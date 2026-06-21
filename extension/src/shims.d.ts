/**
 * Ambient shims for browser globals not covered by lib.dom or @types/chrome.
 */
import type { SpeechRecognitionCtor } from './types';

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }

  // Firefox/Safari expose the same API under `browser`; treat it like `chrome`.
  // eslint-disable-next-line no-var
  var browser: typeof chrome | undefined;
}

export {};
