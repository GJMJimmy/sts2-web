#!/usr/bin/env python3
"""Flatten Godot .tscn scenes into web draw lists → assets/scenes/<scene path>.json (+ assets/scenes/index.json).

Each output is {"root", "items", "nodes"}. Items are in draw order: a textured quad, colour rect or Spine skeleton with a
2D affine matrix m=[a,b,c,d,e,f] mapping its local rect (x, y, w, h) into the root's local space. "root" says how the
root sits in its parent (anchors+offsets or a position), so a scene can be placed full-screen or inside another scene's
node; "nodes" maps node paths to root-local matrices (e.g. the Layer_0x containers of combat backgrounds) and
"sizes" gives Control node rect sizes (parents for anchored sub-scenes).
Particle emitters (CPUParticles2D, GPUParticles2D + ParticleProcessMaterial) become `particles` items with their curves
and gradients pre-sampled; ShaderMaterial items carry `shader: {src, params}` and the shader sources are copied to
assets/shaders (the web renderer translates them; VisualShaders: their generated code, tools/visual_shader.py). Shaders
that read the screen add `screen: 1`, and such items under a BackBufferCopy carry `bbc` (a fresh screen copy). Covers what static set dressing uses: Node2D/Control transforms, anchors+offsets, TextureRect/Sprite2D/ColorRect/
SpineSprite, instanced sub-scenes, modulate/self_modulate, visibility, z_index, show_behind_parent, top_level,
CanvasItemMaterial blend modes (add/sub/mul) and clip_children (items carry `clip`: the clipping node's path; the
clipping node's own item gets `clipOnly` when it is only a mask). Items under a SpineBoneNode / SpineSlotNode carry
`bone` / `slot` (and `behind` for show_behind_parent) with matrices relative to that bone, for creature effects.
Spine items carry their spine-godot materials (`mats`: the SpineSprite's by blend mode, `slotMats`: SpineSlotNodes' by
slot name) and the class names of the scripts on their Node children (`vfx`). Lights are skipped; an autoplayed AnimationPlayer's texture / position tracks and queue_free become the scene's `anim`.

Usage: python3 tools/scenes.py            (converts backgrounds, rest sites, merchant, encounters' custom backgrounds, ancients' event
                                           backgrounds, creature visuals)
"""
import hashlib, json, math, os, re, sys

REF = 'ref/godot'
OUT = 'assets/scenes'
ROOTS = ['scenes/backgrounds', 'scenes/rest_site', 'scenes/merchant', 'scenes/rooms', 'scenes/vfx', 'scenes/events/background_scenes', 'scenes/creature_visuals', 'scenes/screens/char_select', 'scenes/orbs/orb_visuals']
# single scenes outside ROOTS (UI whose effects the web draws), and hidden nodes their code shows at runtime
EXTRA = ['scenes/ui/treasure_relic_holder.tscn',
         # the timeline's stars and the unlock screens' bursts (ui/timeline.tsx)
         'scenes/timeline_screen/timeline_screen.tscn', 'scenes/timeline_screen/unlock_cards_screen.tscn',
         'scenes/timeline_screen/unlock_relics_screen.tscn', 'scenes/timeline_screen/unlock_potions_screen.tscn',
         'scenes/timeline_screen/unlock_character_screen.tscn', 'scenes/timeline_screen/unlock_misc_screen.tscn',
         # the Fake Merchant event's room (ui/shop.tsx FakeMerchantScreen)
         'scenes/events/custom/fake_merchant.tscn']
SHOWN_AT_RUNTIME = {'UncommonGlow', 'RareGlow'}
# shaders the web UI draws itself (not through a converted scene): the Crystal Sphere's ball / fog and item shine
EXTRA_SHADERS = ['shaders/scry_reveal.gdshader', 'shaders/crystal_sphere_item.gdshader',
                 'shaders/vfx/ui/vfx_ui_epoch_unlock_chains_shader.gdshader',  # the epoch inspect screen's chains
                 'shaders/radial_blur.gdshader']  # combat_room's RadialBlur (hidden until NRadialBlurVfx.Activate)
VIEW = (1920.0, 1080.0)

sys.path.insert(0, os.path.dirname(__file__))
from spine_index import skel_paths  # noqa: E402
from visual_shader import default_textures, is_visual  # noqa: E402

CONTROL_TYPES = {
    'Control', 'TextureRect', 'ColorRect', 'Panel', 'Label', 'RichTextLabel', 'HBoxContainer', 'VBoxContainer',
    'MarginContainer', 'CenterContainer', 'NinePatchRect', 'TextureButton', 'Button', 'AspectRatioContainer',
    'SubViewportContainer', 'ReferenceRect', 'ScrollContainer', 'GridContainer', 'PanelContainer', 'TextureProgressBar',
}
NON_CANVAS = {'Node', 'AnimationPlayer', 'Timer', 'AudioStreamPlayer', 'AudioStreamPlayer2D', 'ResourcePreloader'}

# ------------------------------------------------------------------ tscn parsing
VAL_RE = re.compile(r'^(\w+)\((.*)\)$', re.S)


