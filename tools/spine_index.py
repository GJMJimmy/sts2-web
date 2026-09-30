#!/usr/bin/env python3
"""Index creature visual scenes (ref/godot/scenes/creature_visuals/*.tscn) and encounter slot markers → assets/spine-index.json.

For each scene: Spine skeleton + atlas (web asset paths), the Visuals node transform, hitbox bounds and anchor markers,
so the web renderer can place creatures the way the Godot scenes do.
"""
import json, os, re, sys

REF = 'ref/godot'
OUT = 'assets/spine-index.json'

def parse_tscn(text):
    ext = {m.group(3): (m.group(1), m.group(2)) for m in re.finditer(r'\[ext_resource type="(\w+)"[^\]]*path="res://([^"]+)" id="([^"]+)"\]', text)}
    nodes = []
    for m in re.finditer(r'\[node name="([^"]+)" type="(\w+)"(?: parent="([^"]*)")?[^\]]*\]\n(.*?)(?=\n\[|\Z)', text, re.S):
        props = {}
        for line in m.group(4).split('\n'):
            if ' = ' in line:
                k, v = line.split(' = ', 1)
                props[k.strip()] = v.strip()
        nodes.append(dict(name=m.group(1), type=m.group(2), parent=m.group(3), props=props))
    return ext, nodes

def vec(s, default=(0.0, 0.0)):
    m = re.match(r'Vector2\(([-\d.e]+), ([-\d.e]+)\)', s or '')
    return [float(m.group(1)), float(m.group(2))] if m else list(default)

def skel_paths(tres_path):
    p = os.path.join(REF, tres_path)
    if not os.path.exists(p): return None
    t = open(p).read()
    atlas = re.search(r'type="SpineAtlasResource"[^\]]*path="res://([^"]+)"', t)
    skel = re.search(r'type="SpineSkeletonFileResource"[^\]]*path="res://([^"]+)"', t)
    mix = re.search(r'default_mix = ([\d.]+)', t)
    if not atlas or not skel: return None
    return dict(atlas=atlas.group(1), skel=skel.group(1), mix=float(mix.group(1)) if mix else 0.1)

def world_transforms(nodes):
    """Scene-root space for every node: (ox, oy, sx, sy) with world = o + s * local. Rotation is ignored (the indexed
    nodes and their containers are unrotated). Control offsets count as the node's position."""
    by = {}
    for n in nodes:
        n['path'] = '.' if n['parent'] is None else n['name'] if n['parent'] == '.' else n['parent'] + '/' + n['name']
        by[n['path']] = n
    memo = {}
    def xf(path):
        if path not in memo:
            n = by.get(path)
            if n is None or n['parent'] is None: memo[path] = (0.0, 0.0, 1.0, 1.0)
            else:
                ox, oy, psx, psy = xf(n['parent'])
                pr = n['props']
                lx, ly = vec(pr.get('position')) if 'position' in pr else (float(pr.get('offset_left', 0)), float(pr.get('offset_top', 0)))
                sx, sy = vec(pr.get('scale'), (1, 1))
                memo[path] = (ox + psx * lx, oy + psy * ly, psx * sx, psy * sy)
        return memo[path]
    return xf

def index_scene(rel):
    text = open(os.path.join(REF, rel)).read()
    ext, nodes = parse_tscn(text)
    xf = world_transforms(nodes)
    parent_xf = lambda n: xf(n['parent']) if n['parent'] is not None else (0.0, 0.0, 1.0, 1.0)
    e = dict()
    for n in nodes:  # first match wins: state variants (IdleBounds/FlyingBounds…) list the default state first
        pr = n['props']
        if n['type'] == 'SpineSprite' and 'spine' not in e:
            ref = re.search(r'ExtResource\("([^"]+)"\)', pr.get('skeleton_data_res', ''))
            if ref and ref.group(1) in ext:
                sp = skel_paths(ext[ref.group(1)][1])
                if sp:
                    ox, oy, sx, sy = xf(n['path'])
                    e['spine'] = sp
                    e['pos'] = [ox, oy]
                    e['scale'] = [sx, sy]
                    e['skin'] = pr.get('preview_skin', '"default"').strip('"')
        if n['type'] == 'Sprite2D' and 'sprite' not in e and n['parent'] in ('.', 'Visuals'):
            ref = re.search(r'ExtResource\("([^"]+)"\)', pr.get('texture', ''))
            if ref and ref.group(1) in ext:
                ox, oy, sx, sy = xf(n['path'])
                e['sprite'] = dict(texture=ext[ref.group(1)][1], pos=[ox, oy], scale=[sx, sy])
        if n['name'] == 'Bounds' and 'bounds' not in e:
            l, t, r, b = (float(pr.get(k, 0)) for k in ('offset_left', 'offset_top', 'offset_right', 'offset_bottom'))
            ox, oy, sx, sy = parent_xf(n)
            e['bounds'] = [ox + sx * l, oy + sy * t, sx * (r - l), sy * (b - t)]
        key = n['name'][0].lower() + n['name'][1:]
        if n['name'] in ('IntentPos', 'CenterPos', 'OrbPos', 'TalkPos') and key not in e:
            ox, oy, _, _ = xf(n['path'])
            e[key] = [ox, oy]
    return e

def main():
    out = {}
    for d in ['scenes/creature_visuals', 'scenes/rest_site/characters', 'scenes/merchant/characters']:
        root = os.path.join(REF, d)
        if not os.path.isdir(root): continue
        for f in sorted(os.listdir(root)):
            if f.endswith('.tscn'):
                out[f'{d}/{f}'] = index_scene(f'{d}/{f}')
    # Encounter scenes are just Marker2D slots in a 1920x1080 frame (NCombatRoom.PositionCreaturesWithSlots).
    enc = {}
    root = os.path.join(REF, 'scenes/encounters')
    for f in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        if f.endswith('.tscn'):
            _, nodes = parse_tscn(open(os.path.join(root, f)).read())
            enc[f[:-5].upper()] = {n['name']: vec(n['props'].get('position')) for n in nodes if n['type'] == 'Marker2D'}
    out['encounters'] = enc
    json.dump(out, open(OUT, 'w'), indent=0)
    n = sum(1 for v in out.values() if 'spine' in v)
    print(f'{len(out)} scenes, {n} with spine → {OUT}')

if __name__ == '__main__':
    main()
