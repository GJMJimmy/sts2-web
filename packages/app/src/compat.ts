// Compat for engines without paint-order on HTML text: the labels outline themselves with `-webkit-text-stroke` +
// `paint-order: stroke fill`, but Chromium applies paint-order to HTML text only from 123 (before that it knows the
// property from SVG and ignores it for text), so the stroke paints over the fill and every outlined label turns into
// a dark smudge. @supports cannot tell the engines apart (old Chromium still parses paint-order for SVG), so the
// engine version decides; Gecko has had it since 60 and WebKit since 11. On the affected engines this installs an
// override sheet that swaps every stroked rule's stroke for a text-shadow ring of the same colour and radius —
// shadows paint behind the fill, i.e. the same stroke-behind-fill look. `?legacy-text=1` / `?legacy-text=0` force
// either path to test both on a modern browser.

function engineLacksTextPaintOrder(): boolean {
  const ua = navigator.userAgent;
  const chrome = /(?:Chrome|Chromium)\/(\d+)/.exec(ua);
  if (chrome) return Number(chrome[1]) < 123; // Chromium's forks (WebView, Edge, Opera, ...) all carry the token
  const ff = /Firefox\/(\d+)/.exec(ua);
  return ff ? Number(ff[1]) < 60 : false;
}

/** false → the stylesheets' `-webkit-text-stroke` + `paint-order: stroke fill` does not render as written. */
export const textPaintOrder = (() => {
  const forced = new URLSearchParams(location.search).get('legacy-text');
  if (forced) return forced !== '1';
  return !engineLacksTextPaintOrder();
})();

/** A text-shadow ring for the outer half of a centred `w px` stroke; without a colour the shadows use currentColor. */
export function strokeShadowRing(w: number, color = ''): string {
  const r = w / 2, n = r <= 3 ? 8 : r <= 6 ? 12 : 16;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    parts.push(`${(Math.cos(a) * r).toFixed(1)}px ${(Math.sin(a) * r).toFixed(1)}px${color ? ` ${color}` : ''}`);
  }
  return parts.join(', ');
}

/** The stroke part of a label's inline style: stroke-behind-fill where possible, the ring on the old engines. */
export const inlineStroke = (w: number, color: string) =>
  textPaintOrder ? `-webkit-text-stroke: ${w}px ${color}; paint-order: stroke fill;` : `text-shadow: ${strokeShadowRing(w, color)};`;

if (!textPaintOrder) {
  document.documentElement.classList.add('no-text-paint-order');
  const sheet = document.createElement('style');
  document.head.append(sheet);
  const rebuild = () => {
    let css = '';
    const walk = (rules: CSSRuleList) => {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (rule instanceof CSSGroupingRule) walk(rule.cssRules); // @media / @supports blocks
        if (!(rule instanceof CSSStyleRule) || !/^stroke/.test(rule.style.getPropertyValue('paint-order'))) continue;
        const w = parseFloat(rule.style.getPropertyValue('-webkit-text-stroke-width'));
        if (!w) continue;
        const color = rule.style.getPropertyValue('-webkit-text-stroke-color');
        const shadows = [strokeShadowRing(w, color), rule.style.getPropertyValue('text-shadow')].filter(Boolean).join(', ');
        css += `html.no-text-paint-order ${rule.selectorText}{-webkit-text-stroke-width:0;text-shadow:${shadows}}`;
      }
    };
    for (let i = 0; i < document.styleSheets.length; i++) { try { walk(document.styleSheets[i].cssRules); } catch { /* a cross-origin sheet */ } }
    if (sheet.textContent !== css) sheet.textContent = css; // writing it again would re-trigger the observer below
  };
  // component stylesheets join late (vite dev injects <style> tags per import, HMR rewrites them, the production
  // <link> may still be loading), so rebuild on every head change and once more when the document settles
  new MutationObserver(rebuild).observe(document.head, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', rebuild, { once: true });
  addEventListener('load', rebuild, { once: true });
  rebuild();
}
