// Full-screen Pixi backdrop for non-combat rooms (rest site, merchant, treasure): owns the shared Pixi canvas while mounted.
import { useEffect, useRef } from 'preact/hooks';
import { Container } from 'pixi.js';
import { getApp } from '../render/stage';

export function Backdrop({ build, id }: { build: () => Promise<Container | null>; id: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = new Container();
    let dead = false;
    getApp().then((a) => {
      if (dead) return;
      a.stage.removeChildren();
      a.stage.addChild(root);
      host.current?.appendChild(a.canvas);
      a.canvas.style.width = '100%';
      a.canvas.style.height = '100%';
    });
    build().then((c) => { if (c) dead ? c.destroy({ children: true }) : root.addChild(c); }).catch((e) => console.warn('backdrop', id, e));
    return () => {
      dead = true;
      root.parent?.removeChild(root);
      root.destroy({ children: true });
      getApp().then((a) => { if (a.canvas.parentElement === host.current) a.canvas.remove(); });
    };
  }, [id]);
  return <div class="stage-host" ref={host} />;
}
