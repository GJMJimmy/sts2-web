#!/usr/bin/env python3
"""List extracted audio (assets/audio/**.ogg, plus dedup aliases from manifest.json) → assets/audio/index.json.

The web audio layer resolves FMOD event paths against these sample names (see packages/app/src/audio.ts)."""
import json, os

OUT = 'assets/audio'
files = sorted(os.path.relpath(os.path.join(d, f), OUT) for d, _, fs in os.walk(OUT) for f in fs if f.endswith('.ogg'))
man = json.load(open(os.path.join(OUT, 'manifest.json')))
aliases = {k: v for bank in man.values() for k, v in bank.get('aliases', {}).items()}
json.dump({'files': files, 'aliases': aliases}, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
print(f'{len(files)} files, {len(aliases)} aliases → {OUT}/index.json')
