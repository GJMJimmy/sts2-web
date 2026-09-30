import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

/** Version of the extracted asset tree (paths, sizes, mtimes): the service worker keeps its asset cache across app builds until this changes. */
function assetsId(dir: string) {
  const h = crypto.createHash('sha1');
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { const st = fs.statSync(f); h.update(`${path.relative(dir, f)}:${st.size}:${st.mtimeMs}\n`); }
    }
  };
  try { walk(fs.realpathSync(dir)); } catch { return 'none'; }
  return h.digest('hex').slice(0, 12);
}

export default defineConfig(({ command }) => ({
  root: __dirname,
  base: './',
  publicDir: 'public',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact', keepNames: false },
  resolve: { alias: { '@sts2/core': path.resolve(__dirname, '../core/src/index.ts') } },
  server: { port: 47173, strictPort: true, host: '127.0.0.1', fs: { allow: [path.resolve(__dirname, '../..')] } },
  // Bundle goes to js/ so it never mixes with the game's assets/ tree (copied from public/).
  build: { target: 'es2022', chunkSizeWarningLimit: 20000, sourcemap: false, assetsDir: 'js' },
  preview: { port: 47174, strictPort: true, host: '127.0.0.1' },
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)), __ASSETS_ID__: JSON.stringify(command === 'build' ? assetsId(path.resolve(__dirname, 'public/assets')) : 'dev') },
  optimizeDeps: { exclude: ['@sts2/core'] },
}));
