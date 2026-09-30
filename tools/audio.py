#!/usr/bin/env python3
"""FMOD Studio .bank -> Opus .ogg (Safari 18.4+, Chrome, Firefox). Needs vgmstream-cli + ffmpeg on PATH."""
import glob, hashlib, json, os, re, shutil, subprocess, sys
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import Pck, PCK_DEFAULT
import fmod_bank
WORK, OUT = '_work/audio', 'assets/audio'
# size over fidelity ("roughly listenable"): mono, music/ambience 16k, sfx 12k — ~34MB instead of ~90MB at 40k stereo
MUSIC_KBPS, SFX_KBPS, CHANNELS = 16, 12, 1

def encode(job):
    wav, ogg, kbps = job; os.makedirs(os.path.dirname(ogg), exist_ok=True)
    r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-ac', str(CHANNELS), '-c:a', 'libopus', '-b:a', f'{kbps}k', '-vbr', 'on', ogg], capture_output=True, text=True)
    return ogg, (os.path.getsize(ogg) if r.returncode == 0 else -1), r.stderr[-200:]

def extract_bank(bank, wavdir):
    """Every subsong to <stream name>.wav; streams sharing a name within a bank become <name>_rr<k>.wav (round-robin
    variants to the web audio layer) instead of overwriting each other."""
    shutil.rmtree(wavdir, ignore_errors=True); os.makedirs(wavdir)
    info = subprocess.run(['vgmstream-cli', '-m', '-S', '0', bank], capture_output=True, text=True).stdout
    expected = len(re.findall(r'^stream name: ', info, re.M)) or len(re.findall(r'^stream count: ', info, re.M))
    r = subprocess.run(['vgmstream-cli', '-S', '0', '-o', os.path.join(wavdir, '?s__?n.wav'), bank], capture_output=True, text=True)
    raw = sorted(glob.glob(os.path.join(wavdir, '*__*.wav')), key=lambda w: int(os.path.basename(w).split('__')[0]))
    names = [os.path.basename(w).split('__', 1)[1][:-4] or os.path.basename(w).split('__')[0] for w in raw]
    count = {n: names.count(n) for n in names}; k = {}
    for w, n in zip(raw, names):
        k[n] = k.get(n, 0) + 1
        os.rename(w, os.path.join(wavdir, (f'{n}_rr{k[n]}' if count[n] > 1 else n) + '.wav'))
    wavs = sorted(glob.glob(os.path.join(wavdir, '*.wav')))
    assert len(wavs) == len(raw) and (not expected or len(raw) == expected), f'{bank}: {len(raw)} extracted, {expected} subsongs'
    return wavs, r

def main():
    pck = Pck(PCK_DEFAULT); os.makedirs(WORK, exist_ok=True); jobs = []; man = {}; seen = {}
    for p in pck.paths(lambda p: p.endswith('.bank')):
        name = os.path.basename(p)[:-5]; bank = os.path.join(WORK, name + '.bank'); open(bank, 'wb').write(pck.read(p))
        shutil.rmtree(os.path.join(OUT, name), ignore_errors=True)  # no stale samples from earlier runs (audio/debug/ is extract.py's)
        wavdir = os.path.join(WORK, name)
        wavs, r = extract_bank(bank, wavdir)
        kbps = SFX_KBPS if 'sfx' in name.lower() else MUSIC_KBPS
        aliases = {}
        for w in wavs:  # identical streams across banks are encoded once and recorded as aliases
            h = hashlib.md5(open(w, 'rb').read()).hexdigest(); rel = os.path.join(name, os.path.relpath(w, wavdir)[:-4] + '.ogg')
            if h in seen: aliases[rel] = seen[h]
            else: seen[h] = rel; jobs.append((w, os.path.join(OUT, rel), kbps))
        man[name] = dict(streams=len(wavs), unique=len(wavs) - len(aliases), aliases=aliases, kbps=kbps, channels=CHANNELS, bank_bytes=os.path.getsize(bank), wav_bytes=sum(os.path.getsize(w) for w in wavs))
        print(f'{name}: {len(wavs)} streams, wav {man[name]["wav_bytes"]/1e6:.0f}MB', r.stderr.strip()[-120:], flush=True)
    with Pool() as pool: res = pool.map(encode, jobs)
    for name in man: man[name]['bytes'] = sum(b for o, b, _ in res if b > 0 and o.startswith(os.path.join(OUT, name) + os.sep))
    bad = [r for r in res if r[1] < 0]; os.makedirs(OUT, exist_ok=True); json.dump(man, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    print(f"streams {sum(v['streams'] for v in man.values())}, duplicates {sum(len(v['aliases']) for v in man.values())}")
    print(f"encoded {len(res)-len(bad)}, failed {len(bad)}, bank {sum(v['bank_bytes'] for v in man.values())/1e6:.0f}MB -> opus {sum(v['bytes'] for v in man.values())/1e6:.1f}MB")
    for b in bad[:10]: print('FAIL', b)
    fmod_bank.main()  # event data: assets/audio/events.json

if __name__ == '__main__': main()