def parse_value(s, ext, sub):
    s = s.strip()
    if s.startswith('Array['):  # typed array literal, e.g. Array[Texture2D]([ExtResource("a"), ExtResource("b")])
        return [parse_value(m.group(0), ext, sub) for m in re.finditer(r'ExtResource\("[^"]+"\)', s)]
    if s in ('true', 'false'): return s == 'true'
    if s.startswith('"'): return s[1:-1].replace('\\"', '"').replace('\\n', '\n').replace('\\t', '\t').replace('\\\\', '\\')
    if s.startswith('[') and s.endswith(']'):  # plain array, e.g. a Curve's _data
        return [parse_value(x, ext, sub) for x in split_top(s[1:-1])]
    if s.startswith('&"'): return s[2:-1]
    if s.startswith('{') and s.endswith('}'):  # dictionary literal (Animation track keys, AnimationLibrary _data)
        out = {}
        for e in split_top(s[1:-1]):
            e = e.strip()
            if not e: continue
            q = e.index('"', 2 if e.startswith('&') else 1)
            out[parse_value(e[:q + 1], ext, sub)] = parse_value(e[q + 1:].lstrip()[1:], ext, sub)
        return out
    try: return float(s)
    except ValueError: pass
    m = VAL_RE.match(s)
    if not m: return s
    kind, args = m.group(1), m.group(2)
    if kind == 'ExtResource':
        rid = args.strip().strip('"')
        t, p = ext.get(rid, (None, None))
        return {'res': p, 'rtype': t}
    if kind == 'SubResource':
        return sub.get(args.strip().strip('"'), {})
    if kind in ('Vector2', 'Vector2i', 'Vector3', 'Vector3i', 'Color', 'Rect2', 'Rect2i', 'Vector4') or kind.startswith('Packed'):
        try: return [float(x) for x in args.split(',') if x.strip()]
        except ValueError: return s
    return s


def split_top(s):
    """Split on commas that are not inside brackets or strings."""
    out, depth, q, cur = [], 0, False, ''
    for ch in s:
        if q:
            cur += ch
            if ch == '"': q = False
            continue
        if ch == '"': q = True
        elif ch in '([{': depth += 1
        elif ch in ')]}': depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur); cur = ''
        else:
            cur += ch
    if cur.strip(): out.append(cur)
    return out


def _open(v):
    """True while a value is unfinished: unbalanced brackets outside strings, or an unterminated string."""
    depth, q, esc = 0, False, False
    for ch in v:
        if q:
            if esc: esc = False
            elif ch == '\\': esc = True
            elif ch == '"': q = False
        elif ch == '"': q = True
        elif ch in '([{': depth += 1
        elif ch in ')]}': depth -= 1
    return q or depth > 0


def parse_block(body):
    props, key, buf = {}, None, ''
    for line in body.split('\n'):
        if key is not None:  # continuation of a multi-line value (brackets or a string with newlines)
            buf += '\n' + line
            if not _open(buf):
                props[key] = buf; key = None
            continue
        if ' = ' in line and not line.startswith(' '):
            k, v = line.split(' = ', 1)
            if _open(v):
                key, buf = k.strip(), v
            else:
                props[k.strip()] = v
    return props


_cache = {}


def parse_resources(text):
    """ext_resource id → (type, path); sub_resource id → {'type', **every property} (dependencies come first)."""
    ext = {m.group(3): (m.group(1), m.group(2)) for m in re.finditer(r'\[ext_resource type="(\w+)"[^\]]*?path="res://([^"]+)" id="([^"]+)"\]', text)}
    sub = {}
    for m in re.finditer(r'\[sub_resource type="(\w+)" id="([^"]+)"\]\n(.*?)(?=\n\[|\Z)', text, re.S):
        d = {'type': m.group(1)}
        for k, v in parse_block(m.group(3)).items():
            d[k] = parse_value(v, ext, sub)
        sub[m.group(2)] = d
    return ext, sub


_tres = {}


def load_tres(rel):
    """An external .tres resource (Curve, Gradient, materials, VisualShader) as {'type', **its [resource] properties}."""
    if rel in _tres: return _tres[rel]
    path = os.path.join(REF, rel)
    d = {}
    if rel.endswith('.tres') and os.path.exists(path):
        text = open(path, encoding='utf-8').read()
        ext, sub = parse_resources(text)
        t = re.search(r'\[gd_resource type="(\w+)"', text)
        m = re.search(r'\[resource\]\n(.*)', text, re.S)
        d = {'type': t.group(1) if t else None, 'path': rel}
        if m:
            for k, v in parse_block(m.group(1)).items():
                d[k] = parse_value(v, ext, sub)
    _tres[rel] = d
    return d


def res_obj(v):
    """Resolve an ExtResource reference to a loaded .tres; sub-resources are already dicts."""
    if isinstance(v, dict) and v.get('res', '').endswith('.tres') and v.get('rtype') not in ('Texture2D', 'SpineSkeletonDataResource', 'PackedScene', 'Script'):
        return dict(load_tres(v['res']), res=v['res'], rtype=v.get('rtype'))
    return v


def load_scene(rel):
    if rel in _cache: return _cache[rel]
    path = os.path.join(REF, rel)
    text = open(path, encoding='utf-8').read()
    ext, sub = parse_resources(text)
    nodes = []
    for m in re.finditer(r'\[node name="([^"]+)"([^\]]*)\]\n?(.*?)(?=\n\[|\Z)', text, re.S):
        head = m.group(2)
        t = re.search(r'type="(\w+)"', head)
        par = re.search(r'parent="([^"]*)"', head)
        inst = re.search(r'instance=ExtResource\("([^"]+)"\)', head)
        props = {k: parse_value(v, ext, sub) for k, v in parse_block(m.group(3)).items()}
        nodes.append({
            'name': m.group(1), 'type': t.group(1) if t else None, 'parent': par.group(1) if par else None,
            'instance': ext[inst.group(1)][1] if inst and inst.group(1) in ext else None, 'props': props, 'children': [],
        })
    _cache[rel] = nodes
    return nodes


