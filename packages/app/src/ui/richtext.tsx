// Game BBCode ([gold]…[/gold], [img]res://…[/img], [b], [center], effects) → HTML.
import { imageUrl } from '../assets';
const COLORS: Record<string, string> = {
  gold: '#efc851', blue: '#87ceeb', green: '#7fff00', red: '#ff5555', purple: '#ee82ee', pink: '#ff78a0', aqua: '#2aebbe',
  orange: '#ffa518', gray: '#a0a0a0', grey: '#a0a0a0', white: '#ffffff', yellow: '#fff27a', cream: '#fff6e2',
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Per-glyph effects (RichTextSine / Jitter / ThinkyDots / FadeIn / FlyIn): each character becomes a span with its
 * index relative to the effect's start (CharFXTransform.RelativeIndex); style.css animates them. */
const FX = new Set(['sine', 'jitter', 'thinky_dots', 'fade_in', 'fly_in', 'shake']);
export function bbcodeToHtml(src: string): string {
  let out = '';
  const re = /\[(\/?)([a-z_]+)((?:=[^\]\s]*)?(?:\s+[a-z_]+=[^\]\s]*)*)\]/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const stack: string[] = [];
  const colors: string[] = []; // open colour tags, innermost last
  const fx: { i: number }[] = [];
  const text = (raw: string) => {
    const cur = fx[fx.length - 1];
    if (!cur) return esc(raw).replace(/\n/g, '<br>');
    let o = '';
    for (const ch of raw) o += ch === '\n' ? '<br>' : `<span class="rt-c" style="--i:${cur.i++}">${esc(ch)}</span>`;
    return o;
  };
  while ((m = re.exec(src))) {
    out += text(src.slice(last, m.index));
    last = re.lastIndex;
    const [, close, tag0, rest] = m;
    const tag = tag0.toLowerCase();
    const arg = rest?.startsWith('=') ? rest.slice(1).split(/\s+/)[0] : undefined;
    const attrs: Record<string, string> = {};
    for (const a of (rest ?? '').matchAll(/\s+([a-z_]+)=([^\]\s]*)/gi)) attrs[a[1].toLowerCase()] = a[2];
    if (tag === 'img' && !close) {
      const end = src.indexOf('[/img]', last);
      const path = src.slice(last, end < 0 ? undefined : end);
      last = end < 0 ? src.length : end + 6;
      re.lastIndex = last;
      const url = imageUrl(path);
      out += url ? `<img class="rt-icon" src="${url}">` : '';
      continue;
    }
    if (close) {
      if (stack.length) out += stack.pop();
      if (COLORS[tag] || tag === 'color') colors.pop();
      if (FX.has(tag)) fx.pop();
      continue;
    }
    // MegaRichTextLabel [gold] leaves text that is already green (a changed value) green
    if (COLORS[tag]) { const keep = tag === 'gold' && colors[colors.length - 1] === 'green'; out += keep ? '<span>' : `<span style="color:${COLORS[tag]}">`; stack.push('</span>'); colors.push(keep ? 'green' : tag); }
    else if (tag === 'color') { out += `<span style="color:${arg}">`; stack.push('</span>'); colors.push(String(arg)); }
    else if (tag === 'b') { out += '<b>'; stack.push('</b>'); }
    else if (tag === 'i') { out += '<i>'; stack.push('</i>'); }
    else if (tag === 'center') { out += '<span class="rt-center">'; stack.push('</span>'); }
    else if (FX.has(tag)) {
      // env: color / visible for sine, jitter and thinky dots; speed / tick for fade_in; offset_x / offset_y for fly_in
      const st: string[] = [];
      if (attrs.color) st.push(`color:${attrs.color}`);
      if (attrs.visible === 'false') st.push('visibility:hidden');
      if (tag === 'fade_in') { const sp = +(attrs.speed ?? 4), tk = +(attrs.tick ?? 0.01); st.push(`--dur:${1 / sp}s`, `--tick:${tk / sp}s`); }
      if (tag === 'fly_in') { const x = +(attrs.offset_x ?? 0), y = +(attrs.offset_y ?? 0); st.push(`--fx:${x}px`, `--fy:${y}px`, `--rot:${x < 0 ? -20 : 20}deg`); }
      // Godot's built-in [shake] (rate 20, level 5) reads like the game's jitter
      out += `<span class="rt-${tag === 'shake' ? 'jitter' : tag}"${st.length ? ` style="${st.join(';')}"` : ''}>`;
      stack.push('</span>');
      fx.push({ i: 0 });
    }
    else if (tag === 'font_size') { out += `<span style="font-size:${+(arg ?? 20)}px">`; stack.push('</span>'); }
    else { out += '<span>'; stack.push('</span>'); }
  }
  out += text(src.slice(last));
  while (stack.length) out += stack.pop();
  return out;
}
export function RichText({ text, class: cls }: { text: string; class?: string }) {
  return <span class={cls} dangerouslySetInnerHTML={{ __html: bbcodeToHtml(text ?? '') }} />;
}

/**
 * A rendered rich text's glyphs in reading order, for visible_ratio reveals: plain text nodes are split into one span
 * per character the first time (effect glyphs are already spans).
 */
export function glyphs(root: HTMLElement): HTMLElement[] {
  if (!root.dataset.split) {
    root.dataset.split = '1';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) { const t = walker.currentNode as Text; if (!(t.parentElement?.classList.contains('rt-c'))) texts.push(t); }
    for (const t of texts) {
      const frag = document.createDocumentFragment();
      for (const ch of t.textContent ?? '') { const sp = document.createElement('span'); sp.className = 'rt-g'; sp.textContent = ch; frag.appendChild(sp); }
      t.replaceWith(frag);
    }
  }
  return Array.from(root.querySelectorAll<HTMLElement>('.rt-g, .rt-c'));
}
