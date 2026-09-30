#!/usr/bin/env python3
"""VisualShader resources → what Godot draws them with: the generated shader code and the default textures.

A VisualShader resource stores `code`: the text VisualShader::_update_shader generated from its node graph when the
editor saved it, and what the runtime regenerates on load. Checked for every VisualShader graph under ref/godot (31,
.tres and inline sub-resources) against Godot 4.6 regenerating them with the stored code stripped: identical up to float
formatting (`= 1` / `= 1.0`) and 4.6's extra `depth_test_default` render mode on the two spatial ones — so the stored
code is used as is, and the graph is not re-generated here.

What the code does not carry: textures fixed on VisualShaderNodeTexture nodes (source SOURCE_TEXTURE). _update_shader
passes them as default texture parameters (Shader::set_default_texture_parameter) named by make_unique_id:
"tex_" + the stage prefix + "_" + node id, e.g. `uniform sampler2D tex_frg_40;`.

Usage: python3 tools/visual_shader.py   (self-check over ref/godot: the code's node-texture uniforms are exactly these)
"""
import os, re, sys

# VisualShader::Type prefixes (make_unique_id's typepre) of the stages a canvas_item / spatial shader generates
PREFIX = {'vertex': 'vtx', 'fragment': 'frg', 'light': 'lgt'}


def is_visual(sh):
    return isinstance(sh, dict) and sh.get('type') == 'VisualShader'


def default_textures(vs):
    """{uniform name: texture value (as the scene parser gives it)} for the graph's Texture nodes with a fixed texture."""
    out = {}
    for k, node in vs.items():
        m = re.match(r'nodes/(\w+)/(\d+)/node$', k)
        if not m or m.group(1) not in PREFIX or not isinstance(node, dict): continue
        if node.get('type') == 'VisualShaderNodeTexture' and int(node.get('source', 0) or 0) == 0 and node.get('texture'):
            out[f'tex_{PREFIX[m.group(1)]}_{m.group(2)}'] = node['texture']
    return out


def _check():
    sys.path.insert(0, os.path.dirname(__file__))
    import scenes
    bad = n = 0
    for dp, _, fs in os.walk(scenes.REF):
        for f in fs:
            if not f.endswith(('.tres', '.tscn')): continue
            path = os.path.join(dp, f)
            text = open(path, encoding='utf-8').read()
            if 'VisualShader' not in text: continue
            rel = os.path.relpath(path, scenes.REF)
            _, sub = scenes.parse_resources(text)
            graphs = [v for v in sub.values() if is_visual(v)]
            if text.startswith('[gd_resource type="VisualShader"'): graphs.append(scenes.load_tres(rel))
            for vs in graphs:
                n += 1
                code = vs.get('code', '')
                # every Texture node in SOURCE_TEXTURE declares its uniform, set or not
                want = {f'tex_{PREFIX[m.group(1)]}_{m.group(2)}' for k, v in vs.items() if (m := re.match(r'nodes/(\w+)/(\d+)/node$', k))
                        and m.group(1) in PREFIX and isinstance(v, dict) and v.get('type') == 'VisualShaderNodeTexture' and int(v.get('source', 0) or 0) == 0}
                have = set(re.findall(r'uniform\s+sampler2D\s+(tex_(?:vtx|frg|lgt)_\d+)\b', code))
                other = re.findall(r'uniform\s+\w+\s+((?:curve|curve3d|tex)_(?:vtx|frg|lgt)_\d+)\b', code)
                if not code or want != have or set(other) - have or not set(default_textures(vs)) <= have:
                    bad += 1
                    print('MISMATCH', rel, sorted(want), sorted(have), sorted(set(other) - have))
    print(f'{n} VisualShader graphs, {bad} mismatches')
    return bad == 0


if __name__ == '__main__':
    sys.exit(0 if _check() else 1)
