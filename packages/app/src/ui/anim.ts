// Shared CSS animation helpers for Godot sprite animations.
/** A looping keyframe flipbook (AnimatedSprite2D): one keyframe per frame, held with step timing. */
const flipbooks = new Set<string>();
export function flipbook(name: string, frames: Record<string, string>[], fps: number) {
  if (!flipbooks.has(name) && frames.length) {
    flipbooks.add(name);
    const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    const body = frames.map((f, i) => `${((i / frames.length) * 100).toFixed(3)}% { ${Object.entries(f).map(([k, v]) => `${kebab(k)}: ${v};`).join(' ')} }`).join('\n');
    const st = document.createElement('style');
    st.textContent = `@keyframes ${name} {\n${body}\n}`;
    document.head.appendChild(st);
  }
  return { animation: `${name} ${frames.length / fps}s step-end infinite`, ...frames[0] };
}
