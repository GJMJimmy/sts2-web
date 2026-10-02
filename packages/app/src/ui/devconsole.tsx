// NDevConsole (scenes/debug/dev_console.tscn, CanvasLayer 10): the game's own DevConsole behind a panel over the top
// half of the screen. Keys follow NDevConsole._Input. On while developing or with ?dev=1 (the original gates its debug
// commands on the editor / SettingsSave.FullConsole).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { G } from '../game';
import { ui, invalidate } from '../store';
import { bbcodeToHtml } from './richtext';

const enabled = import.meta.env.DEV || new URLSearchParams(location.search).get('dev') === '1';
// commands that reach for Steam, Sentry, the OS file manager or scenes the port does not have
const BLOCKED = ['art', 'cloud', 'getlogs', 'leaderboard', 'log-history', 'multiplayer', 'open', 'sentry', 'trailer'];
const USAGE = "[color=#888888]Use 'F11' to toggle console fullscreen. Press 'up arrow' to use the last command. You can autocomplete commands with 'tab'.[/color]\n\n";

const con = { visible: false, full: false, out: USAGE, tab: '', ghost: '' }; // tab: the selection menu, shown instead of the output
let dev: any = null; // DevConsole, created on the first open (it keeps console_history.log under user://)
let input: HTMLInputElement | null = null;
let yank = '';
/** TabCompletionState. */
const sel = { on: false, index: -1, candidates: [] as string[], last: null as any };

function show() {
  if (!dev) {
    dev = new G.DevConsole().$ctor_DevConsole(true);
    for (const c of BLOCKED) dev._commands.Remove(c);
  }
  con.visible = true;
  invalidate(); // the input takes the focus once it is on screen (DevConsole below)
}
function hide() { con.visible = false; input?.blur(); invalidate(); }

const text = () => input?.value ?? '';
/** LineEdit.Text = …, with the caret where the caller leaves it (the end unless given) and the ghost text following. */
function setText(t: string, caret = t.length) {
  if (!input) return;
  input.value = t;
  input.setSelectionRange(caret, caret);
  updateGhost();
}
/** DevConsole.GetCompletionResults; a command whose completions throw (remove_card looks at the hand: outside a
 * combat there is none) offers nothing. */
function complete(t: string) {
  try { return dev.GetCompletionResults(t); } catch (e) { console.warn(e); return { Candidates: [] as string[], CommonPrefix: '' }; }
}
/** UpdateGhostText: the rest of the only completion, grey, after what is typed. */
function updateGhost() {
  const t = text();
  let g = '';
  if (!sel.on && t.trim()) {
    const r = complete(t);
    if (r.Candidates.length === 1 && r.CommonPrefix.toLowerCase().startsWith(t.toLowerCase())) g = ' '.repeat(t.length) + r.CommonPrefix.slice(t.length);
  }
  con.ghost = g;
  invalidate();
}

/** Candidates of a completion: none leaves selection mode, one is filled in, several open (or refresh) the menu. */
function offer(r: any) {
  sel.last = r;
  const n = r.Candidates.length;
  if (n === 0) exitSelection();
  else if (n === 1) { setText(r.CommonPrefix); exitSelection(); }
  else { sel.candidates = [...r.Candidates]; sel.on = true; sel.index = 0; con.ghost = ''; renderSelection(); }
}
/** AutocompleteCommand (Tab). */
function autocomplete() {
  const t = text();
  let r = complete(t);
  if (!t.trim() && !r.Candidates.length) r = complete('');
  offer(r);
  if (sel.on) input?.setSelectionRange(text().length, text().length);
}
/** OnInputTextChanged: typing filters the open menu. */
function onInput() {
  if (sel.on) offer(complete(text()));
  updateGhost();
}
/** RenderSelectionMenu: at most 12 candidates around the selected one. */
function renderSelection() {
  const c = sel.candidates, n = c.length, T = G.CompletionType, type = sel.last?.Type, ctx = sel.last?.ArgumentContext;
  const lines = [
    type === T.Command ? 'Select command:' : type === T.Subcommand ? `Select ${ctx} action:` : type === T.Argument ? `Select ${ctx} argument:` : 'Select option:',
    '[color=gray]Tab/↑↓: navigate, Enter: accept, Esc: cancel, Type to filter[/color]', '',
  ];
  let from = 0, to = n;
  if (n > 12) {
    from = Math.max(0, sel.index - 6);
    to = Math.min(n, from + 12);
    if (to - from < 12) from = Math.max(0, to - 12);
  }
  if (from > 0) lines.push(`[color=gray]↑ ${from} more above ↑[/color]`);
  for (let i = from; i < to; i++) lines.push(i === sel.index ? `[color=yellow]➜ ${c[i]}[/color]` : `  ${c[i]}`);
  if (to < n) lines.push(`[color=gray]↓ ${n - to} more below ↓[/color]`);
  lines.push('', `[color=gray](${n} matches)[/color]`);
  con.tab = lines.join('\n');
  invalidate();
}
function exitSelection() {
  Object.assign(sel, { on: false, index: -1, candidates: [], last: null });
  con.tab = '';
  updateGhost();
}
function navigate(dir: number) {
  const n = sel.candidates.length;
  if (!n) return;
  sel.index = (sel.index + dir + n) % n;
  renderSelection();
}
function acceptSelection() {
  const pick = sel.candidates[sel.index], r = sel.last;
  if (pick === undefined) return;
  setText(r.Type === G.CompletionType.Command ? pick + ' ' : r.CommandPrefix + (pick.includes(' ') ? `"${pick}"` : pick) + ' ');
  exitSelection();
}

