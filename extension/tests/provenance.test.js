import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

import { sealMessage, sha256Hex } from '../src/provenance.ts';

test('sha256Hex returns a stable lowercase SHA-256 digest', async () => {
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('sealMessage tags engine provenance and chains integrity values', async () => {
  const conv = { messages: [] };
  const user = { role: 'user', content: 'Is this phishing?' };
  const assistant = { role: 'assistant', content: 'It is suspicious.' };
  conv.messages.push(user);
  await sealMessage(conv, user, {
    engine: 'webllm',
    model: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    external: false,
    appVersion: '2.0.0',
  });
  conv.messages.push(assistant);
  await sealMessage(conv, assistant, {
    engine: 'ollama',
    model: 'qwen2.5:7b',
    external: true,
    appVersion: '2.0.0',
  });

  assert.equal(user.provenance.engine, 'webllm');
  assert.equal(user.provenance.external, false);
  assert.equal(assistant.provenance.engine, 'ollama');
  assert.equal(assistant.provenance.external, true);
  assert.match(user.integrity, /^[a-f0-9]{64}$/);
  assert.match(assistant.integrity, /^[a-f0-9]{64}$/);
  assert.notEqual(user.integrity, assistant.integrity);

  const recomputedAssistant = await sha256Hex(
    `${user.integrity}|${assistant.role}|${assistant.content}|${JSON.stringify(
      assistant.provenance
    )}`
  );
  assert.equal(assistant.integrity, recomputedAssistant);
});

test('tampering with sealed content changes the recomputed integrity', async () => {
  const conv = { messages: [{ role: 'assistant', content: 'Original answer' }] };
  await sealMessage(conv, conv.messages[0], {
    engine: 'webllm',
    model: 'model-a',
    external: false,
    appVersion: '2.0.0',
  });

  const sealed = conv.messages[0];
  const tamperedDigest = await sha256Hex(
    `GENESIS|${sealed.role}|Tampered answer|${JSON.stringify(sealed.provenance)}`
  );

  assert.notEqual(sealed.integrity, tamperedDigest);
});

test('sealMessage falls back to unknown provenance when model info is missing', async () => {
  const conv = { messages: [{ role: 'assistant', content: 'Fallback answer' }] };

  await sealMessage(conv, conv.messages[0], null);

  assert.equal(conv.messages[0].provenance.engine, 'unknown');
  assert.equal(conv.messages[0].provenance.model, 'unknown');
  assert.equal(conv.messages[0].provenance.external, false);
  assert.equal(conv.messages[0].provenance.appVersion, 'unknown');
  assert.match(conv.messages[0].integrity, /^[a-f0-9]{64}$/);
});

test('sealMessage uses GENESIS when the previous message has no integrity', async () => {
  const conv = {
    messages: [
      { role: 'user', content: 'Unsealed previous message' },
      { role: 'assistant', content: 'Sealed response' },
    ],
  };

  await sealMessage(conv, conv.messages[1], {
    engine: '',
    model: '',
    external: false,
    appVersion: '',
  });

  assert.equal(conv.messages[1].provenance.engine, 'unknown');
  assert.equal(conv.messages[1].provenance.model, 'unknown');
  assert.equal(conv.messages[1].provenance.appVersion, 'unknown');

  const recomputed = await sha256Hex(
    `GENESIS|${conv.messages[1].role}|${conv.messages[1].content}|${JSON.stringify(
      conv.messages[1].provenance
    )}`
  );
  assert.equal(conv.messages[1].integrity, recomputed);
});
