/**
 * esbuild bundler for the Phishing Detector side panel.
 *
 * @mlc-ai/web-llm is an ESM package that ships a WASM runtime. MV3 forbids
 * loading remote scripts, so we bundle everything into a single local file
 * (dist/sidepanel.bundle.js) that the side panel page loads with <script type="module">.
 *
 * Model *weights* are still fetched at runtime from the model CDN — that is data,
 * not script, and is permitted by the manifest's connect-src / host_permissions.
 */
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/**
 * Piper's bundled ONNX/emscripten glue references Node built-ins (fs, path, …)
 * inside `ENVIRONMENT_IS_NODE` branches that never execute in the browser.
 * esbuild still tries to resolve them at build time, so stub them to empty
 * modules. Safe because the browser code path never touches them.
 */
const stubNodeBuiltins = {
  name: 'stub-node-builtins',
  setup(build) {
    const builtins = [
      'fs', 'path', 'os', 'crypto', 'module', 'url', 'util',
      'worker_threads', 'perf_hooks', 'child_process', 'stream',
      // Node-only deps that @huggingface/transformers references but never uses
      // in the browser build:
      'onnxruntime-node', 'sharp',
    ];
    const filter = new RegExp(`^(node:)?(${builtins.join('|')})$`);
    build.onResolve({ filter }, (args) => ({
      path: args.path,
      namespace: 'node-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
      contents: 'module.exports = {};',
      loader: 'js',
    }));
  },
};

const shared = {
  bundle: true,
  target: 'es2022',
  platform: 'browser',
  plugins: [stubNodeBuiltins],
  sourcemap: true,
  // Keep the bundle readable-ish; the model dominates size, not the JS.
  minify: false,
  logLevel: 'info',
};

/** Side panel page bundle (ES module). */
const sidepanelOptions = {
  ...shared,
  entryPoints: ['src/sidepanel.ts'],
  outfile: 'dist/sidepanel.bundle.js',
  format: 'esm',
};

/** MV3 background service worker (classic script — no ESM in workers everywhere). */
const backgroundOptions = {
  ...shared,
  entryPoints: ['src/background.ts'],
  outfile: 'dist/background.js',
  format: 'iife',
};

if (watch) {
  const ctxs = await Promise.all([
    esbuild.context(sidepanelOptions),
    esbuild.context(backgroundOptions),
  ]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('👀 Watching for changes…');
} else {
  await Promise.all([esbuild.build(sidepanelOptions), esbuild.build(backgroundOptions)]);
  console.log('✅ Built dist/sidepanel.bundle.js + dist/background.js');
}
