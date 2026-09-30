// What FMOD events play, per assets/audio/events.json (tools/fmod_bank.py), through the web engine's own condition /
// playlist code (packages/app/src/audio.ts). Usage: node tools/fmod_events.mjs [event path [param=value ...]]
import fs from 'node:fs';
import assert from 'node:assert';
import * as audio from '../packages/app/src/audio.ts';
const { useEventDb, describeEvent, resolveSfx } = audio;

const db = JSON.parse(fs.readFileSync('assets/audio/events.json', 'utf8'));
useEventDb(db);
const all = Object.keys(db.events);
const show = (path, params = {}) => console.log(`${describeEvent(path, params).join('\n')}${Object.keys(params).length ? `\n  (params ${JSON.stringify(params)})` : ''}\n`);

if (process.argv[2] === 'sim') await simulate();
else if (process.argv[2]) {
  show(process.argv[2], Object.fromEntries(process.argv.slice(3).map((a) => a.split('=')).map(([k, v]) => [k, Number(v)])));
  process.exit(0);
}
if (process.argv[2] !== 'sim') {
show('event:/sfx/ui/clicks/ui_click');
show('event:/sfx/enemy/enemy_attacks/the_insatiable/the_insatiable_lunging_bite');
show('event:/sfx/ambience/act1_ambience', { Progress: 1 });
show('event:/sfx/ambience/act1_ambience', { Progress: 3, Campfire: 1 });
show('event:/sfx/ambience/act2_ambience', { Progress: 4 });
show('event:/sfx/ambience/act2_ambience_the_insatiable');
show('event:/sfx/enemy/enemy_attacks/slumbering_beetle/slumbering_beetle_sleep_loop', { loop: 1 });
show('event:/sfx/characters/regent/regent_hurt_variable', { hurt_amount: 2 });
show('event:/music/menu_update');
show('event:/music/menu/menu_1', { menu_progress: 1 });
show('event:/music/act1_a1_v1', { Progress: 1 });

// checks
const empty = all.filter((e) => !resolveSfx(e).length);
console.log(`${all.length - empty.length}/${all.length} events reach samples; without: ${empty.join(', ') || '-'}`);
assert(!resolveSfx('event:/sfx/ambience/act2_ambience_the_insatiable').flat().some((f) => /bite/i.test(f)), 'insatiable ambience is its ambience bed');
assert(resolveSfx('event:/sfx/enemy/enemy_attacks/slumbering_beetle/slumbering_beetle_sleep_loop').flat().every((f) => /Snore/.test(f)), 'beetle sleep loop snores');
// SfxCmd.PlayLoop(…, usesLoopParam: true) callers end their loop through the "loop" parameter
for (const e of ['event:/sfx/enemy/enemy_attacks/slumbering_beetle/slumbering_beetle_sleep_loop', 'event:/sfx/enemy/enemy_attacks/owl_magistrate/owl_magistrate_fly_loop', 'event:/sfx/enemy/enemy_attacks/thieving_hopper/thieving_hopper_hover_loop'])
  console.log(`${e}: ${JSON.stringify(db.events[e]).includes('["loop",') ? 'ends on loop=1' : 'NO loop parameter'}`);
console.log('ok');
}

/** `sim`: run the engine against a fake Web Audio clock at 20x speed, every music / ambience / loop event with random
 * parameter changes and every one-shot, and fail on exceptions or instances that never end. */
async function simulate() {
  const t0 = performance.now(), now = () => ((performance.now() - t0) / 1000) * 20;
  const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  const node = () => ({ gain: param(), connect() {}, disconnect() {} });
  globalThis.AudioContext = class {
    state = 'running'; destination = node();
    get currentTime() { return now(); }
    createGain() { return node(); }
    createBufferSource() {
      const s = { ...node(), buffer: null, loop: false, playbackRate: param(), onended: null,
        start(at = 0, off = 0) { if (!s.loop) setTimeout(() => s.onended?.(), Math.max(0, (at - now() + s.buffer.duration - off) / 20) * 1000); },
        stop() { setTimeout(() => s.onended?.(), 0); } };
      return s;
    }
    decodeAudioData() { return Promise.resolve({ duration: 1 + Math.random() * 5 }); }
    resume() {}
  };
  globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(8) });
  const errors = [];
  process.on('uncaughtException', (e) => errors.push(e));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (n) => Math.floor(Math.random() * n);
  const locals = (e) => [...new Set(JSON.stringify(db.events[e]).match(/\["([A-Za-z_ ]+)",-?[\d.]+,-?[\d.]+,\d\]/g)?.map((m) => JSON.parse(m)[0]) ?? [])];
  const music = all.filter((e) => db.events[e].bus === 'music');
  for (const e of music) {
    audio.playMusic(e);
    for (let k = 0; k < 8; k++) {
      await sleep(120);
      audio.setMusicProgress(rand(10));
      for (const n of locals(e)) if (!db.params[n]?.global) audio.setMusicParam(n, rand((db.params[n]?.max ?? 1) + 1));
    }
  }
  audio.stopMusic();
  for (const e of all.filter((x) => db.events[x].bus === 'amb')) {
    audio.setAmbience(e);
    for (let k = 0; k < 4; k++) { await sleep(100); audio.setMusicProgress(rand(10)); audio.setCampfire(rand(2)); }
  }
  audio.stopAmbience();
  const sfx = all.filter((e) => db.events[e].bus !== 'music');
  for (const e of sfx) {
    const looping = !!db.events[e].tr || JSON.stringify(db.events[e]).includes('"loop":1');
    if (!looping) audio.playOneShot(e, 1, Object.fromEntries(locals(e).map((n) => [n, rand((db.params[n]?.max ?? 1) + 1)])));
    else { audio.playLoop(e, /sleep_loop|fly_loop|hover_loop/.test(e)); audio.setLoopParam(e, 'loop', rand(3)); } // SfxCmd.PlayLoop's usesLoopParam callers
  }
  await sleep(1500);
  for (const e of sfx) audio.stopLoop(e);
  await sleep(4000); // 80 s simulated: fade-outs and tails end
  const left = audio.audioState().instances;
  console.log(`sim: ${music.length} music, ${sfx.length} sfx/ambience events; ${errors.length} exceptions, ${left.length} instances still live`);
  for (const e of errors.slice(0, 5)) console.log(e);
  for (const i of left.slice(0, 10)) console.log('  live', i.path, i.pos);
  assert(!errors.length, 'engine threw');
  assert(!left.length, 'stopped / finished events keep running');
  process.exit(0);
}
