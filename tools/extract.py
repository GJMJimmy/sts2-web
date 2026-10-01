#!/usr/bin/env python3
"""Extract Slay the Spire 2 assets from the Godot 4 PCK into web-ready form.

Output layout (all paths mirror the original res:// paths):
  assets/images/...        WebP textures, `@0.5x` suffix = pixel/logical scale (Pixi convention)
  assets/atlases/*.json    repacked spritesheets (Pixi JSON hash format) + WebP pages
  assets/animations/...    Spine 4.2 .skel + .atlas + WebP pages
  assets/fonts/*.woff2     subset fonts (only glyphs used by the 14 localizations)
  assets/i18n/<lang>/*.json
  assets/manifest.json
  ref/godot/...            scenes/shaders/materials/tpsheets (text) for the rewrite
  ref/dotnet/sts2.dll      for decompilation
"""
import argparse, collections, io, json, multiprocessing as mp, os, re, struct, sys, time
from PIL import Image
import zstandard
from fontTools import subset
from fontTools.ttLib import TTFont

PCK_DEFAULT = "/Applications/SlayTheSpire2.app/Contents/Game/SlayTheSpire2.app/Contents/Resources/Slay the Spire 2.pck"
DLL_DEFAULT = "/Applications/SlayTheSpire2.app/Contents/Game/SlayTheSpire2.app/Contents/Resources/data_sts2_macos_arm64/sts2.dll"
SCALE = 0.5            # global downscale for anything >= MIN_SCALE_SIDE
MIN_SCALE_SIDE = 128   # tiny icons stay 1:1
FULL_RES = ('images/atlases/card_atlas.', 'animations/characters/')  # drawn at about source size: halving reads as blur; textures are stored lossless
MAX_SIDE = 2048        # WebGL-friendly page cap
WEBP_Q = 75            # with method 6: ~16% smaller than q80/m4 at ~1 dB PSNR
WEBP_METHOD = 6
ATLAS_Q = {'card_atlas': 55}  # full-res painted art: q55 is visually the same as q75 at 82% of the bytes
ATLAS_PAD = 2
REF_EXT = {'.tscn', '.tres', '.gdshader', '.tpsheet', '.cfg', '.gdextension', '.import'}

# ---------------------------------------------------------------- PCK
class Pck:
    def __init__(self, path):
        self.f = open(path, 'rb'); f = self.f
        u32 = lambda: struct.unpack('<I', f.read(4))[0]; u64 = lambda: struct.unpack('<Q', f.read(8))[0]
        assert u32() == 0x43504447, 'not a Godot PCK'
        ver = u32(); u32(); u32(); u32(); flags = u32(); base = u64()
        d = u64() if ver == 3 else None
        for _ in range(16): u32()
        if d: f.seek(d)
        self.entries = {}
        for _ in range(u32()):
            L = u32(); p = f.read(L).rstrip(b'\0').decode(); off = u64(); sz = u64(); f.read(16); u32()
            self.entries[p.replace('res://', '', 1)] = (off + (base if flags & 2 else 0), sz)
    def read(self, p):
        off, sz = self.entries[p]; self.f.seek(off); return self.f.read(sz)
    def paths(self, pred): return sorted(p for p in self.entries if pred(p))

def parse_import(text):
    kv = {}
    for line in text.splitlines():
        m = re.match(r'^(path(?:\.\w+)?|importer|type)=(.*)$', line.strip())
        if m: kv[m.group(1)] = m.group(2).strip('"')
    dests = [v.replace('res://', '', 1) for k, v in kv.items() if k.startswith('path')]
    return kv.get('importer'), kv.get('type'), dests

