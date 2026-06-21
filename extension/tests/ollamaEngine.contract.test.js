import test from 'node:test';
import assert from 'node:assert/strict';

import { createOllamaEngine, listOllamaModels } from '../src/ollamaEngine.ts';

test('listOllamaModels calls the local tags endpoint and sorts models', async () => {
  const calls = mockFetch(async (url) => {
    assert.equal(url, 'http://localhost:11434/api/tags');
    return jsonResponse({ models: [{ name: 'zeta:latest' }, { name: 'alpha:7b' }] });
  });

  assert.deepEqual(await listOllamaModels(), ['alpha:7b', 'zeta:latest']);
  assert.equal(calls.length, 1);
});

test('listOllamaModels returns an empty list when Ollama omits models', async () => {
  mockFetch(async () => jsonResponse({}));

  assert.deepEqual(await listOllamaModels(), []);
});

test('listOllamaModels rejects non-OK Ollama responses', async () => {
  mockFetch(async () => new Response('unavailable', { status: 503 }));

  await assert.rejects(() => listOllamaModels(), /Ollama responded 503/);
});

test('Ollama non-streaming completion maps WebLLM-shaped options to /api/chat', async () => {
  const calls = mockFetch(async (url, init) => {
    assert.equal(url, 'http://localhost:11434/api/chat');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'qwen2.5:7b');
    assert.equal(body.stream, false);
    assert.equal(body.options.temperature, 0.1);
    assert.equal(body.options.num_predict, 1400);
    assert.deepEqual(body.format.required, ['verdict']);
    return jsonResponse({ message: { content: '{"verdict":"SAFE"}' } });
  });

  const engine = createOllamaEngine('qwen2.5:7b');
  const completion = await engine.chat.completions.create({
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0.1,
    max_tokens: 1400,
    response_format: {
      type: 'json_object',
      schema: JSON.stringify({ type: 'object', required: ['verdict'] }),
    },
  });

  assert.equal(completion.choices[0].message.content, '{"verdict":"SAFE"}');
  assert.equal(calls.length, 1);
});

test('Ollama falls back to json format when response schema is invalid', async () => {
  mockFetch(async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.format, 'json');
    return jsonResponse({ message: { content: '{"verdict":"SUSPICIOUS"}' } });
  });

  const completion = await createOllamaEngine('qwen2.5:7b').chat.completions.create({
    messages: [{ role: 'user', content: 'hello' }],
    response_format: {
      type: 'json_object',
      schema: '{not valid json',
    },
  });

  assert.equal(completion.choices[0].message.content, '{"verdict":"SUSPICIOUS"}');
});

test('Ollama uses json format when response_format requests json_object without schema', async () => {
  mockFetch(async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.format, 'json');
    return jsonResponse({ message: {} });
  });

  const completion = await createOllamaEngine('qwen2.5:7b').chat.completions.create({
    messages: [{ role: 'user', content: 'hello' }],
    response_format: { type: 'json_object' },
  });

  assert.equal(completion.choices[0].message.content, '');
});

test('Ollama non-streaming completion tolerates missing message object', async () => {
  mockFetch(async () => jsonResponse({}));

  const completion = await createOllamaEngine('qwen2.5:7b').chat.completions.create({
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(completion.choices[0].message.content, '');
});

test('Ollama leaves format unset for unsupported response_format values', async () => {
  mockFetch(async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(Object.hasOwn(body, 'format'), false);
    return jsonResponse({ message: { content: 'plain text' } });
  });

  const completion = await createOllamaEngine('qwen2.5:7b').chat.completions.create({
    messages: [{ role: 'user', content: 'hello' }],
    response_format: { type: 'text' },
  });

  assert.equal(completion.choices[0].message.content, 'plain text');
});

test('Ollama streaming completion yields WebLLM-shaped delta chunks', async () => {
  mockFetch(async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            '{"message":{"content":"Hello"}}\n{"message":{"content":" world"},"done":true}\n'
          )
        );
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  });

  const stream = await createOllamaEngine('qwen2.5:7b').chat.completions.create({
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk.choices[0].delta.content);
  }
  assert.deepEqual(chunks, ['Hello', ' world']);
});

test('Ollama streaming completion skips empty and malformed NDJSON chunks', async () => {
  mockFetch(async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            '\nnot-json\n{"message":{}}\n{"message":{"content":"kept"}}\n{"done":true}\n'
          )
        );
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  });

  const stream = await createOllamaEngine('qwen2.5:7b').chat.completions.create({
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk.choices[0].delta.content);
  }
  assert.deepEqual(chunks, ['kept']);
});

test('Ollama streaming completion finishes when the reader closes without done marker', async () => {
  mockFetch(async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"message":{"content":"final"}}\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  });

  const stream = await createOllamaEngine('qwen2.5:7b').chat.completions.create({
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk.choices[0].delta.content);
  }
  assert.deepEqual(chunks, ['final']);
});

test('Ollama 403 response becomes actionable CORS setup guidance', async () => {
  mockFetch(async () => new Response('forbidden', { status: 403 }));

  await assert.rejects(
    () =>
      createOllamaEngine('qwen2.5:7b').chat.completions.create({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    /Ollama refused the request .*CORS/
  );
});

test('Ollama non-403 errors include status and response body when available', async () => {
  mockFetch(async () => new Response('model not found', { status: 404 }));

  await assert.rejects(
    () =>
      createOllamaEngine('missing:model').chat.completions.create({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    /Ollama error 404: model not found/
  );
});

test('Ollama non-403 errors tolerate unreadable error bodies', async () => {
  mockFetch(async () => ({
    ok: false,
    status: 500,
    text: async () => {
      throw new Error('body unavailable');
    },
  }));

  await assert.rejects(
    () =>
      createOllamaEngine('qwen2.5:7b').chat.completions.create({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    /Ollama error 500$/
  );
});

test('Ollama non-403 errors omit detail when response body is empty', async () => {
  mockFetch(async () => new Response('', { status: 500 }));

  await assert.rejects(
    () =>
      createOllamaEngine('qwen2.5:7b').chat.completions.create({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    /Ollama error 500$/
  );
});

test('Ollama unload is a no-op compatibility method', async () => {
  const engine = createOllamaEngine('qwen2.5:7b');
  await assert.doesNotReject(() => engine.unload());
});

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
