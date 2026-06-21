/**
 * Vendors the ONNX Runtime + Piper WASM assets into ./assets/ so they load from
 * the extension's own origin instead of a CDN.
 *
 * Why: MV3's `script-src 'self'` forbids importing scripts from a remote origin,
 * so Piper/ONNX cannot dynamically import their .mjs runtime from jsDelivr inside
 * an extension. Serving them locally (via chrome.runtime.getURL) keeps everything
 * same-origin — and makes voice work fully offline.
 */
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = path.resolve('.');

const COPIES = [
  // ONNX Runtime for @huggingface/transformers (Kokoro TTS — natural English).
  ['node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs', 'assets/transformers-ort/ort-wasm-simd-threaded.jsep.mjs'],
  ['node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm', 'assets/transformers-ort/ort-wasm-simd-threaded.jsep.wasm'],
  // ONNX Runtime for piper-tts-web (Piper TTS — ~35 languages).
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs', 'assets/piper-ort/ort-wasm-simd-threaded.jsep.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm', 'assets/piper-ort/ort-wasm-simd-threaded.jsep.wasm'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'assets/piper-ort/ort-wasm-simd-threaded.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'assets/piper-ort/ort-wasm-simd-threaded.wasm'],
  // Piper phonemizer
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data', 'assets/piper/piper_phonemize.data'],
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.js', 'assets/piper/piper_phonemize.js'],
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm', 'assets/piper/piper_phonemize.wasm'],
];

async function main() {
  for (const [src, dest] of COPIES) {
    const from = path.join(ROOT, src);
    const to = path.join(ROOT, dest);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    console.log(`  ${dest}`);
  }
  console.log('✅ Vendored ONNX runtime (for Kokoro TTS) into assets/');
}

main().catch((err) => {
  console.error('✘ vendor failed:', err.message);
  process.exit(1);
});
