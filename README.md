# Phishing Detector AI

A privacy-first browser extension that uses AI to flag phishing in emails, SMS, URLs, and chat messages — and a built-in assistant you can chat with (with optional neural voice). All inference runs **locally**: either **in your browser** (WebLLM/WebGPU) or via your **own local [Ollama](https://ollama.com) server**. **No cloud, no API keys.**

**Course Assignment**: AI Detection | **Developer**: Brandon Newton

---

## What it does

- **Phishing analysis** — paste (or right-click) an email/SMS/URL/chat message and get a structured verdict: `SAFE` / `SUSPICIOUS` / `HIGHLY LIKELY PHISHING`, a 0–100 risk score, red flags, an explanation, recommended action, and per-dimension indicators.
- **PhishGuard chat** — a conversational assistant for understanding scams, with persistent local history and optional **neural voice** (Kokoro for English, Piper for ~35 other languages) plus speech-to-text input.
- **Learns over time (RAG)** — save/correct analyses into a local example library; similar past examples are retrieved and shown to the model on future analyses. Import/export the library as JSON.
- **Theme + settings** — light/dark/system theme, voice/language picker, and a support link.

---

## Two ways to run the model

| Engine | Where it runs | Needs |
|--------|---------------|-------|
| **In-browser** (default) | WebLLM on **WebGPU**, in the side panel | A WebGPU-capable GPU; downloads a model once (cached) |
| **Ollama** (optional) | Your local **Ollama** server (`localhost:11434`) | Ollama installed with a model pulled; great for large/high-end local models |

Either way, **content you analyze never leaves your machine**. With Ollama, the LLM runs in your own local server; embeddings (RAG) and voice still run in-browser.

### In-browser models

| Tier | Model | Download |
|------|-------|----------|
| **Fast** | Qwen2.5-0.5B-Instruct (q4f16_1) | ~0.9 GB |
| **Recommended** (default) | Qwen2.5-3B-Instruct (q4f16_1) | ~2.0 GB |
| **Maximum accuracy** | Qwen2.5-7B-Instruct (q4f16_1) | ~4.7 GB |

### Using Ollama instead

1. Install Ollama and pull a model, e.g. `ollama pull qwen2.5:7b`.
2. Allow **this extension's exact origin** (CORS) — the in-app **Advanced** card shows the precise value and a Copy button, e.g. `OLLAMA_ORIGINS="chrome-extension://<your-id>"` (narrower than `*`, so only this extension can reach Ollama).
3. In the panel: **AI engine → Ollama** → **Refresh models** → pick one → **Connect to Ollama**.

> Chat messages are tagged with which engine + exact model produced them (see *Forensic provenance* below), and external (Ollama) responses are clearly badged.

---

## Build & install

Requires [Node.js](https://nodejs.org/) 18+ to build (not to run).

```bash
cd extension
npm install      # WebLLM, Kokoro/transformers, Piper, esbuild
npm run package  # bundles + vendors runtimes + emits build/chrome, build/firefox, build/safari
```

Then load it:

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select `extension/build/chrome` (works for Chrome **and** Edge).
4. Click the toolbar icon → the **side panel** opens.
5. Accept the Terms/Privacy, choose an engine + model, and **Load AI Model** (or **Connect to Ollama**).

For quick iteration you can `npm run build` and load the `extension/` folder directly. Firefox and Safari builds are generated too — see `BROWSER_EXTENSION_GUIDE.md` (Safari needs Xcode conversion).

---

## How it works

```
┌──────────────────────────────────────────────────────────────┐
│  Side panel (sidepanel.html)                                  │
│                                                               │
│  Analyze / chat ─► engine.chat.completions.create({messages}) │
│        │                 │                                    │
│        │                 ├─ In-browser: WebLLM (WebGPU)        │
│        │                 └─ Ollama: local server (adapter)     │
│        ▼                                                       │
│   Structured JSON verdict (schema-constrained)                │
│   Streaming chat ─► sentence pipeline ─► Kokoro/Piper voice    │
└──────────────────────────────────────────────────────────────┘
```

- Both engines expose the **same OpenAI-shaped interface**, so analysis, JSON-schema output, and streaming chat work identically.
- Selected-text capture uses **`activeTab` + `scripting`** (on-demand injection only when you click "Analyze Selected Text") — there is **no always-on content script**.
- The prompt reasons before concluding (verdict emitted last) for better small-model accuracy.

---

## Forensic provenance

Every chat message is tagged with the **engine + exact model**, app version, and timestamp, and sealed with a **chained SHA-256 hash** (`integrity = SHA256(prevIntegrity | role | content | provenance)`), making the conversation tamper-evident. External (Ollama) responses are badged and recorded as user-supplied. Use the chat **Export** button for a portable JSON record. (This is tamper-*evident*, not an unforgeable signature — the data lives in the user's browser.)

---

## Testing

Run the automated baseline from `extension/`:

```bash
npm run typecheck     # strict TypeScript check (tsc --noEmit)
npm run test:all      # typecheck + build + automated tests
npm run test:coverage # Node test runner coverage report
npm run audit:deps    # dependency vulnerability audit
```

See `docs/testing.md` for automated coverage areas, current coverage snapshot, release gates, and the full manual browser/OS matrix.

---

## Project structure

```
Fraud_detection_Tool/
├── README.md
├── BROWSER_EXTENSION_GUIDE.md
├── docs/
│   └── testing.md            # automated coverage, release gates, browser matrix
└── extension/
    ├── manifest.json          # MV3 (side panel, activeTab+scripting, CSP, host perms)
    ├── package.json           # deps + build/vendor/package/typecheck scripts
    ├── tsconfig.json          # strict TypeScript config (tsc --noEmit gate)
    ├── build.js               # esbuild bundler — sidepanel + background (+ node stubs)
    ├── vendor.js              # copies ONNX/Piper runtimes into assets/
    ├── package-targets.js     # emits build/chrome|firefox|safari
    ├── sidepanel.html / .css  # UI
    ├── src/                   # TypeScript sources (strict)
    │   ├── sidepanel.ts       # model load (WebLLM/Ollama), analysis, library
    │   ├── background.ts      # MV3 worker: side panel/sidebar, context menus
    │   ├── types.ts           # shared types incl. the ChatEngine contract
    │   ├── shims.d.ts         # ambient browser globals (SpeechRecognition, browser)
    │   ├── prompts.ts         # system prompt, few-shot, JSON schema
    │   ├── ollamaEngine.ts    # Ollama adapter (conforms to ChatEngine)
    │   ├── ragStore.ts        # IndexedDB: example library + conversations + embeddings
    │   ├── chatPanel.ts       # streaming chat + TTS pipeline + provenance
    │   ├── ttsService.ts      # Kokoro + Piper voices
    │   ├── settings.ts        # theme, voice/language, support link
    │   ├── provenance.ts      # message sealing / integrity hashing
    │   └── legal.ts           # Terms/Privacy + acceptance gate
    ├── assets/                # vendored ONNX/Piper runtimes (generated)
    ├── dist/                  # bundles: sidepanel + background (generated)
    └── build/                 # per-browser packages (generated)
```

The app is written in **strict TypeScript**; `npm run typecheck` (`tsc --noEmit`) is part of `npm run test:all`. esbuild bundles `src/sidepanel.ts` → `dist/sidepanel.bundle.js` and `src/background.ts` → `dist/background.js`.

---

## Privacy

Content you analyze or chat about is **not transmitted to any server we control**. The only outbound requests are **model/voice file downloads** from the HuggingFace / jsDelivr CDNs (first use, then cached), and — only if you choose Ollama — requests to your **own local** `localhost:11434`. No analytics, trackers, or ads. See the in-app Terms of Service and Privacy Policy.

---

## Notes & limitations

- This tool is **not a perfect solution and is subject to error** (false positives and negatives). Always verify suspicious messages through official channels.
- In-browser mode requires **WebGPU**; if unavailable, switch to Ollama.
- First model/voice download can take a few minutes; subsequent loads are cached.
- Small in-browser models are less capable than large models — for best quality, use the 7B tier or a strong model via Ollama.