def build_tree(rel, depth=0):
    """Scene → root node dict with nested children; instanced sub-scenes are expanded in place."""
    nodes = [dict(n, props=dict(n['props']), children=[]) for n in load_scene(rel)]
    root = nodes[0]
    if root['instance'] and depth < 8:  # inherited scene
        base = build_tree(root['instance'], depth + 1)
        base['props'].update(root['props']); base['name'] = root['name']
        root = base
    by_path = {'.': root}

    def index(n, path):
        for c in n['children']:
            p = c['name'] if path == '.' else f"{path}/{c['name']}"
            by_path[p] = c
            index(c, p)
    index(root, '.')
    for n in nodes[1:]:
        parent = by_path.get(n['parent'])
        if parent is None: continue
        path = n['name'] if n['parent'] == '.' else f"{n['parent']}/{n['name']}"
        existing = next((c for c in parent['children'] if c['name'] == n['name']), None)
        if existing is not None and not n['type'] and not n['instance']:  # property override on an instanced child
            existing['props'].update(n['props'])
            continue
        if n['instance'] and depth < 8 and os.path.exists(os.path.join(REF, n['instance'])):
            sub = build_tree(n['instance'], depth + 1)
            sub['props'].update(n['props']); sub['name'] = n['name']
            n = sub
            index(n, path)
        parent['children'].append(n)
        by_path[path] = n
    return root

# ------------------------------------------------------------------ transforms


def mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f]


def trs(tx, ty, rot=0.0, sx=1.0, sy=1.0, skew=0.0):
    cr, sr = math.cos(rot), math.sin(rot)
    # Godot: x axis rotated by rot, y axis rotated by rot + skew
    cy, sy_ = math.cos(rot + skew), math.sin(rot + skew)
    return [cr * sx, sr * sx, -sy_ * sy, cy * sy, tx, ty]


def vec(v, d=(0.0, 0.0)):
    return v if isinstance(v, list) and len(v) >= 2 else list(d)


def is_control(t):
    return t in CONTROL_TYPES


def control_rect(p, parent_size):
    pw, ph = parent_size
    if any(k in p for k in ('offset_left', 'offset_top', 'offset_right', 'offset_bottom', 'anchor_right', 'anchor_bottom')):
        al, at = p.get('anchor_left', 0.0), p.get('anchor_top', 0.0)
        ar, ab = p.get('anchor_right', 0.0), p.get('anchor_bottom', 0.0)
        l = al * pw + p.get('offset_left', 0.0); t = at * ph + p.get('offset_top', 0.0)
        r = ar * pw + p.get('offset_right', 0.0); b = ab * ph + p.get('offset_bottom', 0.0)
        return l, t, r - l, b - t
    pos = vec(p.get('position')); size = vec(p.get('size'))
    return pos[0], pos[1], size[0], size[1]


def tex_size(res, sizes):
    return sizes.get(res, (0.0, 0.0))

# ------------------------------------------------------------------ flatten


