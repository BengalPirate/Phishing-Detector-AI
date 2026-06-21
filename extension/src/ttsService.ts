/**
 * Dual-engine Text-to-Speech for the chat.
 *
 *   - Kokoro  (kokoro-js / @huggingface/transformers): natural English (US/UK).
 *   - Piper   (@mintplex-labs/piper-tts-web): ~35 other languages.
 *
 * The engine is chosen automatically from the selected voice. Voice MODELS are
 * downloaded on demand from HuggingFace (Kokoro ~86 MB once; each Piper language
 * ~20 MB when first selected) — nothing voice-related is bundled. Only the small
 * ONNX *runtimes* are vendored into ./assets (MV3 forbids loading them from a CDN).
 */

import { KokoroTTS } from 'kokoro-js';
import { env as hfEnv } from '@huggingface/transformers';
import { TtsSession } from '@mintplex-labs/piper-tts-web';
import type {
  ProgressCallback,
  ProgressInfo,
  SpeakOptions,
  SpeakSession,
  SpeakSessionOptions,
  VoiceGroup,
} from './types';

const runtime = ((globalThis.chrome || globalThis.browser) as typeof chrome).runtime;

// Kokoro / transformers ONNX runtime (vendored, same-origin).
hfEnv.allowLocalModels = false;
hfEnv.allowRemoteModels = true;
hfEnv.backends.onnx.wasm!.wasmPaths = runtime.getURL('assets/transformers-ort/');
hfEnv.backends.onnx.wasm!.numThreads = 1;

// Piper ONNX runtime + phonemizer (vendored, same-origin).
const PIPER_WASM_PATHS = {
  onnxWasm: runtime.getURL('assets/piper-ort/'),
  piperData: runtime.getURL('assets/piper/piper_phonemize.data'),
  piperWasm: runtime.getURL('assets/piper/piper_phonemize.wasm'),
};

const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/**
 * Voices grouped by language. English uses Kokoro (natural); everything else
 * uses Piper. Add more Piper voices from its VoiceId list as desired.
 */
export const VOICE_CATALOG: VoiceGroup[] = [
  { lang: 'English (US)', engine: 'kokoro', voices: [
    { id: 'af_heart', name: 'Heart — female' },
    { id: 'am_michael', name: 'Michael — male' },
    { id: 'af_bella', name: 'Bella — female' },
    { id: 'am_fenrir', name: 'Fenrir — male' },
  ]},
  { lang: 'English (UK)', engine: 'kokoro', voices: [
    { id: 'bf_emma', name: 'Emma — female' },
    { id: 'bm_george', name: 'George — male' },
  ]},
  { lang: 'Spanish', engine: 'piper', voices: [
    { id: 'es_ES-davefx-medium', name: 'Dave — Spain' },
    { id: 'es_MX-ald-medium', name: 'Ald — Mexico' },
  ]},
  { lang: 'French', engine: 'piper', voices: [
    { id: 'fr_FR-siwis-medium', name: 'Siwis — female' },
    { id: 'fr_FR-tom-medium', name: 'Tom — male' },
  ]},
  { lang: 'German', engine: 'piper', voices: [
    { id: 'de_DE-thorsten-medium', name: 'Thorsten — male' },
    { id: 'de_DE-kerstin-low', name: 'Kerstin — female' },
  ]},
  { lang: 'Italian', engine: 'piper', voices: [
    { id: 'it_IT-riccardo-x_low', name: 'Riccardo — male' },
  ]},
  { lang: 'Portuguese', engine: 'piper', voices: [
    { id: 'pt_BR-faber-medium', name: 'Faber — Brazil' },
  ]},
  { lang: 'Dutch', engine: 'piper', voices: [
    { id: 'nl_NL-mls-medium', name: 'MLS' },
  ]},
  { lang: 'Russian', engine: 'piper', voices: [
    { id: 'ru_RU-dmitri-medium', name: 'Dmitri — male' },
    { id: 'ru_RU-irina-medium', name: 'Irina — female' },
  ]},
  { lang: 'Polish', engine: 'piper', voices: [
    { id: 'pl_PL-gosia-medium', name: 'Gosia — female' },
  ]},
  { lang: 'Turkish', engine: 'piper', voices: [
    { id: 'tr_TR-dfki-medium', name: 'DFKI' },
  ]},
  { lang: 'Ukrainian', engine: 'piper', voices: [
    { id: 'uk_UA-ukrainian_tts-medium', name: 'Ukrainian TTS' },
  ]},
  { lang: 'Chinese', engine: 'piper', voices: [
    { id: 'zh_CN-huayan-medium', name: 'Huayan — female' },
  ]},
];