/** Up / Down: DevConsole.history is newest first; equal neighbours are stepped over. */
function recall(up: boolean) {
  const h = dev.history;
  if (dev.historyIndex >= h.length) return;
  const t = h[dev.historyIndex], step = up ? 1 : -1;
  const more = () => (up ? dev.historyIndex < h.length - 1 : dev.historyIndex > 0);
  if (more()) do dev.historyIndex += step; while (more() && h[dev.historyIndex] === t);
  setText(t);
}

function processCommand() {
  const t = text();
  if (!t.trim()) return;
  con.out += `[color=#00ff00]➜[/color] ${t}\n`;
  invalidate();
  if (t.trim() === 'clear') { con.out = ''; setText(''); return; }
  if (t.trim() === 'exit') { hide(); return; }
  let ok = false, msg: string;
  try { ({ success: ok, msg } = dev.ProcessCommand(t)); }
  catch (e) { msg = `An exception occurred: ${e}`; console.error(e); }
  con.out += ok ? msg + '\n' : `[color=#ff5555]⚠ ${msg}[/color]\n`;
  con.tab = '';
  setText('');
}

/** HandleReadlineKeybinding: Ctrl + A / E / C / D / K / L / U / W / Y. False for any other key. */
function readline(key: string) {
  const t = text(), c = input?.selectionStart ?? t.length;
  switch (key.toLowerCase()) {
    case 'a': input?.setSelectionRange(0, 0); break;
    case 'e': input?.setSelectionRange(t.length, t.length); break;
    case 'c': setText(''); exitSelection(); break;
    case 'd': hide(); break;
    case 'k': if (c < t.length) { yank = t.slice(c); setText(t.slice(0, c)); } break;
    case 'l': con.out = ''; invalidate(); break;
    case 'u': yank = t; setText(''); exitSelection(); break;
    case 'w': { // DeleteWordBackward
      if (!c) break;
      let i = c - 1;
      while (i >= 0 && /\s/.test(t[i])) i--;
      while (i >= 0 && !/\s/.test(t[i])) i--;
      i++;
      yank = t.slice(i, c);
      setText(t.slice(0, i) + t.slice(c), i);
      break;
    }
    case 'y': if (yank) setText(t.slice(0, c) + yank + t.slice(c), c + yank.length); break;
    default: return false;
  }
  return true;
}

// ' * ^ ` (Key.Apostrophe / Asterisk / Asciicircum / Quoteleft) or Shift+8; by position too, for layouts and input
// methods that report another character
const isToggle = (e: KeyboardEvent) => ["'", '*', '^', '`'].includes(e.key) || e.code === 'Backquote' || e.code === 'Quote' || (e.shiftKey && e.code === 'Digit8');
/** GuiGetFocusOwner is TextEdit / LineEdit: the key is being typed somewhere. */
const typing = () => {
  const el = document.activeElement as HTMLInputElement | null;
  return el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(el.type));
};
// keys the console took on the way down: their release is not the game's either (Escape's would close a screen under it)
const taken = new Set<string>();
if (enabled) {
  // capture, and registered before every other key listener (main.tsx imports this module first): the open console
  // takes the keyboard, like the focused LineEdit under NDevConsole._Input
  window.addEventListener('keydown', (e) => {
    const toggle = isToggle(e);
    if (!con.visible && (!toggle || ui.screen === 'boot' || typing())) return;
    e.stopImmediatePropagation();
    taken.add(e.code);
    if (toggle) { e.preventDefault(); if (con.visible) hide(); else show(); return; }
    if (e.isComposing) return;
    if (document.activeElement !== input) input?.focus(); // a click on the game took the focus: typing still lands here
    const k = e.key;
    let handled = true;
    if (k === 'Escape') { if (sel.on) exitSelection(); else hide(); }
    else if (k === 'F11') { con.full = !con.full; invalidate(); }
    else if (k === 'Tab') { if (sel.on) navigate(1); else autocomplete(); }
    else if (k === 'ArrowUp') { if (sel.on) navigate(-1); else recall(true); }
    else if (k === 'ArrowDown') { if (sel.on) navigate(1); else recall(false); }
    else if (k === 'Enter') { if (sel.on) acceptSelection(); else processCommand(); }
    else handled = e.ctrlKey && readline(k);
    if (handled) e.preventDefault();
  }, true);
  window.addEventListener('keyup', (e) => { if (taken.delete(e.code)) e.stopImmediatePropagation(); }, true);
}

export function DevConsole() {
  const out = useRef<HTMLDivElement>(null);
  const html = useMemo(() => bbcodeToHtml(con.tab || con.out, true), [con.tab, con.out]);
  useLayoutEffect(() => { if (out.current) out.current.scrollTop = out.current.scrollHeight; }, [html]); // scroll_following
  useLayoutEffect(() => { if (con.visible) input?.focus(); }, [con.visible]); // ShowConsole: GrabFocus
  if (!dev) return null;
  return (
    <div class={'viewport dev-console-viewport' + (con.visible ? ' open' : '')}>
      <div class="stage-root dev-console-root">
        <div class={'dev-console' + (con.full ? ' full' : '')}>
          <div class={'dc-output' + (con.tab ? ' tab' : '')} ref={out} dangerouslySetInnerHTML={{ __html: html }} />
          <div class="dc-input">
            <span class="dc-prompt">➜</span>
            <div class="dc-line">
              <input ref={(el) => { input = el; }} onInput={onInput} spellcheck={false} autocomplete="off" autocapitalize="off" />
              <span class="dc-ghost">{con.ghost}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
