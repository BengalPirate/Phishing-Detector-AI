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

## Verifying it works (test matrix)

Target coverage: **4 browsers × 3 OSes = 12 environments**. Safari is macOS-only, so its Windows/Linux cells are **N/A** (10 real environments).

### How to load per browser
- **Chrome / Edge:** `chrome://extensions` (or `edge://extensions`) → Developer mode → **Load unpacked** → `extension/build/chrome`.
- **Firefox:** `about:debugging` → This Firefox → **Load Temporary Add-on** → `extension/build/firefox/manifest.json` (WebGPU needs **Firefox 141+**).
- **Safari (macOS):** open the generated Xcode project (`extension/build/safari-xcode/…`), set your signing Team, Run, then enable it in Safari ▸ Settings ▸ Extensions.

### Per-environment checklist (what a ✅ means)
Run each in the target environment:
1. **Loads** — extension installs with no manifest/CSP errors; side panel (or sidebar/popup) opens; Terms/Privacy gate appears and accepts.
2. **In-browser model** — load **Recommended (Qwen2.5-3B)**; it downloads/caches; **Analyze** a known phishing sample returns a sensible verdict; **Chat** replies.
3. **Voice** — enable **🔊 Speak replies**; voice downloads once and speaks; panel stays scrollable while speaking.
4. **Ollama** (if installed) — **Advanced → Refresh models → Connect** succeeds; analysis + chat work; assistant messages show the **⚠ External model** badge.
5. **Polish** — dark mode toggles; selected-text/right-click analysis works; provenance **Export** downloads a record.

### Status

Legend: ✅ pass · ⬜ not tested · ❌ fail · N/A not applicable

| Environment | Loads | In-browser | Voice | Ollama |
|---|---|---|---|---|
| **Chrome — macOS** | ✅ | ✅ | ✅ | ✅ |
| **Chrome — Windows** | ⬜ | ⬜ | ⬜ | ⬜ |
| **Chrome — Linux** | ⬜ | ⬜ | ⬜ | ⬜ |
| **Edge — macOS** | ⬜ | ⬜ | ⬜ | ⬜ |
| **Edge — Windows** | ⬜ | ⬜ | ⬜ | ⬜ |
| **Edge — Linux** | ⬜ | ⬜ | ⬜ | ⬜ |
| **Firefox — macOS** | ⬜ | ⬜ | ⬜ | ⬜ |
| **Firefox — Windows** | ⬜ | ⬜ | ⬜ | ⬜ |
| **Firefox — Linux** | ⬜ | ⬜ | ⬜ | ⬜ |
| **Safari — macOS** | ⬜ | ⬜ | ⬜ | ⬜ |
| **Safari — Windows** | N/A | N/A | N/A | N/A |
| **Safari — Linux** | N/A | N/A | N/A | N/A |

**Known per-environment caveats**
- **WebGPU** (needed only for the *in-browser* model, not Ollama): Chrome/Edge broad; **Firefox 141+**; **Safari 26+ / recent macOS**. Where WebGPU is unavailable, the **Ollama** path still works.
- **Firefox** uses a sidebar (`sidebar_action`) instead of the side panel; voice/ONNX under MV3 is the most likely failure point — note any console errors.
- **Safari** must be built via Xcode and uses a popup (no side-panel API); requires an Apple Developer signing identity.
- **Ollama** needs the one-time `OLLAMA_ORIGINS` setup (the in-app **Advanced** card shows OS-specific steps).

### Linux distros

The **extension itself is distro-agnostic** — it runs in the browser, so a single mainstream distro (e.g. Ubuntu) verifies the in-browser path. Whether the in-browser model works depends on the machine's **GPU driver / WebGPU support** (Mesa version), not the distro family; if WebGPU is unavailable, use Ollama.

The only Linux-variable part is the **Ollama `OLLAMA_ORIGINS` setup**, which depends on the **init system**, not the distro per se. Verify the setup once per init family:

| Linux family | Setup method | Verified |
|---|---|---|
| **systemd** — Debian/Ubuntu, Fedora/RHEL, Arch, openSUSE | systemd drop-in override (the in-app command) | ⬜ |
| **NixOS** | `services.ollama.environmentVariables.OLLAMA_ORIGINS = "chrome-extension://<your-id>";` in `configuration.nix` → `nixos-rebuild switch` | ⬜ |
| **Gentoo / non-systemd (OpenRC), or manual** | stop Ollama, then `OLLAMA_ORIGINS="chrome-extension://<your-id>" ollama serve` | ⬜ |

(The in-app **Advanced** card lists all three for Linux, since the extension can't detect the distro.)

## Project structure

```
Fraud_detection_Tool/
├── README.md
├── BROWSER_EXTENSION_GUIDE.md
└── extension/
    ├── manifest.json          # MV3 (side panel, activeTab+scripting, CSP, host perms)
    ├── package.json           # deps + build/vendor/package scripts
    ├── build.js               # esbuild bundler (+ node-builtin stubs)
    ├── vendor.js              # copies ONNX/Piper runtimes into assets/
    ├── package-targets.js     # emits build/chrome|firefox|safari
    ├── background.js          # side panel/sidebar, context menus
    ├── sidepanel.html / .css  # UI
    ├── src/
    │   ├── sidepanel.js       # model load (WebLLM/Ollama), analysis, library
    │   ├── prompts.js         # system prompt, few-shot, JSON schema
    │   ├── ollamaEngine.js    # Ollama adapter (OpenAI-shaped)
    │   ├── ragStore.js        # IndexedDB: example library + conversations + embeddings
    │   ├── chatPanel.js       # streaming chat + TTS pipeline + provenance
    │   ├── ttsService.js      # Kokoro + Piper voices
    │   ├── settings.js        # theme, voice/language, support link
    │   ├── provenance.js      # message sealing / integrity hashing
    │   └── legal.js           # Terms/Privacy + acceptance gate
    ├── assets/                # vendored ONNX/Piper runtimes (generated)
    ├── dist/                  # bundle (generated)
    └── build/                 # per-browser packages (generated)
```

---

## Privacy

Content you analyze or chat about is **not transmitted to any server we control**. The only outbound requests are **model/voice file downloads** from the HuggingFace / jsDelivr CDNs (first use, then cached), and — only if you choose Ollama — requests to your **own local** `localhost:11434`. No analytics, trackers, or ads. See the in-app Terms of Service and Privacy Policy.

---

## Notes & limitations

- This tool is **not a perfect solution and is subject to error** (false positives and negatives). Always verify suspicious messages through official channels.
- In-browser mode requires **WebGPU**; if unavailable, switch to Ollama.
- First model/voice download can take a few minutes; subsequent loads are cached.
- Small in-browser models are less capable than large models — for best quality, use the 7B tier or a strong model via Ollama.