# ---------------------------------------------------------------- textures
def decode_ctex(d):
    if d[:4] == b'GDIM':  # importer="image" (e.g. cursors): 'GDIM', u32 length + format name, then the image file
        n = struct.unpack_from('<I', d, 4)[0]; img = Image.open(io.BytesIO(d[8 + n:])); img.load(); return img
    w, h = struct.unpack_from('<II', d, 8); df = struct.unpack_from('<I', d, 36)[0]
    pw, ph = struct.unpack_from('<HH', d, 40); fmt = struct.unpack_from('<I', d, 48)[0]; p = 52
    if df in (1, 2):  # PNG / WebP
        n = struct.unpack_from('<I', d, p)[0]; blob = d[p + 4:p + 4 + n]
        if blob[:4] in (b'WEBP', b'PNG '): blob = blob[4:]
        img = Image.open(io.BytesIO(blob)); img.load(); return img
    if df == 0:
        if fmt in (17, 19, 22):
            n = {17: 1, 19: 3, 22: 7}[fmt]; bpb = 8 if n == 1 else 16; bw, bh = (pw + 3) // 4, (ph + 3) // 4
            return Image.frombytes('RGBA', (pw, ph), d[p:p + bw * bh * bpb], 'bcn', n).crop((0, 0, w, h))
        if fmt == 15:  # RGBAH
            px = bytes(max(0, min(255, int(v * 255))) for t in struct.iter_unpack('<4e', d[p:p + pw * ph * 8]) for v in t)
            return Image.frombytes('RGBA', (pw, ph), px).crop((0, 0, w, h))
        if fmt == 5: return Image.frombytes('RGBA', (pw, ph), d[p:p + pw * ph * 4]).crop((0, 0, w, h))
        if fmt == 4: return Image.frombytes('RGB', (pw, ph), d[p:p + pw * ph * 3]).crop((0, 0, w, h))
    raise ValueError(f'unsupported ctex df={df} fmt={fmt}')

def pick_scale(w, h, src=''):
    s = SCALE if max(w, h) >= MIN_SCALE_SIDE and not src.startswith(FULL_RES) else 1.0
    if max(w, h) * s > MAX_SIDE: s = MAX_SIDE / max(w, h)
    return s

def out_name(src, s):
    base = os.path.splitext(src)[0]
    return f'{base}.webp' if s == 1.0 else f'{base}@{round(s, 3):g}x.webp'

def save_webp(img, path, scale, lossless=False):
    if scale != 1.0:
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    if img.mode not in ('RGB', 'RGBA'): img = img.convert('RGBA')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'WEBP', quality=100 if lossless else WEBP_Q, method=WEBP_METHOD, lossless=lossless)
    return img.size, os.path.getsize(path)

_pck = None
def _init(pck_path):
    global _pck; _pck = Pck(pck_path)

def _tex_job(args):
    src, dest, out_root = args
    try:
        img = decode_ctex(_pck.read(dest)); s = pick_scale(*img.size, src)
        out = os.path.join(out_root, out_name(src, s)); (nw, nh), nb = save_webp(img, out, s, src.startswith(FULL_RES))
        return dict(src=src, out=os.path.relpath(out, out_root), w=nw, h=nh, ow=img.width, oh=img.height, scale=s, bytes=nb, raw=_pck.entries[dest][1])
    except Exception as e:
        return dict(src=src, error=str(e))

# ---------------------------------------------------------------- atlases
def shelf_pack(items, maxw=MAX_SIDE, maxh=MAX_SIDE, pad=ATLAS_PAD):
    """items: list of (key, w, h). Returns list of pages: (pw, ph, [(key, x, y)])."""
    items = sorted(items, key=lambda t: (-t[2], -t[1])); pages = []
    cur = None
    for key, w, h in items:
        if cur is None or not _place(cur, key, w, h, maxw, maxh, pad):
            cur = dict(x=pad, y=pad, shelf_h=0, w=0, h=0, placed=[]); pages.append(cur)
            assert _place(cur, key, w, h, maxw, maxh, pad), f'{key} {w}x{h} exceeds page'
    return [(p['w'], p['h'], p['placed']) for p in pages]

def _place(p, key, w, h, maxw, maxh, pad):
    if p['x'] + w + pad > maxw:
        p['x'] = pad; p['y'] += p['shelf_h'] + pad; p['shelf_h'] = 0
    if p['y'] + h + pad > maxh: return False
    p['placed'].append((key, p['x'], p['y'])); p['x'] += w + pad
    p['shelf_h'] = max(p['shelf_h'], h); p['w'] = max(p['w'], p['x']); p['h'] = max(p['h'], p['y'] + h + pad)
    return True

