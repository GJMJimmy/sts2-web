// Asset resolution: game res:// paths → compressed web assets (see tools/extract.py).
/* eslint-disable @typescript-eslint/no-explicit-any */
export const A = 'assets/';
interface Frame { page: string; x: number; y: number; w: number; h: number; sw: number; sh: number; ox: number; oy: number; pw: number; ph: number }
const frames = new Map<string, Frame>();
const textures = new Map<string, { out: string; w: number; h: number }>();
export let spineIndex: Record<string, any> = {};

export async function loadAssetIndex() {
  const man = await (await fetch(A + 'manifest.json')).json();
  for (const t of man.textures) if (!t.error) textures.set(t.src, { out: t.out, w: t.w, h: t.h });
  await Promise.all(man.atlases.flatMap((a: any) => Array.from({ length: a.pages }, async (_, i) => {
    const j = await (await fetch(`${A}atlases/${a.name}-${i}.json`)).json();
    for (const [k, f] of Object.entries<any>(j.frames)) {
      frames.set(`${a.name}/${k}`, { page: A + 'atlases/' + j.meta.image, x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h, sw: f.sourceSize.w, sh: f.sourceSize.h, ox: f.spriteSourceSize.x, oy: f.spriteSourceSize.y, pw: j.meta.size.w, ph: j.meta.size.h });
    }
  })));
  try { spineIndex = await (await fetch(A + 'spine-index.json')).json(); } catch { spineIndex = {}; }
}

/** All packed texture source paths under a prefix (e.g. "images/rooms/overgrowth/"). */
export function listImages(prefix: string): string[] {
  return [...textures.keys()].filter((k) => k.startsWith(prefix)).sort();
}

/** res://images/foo/bar.png or images/foo/bar.png → compressed webp URL */
export function imageUrl(res: string | null | undefined): string | null {
  if (!res) return null;
  const p = res.replace(/^res:\/\//, '');
  const t = textures.get(p);
  return t ? A + t.out : null;
}
/** atlases/card_atlas.sprites/ironclad/bash.tres → frame */
export function atlasFrame(res: string | null | undefined): Frame | null {
  if (!res) return null;
  const m = /atlases\/(\w+)\.sprites\/(.+)\.tres$/.exec(res);
  return m ? frames.get(`${m[1]}/${m[2]}`) ?? null : frames.get(res) ?? null;
}
export function frameByName(atlas: string, name: string) { return frames.get(`${atlas}/${name}`) ?? null; }

/** CSS for drawing an atlas frame into a box of width `w` (height follows aspect). Trim margins become padding. */
export function frameStyle(f: Frame | null, w: number, h?: number): Record<string, string> {
  if (!f) return { width: `${w}px`, height: `${h ?? w}px` };
  const sx = w / f.sw;
  const hh = h ?? f.sh * sx;
  const sy = hh / f.sh;
  return {
    width: `${w}px`, height: `${hh}px`,
    boxSizing: 'border-box',
    padding: `${f.oy * sy}px ${(f.sw - f.ox - f.w) * sx}px ${(f.sh - f.oy - f.h) * sy}px ${f.ox * sx}px`,
    backgroundImage: `url(${f.page})`,
    backgroundOrigin: 'content-box',
    backgroundClip: 'content-box',
    backgroundSize: `${f.pw * sx}px ${f.ph * sy}px`,
    backgroundPosition: `${-f.x * sx}px ${-f.y * sy}px`,
    backgroundRepeat: 'no-repeat',
  };
}
/** Image for any game image path (atlas sprite or packed texture). */
export function anyImage(res: string | null | undefined): { url: string } | { frame: Frame } | null {
  const f = atlasFrame(res);
  if (f) return { frame: f };
  const u = imageUrl(res) ?? imageUrl(res?.replace(/\.tres$/, '.png'));
  return u ? { url: u } : null;
}

/** An atlas frame as its own image (data URL) for CSS border-image nine-patches; null until the page has loaded. */
const frameUrls = new Map<Frame, string | null>();
export function frameUrl(f: Frame | null, onReady?: () => void): string | null {
  if (!f) return null;
  if (frameUrls.has(f)) return frameUrls.get(f)!;
  frameUrls.set(f, null);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = f.sw; c.height = f.sh;
    c.getContext('2d')!.drawImage(img, f.x, f.y, f.w, f.h, f.ox, f.oy, f.w, f.h);
    frameUrls.set(f, c.toDataURL());
    onReady?.();
  };
  img.src = f.page;
  return null;
}