def flatten(root, sizes):
    """Items in the root's local space, plus the root's placement data and each node's root-local matrix."""
    items = []
    nodes = {}
    sizes_out = {}
    order = [0]

    def color_of(v):
        return v if isinstance(v, list) and len(v) >= 3 else [1.0, 1.0, 1.0, 1.0]

    def walk(n, pm, psize, pmod, pz, parent_is_control, path='.', clip=None, att=None, bbc=False, rep=0):
        p, t = n['props'], n['type']
        if p.get('visible') is False and n.get('name') not in SHOWN_AT_RUNTIME: return
        if t in NON_CANVAS and not n['children']: return
        mod = [a * b for a, b in zip(pmod, color_of(p.get('modulate')) + [1.0] * 4)][:4]
        z = p.get('z_index', 0.0) + (pz if p.get('z_as_relative', True) else 0.0)
        size = psize
        if t in NON_CANVAS:
            m = pm
        elif path == '.':  # root: placed by the consumer (rootPlacement), items stay root-local
            m = pm
            if is_control(t):
                x, y, w, h = control_rect(p, VIEW)
                size = (w, h)
        elif is_control(t):
            if p.get('top_level'): pm = [1, 0, 0, 1, 0, 0]  # ignores the parent transform (root space here)
            x, y, w, h = control_rect(p, psize if parent_is_control else (0.0, 0.0))
            piv = vec(p.get('pivot_offset'))
            sc = vec(p.get('scale'), (1.0, 1.0))
            local = mul(mul(trs(x + piv[0], y + piv[1], p.get('rotation', 0.0), sc[0], sc[1]), [1, 0, 0, 1, 0, 0]), [1, 0, 0, 1, -piv[0], -piv[1]])
            m = mul(pm, local)
            size = (w, h)
        elif t in ('SpineBoneNode', 'SpineSlotNode'):
            # follows a bone / slot of the parent SpineSprite at runtime: children are stored relative to it
            m = [1, 0, 0, 1, 0, 0]
            att = {'bone' if t == 'SpineBoneNode' else 'slot': p.get('bone_name' if t == 'SpineBoneNode' else 'slot_name', ''),
                   'behind': bool(p.get('show_behind_parent'))}
        else:
            pos = vec(p.get('position')); sc = vec(p.get('scale'), (1.0, 1.0))
            m = mul([1, 0, 0, 1, 0, 0] if p.get('top_level') else pm, trs(pos[0], pos[1], p.get('rotation', 0.0), sc[0], sc[1], p.get('skew', 0.0)))
        blend = None
        mat = res_obj(p.get('material'))
        if isinstance(mat, dict):
            blend = {1.0: 'add', 2.0: 'sub', 3.0: 'mul'}.get(mat.get('blend_mode'))
            if 'additive' in (mat.get('res') or ''): blend = 'add'
        own = [a * b for a, b in zip(mod, color_of(p.get('self_modulate')) + [1.0] * 4)][:4]
        tex = p.get('texture')
        if t == 'Sprite2D' and not (isinstance(tex, dict) and tex.get('res')) and isinstance(p.get('_frames'), list) and p['_frames']:
            tex = p['_frames'][0]  # NSpriteAnimator sets the texture at runtime
        nz = noise_texture(tex)  # a NoiseTexture2D: items carry its properties (`noise`) under a stand-in src and size
        if nz and nz['noise']:
            tex = {'res': 'noise:' + hashlib.md5(json.dumps(nz, sort_keys=True).encode()).hexdigest()[:12], 'noise': nz}
            sizes[tex['res']] = (float(nz['width']), float(nz['height']))
        # show_behind_parent children draw before their parent's own item
        behind = [c for c in n['children'] if c['props'].get('show_behind_parent')]
        child_path = lambda c: c['name'] if path == '.' else f"{path}/{c['name']}"
        clip_mode = int(p.get('clip_children', 0.0) or 0)
        inner_clip = path if clip_mode else clip
        # a BackBufferCopy (copy_mode not disabled) copies the screen before its children draw: their screen reads see it
        inner_bbc = bbc or (t == 'BackBufferCopy' and int(p.get('copy_mode', 1.0) or 0) != 0)
        rep = int(p.get('texture_repeat', 0.0) or 0) or rep  # CanvasItem.texture_repeat (0: the parent's; default disabled)
        for c in behind:
            walk(c, m, size, mod, z, is_control(t) or (t in NON_CANVAS and parent_is_control), child_path(c), inner_clip, att, bbc, rep)
        base = {'m': [round(v, 4) for v in m], 'z': z, 'o': order[0], 'p': path}
        if blend: base['blend'] = blend
        if clip: base['clip'] = clip
        if att:
            base.update({k: v for k, v in att.items() if k != 'behind'})
            if att['behind']: base['behind'] = 1
        if clip_mode == 1: base['clipOnly'] = 1
        if isinstance(tex, dict) and tex.get('noise'): base['noise'] = tex['noise']
        scr = p.get('script')  # GDScript attachment (decompiled to ref/godot/**/*.gd): little_light_script (no exported vars)
        if isinstance(scr, dict) and str(scr.get('res')).endswith('.gd'): base['script'] = scr['res']
        if isinstance(mat, dict) and (mat.get('type') == 'ShaderMaterial' or mat.get('rtype') == 'ShaderMaterial'):
            base['shader'] = shader_ref(mat)  # drawn by a custom shader (translated by tools/shaders.py where possible)
            if bbc and isinstance(base['shader'], dict) and base['shader'].get('screen'): base['bbc'] = 1  # reads a fresh screen copy
            if rep in (2, 3) and isinstance(base['shader'], dict): base['rep'] = rep - 1  # TEXTURE wraps: 1 repeat, 2 mirror
        if own != [1.0, 1.0, 1.0, 1.0]: base['color'] = [round(v, 4) for v in own]
        if own != mod: base['mod'] = [round(v, 4) for v in mod]  # the modulate alone, for scripts that set self_modulate
        if t == 'TextureRect' and isinstance(tex, dict) and tex.get('res'):
            tw, th = tex_size(tex['res'], sizes)
            w, h = size
            if p.get('expand_mode', 0.0) == 0.0:  # EXPAND_KEEP_SIZE: the texture is the minimum size
                w, h = max(w, tw), max(h, th)
            items.append(dict(base, k='tex', src=tex['res'], x=0, y=0, w=w, h=h, stretch=int(p.get('stretch_mode', 0.0)),
                              flipH=bool(p.get('flip_h')), flipV=bool(p.get('flip_v')), tw=tw, th=th))
        elif t == 'Sprite2D' and isinstance(tex, dict) and tex.get('res'):
            tw, th = tex_size(tex['res'], sizes)
            region = p.get('region_rect') if p.get('region_enabled') else None
            hf, vf = int(p.get('hframes', 1.0)), int(p.get('vframes', 1.0))
            w, h = (region[2], region[3]) if region else (tw / hf, th / vf)
            if not region and (hf > 1 or vf > 1):
                fr = int(p.get('frame', 0.0))
                region = [(fr % hf) * w, (fr // hf) * h, w, h]
            off = vec(p.get('offset'))
            x, y = (off[0] - w / 2, off[1] - h / 2) if p.get('centered', True) else (off[0], off[1])
            it = dict(base, k='tex', src=tex['res'], x=x, y=y, w=w, h=h, flipH=bool(p.get('flip_h')), flipV=bool(p.get('flip_v')), tw=tw, th=th)
            if region: it['region'] = region
            frames = p.get('_frames')
            if isinstance(frames, list) and frames:  # NSpriteAnimator: flip through frames at _fps, then free
                it['anim'] = {'frames': [f.get('res') for f in frames if isinstance(f, dict)], 'fps': p.get('_fps', 15.0), 'loop': bool(p.get('_loop')),
                              'rot': vec(p.get('_rotationRange')) if p.get('_randomizeRotation') else None}
            items.append(it)
        elif t == 'ColorRect':
            c = color_of(p.get('color'))
            items.append(dict(base, k='rect', x=0, y=0, w=size[0], h=size[1], color=[round(a * b, 4) for a, b in zip(own, c)]))
        elif t in ('CPUParticles2D', 'GPUParticles2D') and isinstance(tex, dict) and tex.get('res'):
            it = particle_item(t, p, mat, tex, sizes)
            if it: items.append(dict(base, **it))
        elif t == 'SpineSprite':
            ref = p.get('skeleton_data_res')
            sp = skel_paths(ref['res']) if isinstance(ref, dict) and ref.get('res') else None
            if sp:
                it = dict(base, k='spine', spine=sp, skin=p.get('preview_skin', 'default'), anim=p.get('preview_animation', ''))
                it.update(spine_materials(n))
                items.append(it)
        order[0] += 1
        if path != '.':
            nodes[path] = [round(v, 4) for v in m]
            if is_control(t): sizes_out[path] = [round(size[0], 2), round(size[1], 2)]
        for c in n['children']:
            if c in behind: continue
            walk(c, m, size, mod, z, is_control(t) or (t in NON_CANVAS and parent_is_control), child_path(c), inner_clip, att, inner_bbc, rep)

    walk(root, [1, 0, 0, 1, 0, 0], VIEW, [1.0, 1.0, 1.0, 1.0], 0.0, True)
    items.sort(key=lambda i: (i['z'], i['o']))
    for i in items: del i['o']
    return {'root': root_placement(root), 'items': items, 'nodes': nodes, 'sizes': sizes_out}


# ------------------------------------------------------------------ particles & shaders
SHADERS = {}  # shader path → inline code (None: read the file)


def shader_ref(mat):
    """ShaderMaterial → {'src': shader path, 'params': uniform values (textures as {'tex': path})}, plus `screen` when the
    shader reads the screen (hint_screen_texture). A VisualShader's Texture nodes add their default textures."""
    sh = mat.get('shader')
    src = sh.get('res') if isinstance(sh, dict) else None
    if isinstance(sh, dict) and not src and sh.get('code'):  # a Shader sub-resource with inline code
        src = 'inline/' + hashlib.md5(sh['code'].encode()).hexdigest()[:12] + '.gdshader'
        SHADERS[src] = sh['code']
    params = {}
    vs = load_tres(src) if src and src.endswith('.tres') else sh
    defaults = list(default_textures(vs).items()) if is_visual(vs) else []  # the material's own values come after
    for name, v in defaults + [(k[len('shader_parameter/'):], v) for k, v in mat.items() if k.startswith('shader_parameter/')]:
        if isinstance(v, dict) and v.get('res', '').endswith('.tres'): params[name] = bake_texture(v['res'])
        elif isinstance(v, dict) and v.get('res'): params[name] = {'tex': v['res']}
        elif isinstance(v, dict) and v.get('type') in BAKED and bake_res(v): params[name] = bake_res(v)  # a sub-resource LUT / curve
        elif isinstance(v, (bool, float, int)) or (isinstance(v, list) and all(isinstance(x, (int, float)) for x in v)): params[name] = v
    if not src: return 1
    SHADERS.setdefault(src, None)
    ref = {'src': src, 'params': params}
    if 'hint_screen_texture' in shader_code(src): ref['screen'] = 1
    return ref


def shader_code(src):
    """A shader's source: inline code, a .gdshader file, or a .tres Shader / VisualShader's (generated) code."""
    if SHADERS.get(src): return SHADERS[src]
    path = os.path.join(REF, src)
    if src.endswith('.gdshader'): return open(path, encoding='utf-8').read() if os.path.exists(path) else ''
    return load_tres(src).get('code', '')


SPINE_BLENDS = ('normal', 'additive', 'multiply', 'screen')  # spine BlendMode order
CANVAS_BLENDS = {0: 'mix', 1: 'add', 2: 'sub', 3: 'mul', 4: 'premul'}


def material_ref(v):
    """A Material property → {'shader': shader_ref, 'key', 'local'} (ShaderMaterial; `key` names the shared resource: the
    .tres path, or a sub-resource's content hash) or {'blend'} (CanvasItemMaterial); None for anything else."""
    mat = res_obj(v)
    if not isinstance(mat, dict): return None
    if mat.get('type') == 'CanvasItemMaterial':
        return {'blend': CANVAS_BLENDS.get(int(mat.get('blend_mode', 0.0)), 'mix')}
    if mat.get('type') != 'ShaderMaterial': return None
    sh = shader_ref(mat)
    if not isinstance(sh, dict): return None
    out = {'shader': sh, 'key': mat.get('res') or 'sub:' + hashlib.md5(json.dumps(sh, sort_keys=True).encode()).hexdigest()[:12]}
    if mat.get('resource_local_to_scene'): out['local'] = 1
    return out


def spine_materials(n):
    """SpineSprite::update_meshes' materials: the sprite's {normal,additive,multiply,screen}_material (`mats`), each slot's
    first SpineSlotNode's (`slotMats`, by slot name) and the VFX scripts on Node children (`vfx`: class names)."""
    mats = lambda p: {b: m for b in SPINE_BLENDS for m in [material_ref(p.get(b + '_material'))] if m}
    out, slots, vfx = {}, {}, []
    own = mats(n['props'])
    if own: out['mats'] = own
    for c in n['children']:
        if c['type'] == 'SpineSlotNode' and c['props'].get('slot_name'): slots.setdefault(c['props']['slot_name'], mats(c['props']))
        scr = c['props'].get('script')
        if c['type'] == 'Node' and isinstance(scr, dict) and str(scr.get('res')).endswith('.cs'): vfx.append(os.path.basename(scr['res'])[:-3])
    if any(slots.values()): out['slotMats'] = {k: v for k, v in slots.items() if v}
    if vfx: out['vfx'] = vfx
    return out


BAKED = ('GradientTexture1D', 'CurveTexture', 'CurveXYZTexture', 'NoiseTexture2D')

# Godot 4.5's defaults (modules/noise: fastnoise_lite.h, noise_texture_2d.h) for what a resource leaves out
FNL_DEFAULTS = {
    'noise_type': 1, 'seed': 0, 'frequency': 0.01, 'offset': [0.0, 0.0, 0.0],
    'fractal_type': 1, 'fractal_octaves': 5, 'fractal_lacunarity': 2.0, 'fractal_gain': 0.5,
    'fractal_weighted_strength': 0.0, 'fractal_ping_pong_strength': 2.0,
    'cellular_distance_function': 0, 'cellular_jitter': 1.0, 'cellular_return_type': 1,
    'domain_warp_enabled': False, 'domain_warp_type': 0, 'domain_warp_amplitude': 30.0, 'domain_warp_frequency': 0.05,
    'domain_warp_fractal_type': 1, 'domain_warp_fractal_octaves': 5, 'domain_warp_fractal_lacunarity': 6.0, 'domain_warp_fractal_gain': 0.5,
}
NOISE_TEX_DEFAULTS = {'width': 512, 'height': 512, 'invert': False, 'in_3d_space': False, 'seamless': False,
                      'seamless_blend_skirt': 0.1, 'as_normal_map': False, 'bump_strength': 8.0, 'normalize': True}


def noise_texture(v):
    """NoiseTexture2D (a sub-resource or an external .tres) → its properties for render/noise.ts (Godot's defaults filled
    in, the FastNoiseLite as `noise`, the Gradient as `color_ramp`); None for anything else."""
    if isinstance(v, dict) and str(v.get('res', '')).endswith('.tres'): v = load_tres(v['res'])
    if not isinstance(v, dict) or v.get('type') != 'NoiseTexture2D': return None
    d = {k: v.get(k, dv) for k, dv in NOISE_TEX_DEFAULTS.items()}
    n = res_obj(v.get('noise'))
    d['noise'] = {k: n.get(k, dv) for k, dv in FNL_DEFAULTS.items()} if isinstance(n, dict) and n.get('type') == 'FastNoiseLite' else None
    g = res_obj(v.get('color_ramp'))
    if isinstance(g, dict) and g.get('type') == 'Gradient':
        # Gradient(): black at 0, white at 1; set_offsets / set_colors resize the points (new ones: offset 0, black)
        offs, cols = [0.0, 1.0], [[0.0, 0.0, 0.0, 1.0], [1.0, 1.0, 1.0, 1.0]]
        if isinstance(g.get('offsets'), list):
            offs = list(g['offsets']); cols = (cols + [[0.0, 0.0, 0.0, 1.0]] * len(offs))[:len(offs)]
        if isinstance(g.get('colors'), list):
            c = g['colors']; cols = [c[i * 4:i * 4 + 4] for i in range(len(c) // 4)]; offs = (offs + [0.0] * len(cols))[:len(cols)]
        d['color_ramp'] = {'offsets': offs, 'colors': cols, 'interpolation_mode': int(g.get('interpolation_mode', 0)),
                           'interpolation_color_space': int(g.get('interpolation_color_space', 0))}
    return d


def bake_texture(rel, n=64):
    """Procedural textures (CurveTexture, CurveXYZTexture, GradientTexture1D) → {'bake': {'w', 'rgba'}} float data."""
    return bake_res(load_tres(rel), n) or {'tex': rel}


def bake_res(r, n=64):
    """bake_texture for a loaded resource (an external .tres or a material's sub-resource); None if it is not one."""
    t = r.get('type')
    if t == 'NoiseTexture2D':  # generated at runtime (render/noise.ts) from its properties
        nz = noise_texture(r)
        return {'noise': nz} if nz and nz['noise'] else None
    if t == 'GradientTexture1D':
        g = sample_gradient(r.get('gradient'), n)
        return {'bake': {'w': n, 'rgba': g}} if g else None
    if t in ('CurveTexture', 'CurveXYZTexture'):
        cs = [sample_curve(r.get(k), n) for k in (('curve', 'curve', 'curve') if t == 'CurveTexture' else ('curve_x', 'curve_y', 'curve_z'))]
        rgba = []
        for i in range(n): rgba += [cs[0][i] if cs[0] else 0.0, cs[1][i] if cs[1] else 0.0, cs[2][i] if cs[2] else 0.0, 1.0]
        return {'bake': {'w': n, 'rgba': rgba}}
    return None


def export_shaders():
    """Godot shader sources used by exported items → assets/shaders/<path>.gdshader (VisualShaders: their generated code)."""
    for src in EXTRA_SHADERS: SHADERS.setdefault(src, None)
    for src in sorted(SHADERS):
        code = shader_code(src)
        if not code: continue
        out = os.path.join('assets/shaders', re.sub(r'\.(tres|gdshader)$', '.gdshader', src))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, 'w', encoding='utf-8').write(code)


def unwrap(v):
    """CurveTexture / CurveXYZTexture / GradientTexture1D (sub or external .tres) → the Curve / Gradient inside."""
    v = res_obj(v)
    if isinstance(v, dict):
        for k in ('curve', 'curve_x', 'gradient'):
            if k in v: return res_obj(v[k])
    return v


def sample_curve(c, n=32):
    """Godot Curve (cubic Hermite between points, tangents from _data) sampled at n points over [0, 1]."""
    c = unwrap(c)
    if not isinstance(c, dict) or not isinstance(c.get('_data'), list): return None
    d, pts = c['_data'], []
    i = 0
    while i + 2 < len(d):
        if isinstance(d[i], list): pts.append((d[i][0], d[i][1], d[i + 1], d[i + 2])); i += 5
        else: i += 1
    if not pts: return None
    pts.sort()
    out = []
    for j in range(n):
        x = j / (n - 1)
        if x <= pts[0][0]: y = pts[0][1]
        elif x >= pts[-1][0]: y = pts[-1][1]
        else:
            k = next(k for k in range(len(pts) - 1) if pts[k][0] <= x <= pts[k + 1][0])
            (x0, y0, _, t0), (x1, y1, t1, _) = pts[k], pts[k + 1]
            dx = x1 - x0 or 1e-6
            t = (x - x0) / dx
            h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
            y = h00 * y0 + h10 * dx * t0 + h01 * y1 + h11 * dx * t1
        out.append(round(y, 4))
    return out


def sample_gradient(g, n=32):
    """Godot Gradient (linear or constant) sampled at n points → flat RGBA list."""
    g = unwrap(g)
    if not isinstance(g, dict) or g.get('type') not in ('Gradient', None): return None
    offs = g.get('offsets', [0.0, 1.0]); cols = g.get('colors', [0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0])
    stops = sorted((offs[i], cols[i * 4:i * 4 + 4]) for i in range(min(len(offs), len(cols) // 4)))
    if not stops: return None
    const = g.get('interpolation_mode') == 1.0
    out = []
    for j in range(n):
        x = j / (n - 1)
        if x <= stops[0][0]: c = stops[0][1]
        elif x >= stops[-1][0]: c = stops[-1][1]
        else:
            k = next(k for k in range(len(stops) - 1) if stops[k][0] <= x <= stops[k + 1][0])
            (a, ca), (b, cb) = stops[k], stops[k + 1]
            t = 0.0 if const else (x - a) / ((b - a) or 1e-6)
            c = [ca[i] + (cb[i] - ca[i]) * t for i in range(4)]
        out += [round(v, 3) for v in c]
    return out


def particle_item(t, p, mat, tex, sizes):
    """CPUParticles2D / GPUParticles2D (ParticleProcessMaterial) → an emitter description for the web particle system."""
    gpu = t == 'GPUParticles2D'
    pm = res_obj(p.get('process_material')) if gpu else p
    if not isinstance(pm, dict): pm = {}
    g = lambda k, d=0.0: pm.get(k, d) if isinstance(pm.get(k, d), (int, float, bool)) else d
    def v2(k, d):
        v = pm.get(k)
        return [v[0], v[1]] if isinstance(v, list) and len(v) >= 2 else list(d)
    tw, th = tex_size(tex['res'], sizes)
    hf = vf = 1
    if isinstance(mat, dict) and mat.get('particles_animation'):
        hf, vf = int(mat.get('particles_anim_h_frames', 1.0)), int(mat.get('particles_anim_v_frames', 1.0))
    shape = int(g('emission_shape', 0))
    ss = v2('emission_shape_scale', (1, 1)) if gpu else [1, 1]
    if shape in (1, 2): ext = [g('emission_sphere_radius', 1.0)] * 2
    elif shape == 3: ext = v2('emission_box_extents' if gpu else 'emission_rect_extents', (1, 1))
    elif shape == 6: ext = [g('emission_ring_radius', 1.0), g('emission_ring_inner_radius', 0.0)]
    else: ext = [0, 0]
    it = {
        'k': 'particles', 'src': tex['res'], 'tw': tw, 'th': th, 'hf': hf, 'vf': vf,
        'amount': int(p.get('amount', 8.0)), 'life': p.get('lifetime', 1.0), 'oneShot': bool(p.get('one_shot')),
        'explo': p.get('explosiveness', 0.0), 'pre': p.get('preprocess', 0.0), 'speed': p.get('speed_scale', 1.0),
        'emitting': p.get('emitting', True) is not False, 'lifeRand': g('lifetime_randomness') if gpu else p.get('lifetime_randomness', 0.0),
        'shape': shape, 'ext': [ext[0] * ss[0], ext[1] * (ss[1] if shape == 3 else ss[0])], 'offset': v2('emission_shape_offset', (0, 0)) if gpu else [0, 0],
        'dir': v2('direction', (1, 0)), 'spread': g('spread', 45.0),
        'vel': [g('initial_velocity_min'), g('initial_velocity_max')], 'grav': v2('gravity', (0, -9.8) if gpu else (0, 980)),
        'accel': [g('linear_accel_min'), g('linear_accel_max')], 'radial': [g('radial_accel_min'), g('radial_accel_max')],
        'damp': [g('damping_min'), g('damping_max')], 'angv': [g('angular_velocity_min'), g('angular_velocity_max')],
        'ang': [g('angle_min'), g('angle_max')],
        'scale': [g('scale_min', 1.0), g('scale_max', 1.0)] if gpu else [g('scale_amount_min', 1.0), g('scale_amount_max', 1.0)],
        'animOff': [g('anim_offset_min'), g('anim_offset_max')], 'animSpeed': [g('anim_speed_min'), g('anim_speed_max')],
        'align': bool(pm.get('particle_flag_align_y')),
    }
    if gpu and not isinstance(pm.get('gravity'), list): it['grav'] = [0, -9.8]
    # hue_variation: a per-particle colour rotation by 2π·mix(min, max, rand)·curve(t); a GPU material without a curve
    # uses 1, CPUParticles2D 0 (so no curve, no variation)
    hv = [g('hue_variation_min'), g('hue_variation_max')]
    if hv != [0.0, 0.0] and (gpu or pm.get('hue_variation_curve')):
        it['hue'] = hv
        if not gpu: it['hueCpu'] = True
    col = pm.get('color')
    if isinstance(col, list) and len(col) >= 4 and col != [1.0, 1.0, 1.0, 1.0]: it['tint'] = [round(x, 4) for x in col[:4]]
    split = not gpu and p.get('split_scale')
    curves = {
        'scx': sample_curve(p.get('scale_curve_x') if split else pm.get('scale_curve' if gpu else 'scale_amount_curve')),
        'scy': sample_curve(p.get('scale_curve_y')) if split else (sample_curve(unwrap_y(pm.get('scale_curve'))) if gpu else None),
        'alpha': sample_curve(pm.get('alpha_curve')) if gpu else None,
        'ramp': sample_gradient(pm.get('color_ramp')), 'initRamp': sample_gradient(pm.get('color_initial_ramp')),
        'angCurve': sample_curve(pm.get('angle_curve')), 'velCurve': sample_curve(pm.get('velocity_limit_curve')) if gpu else None,
        'hueCurve': sample_curve(pm.get('hue_variation_curve')) if 'hue' in it else None,
    }
    for k, v in curves.items():
        if v: it[k] = v
    return it


def unwrap_y(v):
    """CurveXYZTexture's y curve (split particle scale); None for single curves."""
    v = res_obj(v)
    return res_obj(v.get('curve_y')) if isinstance(v, dict) and 'curve_y' in v else None


def autoplay_anim(root, sizes):
    """An AnimationPlayer's autoplayed animation (players under the root only): its value tracks on texture / position
    (keys: times, values, discrete or not) and the queue_free call time. Paths are relative to the player's parent."""
    def find(n, path):
        for c in n['children']:
            cp = c['name'] if path == '.' else f"{path}/{c['name']}"
            if c['type'] == 'AnimationPlayer' and c['props'].get('autoplay'):
                yield path, c
            yield from find(c, cp)
    for base, player in find(root, '.'):
        libs = player['props'].get('libraries')
        lib = next(iter(libs.values()), None) if isinstance(libs, dict) else None
        anim = (lib or {}).get('_data', {}).get(player['props']['autoplay']) if isinstance(lib, dict) else None
        if not isinstance(anim, dict): continue
        out = {'length': anim.get('length', 1.0), 'tracks': []}
        i = 0
        while f'tracks/{i}/type' in anim:
            kind, path, keys = anim[f'tracks/{i}/type'], anim.get(f'tracks/{i}/path', ''), anim.get(f'tracks/{i}/keys', {})
            np = re.match(r'NodePath\("(.*)"\)$', str(path))
            node, _, prop = (np.group(1) if np else str(path)).partition(':')
            node = node if base == '.' else (base if node == '.' else f'{base}/{node}')
            if kind == 'method' and isinstance(keys, dict):
                for t, v in zip(keys.get('times', []), keys.get('values', [])):
                    if isinstance(v, dict) and v.get('method') == 'queue_free' and node in ('.', base): out['free'] = t
            elif kind == 'value' and prop in ('texture', 'position') and isinstance(keys, dict):
                vals = [v.get('res') if isinstance(v, dict) else (None if v == 'null' else v) for v in keys.get('values', [])]
                tr = {'node': node, 'prop': prop, 'times': keys.get('times', []), 'values': vals, 'discrete': keys.get('update') == 1.0}
                if prop == 'texture': tr['sizes'] = [list(tex_size(v, sizes)) if v else None for v in vals]
                out['tracks'].append(tr)
            i += 1
        if out['tracks'] or 'free' in out: return out
    return None


def script_exports(root):
    """The root script's exported fields set in the scene (`_impactParticles = [NodePath(...)]`, `_duration = 1.5`):
    node paths (item paths) and numbers, for the web ports of the VFX scripts that drive a scene."""
    out = {}
    np = lambda x: re.match(r'NodePath\("(.*)"\)$', x) if isinstance(x, str) else None
    for k, v in root['props'].items():
        if not k.startswith('_') or k.startswith('_edit'): continue
        if isinstance(v, list) and v and all(np(x) for x in v): out[k] = [np(x).group(1) for x in v]
        elif np(v): out[k] = np(v).group(1)
        elif isinstance(v, (bool, int, float)) or (isinstance(v, list) and v and all(isinstance(x, (int, float)) for x in v)): out[k] = v
    return out


def root_placement(root):
    """How the root sits in its parent: Control anchors/offsets (resolved against the parent size) or a Node2D transform."""
    p = root['props']
    r = {'ctrl': is_control(root['type']), 'piv': vec(p.get('pivot_offset')), 'scale': vec(p.get('scale'), (1.0, 1.0)), 'rot': p.get('rotation', 0.0)}
    mod = p.get('modulate')
    if isinstance(mod, list) and len(mod) >= 4 and mod[:4] != [1.0, 1.0, 1.0, 1.0]: r['mod'] = mod[:4]  # baked into item colours; scripts may replace it
    if r['ctrl'] and any(k in p for k in ('offset_left', 'offset_top', 'offset_right', 'offset_bottom', 'anchor_right', 'anchor_bottom')):
        r['a'] = [p.get('anchor_left', 0.0), p.get('anchor_top', 0.0), p.get('anchor_right', 0.0), p.get('anchor_bottom', 0.0)]
        r['off'] = [p.get('offset_left', 0.0), p.get('offset_top', 0.0), p.get('offset_right', 0.0), p.get('offset_bottom', 0.0)]
    else:
        r['pos'] = vec(p.get('position'))
    return r


def load_sizes():
    man = json.load(open('assets/manifest.json'))
    sizes = {t['src']: (float(t['ow']), float(t['oh'])) for t in man['textures']}
    return sizes


def main():
    sizes = load_sizes()
    index = []
    files = [os.path.relpath(os.path.join(dp, f), REF) for r in ROOTS for dp, _, fs in os.walk(os.path.join(REF, r)) for f in sorted(fs) if f.endswith('.tscn')]
    for rel in files + EXTRA:
        try:
            tree = build_tree(rel)
            scene = flatten(tree, sizes)
            anim = autoplay_anim(tree, sizes)
            if anim: scene['anim'] = anim
            ex = script_exports(tree) if tree['props'].get('script') else None
            if ex: scene['exports'] = ex
        except Exception as e:  # keep going; report
            print('skip', rel, e); continue
        out = os.path.join(OUT, rel[:-5] + '.json')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        json.dump(scene, open(out, 'w'), separators=(',', ':'))
        index.append(rel)
    json.dump(sorted(index), open(os.path.join(OUT, 'index.json'), 'w'), indent=0)
    export_shaders()
    print(f'{len(index)} scenes → {OUT}, {len(SHADERS)} shaders → assets/shaders')


if __name__ == '__main__':
    main()
