import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);

test('manifest host permissions stay restricted to model CDNs and local Ollama', async () => {
  const manifest = JSON.parse(await readText('manifest.json'));
  const allowed = new Set([
    'https://huggingface.co/*',
    'https://*.huggingface.co/*',
    'https://*.hf.co/*',
    'https://raw.githubusercontent.com/*',
    'https://cdn.jsdelivr.net/*',
    'http://localhost:11434/*',
    'http://127.0.0.1:11434/*',
  ]);

  assert.deepEqual(new Set(manifest.host_permissions), allowed);
});

test('model and chat output rendering does not inject generated text as HTML', async () => {
  const sidepanel = await readText('src/sidepanel.ts');
  const chat = await readText('src/chatPanel.ts');

  assert.match(sidepanel, /explanation\.textContent = result\.explanation/);
  assert.match(sidepanel, /userAdvice\.textContent = result\.user_advice/);
  assert.match(chat, /body\.textContent = m\.content/);
  assert.doesNotMatch(chat, /innerHTML\s*=\s*m\.content/);
  assert.doesNotMatch(sidepanel, /innerHTML\s*=\s*result\./);
});

test('extension avoids eval and broad page injection patterns', async () => {
  const files = [
    'src/background.ts',
    'src/sidepanel.ts',
    'src/chatPanel.ts',
    'src/ollamaEngine.ts',
    'src/prompts.ts',
    'src/provenance.ts',
  ];

  for (const file of files) {
    const source = await readText(file);
    assert.doesNotMatch(source, /\beval\s*\(/, `${file} contains eval()`);
    assert.doesNotMatch(source, /new Function\s*\(/, `${file} contains new Function()`);
    assert.doesNotMatch(source, /<all_urls>/, `${file} contains broad host pattern`);
  }
});

test('privacy-sensitive documentation does not claim cloud processing', async () => {
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');

  assert.match(readme, /No analytics, trackers, or ads/);
  assert.match(readme, /not transmitted to any server we control/);
  assert.doesNotMatch(readme, /Gemini API key/);
});

async function readText(path) {
  return readFile(new URL(path, root), 'utf8');
}