def build_atlas(pck, imp, tp_path, out_root):
    sheet = json.loads(pck.read(tp_path)); name = os.path.splitext(os.path.basename(tp_path))[0]
    S = 1.0 if tp_path.startswith(FULL_RES) else SCALE
    names = {sp['filename'] for tex in sheet['textures'] for sp in tex['sprites']}
    sprites = []  # (key, scaled_img, trim)
    for tex in sheet['textures']:
        src = os.path.join(os.path.dirname(tp_path), tex['image']); page = decode_ctex(pck.read(imp[src][2][0]))
        for sp in tex['sprites']:
            if '/beta/' in sp['filename'] and sp['filename'].replace('/beta/', '/') in names: continue  # beta art of a card with final art: never loaded
            r, m = sp['region'], sp.get('margin', {'x': 0, 'y': 0, 'w': 0, 'h': 0})
            crop = page.crop((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']))
            if S != 1.0: crop = crop.resize((max(1, round(r['w'] * S)), max(1, round(r['h'] * S))), Image.LANCZOS)
            sprites.append((os.path.splitext(sp['filename'])[0], crop, m, r))
    pages = shelf_pack([(k, im.width, im.height) for k, im, _, _ in sprites])
    by_key = {k: (im, m, r) for k, im, m, r in sprites}; total = 0; jsons = []
    for i, (pw, ph, placed) in enumerate(pages):
        canvas = Image.new('RGBA', (pw, ph)); frames = {}
        for key, x, y in placed:
            im, m, r = by_key[key]; canvas.paste(im, (x, y))
            frames[key] = dict(frame=dict(x=x, y=y, w=im.width, h=im.height), rotated=False, trimmed=any(m.values()),
                               spriteSourceSize=dict(x=round(m['x'] * S), y=round(m['y'] * S), w=im.width, h=im.height),
                               sourceSize=dict(w=round((r['w'] + m['w']) * S), h=round((r['h'] + m['h']) * S)))
        img_name = f'{name}-{i}.webp'; json_name = f'{name}-{i}.json'
        os.makedirs(os.path.join(out_root, 'atlases'), exist_ok=True)
        canvas.save(os.path.join(out_root, 'atlases', img_name), 'WEBP', quality=ATLAS_Q.get(name, WEBP_Q), method=WEBP_METHOD)
        total += os.path.getsize(os.path.join(out_root, 'atlases', img_name))
        jsons.append((json_name, dict(frames=frames, meta=dict(image=img_name, format='RGBA8888', size=dict(w=pw, h=ph), scale=str(S)))))
    for j, (jn, data) in enumerate(jsons):
        data['meta']['related_multi_packs'] = [o[0] for k, o in enumerate(jsons) if k != j]
        json.dump(data, open(os.path.join(out_root, 'atlases', jn), 'w'), separators=(',', ':'))
    return dict(name=name, pages=len(pages), sprites=len(sprites), bytes=total)

# ---------------------------------------------------------------- spine
def build_spine(pck, imp, out_root):
    res = []
    for src, (importer, typ, dests) in imp.items():
        if importer == 'spine.skel':
            out = os.path.join(out_root, src); os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, 'wb').write(pck.read(dests[0])); res.append(dict(src=src, kind='skel'))
        elif importer == 'spine.atlas':
            data = json.loads(pck.read(dests[0]))['atlas_data']; lines = data.split('\n'); d = os.path.dirname(src); out_lines = []
            for i, line in enumerate(lines):  # page name lines: followed by "size:" line
                if i + 1 < len(lines) and lines[i + 1].startswith('size:') and line.strip():
                    page_src = os.path.join(d, line.strip()); pw, ph = map(int, lines[i + 1].split(':')[1].split(','))
                    s = pick_scale(pw, ph, page_src); out_lines.append(os.path.basename(out_name(page_src, s)))
                else: out_lines.append(line)
            out = os.path.join(out_root, src); os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, 'w').write('\n'.join(out_lines)); res.append(dict(src=src, kind='atlas'))
    return res

# ---------------------------------------------------------------- fonts
def decode_fontdata(d):
    assert d[:4] == b'RSCC'; mode, bs, total = struct.unpack_from('<III', d, 4); bc = total // bs + 1
    sizes = struct.unpack_from(f'<{bc}I', d, 16); p = 16 + 4 * bc; dz = zstandard.ZstdDecompressor(); out = b''
    for s in sizes: out += dz.decompress(d[p:p + s], max_output_size=bs); p += s
    best = None; i = out.find(b'\x1f\x00\x00\x00')  # VARIANT_PACKED_BYTE_ARRAY
    while i != -1:
        L = struct.unpack_from('<I', out, i + 4)[0]
        if 0 < L <= len(out) - i - 8 and out[i + 8:i + 12] in (b'\x00\x01\x00\x00', b'OTTO', b'true', b'ttcf') and (best is None or L > best[1]):
            best = (i + 8, L)
        i = out.find(b'\x1f\x00\x00\x00', i + 1)
    assert best, 'no font blob found'; return out[best[0]:best[0] + best[1]]

