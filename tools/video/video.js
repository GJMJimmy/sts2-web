// The intro video as a pure function of time: window.setup(data) builds the page once, window.renderFrame(t) poses
// every element for second t (no CSS animation anywhere), so any frame renders the same in any order.
'use strict';
const W = 1920, H = 1080, FPS = 60;
const $ = (s) => document.querySelector(s);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const P = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  outCubic: (k) => 1 - (1 - k) ** 3, inCubic: (k) => k * k * k, inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  outExpo: (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k)), inExpo: (k) => (k <= 0 ? 0 : 2 ** (10 * k - 10)),
  outBack: (k) => { const c = 1.70158; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; },
  inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2, outQuint: (k) => 1 - (1 - k) ** 5,
};
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const noise1 = (x, s = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i + s * 1013), hash(i + 1 + s * 1013), u) * 2 - 1; };
const fmt = (v, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
function st(e, o) { for (const k in o) e.style[k] = o[k]; return e; }
const blur = (px) => (px > 0.05 ? `blur(${px.toFixed(2)}px)` : '');

/** Split text into per-character spans; <b>…</b> marks gold highlights. */
function split(e, text) {
  e.textContent = '';
  const spans = [];
  for (const part of text.split(/(<b>.*?<\/b>)/)) {
    const hl = part.startsWith('<b>');
    for (const ch of hl ? part.slice(3, -4) : part) {
      const s = el('span', 'ch' + (hl ? ' hl' : ''), e);
      s.textContent = ch;
      spans.push(s);
    }
  }
  return spans;
}
/** Staggered character entrance (rise, unblur, fade) and optional exit window [a, b]. */
function chars(spans, t, t0, { stagger = 0.03, dur = 0.5, y = 24, blurPx = 8, scale = 1, ease = E.outCubic, out = null } = {}) {
  spans.forEach((s, i) => {
    const k = ease(P(t, t0 + i * stagger, t0 + i * stagger + dur));
    let o = k;
    if (out) o *= 1 - E.inCubic(P(t, out[0], out[1]));
    s.style.opacity = o.toFixed(3);
    s.style.transform = `translateY(${((1 - k) * y).toFixed(2)}px) scale(${lerp(scale, 1, k).toFixed(4)})`;
    s.style.filter = blur((1 - k) * blurPx);
  });
}

// ── clips (captured game frames) ────────────────────────────────────────────────────────────────────────────────────
let D = null;
const pending = [];
const clipImg = (parent, cls = 'clip') => el('img', cls, parent);
function showClip(img, name, sec) {
  const n = D.clips[name] ?? 0;
  if (!n) { img.style.visibility = 'hidden'; return; }
  img.style.visibility = '';
  const f = clamp(Math.floor(sec * FPS + 1e-6), 0, n - 1);
  const url = `../../_work/video/clips/${name}/${String(f).padStart(5, '0')}.jpg`;
  if (img.dataset.src !== url) {
    img.dataset.src = url;
    img.src = url;
    pending.push(img.decode().catch(() => {}));
  }
}

// ── shared pieces ───────────────────────────────────────────────────────────────────────────────────────────────────
function makeLogo(parent) {
  const root = el('div', 'logo', parent);
  const cs = [];
  for (const c of ['S', 'T', 'S', '2', '◆', 'W', 'E', 'B']) {
    const s = el('span', 'ch' + (c === '◆' ? ' dot' : ' lg'), root);
    s.textContent = c;
    cs.push(s);
  }
  return {
    root, cs,
    layout() { // one gradient across the whole word, although each letter paints its own
      const w = root.scrollWidth;
      for (const s of cs) if (s.classList.contains('lg')) st(s, { backgroundSize: `${w}px 100%`, backgroundPosition: `${-s.offsetLeft}px 0` });
    },
    pose(t, t0, sweep) {
      cs.forEach((s, i) => {
        const k = E.outExpo(P(t, t0 + i * 0.04, t0 + 0.6 + i * 0.04));
        s.style.opacity = k;
        s.style.transform = `translateY(${(1 - k) * -50}px) scale(${lerp(1.9, 1, k)})`;
        s.style.filter = blur((1 - k) * 18);
      });
      root.style.setProperty('--sweep', `${sweep}%`);
    },
  };
}
function makeTag(parent, no, text) {
  const e = el('div', 'tag', parent, `<b>${no}</b><i></i><span>${text}</span>`);
  return (t, a, b) => {
    const k = E.outCubic(P(t, a, a + 0.5)) * (1 - P(t, b - 0.3, b));
    st(e, { opacity: k, transform: `translateX(${(1 - k) * -30}px)` });
  };
}
function makeWall(parent, cols, rows, seed) {
  const wrap = el('div', 'wallwrap', parent);
  const wall = el('div', 'wall', wrap);
  wall.style.gridTemplateColumns = `repeat(${cols}, 250px)`;
  const imgs = [];
  for (let i = 0; i < cols * rows; i++) {
    const img = el('img', '', wall);
    img.src = D.portraits[Math.floor(hash(i * 7.3 + seed) * D.portraits.length)];
    imgs.push(img);
  }
  el('div', 'fadeedge', wrap);
  return { wrap, wall, imgs };
}
function pop(e, t, t0, base = '') {
  const k = P(t, t0, t0 + 0.4);
  const s = k <= 0 ? 0 : E.outBack(k);
  st(e, { opacity: clamp(k * 3), transform: `${base} scale(${s.toFixed(4)})` });
}

// ── code panels ─────────────────────────────────────────────────────────────────────────────────────────────────────
const KW = new Set('public sealed class override protected async await return this new base export extends function yield void null true false static get'.split(' '));
function hi(line) {
  return line.replace(/("[^"]*"?)|(\b\d+m?\b)|([A-Za-z_$][\w$]*)|([^"\w$]+)/g, (m, s, n, id, other) => {
    if (s) return `<span class="s">${esc(s)}</span>`;
    if (n) return `<span class="n">${m}</span>`;
    if (id) return KW.has(id) ? `<span class="k">${id}</span>` : /^[A-Z]/.test(id) ? `<span class="ty">${id}</span>` : /^\$/.test(id) ? `<span class="fn">${id}</span>` : id;
    return esc(other);
  });
}
const CS = `public sealed class Bash : CardModel
{
    public Bash()
        : base(2, CardType.Attack, CardRarity.Basic, TargetType.AnyEnemy) { }

    protected override async Task OnPlay(PlayerChoiceContext choiceContext,
        CardPlay cardPlay)
    {
        await DamageCmd.Attack(DynamicVars.Damage.BaseValue).FromCard(this)
            .Targeting(cardPlay.Target)
            .WithHitFx("vfx/vfx_attack_blunt", null, "blunt_attack.mp3")
            .Execute(choiceContext);
        await PowerCmd.Apply<VulnerablePower>(cardPlay.Target,
            DynamicVars.Vulnerable.BaseValue, Owner.Creature, this);
    }
}`.split('\n');
const TS = `export class Bash extends CardModel {
  $ctor_Bash() {
    this.$ctor_CardModel(2, CardType.Attack, CardRarity.Basic,
      TargetType.AnyEnemy, true);
    return this;
  }
  OnPlay(choiceContext, cardPlay): $.Task<void> {
    return $.async(function* () {
      yield DamageCmd.Attack$Decimal(this.DynamicVars.Damage.BaseValue)
        .FromCard(this).Targeting(cardPlay.Target)
        .WithHitFx("vfx/vfx_attack_blunt", null, "blunt_attack.mp3")
        .Execute(choiceContext);
      yield PowerCmd.Apply$Creature_Decimal_Creature_CardModel_Boolean_T1(
        VulnerablePower, cardPlay.Target,
        this.DynamicVars.Vulnerable.BaseValue, this.Owner.Creature, this, false);
    }, this);
  }
}`.split('\n');
function makePanel(parent, x, file, sub, lang, color, lines) {
  const p = el('div', 'panel', parent);
  st(p, { left: x + 'px' });
  el('div', 'ph', p, `<b>${file}</b><span>${sub}</span><span class="lang" style="background:${color}22;color:${color}">${lang}</span>`);
  const code = el('div', 'code', p);
  const rows = lines.map(() => { const r = el('div', 'ln', code); const bar = el('div', 'bar', r); const txt = el('span', '', r); return { r, bar, txt }; });
  return { p, rows };
}
const GLYPHS = '<>/\\{}[]=+*#$%&?!01';

