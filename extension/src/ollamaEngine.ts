/**
 * Ollama adapter — lets users run the analysis + chat on a local Ollama model
 * instead of the in-browser WebLLM model. It exposes the SAME shape as WebLLM's
 * engine (`engine.chat.completions.create(...)`), so the rest of the app
 * (analysis, JSON output, streaming chat + TTS pipeline) works unchanged.
 *
 * Embeddings (RAG) and TTS stay in-browser; Ollama handles only the LLM.
 *
 * Requires Ollama running locally (default http://localhost:11434). The
 * extension reaches it via host_permissions; if the server rejects the request,
 * the user may need to allow the extension origin:
 *   OLLAMA_ORIGINS=chrome-extension://* ollama serve
 */

import type {
  ChatEngine,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
} from './types';

const OLLAMA_BASE = 'http://localhost:11434';

/** List the models the user has pulled in Ollama (for the picker). */
export async function listOllamaModels(): Promise<string[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`);
  if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
  const data = await res.json();
  return (data.models || []).map((m: { name: string }) => m.name).sort();
}

interface OllamaBody {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  options: { temperature?: number; num_predict?: number };
  format?: unknown;
}

/**
 * Build an engine bound to a specific Ollama model. Uses the native /api/chat
 * endpoint for full control over streaming (NDJSON) and structured output.
 */
export function createOllamaEngine(model: string): ChatEngine {
  async function create(
    opts: ChatRequest
  ): Promise<ChatResponse | AsyncIterable<ChatStreamChunk>> {
    const body: OllamaBody = {
      model,
      messages: opts.messages,
      stream: !!opts.stream,
      options: {},
    };
    if (opts.temperature != null) body.options.temperature = opts.temperature;
    if (opts.max_tokens != null) body.options.num_predict = opts.max_tokens;

    // Structured output: our analysis passes response_format {type:'json_object',
    // schema}. Ollama's native `format` accepts a JSON schema object, or 'json'.
    if (opts.response_format) {
      if (opts.response_format.schema) {
        try {
          body.format = JSON.parse(opts.response_format.schema);
        } catch (_) {
          body.format = 'json';
        }
      } else if (opts.response_format.type === 'json_object') {
        body.format = 'json';
      }
    }

    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(
          'Ollama refused the request (403 — CORS). Allow this extension: on the macOS app run ' +
            '`launchctl setenv OLLAMA_ORIGINS "*"` then quit and reopen Ollama; or from a terminal run ' +
            '`OLLAMA_ORIGINS="chrome-extension://*" ollama serve`.'
        );
      }
      const detail = await res.text().catch(() => '');
      throw new Error(`Ollama error ${res.status}${detail ? ': ' + detail : ''}`);
    }

    if (!opts.stream) {
      const data = await res.json();
      return { choices: [{ message: { content: data.message?.content || '' } }] };
    }

    // Streaming: Ollama returns newline-delimited JSON objects.
    return (async function* (): AsyncGenerator<ChatStreamChunk> {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let obj: any;
          try {
            obj = JSON.parse(line);
          } catch (_) {
            continue;
          }
          const content = obj.message?.content || '';
          if (content) yield { choices: [{ delta: { content } }] };
          if (obj.done) return;
        }
      }
    })();
  }

  return {
    chat: { completions: { create } },
    async unload() {
      /* nothing to unload — Ollama runs out-of-process */
    },
  };
}