def build_fonts(pck, imp, chars, out_root, ref_root):
    res = []
    for src, (importer, typ, dests) in imp.items():
        if importer != 'font_data_dynamic': continue
        raw = decode_fontdata(pck.read(dests[0])); name = os.path.splitext(os.path.basename(src))[0]
        ref = os.path.join(ref_root, 'fonts', os.path.basename(src)); os.makedirs(os.path.dirname(ref), exist_ok=True); open(ref, 'wb').write(raw)
        try:
            font = TTFont(io.BytesIO(raw)); opts = subset.Options(flavor='woff2', hinting=False, desubroutinize=True, layout_features=['*'], notdef_outline=True, ignore_missing_glyphs=True)
            sub = subset.Subsetter(opts); sub.populate(text=chars); sub.subset(font)
            out = os.path.join(out_root, 'fonts', f'{name}.woff2'); os.makedirs(os.path.dirname(out), exist_ok=True); font.flavor = 'woff2'; font.save(out)
            res.append(dict(src=src, out=os.path.relpath(out, out_root), raw=len(raw), bytes=os.path.getsize(out), glyphs=len(font.getGlyphOrder())))
        except Exception as e:
            res.append(dict(src=src, raw=len(raw), error=str(e)))
    return res

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--pck', default=PCK_DEFAULT); ap.add_argument('--dll', default=DLL_DEFAULT)
    ap.add_argument('--out', default='assets'); ap.add_argument('--ref', default='ref'); ap.add_argument('--jobs', type=int, default=max(2, os.cpu_count() - 1))
    ap.add_argument('--only', default='', help='comma list: textures,atlases,spine,fonts,i18n,ref,gdscript,debug_audio')
    a = ap.parse_args(); only = set(a.only.split(',')) if a.only else None
    def want(k): return only is None or k in only
    t0 = time.time(); pck = Pck(a.pck); mpath = os.path.join(a.out, 'manifest.json')
    man = json.load(open(mpath)) if os.path.exists(mpath) else {}  # merge so --only runs keep other sections
    man.update(scale=SCALE, min_scale_side=MIN_SCALE_SIDE, max_side=MAX_SIDE, webp_quality=WEBP_Q)
    imp = {}
    for p in pck.paths(lambda p: p.endswith('.import')):
        importer, typ, dests = parse_import(pck.read(p).decode('utf-8', 'replace')); imp[p[:-7]] = (importer, typ, dests)
    print(f'pck files={len(pck.entries)} imports={len(imp)}', flush=True)

    atlas_pages = set()
    for tp in pck.paths(lambda p: p.endswith('.tpsheet')):
        for tex in json.loads(pck.read(tp))['textures']: atlas_pages.add(os.path.join(os.path.dirname(tp), tex['image']))

    if want('ref'):
        n = 0
        for p in pck.paths(lambda p: os.path.splitext(p)[1] in REF_EXT or p.startswith('localization/') and p.endswith('.md')):
            out = os.path.join(a.ref, 'godot', p); os.makedirs(os.path.dirname(out), exist_ok=True); open(out, 'wb').write(pck.read(p)); n += 1
        os.makedirs(os.path.join(a.ref, 'dotnet'), exist_ok=True)
        if os.path.exists(a.dll): open(os.path.join(a.ref, 'dotnet', 'sts2.dll'), 'wb').write(open(a.dll, 'rb').read())
        print(f'ref: {n} files', flush=True)

    if want('gdscript'):  # compiled .gdc -> readable .gd at the path its .gd.remap names
        import gdc; n = 0
        for rp in pck.paths(lambda p: p.endswith('.gd.remap')):
            m = re.search(r'path="res://([^"]+)"', pck.read(rp).decode())
            out = os.path.join(a.ref, 'godot', rp[:-len('.remap')]); os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, 'w').write(gdc.decompile(pck.read(m.group(1)))); n += 1
        print(f'gdscript: {n} scripts', flush=True)

    # font subsets cover every character any localization table uses (also for `--only fonts` runs)
    chars = set(); loc_files = pck.paths(lambda p: p.startswith('localization/') and p.endswith('.json'))
    for p in loc_files: chars.update(json.dumps(json.loads(pck.read(p).decode('utf-8')), ensure_ascii=False))
    if want('i18n'):
        n = 0
        for p in loc_files:
            data = json.loads(pck.read(p).decode('utf-8')); out = os.path.join(a.out, 'i18n', p[len('localization/'):])
            os.makedirs(os.path.dirname(out), exist_ok=True); json.dump(data, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':')); n += 1
        man['i18n'] = dict(files=n, chars=len(chars)); print(f'i18n: {n} files, {len(chars)} distinct chars', flush=True)
        # browser preload index: the game reads localization synchronously through Godot FileAccess
        i18n_root = os.path.join(a.out, 'i18n')
        langs = sorted(d for d in os.listdir(i18n_root) if os.path.isdir(os.path.join(i18n_root, d)))
        tables = sorted(f[:-5] for f in os.listdir(os.path.join(i18n_root, 'eng')) if f.endswith('.json'))
        json.dump(dict(languages=langs, tables=tables), open(os.path.join(i18n_root, 'index.json'), 'w'))

    if want('fonts'):
        man['fonts'] = build_fonts(pck, imp, ''.join(sorted(chars)) + ''.join(chr(c) for c in range(32, 127)), a.out, a.ref)
        print(f"fonts: {len(man['fonts'])} -> {sum(f.get('bytes', 0) for f in man['fonts']) / 1e6:.1f}MB", flush=True)

    if want('debug_audio'):
        # NDebugAudioManager plays res://debug_audio/<name> (raw mp3/wav; .tres = AudioStreamRandomizer over several)
        out = os.path.join(a.out, 'audio', 'debug'); os.makedirs(out, exist_ok=True); index = {}
        for p in pck.paths(lambda p: p.startswith('debug_audio/') and os.path.splitext(p)[1] in ('.mp3', '.wav', '.ogg')):
            name = p[len('debug_audio/'):]; open(os.path.join(out, name), 'wb').write(pck.read(p)); index[name] = [name]
        for p in pck.paths(lambda p: p.startswith('debug_audio/') and p.endswith('.tres')):
            refs = re.findall(r'path="res://debug_audio/([^"]+)"', pck.read(p).decode('utf-8', 'replace'))
            index[p[len('debug_audio/'):]] = [r for r in refs if r in index]
        json.dump(index, open(os.path.join(out, 'index.json'), 'w'), separators=(',', ':'), sort_keys=True)
        man['debug_audio'] = dict(files=sum(1 for v in index.values() if len(v) == 1), sets=sum(1 for v in index.values() if len(v) != 1))
        print(f"debug_audio: {man['debug_audio']}", flush=True)

    if want('spine'):
        man['spine'] = build_spine(pck, imp, a.out); print(f"spine: {len(man['spine'])} files", flush=True)

    if want('atlases'):
        man['atlases'] = [build_atlas(pck, imp, tp, a.out) for tp in pck.paths(lambda p: p.endswith('.tpsheet'))]
        for x in man['atlases']: print(f"atlas {x['name']}: {x['sprites']} sprites, {x['pages']} pages, {x['bytes'] / 1e6:.1f}MB", flush=True)

    if want('textures'):
        jobs = [(src, dests[0], a.out) for src, (importer, typ, dests) in imp.items() if importer in ('texture', 'image') and src not in atlas_pages and dests]
        print(f'textures: {len(jobs)} jobs on {a.jobs} workers', flush=True); res = []
        with mp.Pool(a.jobs, initializer=_init, initargs=(a.pck,)) as pool:
            for i, r in enumerate(pool.imap_unordered(_tex_job, jobs, chunksize=8)):
                res.append(r)
                if i % 400 == 0: print(f'  {i}/{len(jobs)} {time.time() - t0:.0f}s', flush=True)
        ok = [r for r in res if 'error' not in r]; man['textures'] = sorted(res, key=lambda r: r['src'])
        print(f"textures: {len(ok)} ok, {len(res) - len(ok)} failed, raw {sum(r['raw'] for r in ok) / 1e6:.0f}MB -> {sum(r['bytes'] for r in ok) / 1e6:.1f}MB", flush=True)
        for r in res:
            if 'error' in r: print('  FAIL', r['src'], r['error'])

    os.makedirs(a.out, exist_ok=True); json.dump(man, open(mpath, 'w'), indent=1)
    print(f'done in {time.time() - t0:.0f}s', flush=True)

if __name__ == '__main__': main()