// montage: one shot per bar (2 s), clip name + start second inside the clip
const SHOTS = [
  { clip: 'combat', at: 3.2, big: '战斗', sub: '出牌、意图、伤害飘字 —— 全由原作规则代码驱动' },
  { clip: 'combat', at: 14.0, big: '特效', sub: 'VFX 场景整体播放：逐帧精灵 · 粒子 · 骨骼 · 着色器' },
  { clip: 'neow', at: 3.3, rate: 0.8, big: '古神', sub: '涅奥的馈赠：开局遗物与卡牌选择' },
  { clip: 'map', at: 1.6, big: '地图', sub: '原版纸张、点位算法与图例' },
  { clip: 'scene-overgrowth_rest_site', at: 0.5, zoom: 1.3, origin: '48% 64%', big: '篝火', sub: 'Godot 着色器实时翻译：火焰 · 光束 · 粒子' },
  { clip: 'rest', at: 2.8, big: '锻造', sub: '升级预览与锤击特效' },
  { clip: 'shop', at: 0.5, big: '商人', sub: '上架、购买、台词气泡' },
  { clip: 'treasure', at: 0.35, big: '宝箱', sub: '按幕区分的开箱骨骼动画' },
  { clip: 'event', at: 0.8, big: '事件', sub: '原版事件文本、选项与附魔' },
  { clip: 'combat', at: 57.4, rate: 1.2, big: '奖励', sub: '金币 · 药水 · 卡牌奖励' },
  { clip: 'boss', at: 1.0, big: '首领', sub: '幕末 Boss：原版站位、意图与骨骼动画' },
  { clip: 'boss', at: 19.3, big: '首领', sub: '三幕 Boss → 终局「建筑师」→ 胜利' },
];

// ── scenes ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const scenes = [];
function scene(a, b, build, drift = 0) {
  const root = el('div', 'scene', $('#world'));
  scenes.push({ a, b, root, render: build(root), drift });
}

