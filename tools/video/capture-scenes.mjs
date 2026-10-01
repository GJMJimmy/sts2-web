// Records converted scenes full-screen through the dev server's ?scene= view (fire shaders, particles, skeletons).
// Usage: URL=http://127.0.0.1:47173/ node tools/video/capture-scenes.mjs scenes/rest_site/glory_rest_site.tscn …
import { open } from './cap-lib.mjs';
for (const s of process.argv.slice(2)) {
  const { browser, vt, rec } = await open('scene=' + encodeURIComponent(s));
  await vt.until(() => window.ui?.screen === 'menu');
  await vt.run(1500);
  rec.start('scene-' + s.split('/').pop().replace('.tscn', ''));
  await rec.play(5000);
  rec.stop();
  await browser.close();
}
