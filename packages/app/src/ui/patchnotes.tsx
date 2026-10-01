// NMainMenu's PatchNotesButton (top right) and NPatchNotesScreen (screens/patch_notes_screen.tscn): not a submenu but a
// layer of the main menu over its blur backstop. The notes (res://localization/eng/patch_notes/*.md, English only) are
// BBCode shown verbatim, newest first; the arrows page through older / newer ones.
import { useEffect, useState } from 'preact/hooks';
import { A, imageUrl } from '../assets';
import { invalidate } from '../store';
import { playOneShot } from '../audio';
import { hsvFilter } from '../filters';
import { RichText } from './richtext';
import { BackButton, NGoldArrowButton } from './buttons';
import { ScrollArea } from './scrollable';
import { backstop } from './menu';
import './patchnotes.css';

const pn = { open: false, shown: false, index: 0, gen: 0, paths: null as string[] | null, text: new Map<string, string>() };
/** DirAccess.GetFilesAt (alphabetical, i.e. by date) reversed: index 0 is the newest. */
const paths = async () => (pn.paths ??= ((await (await fetch(A + 'patch_notes/index.json')).json()) as string[]).reverse());
async function load(i: number) {
  const name = (await paths())[i];
  if (name && !pn.text.has(name)) pn.text.set(name, await (await fetch(A + 'patch_notes/' + name)).text().catch(() => ''));
  invalidate();
}
/** Open: backstop, toggle and back on, α → 1 over 0.25 s (instant the first time: the root starts opaque). */
function open() {
  if (pn.open) return;
  pn.open = true;
  pn.shown = true;
  pn.gen++;
  backstop(true);
  void load(pn.index);
  invalidate();
}
function close() {
  if (!pn.open) return;
  pn.open = false;
  backstop(false);
  const gen = pn.gen;
  setTimeout(() => { if (!pn.open && gen === pn.gen) { pn.shown = false; invalidate(); } }, 250);
  invalidate();
}
function page(d: number) {
  const n = pn.paths?.length ?? 0;
  const next = pn.index + d;
  if (next < 0 || next >= n) return;
  pn.index = next;
  void load(next);
}
/** "yyyy_MM_d" (invariant) → "MMMM d, yyyy" (invariant English). */
function dateOf(name: string) {
  const m = /^(\d{4})_(\d{2})_(\d{1,2})$/.exec(name.split('.')[0]);
  if (!m) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
}

export function PatchNotes() {
  useEffect(() => () => { if (pn.open) { pn.open = false; pn.shown = false; } }, []);
  return (
    <>
      <PatchNotesIcon class="pn-button" onClick={open} />
      {pn.shown && <PatchNotesScreen />}
    </>
  );
}

/** NPatchNotesButton: the icon; hover v 1.2 and 5° at once (ui_hover), back on unhover. */
function PatchNotesIcon({ class: cls, onClick }: { class: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  return (
    <div class={cls}
      onPointerEnter={() => { setHover(true); playOneShot('event:/sfx/ui/clicks/ui_hover'); }} onPointerLeave={() => { setHover(false); setDown(false); }}
      onPointerDown={(e) => { if (e.button === 0) { setDown(true); playOneShot('event:/sfx/ui/clicks/ui_click'); } }}
      onPointerUp={(e) => { if (e.button === 0 && down) { setDown(false); onClick(); } }}>
      <img src={imageUrl('images/ui/main_menu/patch_notes_icon.png') ?? ''} style={{ filter: hsvFilter(1, 1, hover ? 1.2 : 1), rotate: hover ? '5deg' : '0deg' }} />
    </div>
  );
}

function PatchNotesScreen() {
  const [first] = useState(() => pn.gen === 1);
  const n = pn.paths?.length ?? 0;
  const name = pn.paths?.[pn.index] ?? '';
  const text = pn.text.get(name);
  // hotkeys (released): ← older, → newer, Esc closes
  useEffect(() => {
    const up = (e: KeyboardEvent) => {
      if (!pn.open) return;
      if (e.key === 'ArrowLeft') page(1);
      else if (e.key === 'ArrowRight') page(-1);
      else if (e.key === 'Escape') close();
    };
    window.addEventListener('keyup', up);
    return () => window.removeEventListener('keyup', up);
  }, []);
  return (
    <div class={'pn-screen' + (pn.open ? ' open' : '') + (first ? ' first' : '')}>
      {text != null && (
        <ScrollArea key={name} rect={[199, 1, 1520, 1080]} bar={[1819, 131, 50, 820]}>
          <div class="pn-content">
            <div class="pn-text">
              <div class="pn-date">{dateOf(name)}</div>
              <RichText text={text} />
            </div>
          </div>
        </ScrollArea>
      )}
      {pn.index < n - 1 && <NGoldArrowButton left class="pn-prev" onClick={() => page(1)} />}
      {pn.index > 0 && <NGoldArrowButton left flip class="pn-next" onClick={() => page(-1)} />}
      <PatchNotesIcon class="pn-toggle" onClick={close} />
      <BackButton enabled={pn.open} onClick={close} />
    </div>
  );
}
