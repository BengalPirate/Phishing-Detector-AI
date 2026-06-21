import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';

const root = new URL('..', import.meta.url);

// Both bundles are entrypoints: the side panel page and the background worker.
const ENTRYPOINTS = ['src/sidepanel.ts', 'src/background.ts'];

test('all source modules are reachable from an entrypoint', async () => {
  const modules = await listSourceFiles(new URL('src/', root));
  const reachable = new Set();

  for (const entry of ENTRYPOINTS) {
    await walkImports(entry, reachable);
  }

  for (const modulePath of modules) {
    assert.ok(reachable.has(modulePath), `unreachable source module: ${modulePath}`);
  }
});

test('removed backend and popup files are not referenced by current docs or extension code', async () => {
  const checkedFiles = [
    '../README.md',
    '../BROWSER_EXTENSION_GUIDE.md',
    'manifest.json',
    'src/background.ts',
    'sidepanel.html',
    'src/sidepanel.ts',
  ];
  const joined = (await Promise.all(checkedFiles.map((p) => readText(p)))).join('\n');

  for (const stale of ['api_server.py', 'popup.html', 'popup.js', 'popup.css', 'content.js']) {
    assert.doesNotMatch(joined, new RegExp(stale.replace('.', '\\.')));
  }
});

test('known compatibility hook is documented as intentionally unowned by current UI', async () => {
  const background = await readText('src/background.ts');
  const appSources = [
    await readText('src/sidepanel.ts'),
    await readText('src/chatPanel.ts'),
    await readText('sidepanel.html'),
  ].join('\n');

  assert.match(background, /request\.action === 'analyzeText'/);
  assert.doesNotMatch(appSources, /action:\s*['"]analyzeText['"]/);
});

async function walkImports(modulePath, reachable) {
  if (reachable.has(modulePath)) return;
  reachable.add(modulePath);

  const source = await readText(modulePath);
  const imports = [...source.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)].map((m) => m[1]);
  for (const specifier of imports) {
    const resolved = new URL(specifier, new URL(modulePath, root));
    let relative = resolved.pathname.slice(root.pathname.length);
    // Imports are extensionless (TS bundler resolution); resolve to the .ts file.
    if (!relative.endsWith('.ts') && !relative.endsWith('.js')) relative += '.ts';
    await walkImports(relative, reachable);
  }
}

async function listSourceFiles(dirUrl, prefix = 'src') {
  const entries = await readdir(dirUrl);
  const files = [];
  for (const entry of entries) {
    const url = new URL(`${entry}`, dirUrl);
    const s = await stat(url);
    if (s.isDirectory()) {
      files.push(...(await listSourceFiles(new URL(`${entry}/`, dirUrl), `${prefix}/${entry}`)));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(`${prefix}/${entry}`);
    }
  }
  return files;
}

async function readText(path) {
  return readFile(new URL(path, root), 'utf8');
}
