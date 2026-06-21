import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const root = new URL('..', import.meta.url);

test('Chrome macOS manifest uses MV3, side panel, and least-broad checked permissions', async () => {
  const manifest = await readJson('manifest.json');

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '114');
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
  assert.deepEqual(manifest.content_scripts, undefined);
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
  assert.ok(manifest.host_permissions.includes('http://localhost:11434/*'));
  assert.ok(manifest.host_permissions.includes('http://127.0.0.1:11434/*'));
});

test('extension CSP allows required local model runtimes without remote scripts', async () => {
  const manifest = await readJson('manifest.json');
  const csp = manifest.content_security_policy.extension_pages;

  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(csp, /script-src[^;]*https:/);
  assert.doesNotMatch(csp, /'unsafe-inline'/);
  assert.match(csp, /connect-src[^;]*https:\/\/huggingface\.co/);
  assert.match(csp, /connect-src[^;]*http:\/\/localhost:11434/);
});

test('all DOM ids used by side panel modules exist in sidepanel.html', async () => {
  const html = await readText('sidepanel.html');
  const source = [
    await readText('src/sidepanel.ts'),
    await readText('src/chatPanel.ts'),
    await readText('src/settings.ts'),
    await readText('src/legal.ts'),
  ].join('\n');

  const idsInHtml = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const idsInJs = [...source.matchAll(/getElementById\(['"`]([^'"`]+)['"`]\)/g)].map((m) => m[1]);

  assert.ok(idsInJs.length > 60, 'expected substantial DOM coverage');
  for (const id of idsInJs) {
    assert.ok(idsInHtml.has(id), `missing DOM id: ${id}`);
  }
});

test('README reflects the current Chrome/macOS local browser-or-Ollama scope', async () => {
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  const testingDoc = await readFile(new URL('../../docs/testing.md', import.meta.url), 'utf8');

  assert.match(readme, /in your browser.*Ollama/s);
  assert.match(readme, /docs\/testing\.md/);
  assert.match(testingDoc, /\|\s*\*\*Chrome - macOS\*\*\s*\|\s*pass\s*\|\s*pass\s*\|\s*pass\s*\|\s*pass\s*\|/);
  assert.match(testingDoc, /\|\s*\*\*Edge - macOS\*\*\s*\|\s*untested\s*\|\s*untested\s*\|\s*untested\s*\|\s*untested\s*\|/);
  assert.doesNotMatch(readme, /content\.js\s+# reads selected text/);
  assert.doesNotMatch(readme, /SmolLM2-1\.7B/);
});

test('package targets exclude the removed content script from browser builds', async () => {
  const targets = await readText('package-targets.js');

  assert.doesNotMatch(targets, /content\.js/);
  assert.match(targets, /build\/chrome/);
  assert.match(targets, /build\/firefox/);
  assert.match(targets, /build\/safari/);
});

test('built bundle stays under Chrome extension performance budget', async () => {
  const bundle = await stat(new URL('dist/sidepanel.bundle.js', root));
  const maxBytes = 15 * 1024 * 1024;

  assert.ok(
    bundle.size < maxBytes,
    `bundle ${bundle.size} bytes exceeds ${maxBytes} byte budget`
  );
});

async function readText(path) {
  return readFile(new URL(path, root), 'utf8');
}

async function readJson(path) {
  return JSON.parse(await readText(path));
}