function buildAll() {
  const C = D.cues;

  // 1 ─ cold open + title (0–8)
  scene(0, 8.1, (root) => {
    const back = el('div', 'abs', root);
    st(back, { inset: '0', transformOrigin: '50% 50%' });
    const bimg = clipImg(back);
    const group = el('div', 'abs', root);
    st(group, { inset: '0' });
    const l0 = el('div', 'abs center', group);
    st(l0, { top: '372px', font: '22px var(--mono)', letterSpacing: '.28em', color: 'var(--gold)' });
    const s0 = split(l0, 'GODOT 4.5  ·  C# / .NET 9  ·  FMOD  ·  SPINE 4.2');
    const l1 = el('div', 'abs center serif', group);
    st(l1, { top: '446px', fontSize: '76px' });
    const s1 = split(l1, '一款桌面游戏，');
    const l2 = el('div', 'abs center serif', group);
    st(l2, { top: '556px', fontSize: '76px' });
    const s2 = split(l2, '能不能直接在<b>浏览器</b>里运行？');
    const ring = el('div', 'abs', root);
    st(ring, { left: '960px', top: '470px', width: '10px', height: '10px', borderRadius: '50%', border: '3px solid #ffd9a0', boxShadow: '0 0 30px #ffb060, inset 0 0 20px rgba(255,176,96,.6)' });
    const tg = el('div', 'abs center', root);
    st(tg, { top: '330px', transformOrigin: '50% 40%' });
    const logo = makeLogo(tg);
    const sub = el('div', 'serif', tg);
    st(sub, { marginTop: '34px', fontSize: '46px', letterSpacing: '.34em', color: '#efe3c8', fontWeight: '700' });
    const ss = split(sub, '《杀戮尖塔 2》· 浏览器移植');
    const r1 = el('div', 'rule', tg), r2 = el('div', 'rule', tg);
    st(r1, { top: '292px' }); st(r2, { top: '292px' });
    const cap = el('div', 'abs center', root);
    st(cap, { top: '760px', font: '20px var(--mono)', letterSpacing: '.3em', color: 'var(--muted)' });
    const sc = split(cap, 'TYPESCRIPT  ·  PREACT  ·  PIXI  ·  SPINE  ·  WEB AUDIO');
    D.layout.push(() => logo.layout());
    return (t) => {
      chars(s0, t, 0.45, { stagger: 0.016, dur: 0.3, y: 0, blurPx: 6 });
      chars(s1, t, 1.35, { stagger: 0.07, dur: 0.6, y: 34, blurPx: 14 });
      chars(s2, t, 2.2, { stagger: 0.055, dur: 0.6, y: 34, blurPx: 14 });
      const z = E.inExpo(P(t, 3.2, 4.0));
      st(group, { display: t < 4 ? 'block' : 'none', opacity: 1 - P(t, 3.75, 4.0), transform: `scale(${1 + z * 0.3})`, filter: blur(z * 12) });
      const on = t >= 4;
      tg.style.display = back.style.display = ring.style.display = cap.style.display = on ? 'block' : 'none';
      if (!on) return;
      showClip(bimg, 'menu', 2.6 + (t - 4) * 0.5);
      st(back, { opacity: E.outCubic(P(t, 4, 5.2)) * 0.95, transformOrigin: '100% 100%', transform: `scale(${2.25 + (t - 4) * 0.04})`, filter: 'blur(4px) brightness(.5) saturate(1.05)' });
      const rk = E.outCubic(P(t, 4, 5.0));
      st(ring, { width: `${rk * 2600}px`, height: `${rk * 2600}px`, transform: 'translate(-50%,-50%)', opacity: (1 - rk) * 0.85, borderWidth: `${lerp(8, 1, rk)}px` });
      logo.pose(t, 4.0, lerp(-40, 140, E.inOutSine(P(t, 4.4, 6.6))));
      chars(ss, t, 4.55, { stagger: 0.045, dur: 0.6, y: 16, blurPx: 8 });
      const lk = E.outCubic(P(t, 4.6, 5.8));
      st(r1, { left: `${960 - 40 - lk * 420}px`, width: `${lk * 420}px`, top: '300px' });
      st(r2, { left: '1000px', width: `${lk * 420}px`, top: '300px' });
      chars(sc, t, 5.3, { stagger: 0.012, dur: 0.4, y: 0, blurPx: 4 });
      const ex = E.inCubic(P(t, 7.35, 8.05));
      st(tg, { transform: `scale(${1 + ex * 0.9})`, opacity: 1 - ex, filter: blur(ex * 20) });
      st(cap, { opacity: 1 - ex });
      if (t > 7.35) back.style.opacity = (1 - ex) * 0.95;
    };
  });

  // 2 ─ it runs in the browser (8–16)
  scene(7.9, 16.1, (root) => {
    const cap = el('div', 'abs center serif', root);
    st(cap, { top: '52px', fontSize: '46px', fontWeight: '700' });
    const cs = split(cap, '原作的美术、动画、音频与规则，<b>完整跑在浏览器里</b>');
    const wrap = el('div', 'abs', root);
    st(wrap, { inset: '0', perspective: '1800px' });
    const glow = el('div', 'abs', wrap);
    st(glow, { left: '160px', top: '140px', width: '1600px', height: '860px', background: 'radial-gradient(ellipse, rgba(242,196,109,.22), transparent 65%)', filter: 'blur(20px)' });
    const br = el('div', 'browser', wrap);
    el('div', 'bar', br, `<span class="d" style="background:#ff5f57"></span><span class="d" style="background:#febc2e"></span><span class="d" style="background:#28c840"></span>
      <span class="tab">◆ 杀戮尖塔 2 · Web</span><span class="url">🔒 127.0.0.1:47173/?lang=zhs</span>`);
    const view = el('div', 'view', br);
    const a = clipImg(view), b = clipImg(view);
    const fl = el('div', 'abs', view);
    st(fl, { inset: '0', background: '#fff' });
    const chips = el('div', 'abs chips', root);
    st(chips, { left: '0', right: '0', top: '1004px' });
    const cl = ['Chrome', 'Edge', 'Firefox', 'Safari 18.4+', '触屏平板'].map((x, i) => el('div', 'chip' + (i === 4 ? ' teal' : ''), chips, x));
    const SW = 10.6;
    return (t) => {
      const k = E.outExpo(P(t, 7.95, 9.3));
      const push = E.inOutSine(P(t, 9.3, 15.4));
      const ex = E.inCubic(P(t, 15.4, 16.05));
      st(br, { opacity: P(t, 7.95, 8.2), transform: `translateX(${-ex * 2000}px) translateY(${(1 - k) * 320}px) rotateX(${(1 - k) * 34}deg) scale(${lerp(0.68, 1, k) * (1 + push * 0.05)})`, filter: blur(ex * 24) });
      st(glow, { opacity: k * (1 - ex) });
      if (t < SW + 0.3) showClip(a, 'menu', 3.2 + (t - 8));
      a.style.display = t < SW + 0.3 ? '' : 'none';
      b.style.display = t >= SW ? '' : 'none';
      if (t >= SW) { showClip(b, 'charselect', 0.25 + (t - SW)); b.style.opacity = E.outCubic(P(t, SW, SW + 0.2)); }
      fl.style.opacity = t >= SW ? 0.55 * (1 - P(t, SW, SW + 0.35)) : 0;
      chars(cs, t, 8.7, { stagger: 0.03, dur: 0.5, out: [15.3, 15.8] });
      cl.forEach((c, i) => { pop(c, t, 9.8 + i * 0.16); if (t > 15.3) c.style.opacity = 1 - P(t, 15.3, 15.8); });
    };
  });

  // 3 ─ the transpiler (16–28)
  scene(15.9, 28.1, (root) => {
    const rain = el('div', 'abs', root);
    st(rain, { inset: '0', overflow: 'hidden', WebkitMaskImage: 'linear-gradient(transparent, #000 25%, #000 75%, transparent)' });
    const cols = D.rain.map((lines, i) => {
      const c = el('div', 'abs', rain);
      st(c, { left: `${30 + i * 640}px`, top: '0', width: '620px', font: '13px/20px var(--mono)', color: i === 1 ? '#8fb7d9' : '#9a8f7a', whiteSpace: 'pre', overflow: 'hidden' });
      c.textContent = lines.join('\n');
      return c;
    });
    const tagPose = makeTag(root, '01', '规则层');
    const head = el('div', 'abs center', root);
    st(head, { top: '300px' });
    const no = el('div', 'bignum', head, '01');
    st(no, { fontSize: '220px', color: 'transparent', WebkitTextStroke: '2px var(--gold)', textShadow: '0 0 40px rgba(242,196,109,.25)' });
    const ht = el('div', 'serif', head);
    st(ht, { fontSize: '76px', marginTop: '10px' });
    const hs = split(ht, '规则层：<b>转译</b>，而不是重写');
    const hsub = el('div', '', head);
    st(hsub, { marginTop: '22px', fontSize: '28px', color: 'var(--muted)', letterSpacing: '.12em' });
    const hss = split(hsub, 'Roslyn 写的 C# → TypeScript 转译器 · tools/cs2ts');
    const L = makePanel(root, 60, 'Bash.cs', 'ILSpy 反编译', 'C#', '#b48cff', CS);
    const R = makePanel(root, 1060, 'sts2.ts', '转译产物', 'TS', '#5fb4ff', TS);
    const node = el('div', 'node', root, '<b>cs2ts</b>');
    const nodeL = el('div', 'node-l', root, 'Roslyn 4.14');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    st(svg, { position: 'absolute', left: '0', top: '0', width: '1920px', height: '1080px', overflow: 'visible' });
    root.appendChild(svg);
    const lineY = (i) => 230 + 46 + 18 + i * 24.3 + 12;
    const awaitL = CS.map((l, i) => (/await|async/.test(l) ? i : -1)).filter((i) => i >= 0);
    const yieldR = TS.map((l, i) => (/yield|\$\.async/.test(l) ? i : -1)).filter((i) => i >= 0);
    const pairs = awaitL.map((l, j) => [l, yieldR[j]]);
    const paths = pairs.map(() => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#f2c46d'); p.setAttribute('stroke-width', '2');
      p.style.filter = 'drop-shadow(0 0 6px #f2c46d)';
      svg.appendChild(p);
      return p;
    });
    const beam = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    beam.setAttribute('stroke', '#ffe3a8'); beam.setAttribute('stroke-width', '4'); beam.style.filter = 'drop-shadow(0 0 10px #ffb060)';
    svg.appendChild(beam);
    const chipBox = el('div', 'abs', root);
    st(chipBox, { left: '0', right: '0', top: '830px' });
    const CH = ['async / await → 生成器', 'goto → 状态机', 'decimal · int64 · 无符号截断', 'LINQ · 模式匹配 · 元组', 'out / ref → {v} 盒子', '静态构造 beforefieldinit'];
    const chipEls = CH.map((c, i) => {
      const e = el('div', 'chip abs' + (i % 2 ? ' teal' : ''), chipBox, c);
      st(e, { top: `${Math.floor(i / 3) * 76}px`, left: `${[250, 790, 1300][i % 3] + (i >= 3 ? 60 : 0)}px`, fontSize: '26px' });
      return e;
    });
    const big = el('div', 'abs center', root);
    st(big, { top: '220px', paddingTop: '80px', paddingBottom: '80px', background: 'radial-gradient(ellipse 42% 50% at 50% 45%, rgba(6,7,11,.9), rgba(6,7,11,.5) 60%, transparent 80%)' });
    const num = el('div', 'bignum', big);
    st(num, { fontSize: '260px', textShadow: '0 0 60px rgba(242,196,109,.35)' });
    const bl = el('div', 'serif', big);
    st(bl, { fontSize: '50px', marginTop: '14px', fontWeight: '700' });
    const bls = split(bl, '行 TypeScript 规则层，与原作<b>逐语句对应</b>');
    const b2 = el('div', '', big);
    st(b2, { fontSize: '28px', marginTop: '26px', color: 'var(--muted)', letterSpacing: '.08em' });
    const b2s = split(b2, '3,299 个 C# 文件 · 606 张卡 · 297 件遗物 · 一次转译约 11 秒');
    return (t) => {
      const rk = E.outCubic(P(t, 16.0, 17.0)) * (1 - E.inCubic(P(t, 27.5, 28.05)));
      const boost = E.inCubic(P(t, 25.3, 28)) * 1400;
      cols.forEach((c, i) => st(c, { opacity: (0.08 + 0.1 * E.outCubic(P(t, 25.3, 26.2))) * rk, transform: `translateY(${-(t - 16) * (40 + i * 14) - boost * (0.8 + i * 0.2)}px)`, filter: blur(i === 1 ? 0 : 1.2) }));
      tagPose(t, 17.1, 27.9);
      const hk = 1 - E.inCubic(P(t, 16.9, 17.3));
      st(head, { display: t < 17.35 ? 'block' : 'none', opacity: hk, transform: `translateY(${(1 - hk) * -40}px)` });
      st(no, { opacity: E.outCubic(P(t, 16.0, 16.4)), transform: `scale(${lerp(1.4, 1, E.outExpo(P(t, 16.0, 16.5)))})` });
      chars(hs, t, 16.1, { stagger: 0.035, dur: 0.45 });
      chars(hss, t, 16.35, { stagger: 0.01, dur: 0.3, y: 10 });
      // panels
      const pin = E.outCubic(P(t, 17.0, 17.5));
      const pout = E.inCubic(P(t, 25.2, 25.7));
      for (const [pn, dir] of [[L.p, -1], [R.p, 1]]) st(pn, { display: t > 16.95 && t < 25.8 ? 'block' : 'none', opacity: pin * (1 - pout), transform: `translateX(${dir * (1 - pin) * 80}px) scale(${1 - pout * 0.1})`, filter: blur(pout * 14) });
      // C#: typed
      const total = CS.reduce((n, l) => n + l.length + 1, 0);
      const typed = Math.floor(total * P(t, C.typing[0][0], C.typing[0][1]));
      let left = typed;
      L.rows.forEach((row, i) => {
        const l = CS[i];
        const n = clamp(left, 0, l.length);
        const caret = left >= 0 && left <= l.length && t < C.typing[0][1] + 0.4 && Math.floor(t * 4) % 2 === 0 ? '<span class="caret"></span>' : '';
        row.txt.innerHTML = left > 0 ? hi(l.slice(0, n)) + caret : caret;
        left -= l.length + 1;
      });
      // beam through the node
      const bk = P(t, 19.5, 20.0);
      const bx = bk < 0.5 ? lerp(860, 960, bk * 2) : lerp(960, 1060, bk * 2 - 1);
      beam.setAttribute('x1', String(bk < 0.5 ? 860 : 960)); beam.setAttribute('y1', '720');
      beam.setAttribute('x2', String(bx)); beam.setAttribute('y2', '720');
      beam.style.opacity = bk > 0 && bk < 1 ? '1' : '0';
      const nk = E.outBack(P(t, 17.2, 17.6));
      const pulse = Math.exp(-Math.max(0, t - 19.75) * 5) * (t > 19.75 ? 1 : 0);
      st(node, { display: t > 17.1 && t < 25.8 ? 'grid' : 'none', opacity: (1 - pout), transform: `scale(${nk * (1 + pulse * 0.35)})`, boxShadow: `0 0 ${60 + pulse * 120}px rgba(242,196,109,${0.35 + pulse * 0.5})` });
      st(nodeL, { display: node.style.display === 'none' ? 'none' : 'block', opacity: nk * (1 - pout) });
      // TS: decoded line by line
      const f = Math.floor(t * FPS);
      R.rows.forEach((row, i) => {
        const r0 = 20.0 + i * 0.055, l = TS[i];
        if (t < r0) { row.txt.innerHTML = ''; return; }
        const k = P(t, r0, r0 + 0.4);
        if (k >= 1) { row.txt.innerHTML = hi(l); return; }
        const res = Math.floor(k * l.length);
        let s = '';
        for (let j = 0; j < l.length; j++) s += j < res || l[j] === ' ' ? l[j] : GLYPHS[Math.floor(hash(j * 13 + f * 7 + i) * GLYPHS.length)];
        row.txt.innerHTML = `<span style="color:#5fe0d4">${esc(s)}</span>`;
      });
      // await ↔ yield
      const hk2 = E.outCubic(P(t, 21.2, 21.6)) * (1 - P(t, 24.8, 25.2));
      for (const i of awaitL) L.rows[i].bar.style.opacity = hk2;
      for (const i of yieldR) R.rows[i].bar.style.opacity = hk2;
      pairs.forEach(([l, r], j) => {
        const y1 = lineY(l), y2 = lineY(r);
        paths[j].setAttribute('d', `M 846 ${y1} C 960 ${y1}, 960 ${y2}, 1074 ${y2}`);
        const dk = E.inOutCubic(P(t, 21.3 + j * 0.12, 21.9 + j * 0.12));
        paths[j].setAttribute('stroke-dasharray', '400'); paths[j].setAttribute('stroke-dashoffset', String(400 * (1 - dk)));
        paths[j].style.opacity = hk2;
      });
      chipEls.forEach((c, i) => { pop(c, t, C.pops[i]); if (t > 25.1) c.style.opacity = 1 - P(t, 25.1, 25.5); c.style.display = t > 25.6 ? 'none' : ''; });
      // the line count
      const on = t > 25.3;
      big.style.display = on ? 'block' : 'none';
      if (on) {
        const ck = E.outExpo(P(t, 25.45, 26.9));
        num.textContent = fmt(Math.round(146047 * ck));
        const bex = E.inCubic(P(t, 27.45, 28.05));
        st(big, { opacity: E.outCubic(P(t, 25.3, 25.6)) * (1 - bex), transform: `scale(${lerp(0.9, 1, E.outCubic(P(t, 25.3, 26))) * (1 + bex * 0.4)})`, filter: blur(bex * 16) });
        chars(bls, t, 25.9, { stagger: 0.03, dur: 0.45 });
        chars(b2s, t, 26.5, { stagger: 0.012, dur: 0.35, y: 10 });
      }
    };
  }, 0.004);

  // 4 ─ assets (28–36)
  scene(27.9, 36.1, (root) => {
    const wall = makeWall(root, 18, 10, 3);
    const tagPose = makeTag(root, '02', '资源管线');
    const title = el('div', 'abs center serif', root);
    st(title, { top: '140px', fontSize: '60px', fontWeight: '700' });
    const ts = split(title, '1.65 GB 的游戏包，压成 <b>Web 就绪</b> 的资源');
    const num = el('div', 'abs center bignum', root);
    st(num, { top: '250px', fontSize: '230px' });
    const track = el('div', 'abs', root);
    st(track, { left: '360px', top: '500px', width: '1200px', height: '10px', borderRadius: '5px', background: 'rgba(255,255,255,.08)' });
    const fill = el('div', 'abs', track);
    st(fill, { left: '0', top: '0', height: '10px', borderRadius: '5px', background: 'linear-gradient(90deg, var(--gold), var(--teal))', boxShadow: '0 0 20px rgba(95,224,212,.6)' });
    const stamp = el('div', 'abs serif', root);
    st(stamp, { left: '1500px', top: '280px', fontSize: '64px', color: 'var(--gold)', border: '4px solid var(--gold)', borderRadius: '14px', padding: '4px 22px', transformOrigin: '50% 50%', textShadow: '0 0 20px rgba(242,196,109,.5)' });
    stamp.textContent = '13× 更小';
    const ROWS = [['贴图', '3,358 张 WebP', '1,112 MB', '38.9 MB', '29×'], ['图集', '2,575 个精灵重打包', '66 MB', '3.7 MB', '18×'], ['字体', 'CJK 子集 woff2', '133 MB', '8.0 MB', '17×'], ['音频', 'FMOD → 单声道 Opus', '283 MB', '31.4 MB', '9×']];
    const rows = ROWS.map((r, i) => {
      const e = el('div', 'row', root, `<div class="l">${r[0]}<small>${r[1]}</small></div><div class="v">${r[2]} → <em>${r[3]}</em></div><div class="r">${r[4]}</div>`);
      e.style.top = `${580 + i * 80}px`;
      return e;
    });
    const note = el('div', 'abs center', root);
    st(note, { top: '930px', fontSize: '24px', color: 'var(--muted)', letterSpacing: '.1em' });
    const ns = split(note, 'Spine 骨骼 160 套原样复用 · 贴图按 0.5x 供给 · 音乐按幕懒加载，每幕约 5 MB');
    return (t) => {
      const wk = E.outCubic(P(t, 27.95, 29));
      st(wall.wrap, { opacity: 0.8 * wk * (1 - P(t, 35.5, 36.05)), filter: 'brightness(.62) saturate(.85)' });
      st(wall.wall, { transform: `translate(-50%, -50%) rotateX(55deg) rotateZ(-16deg) translateY(${-(t - 28) * 46}px) scale(1.25)` });
      tagPose(t, 28.1, 35.9);
      const ex = E.inCubic(P(t, 35.4, 36.0));
      chars(ts, t, 28.2, { stagger: 0.03, dur: 0.45, out: [35.4, 35.8] });
      const ck = E.inOutCubic(P(t, C.ticks[0][0], C.ticks[0][1]));
      const v = lerp(1626, 123.0, ck);
      num.innerHTML = `${fmt(v, 1)}<span style="font-size:.36em;color:var(--muted)"> MB</span>`;
      const nk = E.outCubic(P(t, 28.6, 29.1));
      st(num, { opacity: nk * (1 - ex), transform: `translateY(${(1 - nk) * 30}px)`, color: ck > 0.98 ? 'var(--teal)' : 'var(--text)' });
      st(track, { opacity: nk * (1 - ex) });
      fill.style.width = `${1200 * (v / 1626)}px`;
      pop(stamp, t, 31.7, 'rotate(-8deg)');
      if (t > 35.3) stamp.style.opacity = 1 - P(t, 35.3, 35.7);
      rows.forEach((r, i) => {
        const k = E.outCubic(P(t, 32.1 + i * 0.3, 32.6 + i * 0.3));
        st(r, { opacity: k * (1 - ex), transform: `translateX(${(1 - k) * -60}px)` });
      });
      chars(ns, t, 33.6, { stagger: 0.008, dur: 0.3, y: 8, out: [35.4, 35.8] });
    };
  }, 0.004);

  // 5 ─ renderer, audio, then the build-up (36–48)
  scene(35.9, 47.8, (root) => {
    const tagPose = makeTag(root, '03', '表现层');
    const title = el('div', 'abs serif', root);
    st(title, { left: '110px', top: '250px', fontSize: '64px', lineHeight: '1.25', fontWeight: '900' });
    title.innerHTML = '<div></div><div></div>';
    const t1 = split(title.children[0], '把原作场景'), t2 = split(title.children[1], '原样搬上 <b>WebGL</b>');
    const ITEMS = [['PixiJS 8 · WebGL2 渲染', ''], ['Spine 4.2 骨骼动画', '160 套'], ['.tscn 场景摊平重建', '907 个'], ['Godot 着色器 → GLSL ES 3.0', '52 / 58'], ['粒子发射器 CPU 模拟', '一发射器一绘制']];
    const items = ITEMS.map(([a, b], i) => { const e = el('div', 'list', root, `<i></i><span>${a}</span><small>${b}</small>`); e.style.top = `${470 + i * 76}px`; return e; });
    const tilt = el('div', 'tilt', root);
    const inner = el('div', 'abs', tilt);
    st(inner, { inset: '0', transformStyle: 'preserve-3d' });
    const planes = [0, 1, 2].map((j) => { const p = el('div', 'pl', inner); return { p, img: clipImg(p) }; });
    planes[0].p.style.filter = 'brightness(1.15) saturate(1.1)';
    planes[1].p.style.filter = 'hue-rotate(150deg) saturate(1.6) brightness(1.2)';
    planes[2].p.style.filter = 'grayscale(1) brightness(1.5) contrast(1.2)';
    // audio
    const at = el('div', 'abs center serif', root);
    st(at, { top: '200px', fontSize: '62px', fontWeight: '700' });
    const ats = split(at, 'FMOD 银行 → <b>Web Audio</b> 事件引擎');
    const wave = el('canvas', '', root);
    wave.width = 1500; wave.height = 300;
    st(wave, { left: '210px', top: '330px' });
    const wctx = wave.getContext('2d');
    const an = el('div', 'abs center bignum', root);
    st(an, { top: '660px', fontSize: '170px' });
    const al = el('div', 'abs center', root);
    st(al, { top: '850px', fontSize: '32px', letterSpacing: '.08em' });
    const als = split(al, '个音频事件，全部按原作的事件数据播放');
    const a2 = el('div', 'abs center', root);
    st(a2, { top: '910px', fontSize: '24px', color: 'var(--muted)', letterSpacing: '.12em' });
    const a2s = split(a2, '音乐按进度切换分层 · 环境音 · 随机音高与音量 · 四路音量总线');
    // riser words over flashes of the rooms
    const WORDS = [['战斗', 'combat', 3.4], ['地图', 'map', 1.8], ['事件', 'event', 1.0], ['商人', 'shop', 0.6], ['篝火', 'scene-hive_rest_site', 1.0], ['宝箱', 'treasure', 0.4], ['锻造', 'rest', 2.9], ['首领', 'boss', 4.0]];
    const wbg = el('div', 'abs', root);
    st(wbg, { inset: '0' });
    const wimg = clipImg(wbg);
    const word = el('div', 'word', root);
    return (t) => {
      tagPose(t, 36.1, 43.9);
      // part A: layers
      const A = t < 40.9;
      title.style.display = tilt.style.display = A ? 'block' : 'none';
      items.forEach((e) => (e.style.display = A ? 'flex' : 'none'));
      if (A) {
        const ax = E.inCubic(P(t, 40.3, 40.85));
        chars(t1, t, 36.15, { stagger: 0.05, dur: 0.5 });
        chars(t2, t, 36.4, { stagger: 0.05, dur: 0.5 });
        st(title, { opacity: 1 - ax, transform: `translateX(${-ax * 120}px)` });
        items.forEach((e, i) => { const k = E.outCubic(P(t, 36.8 + i * 0.5, 37.3 + i * 0.5)); st(e, { opacity: k * (1 - ax), transform: `translateX(${(1 - k) * -40 - ax * 120}px)` }); });
        const tk = E.outExpo(P(t, 36.0, 37.0));
        const sep = E.inOutCubic(P(t, 37.2, 38.4)) * (1 - E.inOutCubic(P(t, 39.8, 40.4)));
        st(tilt, { opacity: tk * (1 - ax), transform: `translateX(${(1 - tk) * 300 + ax * 400}px)` });
        st(inner, { transform: `rotateY(${-22 + (t - 36) * 1.2}deg) rotateX(4deg)` });
        planes.forEach(({ p, img }, j) => {
          const second = t >= 38.6;
          showClip(img, second ? 'scene-hive_rest_site' : 'combat', second ? 0.3 + (t - 38.6) : 3.0 + (t - 36));
          st(img, { transformOrigin: '48% 62%', transform: second ? `scale(${1.55 + (t - 38.6) * 0.04})` : '' });
          st(p, { transform: `translateZ(${-sep * 180 * j}px) translateX(${sep * 110 * j}px) translateY(${-sep * 60 * j}px)`, opacity: j === 0 ? 1 : sep * (j === 1 ? 0.6 : 0.45), zIndex: String(3 - j) });
        });
      }
      // part B: audio
      const B = t >= 40.7 && t < 44.05;
      for (const e of [at, wave, an, al, a2]) e.style.display = B ? 'block' : 'none';
      if (B) {
        const bx = E.inCubic(P(t, 43.6, 44.0));
        chars(ats, t, 40.8, { stagger: 0.03, dur: 0.45 });
        st(at, { opacity: 1 - bx });
        const wk = E.outCubic(P(t, 41.0, 41.6));
        wctx.clearRect(0, 0, 1500, 300);
        const f = Math.floor(t * FPS), N = 100;
        const g = wctx.createLinearGradient(0, 0, 1500, 0);
        g.addColorStop(0, '#f2c46d'); g.addColorStop(1, '#5fe0d4');
        wctx.fillStyle = g;
        for (let i = 0; i < N; i++) {
          const a = AUDIO.rms[Math.max(0, f - (N - i))] ?? 0;
          const shape = 0.55 + 0.45 * Math.sin(i * 0.9 + t * 3) * Math.sin(i * 0.37);
          const h = Math.min(292, Math.max(3, a * 560 * shape * wk * (1 - bx)));
          wctx.globalAlpha = 0.35 + 0.65 * (i / N);
          wctx.fillRect(i * 15, 150 - h / 2, 9, h);
        }
        const ck = E.outExpo(P(t, 41.3, 42.5));
        an.innerHTML = `${Math.round(562 * ck)}<span style="color:var(--muted)"> / 562</span>`;
        st(an, { opacity: E.outCubic(P(t, 41.2, 41.5)) * (1 - bx) });
        chars(als, t, 41.9, { stagger: 0.02, dur: 0.4 });
        chars(a2s, t, 42.6, { stagger: 0.01, dur: 0.3, y: 8 });
        st(al, { opacity: 1 - bx }); st(a2, { opacity: 1 - bx });
      }
      // part C: the build-up
      const Cw = t >= 44 && t < 47.75;
      wbg.style.display = word.style.display = Cw ? 'block' : 'none';
      if (Cw) {
        const i = clamp(Math.floor((t - 44) / 0.5), 0, 7), w0 = 44 + i * 0.5, k = P(t, w0, w0 + 0.45);
        const [w, clip, at0] = WORDS[i];
        showClip(wimg, D.clips[clip] ? clip : 'combat', at0 + (t - w0));
        const ramp = P(t, 44, 47.75);
        st(wbg, { opacity: 0.55 + 0.3 * ramp, transform: `scale(${1.15 - 0.1 * E.outCubic(k)})`, filter: `brightness(${0.45 + 0.25 * ramp}) saturate(1.2) contrast(1.1)` });
        word.textContent = w;
        st(word, { opacity: clamp(k * 6) * (1 - P(k, 0.8, 1) * 0.6), transform: `scale(${lerp(1.35 + ramp * 0.3, 1, E.outExpo(k))})`, letterSpacing: `${lerp(0.4, 0.05, E.outExpo(k))}em`, filter: blur((1 - E.outExpo(k)) * 12) });
      }
    };
  });

  // 6 ─ montage of the real thing (48–72)
  scene(47.9, 72.05, (root) => {
    const img = clipImg(root);
    const lab = el('div', 'shot-label', root);
    const no = el('div', 'no', lab), big = el('div', 'big', lab), sub = el('div', 'sub', lab);
    el('div', 'rec', root, '<i></i>浏览器实机录制');
    const rec = root.lastChild;
    let cur = -1, bs = [], ss = [];
    return (t) => {
      const shots = SHOTS;
      const i = clamp(Math.floor((t - 48) / 2), 0, shots.length - 1), s = shots[i], t0 = 48 + i * 2;
      if (i !== cur) {
        cur = i;
        no.textContent = `${String(i + 1).padStart(2, '0')} / ${String(shots.length).padStart(2, '0')}`;
        bs = split(big, s.big);
        ss = split(sub, s.sub);
      }
      showClip(img, D.clips[s.clip] ? s.clip : 'combat', s.at + (t - t0) * (s.rate ?? 1));
      const punch = Math.exp(-(t - t0) * 7);
      st(img, { transform: `scale(${(1.03 + 0.05 * punch + (t - t0) * 0.012) * (s.zoom ?? 1)})`, transformOrigin: s.origin ?? '50% 50%', filter: `brightness(${1.12 + punch * 0.35}) contrast(1.06) saturate(1.12)` });
      chars(bs, t, t0 + 0.05, { stagger: 0.06, dur: 0.35, y: 40, blurPx: 10, out: [t0 + 1.8, t0 + 1.98] });
      chars(ss, t, t0 + 0.25, { stagger: 0.012, dur: 0.3, y: 10, blurPx: 4, out: [t0 + 1.8, t0 + 1.98] });
      no.style.opacity = P(t, t0, t0 + 0.2) * (1 - P(t, t0 + 1.8, t0 + 1.98));
      rec.style.opacity = P(t, 48.3, 48.8) * (1 - P(t, 71.6, 72)) * (Math.floor(t * 1.5) % 2 ? 1 : 0.75);
      root.style.opacity = 1 - P(t, 71.75, 72.05);
    };
  });

  // 7 ─ proof (72–84)
  scene(71.9, 84.1, (root) => {
    const wall = makeWall(root, 18, 10, 11);
    const tagPose = makeTag(root, '04', '验证');
    const title = el('div', 'abs center serif', root);
    st(title, { top: '120px', fontSize: '72px' });
    const ts = split(title, '一切用<b>测试</b>说话');
    const sub = el('div', 'abs center', root);
    st(sub, { top: '225px', fontSize: '26px', color: 'var(--muted)', letterSpacing: '.12em' });
    const ss = split(sub, 'Vitest 无头测试 + Playwright 走真实浏览器界面的覆盖测试');
    const STATS = [['卡牌', 577], ['遗物', 289], ['药水', 64], ['遭遇战', 81], ['事件路径', 151]];
    const stats = STATS.map(([l, n], i) => { const e = el('div', 'stat', root, `<div class="bignum">0</div><div class="lb">${l}</div>`); e.style.left = `${210 + i * 300}px`; return { e, n, num: e.firstChild }; });
    const res = el('div', 'abs center', root);
    st(res, { top: '560px' });
    res.innerHTML = `<div class="serif" style="font-size:54px;font-weight:700"><span class="bignum" style="font-size:80px;color:var(--gold)">1,162</span> 项覆盖测试</div>`;
    const zero = el('div', 'abs center', root);
    st(zero, { top: '668px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '26px' });
    zero.innerHTML = `<svg width="92" height="92" viewBox="0 0 92 92"><circle cx="46" cy="46" r="42" fill="none" stroke="#5fe0d4" stroke-width="5" stroke-dasharray="264" /><path d="M26 47 L41 62 L67 32" fill="none" stroke="#5fe0d4" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="70" /></svg><span class="serif" style="font-size:92px;color:#5fe0d4;text-shadow:0 0 40px rgba(95,224,212,.5)">零失败</span>`;
    const circ = zero.querySelector('circle'), tick = zero.querySelector('path');
    const LINES = ['自动游玩全程：三幕 → 终局「建筑师」→ <b>胜利结算</b>，控制台零报错', '<b>60 FPS</b> · 主菜单主线程 5.1% · 0.4 秒进入主菜单', 'IndexedDB 存档 · Service Worker 离线 · <b>14 种语言</b>'];
    const lines = LINES.map((l, i) => { const e = el('div', 'line3', root); e.style.top = `${820 + i * 58}px`; return { e, s: split(e, l) }; });
    return (t) => {
      const wk = E.outCubic(P(t, 72, 73));
      const ex = E.inCubic(P(t, 83.4, 84.05));
      st(wall.wrap, { opacity: 0.45 * wk * (1 - ex), filter: 'brightness(.5) saturate(.7) blur(1px)' });
      st(wall.wall, { transform: `translate(-50%, -50%) rotateX(60deg) rotateZ(12deg) translateY(${-(t - 72) * 40}px) scale(1.3)` });
      tagPose(t, 72.2, 83.9);
      chars(ts, t, 72.2, { stagger: 0.06, dur: 0.5, out: [83.4, 83.9] });
      chars(ss, t, 72.6, { stagger: 0.01, dur: 0.3, y: 8, out: [83.4, 83.9] });
      stats.forEach(({ e, n, num }, i) => {
        const a = D.cues.ticks[1][0] + i * 0.25, k = E.outExpo(P(t, a, a + 2.4));
        num.textContent = fmt(Math.round(n * k));
        const ek = E.outCubic(P(t, a - 0.3, a));
        st(e, { opacity: ek * (1 - ex), transform: `translateY(${(1 - ek) * 30}px)` });
      });
      const ch = D.cues.chime;
      const rk = E.outCubic(P(t, ch - 0.6, ch - 0.2));
      st(res, { opacity: rk * (1 - ex), transform: `translateY(${(1 - rk) * 20}px)` });
      const zk = P(t, ch, ch + 0.5);
      st(zero, { opacity: clamp(zk * 4) * (1 - ex), transform: `scale(${zk > 0 ? E.outBack(zk) : 0})` });
      circ.setAttribute('stroke-dashoffset', String(264 * (1 - E.outCubic(P(t, ch, ch + 0.6)))));
      tick.setAttribute('stroke-dashoffset', String(70 * (1 - E.outCubic(P(t, ch + 0.25, ch + 0.7)))));
      lines.forEach(({ s }, i) => chars(s, t, 79.4 + i * 0.7, { stagger: 0.012, dur: 0.35, y: 12, out: [83.4, 83.9] }));
    };
  }, 0.004);

  // 8 ─ the cast, then the logo (84–96)
  scene(83.9, 96.1, (root) => {
    const CAST = [['铁甲战士', 0.2, 1390, 370], ['静默猎手', 2.3, 1230, 300], ['储君', 4.4, 1420, 260], ['亡灵契约师', 6.5, 1430, 520], ['故障机器人', 8.6, 1540, 330]]; // name, clip second, face x/y
    const slices = CAST.map(([name, s0, fx, fy], i) => {
      const e = el('div', 'slice', root);
      const inner = el('div', 'abs', e);
      st(inner, { inset: '0' });
      const img = clipImg(inner);
      const nm = el('div', 'nm', e, name);
      return { e, inner, img, nm, s0, i, fx, fy };
    });
    const tg = el('div', 'abs center', root);
    st(tg, { top: '300px' });
    const logo = makeLogo(tg);
    const tl = el('div', 'serif', tg);
    st(tl, { marginTop: '40px', fontSize: '58px', letterSpacing: '.3em', fontWeight: '700', color: '#f3e7cf' });
    const tls = split(tl, '在浏览器里，攀登尖塔。');
    const stack = el('div', 'abs center', root);
    st(stack, { top: '760px', font: '22px var(--mono)', letterSpacing: '.22em', color: 'var(--muted)' });
    const sts = split(stack, 'C# → TYPESCRIPT  ·  PREACT  ·  PIXIJS 8  ·  SPINE 4.2  ·  WEB AUDIO');
    const disc = el('div', 'abs center', root);
    st(disc, { top: '980px', fontSize: '22px', color: '#8b90a0', letterSpacing: '.1em' });
    const ds = split(disc, '《杀戮尖塔 2》游戏内容版权归 Mega Crit 所有 · 本项目为非官方学习项目 · 仅供学习交流，请勿用于商业用途');
    D.layout.push(() => logo.layout());
    return (t) => {
      const col = E.inExpo(P(t, 87.7, 88.0));
      slices.forEach(({ e, inner, img, nm, s0, i, fx, fy }) => {
        const a = D.cues.slices[i], k = E.outExpo(P(t, a, a + 0.5));
        const x = -60 + i * 390;
        const loop = (t - a) % 2.6, local = loop < 1.3 ? loop : 2.6 - loop; // ping-pong inside the character's 1.3 s
        showClip(img, 'charselect', s0 + Math.max(0, local));
        e.style.display = t >= a && t < 88.05 ? 'block' : 'none';
        st(e, { left: `${x}px`, transform: `skewX(-10deg) translateY(${(1 - k) * (i % 2 ? -1250 : 1250)}px) scaleY(${1 - col})`, filter: `brightness(${1 + col * 2})` });
        st(inner, { transform: 'skewX(10deg)' });
        st(img, { left: `${240 - fx - (t - a) * 12}px`, top: `${480 - fy}px`, transformOrigin: `${fx}px ${fy}px`, transform: `scale(${1.3 + (t - a) * 0.02})` });
        const nk = E.outCubic(P(t, 86.2 + i * 0.12, 86.7 + i * 0.12));
        st(nm, { opacity: nk, transform: `skewX(10deg) translateY(${(1 - nk) * 30}px)` });
      });
      const on = t >= 88;
      tg.style.display = on ? 'block' : 'none';
      if (on) {
        logo.pose(t, 88.0, lerp(-40, 140, E.inOutSine(P(t, 88.4, 91))));
        chars(tls, t, 88.7, { stagger: 0.07, dur: 0.6, y: 20, blurPx: 10 });
        st(tg, { transform: `scale(${1 + (t - 88) * 0.006})` });
      }
      chars(sts, t, 89.6, { stagger: 0.012, dur: 0.4, y: 0, blurPx: 4 });
      chars(ds, t, 91.2, { stagger: 0.01, dur: 0.4, y: 0, blurPx: 3 });
      stack.style.display = disc.style.display = on ? 'block' : 'none';
    };
  });
}

// ── background, particles, post ────────────────────────────────────────────────────────────────────────────────────
const KEYS = [ // t, warm, cool, center, embers, bokeh
  [0, 0.15, 0.1, 0, 0.12, 0], [3.95, 0.3, 0.15, 0.1, 0.3, 0.1], [4.0, 1, 0.5, 0.9, 1, 0.7], [7.5, 0.8, 0.5, 0.6, 0.8, 0.5],
  [8.5, 0.55, 0.6, 0.35, 0.5, 0.3], [16, 0.35, 0.7, 0.25, 0.3, 0.2], [28, 0.5, 0.5, 0.3, 0.35, 0.2], [36, 0.45, 0.6, 0.3, 0.35, 0.2],
  [44, 0.3, 0.3, 0.2, 0.4, 0.2], [47.7, 1, 0.4, 0.6, 1, 0.8], [47.75, 0, 0, 0, 0, 0], [48, 0, 0, 0, 0.25, 0.35], [71.9, 0, 0, 0, 0.25, 0.35],
  [72.1, 0.45, 0.6, 0.35, 0.4, 0.25], [84, 0.5, 0.5, 0.3, 0.5, 0.3], [87.9, 0.6, 0.5, 0.3, 0.7, 0.4], [88.1, 1, 0.6, 0.9, 1, 0.7], [96, 0.4, 0.3, 0.3, 0.5, 0.2]];
function levels(t) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= t) i++;
  const a = KEYS[i], b = KEYS[i + 1], k = P(t, a[0], b[0]);
  return { warm: lerp(a[1], b[1], k), cool: lerp(a[2], b[2], k), center: lerp(a[3], b[3], k), embers: lerp(a[4], b[4], k), bokeh: lerp(a[5], b[5], k) };
}
let glow;
function makeGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,236,200,1)'); gr.addColorStop(0.18, 'rgba(255,170,90,.9)'); gr.addColorStop(0.5, 'rgba(255,110,40,.25)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}
function radial(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function drawBG(t) {
  const L = levels(t), bg = $('#bg').getContext('2d'), fg = $('#fg').getContext('2d');
  bg.globalCompositeOperation = 'source-over';
  bg.fillStyle = '#06070b'; bg.fillRect(0, 0, W, H);
  if (L.warm > 0) radial(bg, 960 + Math.sin(t * 0.2) * 200, 1250, 1150, `rgba(255,105,40,${0.26 * L.warm})`);
  if (L.cool > 0) radial(bg, 1650, -120, 950, `rgba(95,224,212,${0.12 * L.cool})`);
  if (L.center > 0) radial(bg, 960, 520, 820, `rgba(242,196,109,${0.1 * L.center})`);
  bg.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 240; i++) {
    if (hash(i * 3.1) > L.embers) continue;
    const v = 30 + 110 * hash(i * 1.7), y0 = hash(i * 2.3) * (H + 200);
    const y = H + 100 - ((y0 + t * v) % (H + 200));
    const x = hash(i * 5.1) * W + noise1(t * 0.35 + i, 7) * 70 + Math.sin(t * 0.6 + i) * 20;
    const s = (3 + 10 * hash(i * 9.2) ** 3) * 2.2;
    const a = (0.45 + 0.55 * Math.sin(t * (2 + hash(i) * 6) + i * 3)) * clamp(y / (H * 0.8)) * 0.9;
    bg.globalAlpha = clamp(a);
    bg.drawImage(glow, x - s, y - s, s * 2, s * 2);
  }
  bg.globalAlpha = 1;
  fg.clearRect(0, 0, W, H);
  if (L.bokeh > 0.01) {
    fg.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const v = 18 + 40 * hash(i * 4.4 + 9), y0 = hash(i * 6.6 + 1) * (H + 400);
      const y = H + 200 - ((y0 + t * v) % (H + 400));
      const x = hash(i * 8.8 + 3) * W + Math.sin(t * 0.3 + i) * 60;
      const s = 30 + 70 * hash(i * 2.9 + 5);
      fg.globalAlpha = L.bokeh * 0.22 * (0.6 + 0.4 * Math.sin(t * 1.3 + i));
      fg.drawImage(glow, x - s, y - s, s * 2, s * 2);
    }
    fg.globalAlpha = 1;
  }
}
const lastBefore = (arr, t) => { let r = -Infinity; for (const x of arr) if (x <= t) r = x; return r; };
function post(t) {
  const C = D.cues;
  let imp = 0, bigImp = 0;
  for (const [ti, s] of C.impacts) if (t >= ti) { imp = Math.max(imp, s * Math.exp(-(t - ti) * 5)); if (s >= 0.9) bigImp = Math.max(bigImp, Math.exp(-(t - ti) * 6)); }
  const cut = Math.exp(-(t - lastBefore([...C.cuts, ...C.slices], t)) * 12);
  const kick = t >= 48 && t < 72 ? Math.exp(-(t - lastBefore(AUDIO.kicks, t)) * 10) : 0;
  let gl = 0;
  for (const g of C.glitches) if (t >= g && t < g + 0.14) gl = Math.max(gl, (1 - (t - g) / 0.14) * (Math.floor(t * 60) % 2 ? 1 : 0.5));
  const riser = t >= C.riser[0] && t < 47.75 ? E.inCubic(P(t, C.riser[0], 47.75)) : 0;
  const amp = 22 * imp + 7 * cut + 3 * kick + 9 * riser + 30 * gl;
  const f = Math.floor(t * FPS);
  const sx = amp * noise1(t * 32, 1) + gl * (hash(f) * 2 - 1) * 40, sy = amp * noise1(t * 32, 2), rot = amp * 0.02 * noise1(t * 20, 3);
  const zoom = 1 + 0.035 * bigImp + 0.008 * kick + 0.03 * riser;
  const w = $('#world');
  w.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${zoom.toFixed(4)})`;
  const split = 16 * imp + 8 * cut + 28 * gl + 6 * riser;
  if (split > 0.4) {
    $('#rgb-r').setAttribute('dx', (-split).toFixed(2));
    $('#rgb-b').setAttribute('dx', split.toFixed(2));
    w.style.filter = 'url(#rgb)';
  } else w.style.filter = '';
  let flash = 0;
  for (const [ti, s] of C.impacts) if (t >= ti) flash = Math.max(flash, (s >= 0.9 ? 0.95 : 0.4 * s) * Math.exp(-(t - ti) * 7));
  flash = Math.max(flash, 0.35 * cut * (t < 72 || t > 84 ? 1 : 0));
  $('#flash').style.opacity = flash.toFixed(3);
  $('#scan').style.opacity = (gl * 0.7 + riser * 0.25).toFixed(3);
  const black = Math.max(t >= 47.75 && t < 48 ? 1 : 0, P(t, 94.2, 96));
  $('#black').style.opacity = black.toFixed(3);
  $('#grain').style.backgroundImage = `url(${D.grain[f % D.grain.length]})`;
  $('#grain').style.backgroundPosition = `${Math.floor(hash(f * 1.3) * 200)}px ${Math.floor(hash(f * 2.1) * 200)}px`;
}

// ── entry points for render.mjs ─────────────────────────────────────────────────────────────────────────────────────
window.setup = async (data) => {
  D = { ...data, layout: [] };
  glow = makeGlow();
  D.grain = [0, 1, 2, 3, 4, 5].map((s) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d'), im = g.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) { const v = Math.floor(hash(i * 1.37 + s * 99991) * 255); im.data.set([v, v, v, 255], i * 4); }
    g.putImageData(im, 0, 0);
    return c.toDataURL();
  });
  buildAll();
  await document.fonts.ready;
  for (const s of scenes) s.root.style.display = 'block';
  D.layout.forEach((f) => f());
  for (const s of scenes) s.root.style.display = 'none';
  await Promise.all([...document.querySelectorAll('.wall img')].map((i) => i.decode().catch(() => {})));
};
window.renderFrame = async (t) => {
  pending.length = 0;
  drawBG(t);
  for (const s of scenes) {
    const on = t >= s.a && t < s.b;
    s.root.style.display = on ? 'block' : 'none';
    if (on && s.drift) s.root.style.transform = `scale(${(1 + (t - s.a) * s.drift).toFixed(5)})`; // slow push-in keeps holds alive
    if (on) s.render(t);
  }
  post(t);
  await Promise.all(pending);
};