// id -> engine lookup
const VOICE_ENGINE: Record<string, 'kokoro' | 'piper'> = {};
for (const g of VOICE_CATALOG) for (const v of g.voices) VOICE_ENGINE[v.id] = g.engine;

const DEFAULT_VOICE = 'af_heart';

function cleanText(text: string): string {
  let p = text;
  p = p.replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '');
  p = p.replace(/`{1,3}/g, '').replace(/^\s*[-*+]\s/gm, '').replace(/^\s*\d+\.\s/gm, '');
  p = p.replace(/[\[\]{}|~\\]/g, '').replace(/_/g, ' ');
  return p.replace(/\s+/g, ' ').trim();
}

function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+/g) || [text]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Normalize a download-progress event to { pct } when a total is known, or
 * { loadedMB } when it isn't (HuggingFace sometimes omits Content-Length).
 */
function reportProgress(
  onProgress: ProgressCallback | undefined,
  p: { loaded?: number; total?: number; status?: string }
): void {
  if (!onProgress) return;
  const loaded = p.loaded || 0;
  if (p.total) onProgress({ pct: Math.round((loaded * 100) / p.total) });
  else if (loaded) onProgress({ loadedMB: Math.round(loaded / 1048576) });
}

class TtsService {
  currentVoiceId: string;
  kokoro: KokoroTTS | null;
  piper: TtsSession | null;
  piperVoiceId: string | null;
  currentAudio: HTMLAudioElement | null;

  constructor() {
    this.currentVoiceId = DEFAULT_VOICE;
    this.kokoro = null;
    this.piper = null;
    this.piperVoiceId = null;
    this.currentAudio = null;
  }

  engineFor(voiceId: string): 'kokoro' | 'piper' {
    return VOICE_ENGINE[voiceId] || 'kokoro';
  }

  setVoice(voiceId: string): void {
    if (voiceId) this.currentVoiceId = voiceId;
  }

  getCurrentVoiceId(): string {
    return this.currentVoiceId;
  }

  /** Ready if the engine for the current voice is loaded. */
  isReady(): boolean {
    if (this.engineFor(this.currentVoiceId) === 'kokoro') return !!this.kokoro;
    return !!this.piper && this.piperVoiceId === this.currentVoiceId;
  }

  /** Load the engine + voice needed for `voiceId` (downloads on demand). */
  async ensure(voiceId: string, onProgress?: ProgressCallback): Promise<void> {
    const engine = this.engineFor(voiceId);
    if (engine === 'kokoro') {
      if (!this.kokoro) {
        this.kokoro = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: (p: { status?: string; loaded?: number; total?: number }) => {
            if (p.status === 'progress') reportProgress(onProgress, p);
          },
        });
      }
    } else {
      if (!this.piper || this.piperVoiceId !== voiceId) {
        this.piper = await TtsSession.create({
          voiceId,
          wasmPaths: PIPER_WASM_PATHS,
          progress: (p) => reportProgress(onProgress, p),
        });
        this.piperVoiceId = voiceId;
      }
    }
  }

  async initialize(voiceId?: string, onProgress?: ProgressCallback): Promise<void> {
    if (voiceId) this.currentVoiceId = voiceId;
    await this.ensure(this.currentVoiceId, onProgress);
  }

  /** Switch voice (and download it if needed). */
  async switchModel(
    voiceId: string,
    onProgress?: (arg: ProgressInfo | number) => void
  ): Promise<void> {
    this.currentVoiceId = voiceId;
    await this.ensure(voiceId, onProgress);
    if (onProgress) onProgress(100);
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const voiceId = this.currentVoiceId;
    const engine = this.engineFor(voiceId);
    try {
      await this.ensure(voiceId);
      options.onStart?.();

      if (engine === 'kokoro') {
        // voiceId is a valid Kokoro voice id at runtime; the literal-union type can't prove it.
        const audio = await this.kokoro!.generate(
          cleanText(text),
          { voice: voiceId } as unknown as Parameters<KokoroTTS['generate']>[1]
        );
        await this.playBlob(audio.toBlob(), options.rate || 1.0);
      } else {
        // Piper: synthesize per sentence for more natural pacing.
        const sentences = splitSentences(cleanText(text));
        for (let i = 0; i < sentences.length; i++) {
          const blob = await this.piper!.predict(sentences[i]);
          await this.playBlob(blob, options.rate || 1.0);
          if (i < sentences.length - 1) await new Promise((r) => setTimeout(r, 300));
        }
      }
      options.onEnd?.();
    } catch (err) {
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Synthesize one chunk of text to a WAV Blob using the current voice. */
  async synthesize(text: string): Promise<Blob> {
    const voiceId = this.currentVoiceId;
    await this.ensure(voiceId);
    if (this.engineFor(voiceId) === 'kokoro') {
      const audio = await this.kokoro!.generate(
        cleanText(text),
        { voice: voiceId } as unknown as Parameters<KokoroTTS['generate']>[1]
      );
      return audio.toBlob();
    }
    return await this.piper!.predict(cleanText(text));
  }

  /**
   * Streaming speech pipeline. Push sentences as they arrive (e.g. from a
   * streaming LLM); the session synthesizes and plays them in order, overlapping
   * synthesis of the next chunk with playback of the current one.
   *
   *   const s = ttsService.createSpeakSession({ onFirstAudio, onDone, onError });
   *   s.push('First sentence.'); s.push('Second.'); s.end();
   *   await s.done;  // resolves when everything has been spoken
   */
  createSpeakSession(opts: SpeakSessionOptions = {}): SpeakSession {
    const service = this;
    const sentenceQueue: string[] = [];
    const audioQueue: Blob[] = [];
    let ended = false;
    let stopped = false;
    let synthDone = false;
    let firstFired = false;
    let synthWaiter: (() => void) | null = null;
    let playWaiter: (() => void) | null = null;

    const wakeSynth = () => { if (synthWaiter) { const w = synthWaiter; synthWaiter = null; w(); } };
    const wakePlay = () => { if (playWaiter) { const w = playWaiter; playWaiter = null; w(); } };

    async function synthLoop() {
      while (!stopped) {
        if (sentenceQueue.length === 0) {
          if (ended) break;
          await new Promise<void>((r) => (synthWaiter = r));
          continue;
        }
        const sentence = sentenceQueue.shift()!;
        try {
          const blob = await service.synthesize(sentence);
          if (stopped) break;
          audioQueue.push(blob);
          wakePlay();
        } catch (e) {
          opts.onError?.(e instanceof Error ? e : new Error(String(e)));
        }
        // Yield to the event loop between synthesis units so the browser can
        // process scroll/paint — keeps the whole panel scrollable while speaking.
        await new Promise((r) => setTimeout(r, 0));
      }
      synthDone = true;
      wakePlay();
    }

    async function playLoop() {
      while (!stopped) {
        if (audioQueue.length === 0) {
          if (synthDone) break;
          await new Promise<void>((r) => (playWaiter = r));
          continue;
        }
        const blob = audioQueue.shift()!;
        if (!firstFired) {
          firstFired = true;
          opts.onFirstAudio?.();
        }
        try {
          await service.playBlob(blob, opts.rate || 1.0);
        } catch (_) {
          /* skip a failed chunk */
        }
      }
      opts.onDone?.();
    }

    const done = Promise.all([synthLoop(), playLoop()]).then(() => {});

    return {
      push: (s: string) => { if (!stopped && s) { sentenceQueue.push(s); wakeSynth(); } },
      end: () => { ended = true; wakeSynth(); },
      stop: () => { stopped = true; service.stop(); wakeSynth(); wakePlay(); },
      done,
    };
  }

  playBlob(wavBlob: Blob, rate = 1.0): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const audio = new Audio();
      this.currentAudio = audio;
      const url = URL.createObjectURL(wavBlob);
      audio.src = url;
      audio.playbackRate = rate;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        reject(new Error('Audio playback failed'));
      };
      audio.play().catch((err) => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        reject(err);
      });
    });
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }
}

export const ttsService = new TtsService();
