/**
 * Shared types for the extension. The highest-value type here is `ChatEngine`,
 * the contract that BOTH the in-browser WebLLM engine and the local Ollama
 * adapter conform to, so the analysis + chat code is engine-agnostic.
 */

// ---- Chat engine contract --------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Subset of the OpenAI-shaped request both engines accept. */
export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: { type?: string; schema?: string };
}

/** Non-streaming completion shape. */
export interface ChatResponse {
  choices: Array<{ message?: { content?: string } }>;
}

/** One streamed chunk. */
export interface ChatStreamChunk {
  choices: Array<{ delta?: { content?: string } }>;
}

/**
 * Minimal engine interface used by analysis (non-streaming) and chat (streaming).
 * `create` returns a union; callers cast to the shape they requested.
 */
export interface ChatEngine {
  chat: {
    completions: {
      create(req: ChatRequest): Promise<ChatResponse | AsyncIterable<ChatStreamChunk>>;
    };
  };
  unload?(): Promise<void>;
}

// ---- Provenance / chat data ------------------------------------------------

export interface ModelInfo {
  engine: string;
  model: string;
  external: boolean;
  appVersion: string;
}

export interface Provenance extends ModelInfo {
  sealedAt: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: number;
  provenance?: Provenance;
  integrity?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

// ---- Analysis / RAG --------------------------------------------------------

export interface AnalysisIndicators {
  sender_analysis: string;
  urgency_tactics: string;
  link_analysis: string;
  grammar_tone: string;
  requested_action: string;
}

export interface AnalysisResult {
  verdict: string;
  risk_score: number;
  red_flags: string[];
  explanation: string;
  user_advice: string;
  indicators: Record<string, string>;
  // metadata stamped at analysis time
  message_type?: string;
  engine?: string;
  model_used?: string;
  external?: boolean;
  analyzed_at?: string;
}

/** A labeled example as supplied to the prompt builder / stored in the library. */
export interface RetrievedExample {
  type: string;
  text: string;
  analysis: Partial<AnalysisResult> & Record<string, unknown>;
}

export interface RagExample extends RetrievedExample {
  id: string;
  source: string;
  createdAt: number;
  embedding: number[];
  score?: number;
}

// ---- TTS -------------------------------------------------------------------

export interface VoiceEntry {
  id: string;
  name: string;
}

export interface VoiceGroup {
  lang: string;
  engine: 'kokoro' | 'piper';
  voices: VoiceEntry[];
}

export interface ProgressInfo {
  pct?: number;
  loadedMB?: number;
}

export type ProgressCallback = (info: ProgressInfo) => void;

export interface SpeakOptions {
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

export interface SpeakSessionOptions {
  rate?: number;
  onFirstAudio?: () => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

export interface SpeakSession {
  push(sentence: string): void;
  end(): void;
  stop(): void;
  done: Promise<void>;
}

// ---- Web Speech API (not in default lib.dom typings) -----------------------

export interface SpeechRecognitionResultLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  start(): void;
  stop(): void;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
