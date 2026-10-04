// Offline precache button (a port-only screen element, not in the game): production builds only — the dev server
// registers no service worker. Asks the worker (sw.js message handler) to cache every file of the build's
// assets/ tree (the filelist.json the build emits), so the game can be played fully offline. Already-cached files
// are skipped by the worker: interrupting the download and pressing again resumes it.
import { useEffect, useRef, useState } from 'preact/hooks';
import { playOneShot } from '../audio';
import { appText } from '../i18n';
import './precache.css';

const DONE_KEY = 'sts2web_precached';
const hoverSfx = () => playOneShot('event:/sfx/ui/clicks/ui_hover');
const clickSfx = () => playOneShot('event:/sfx/ui/clicks/ui_click');
const mb = (n: number) => (n / 1e6).toFixed(0);

type Phase = 'idle' | 'scan' | 'fetch' | 'done';
let list: [string, number][] | null = null; // the build's filelist, fetched once per page

export function PrecacheButton() {
  // the service worker only exists in a production build; nothing to do without one. On a first visit the worker
  // claims the page a beat after the menu renders: watch controllerchange so the button still shows up.
  const [swReady, setSwReady] = useState(!!navigator.serviceWorker?.controller);
  const [state, setState] = useState<'' | 'scan' | 'fetch' | 'done'>(localStorage.getItem(DONE_KEY) === __ASSETS_ID__ ? 'done' : '');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [failed, setFailed] = useState(0);
  const [size, setSize] = useState<number | null>(list ? list.reduce((s, f) => s + f[1], 0) : null);
  const [hover, setHover] = useState(false);
  const busy = state === 'scan' || state === 'fetch';
  // progress messages from the worker arrive on the container (navigator.serviceWorker), not on the controller
  const listener = useRef<(e: Event) => void>(() => {});

  useEffect(() => {
    if (swReady) return;
    const onChange = () => { if (navigator.serviceWorker.controller) setSwReady(true); };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange);
  }, [swReady]);

  const start = async () => {
    if (busy) return;
    clickSfx();
    try {
      const files: [string, number][] = list ?? (list = (await (await fetch('assets/filelist.json')).json()).files);
      setSize(files.reduce((s, f) => s + f[1], 0));
      setState('scan');
      setFailed(0);
      // the fetch handler caches filelist.json like any asset, so it survives offline too
      listener.current = (e: Event) => {
        const m = (e as MessageEvent).data;
        if (m?.type !== 'precache') return;
        setProgress({ done: m.done, total: m.total });
        setState(m.phase === 'done' ? 'done' : 'fetch');
        if (m.failed > 0) setFailed(m.failed);
        if (m.phase === 'done') {
          if (m.failed === 0) try { localStorage.setItem(DONE_KEY, __ASSETS_ID__); } catch { /* best effort */ }
          navigator.serviceWorker.removeEventListener('message', listener.current);
        }
      };
      navigator.serviceWorker.addEventListener('message', listener.current);
      navigator.serviceWorker.controller!.postMessage({ type: 'precache', files: list });
    } catch { setState(''); }
  };

  useEffect(() => {
    // the total size for the idle subtitle: from the manifest, which the worker caches like any asset
    (async () => {
      const files: [string, number][] = list ?? (list = (await (await fetch('assets/filelist.json')).json()).files);
      setSize(files.reduce((s, f) => s + f[1], 0));
    })().catch(() => { /* idle without the size */ });
    return () => navigator.serviceWorker.removeEventListener('message', listener.current);
  }, []);
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !swReady) return null;

  const allDone = state === 'done';
  const pct = progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  const desc = allDone ? appText('offlineCached')
    : busy ? (state === 'scan' ? appText('offlineScanning') : appText('offlineProgress').replace('{done}', String(progress.done)).replace('{total}', String(progress.total)))
    : failed > 0 ? appText('offlineFailed').replace('{n}', String(failed))
    : appText('offlineDesc') + (size != null ? ` · ${mb(size)} MB` : '');
  return (
    <div class={'mm-offline' + (allDone ? ' done' : '') + (busy ? ' busy' : '') + (hover ? ' hover' : '')}
      onPointerEnter={() => { if (!busy) { setHover(true); hoverSfx(); } }} onPointerLeave={() => setHover(false)}
      onPointerDown={(e) => { if (e.button === 0 && !busy) clickSfx(); }}
      onPointerUp={(e) => { if (e.button === 0 && !busy) void start(); }}>
      {/* a simple download-to-device outline (Material Symbols' save_alt in a circle) */}
      <svg class="mmo-icon" viewBox="0 0 24 24" aria-hidden="true">
        {allDone
          ? <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
          : <path d="M12 16l-6-6 1.4-1.4L11 12.2V3h2v9.2l3.6-3.6L18 10l-6 6Zm-8 4v-3h2v1h12v-1h2v3H4Z" />}
      </svg>
      <div class="mmo-title">{appText('offlineHeader')}</div>
      <div class="mmo-desc">{desc}</div>
      {/* the progress bar hangs under the button while the worker fills the cache */}
      {busy && (
        <div class="mmo-progress">
          {state === 'fetch'
            ? <div class="mmo-bar" style={{ width: `${pct}%` }} />
            : <div class="mmo-bar scan" />}
        </div>
      )}
    </div>
  );
}
