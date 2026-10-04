// Cloud save sync (a port-only screen, not in the game): upload the local save files to a self-hosted sync server or
// restore them back, over the blurred main menu or the capstone stack (from the pause menu). Logic lives in ../sync.ts.
import { useState } from 'preact/hooks';
import { ui, invalidate } from '../store';
import { appText, loc } from '../i18n';
import { playOneShot } from '../audio';
import { confirmPopup } from './modal';
import { BackButton } from './buttons';
import { savedServer, savedSlot, serverUrl, slotOk, uploadToCloud, restoreFromCloud, rememberSync, markRestored } from '../sync';
import './cloud.css';

const hoverSfx = () => playOneShot('event:/sfx/ui/clicks/ui_hover');
const clickSfx = () => playOneShot('event:/sfx/ui/clicks/ui_click');
const yesNo = () => ({
  yes: loc('main_menu_ui', 'GENERIC_POPUP.confirm'),
  no: loc('main_menu_ui', 'GENERIC_POPUP.cancel'),
});

/** The hand-rolled hover/press button (mm idiom) in a flat dark style matching the seed input. */
function SyncButton({ label, kind, enabled, onClick }: { label: string; kind: 'primary' | 'ghost'; enabled: boolean; onClick: () => void }) {
  const [st, setSt] = useState<'' | 'hover' | 'press'>('');
  return (
    <div class={`cs-btn ${kind} ${st}${enabled ? '' : ' disabled'}`}
      onPointerEnter={() => { if (!enabled) return; setSt('hover'); hoverSfx(); }}
      onPointerLeave={() => setSt('')}
      onPointerDown={(e) => { if (enabled && e.button === 0) { setSt('press'); clickSfx(); } }}
      onPointerUp={(e) => { if (enabled && e.button === 0 && st === 'press') { setSt(''); onClick(); } }}>
      {label}
    </div>
  );
}

export function CloudSync({ onBack }: { onBack: () => void }) {
  const [server, setServer] = useState(savedServer());
  const [slot, setSlot] = useState(savedSlot());
  const [busy, setBusy] = useState<'' | 'up' | 'down'>('');
  const [msg, setMsg] = useState('');
  const run = async (dir: 'up' | 'down') => {
    if (busy) return;
    const url = serverUrl(server), code = slot.trim();
    if (!url) { setMsg(appText('cloudNeedServer')); return; }
    if (!slotOk(code)) { setMsg(appText('cloudNeedSlot')); return; }
    rememberSync(url, code);
    setMsg(dir === 'up' ? appText('cloudUploading') : appText('cloudDownloading'));
    setBusy(dir);
    try {
      if (dir === 'up') {
        const n = await uploadToCloud(url, code);
        setMsg(appText('cloudUpDone').replace('{n}', String(n)));
      } else {
        const r = await restoreFromCloud(url, code);
        if (r === 'miss') { setMsg(appText('cloudMiss')); setBusy(''); return; }
        markRestored(); // the reload's pagehide must not save the stale memory state over the restored files
        setMsg(appText('cloudRestored'));
        setTimeout(() => window.location.reload(), 800); // let the status line show before the page goes away
        return; // busy stays: the page is leaving anyway
      }
    } catch (e) {
      setMsg(appText('cloudFail') + String((e as any)?.message ?? e));
    }
    setBusy('');
  };
  const download = async () => {
    const ok = await confirmPopup({
      header: appText('cloudRestoreHeader'), body: appText('cloudRestoreBody'), ...yesNo(),
    });
    if (ok) void run('down');
  };
  return (
    <div class="cloud-screen">
      <div class="cs-title">{appText('cloudSyncHeader')}</div>
      <div class="cs-intro">{appText('cloudIntro')}</div>
      <div class="cs-form">
        <label class="cs-label">{appText('cloudServer')}</label>
        <input class="cs-input" value={server} placeholder={appText('cloudServerPh')} spellcheck={false}
          onInput={(e) => setServer((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur(); } }} />
        <label class="cs-label">{appText('cloudSlot')}</label>
        <input class="cs-input" value={slot} placeholder={appText('cloudSlotPh')} spellcheck={false}
          onInput={(e) => setSlot((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur(); } }} />
        <div class="cs-hint">{appText('cloudSlotHint')}</div>
        <div class="cs-row">
          <SyncButton kind="primary" label={appText('cloudUpload')} enabled={!busy} onClick={() => void run('up')} />
          <SyncButton kind="ghost" label={appText('cloudDownload')} enabled={!busy} onClick={() => void download()} />
        </div>
        {msg && <div class="cs-status">{msg}</div>}
      </div>
      <BackButton enabled={!busy} onClick={onBack} />
    </div>
  );
}
