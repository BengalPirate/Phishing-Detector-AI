# Browser Extension Installation & Testing Guide

This guide walks you through building, installing, and testing the **Phishing Detector AI** extension. The AI runs **locally** — either **in your browser** (WebLLM / WebGPU) or via your **own local Ollama server** — with **no cloud and no API keys**.

---

## Pre-Installation Checklist

- [ ] **Chrome or Edge 114+** (or another Chromium browser with WebGPU + Side Panel support)
- [ ] A GPU that supports **WebGPU** (verify at <https://webgpureport.org> — you should see adapter info, not an error)
- [ ] **Node.js 18+** installed (only needed to build the extension)
- [ ] ~500 MB–1.7 GB free disk for the cached model

---

## Step 1: Build the extension

The extension bundles the WebLLM runtime, so build it once before loading.

```bash
cd extension
npm install      # WebLLM, Kokoro/transformers, Piper, esbuild
npm run package  # bundles, vendors runtimes, emits build/chrome|firefox|safari
```

You should see `✅ Built dist/sidepanel.bundle.js` followed by the `build/*` folders. If you plan to edit the code, `npm run build` rebuilds just the bundle (and you can load the `extension/` folder directly).

---

## Step 2: Load the extension in Chrome

1. Open `chrome://extensions` in your browser.
2. Toggle **Developer mode** on (top-right corner).
3. Click **Load unpacked**.
4. Select the `extension/build/chrome` folder (works for Chrome **and** Edge). For quick dev you can load the `extension/` folder directly after `npm run build`.
5. The **Phishing Detector AI** card appears. Pin it from the puzzle-piece menu for easy access.

---

## Step 3: Load the AI model (one time)

1. Click the extension's toolbar icon — the **side panel** opens on the right. Accept the Terms/Privacy on first launch.
2. Pick an **AI engine**:
   - **In-browser** — choose a model: **Fast** (Qwen2.5-0.5B, ~0.9 GB), **Recommended** (Qwen2.5-3B, ~2.0 GB), or **Maximum accuracy** (Qwen2.5-7B, ~4.7 GB).
   - **Ollama** — click **Refresh models**, pick one of your local models, then **Connect to Ollama** (no download). See *Using Ollama* below for the one-time CORS setup.
3. Click **Load AI Model** (or **Connect to Ollama**). For in-browser, a progress bar shows the model + voice downloading; keep the panel open until it finishes (it caches for next time).
4. When you see **"Model ready,"** you're set.

### Using Ollama (advanced)

The panel's **Advanced** section walks the user through this with OS-specific steps and a **Copy** button — and it fills in **this extension's exact origin** (e.g. `chrome-extension://<your-id>`) rather than a wildcard, so only this extension can reach Ollama. Set `OLLAMA_ORIGINS` to that value (shown in the card) and restart Ollama:

- **macOS:** `launchctl setenv OLLAMA_ORIGINS "chrome-extension://<your-id>"`, then quit and reopen the Ollama app.
- **Windows:** `setx OLLAMA_ORIGINS "chrome-extension://<your-id>"`, then quit Ollama from the system tray and reopen it (sign out/in if needed).
- **Linux (systemd):**
  ```bash
  sudo mkdir -p /etc/systemd/system/ollama.service.d && \
  printf '[Service]\nEnvironment="OLLAMA_ORIGINS=chrome-extension://<your-id>"\n' | sudo tee /etc/systemd/system/ollama.service.d/override.conf && \
  sudo systemctl daemon-reload && sudo systemctl restart ollama
  ```
  (Or, if you run Ollama manually: `OLLAMA_ORIGINS="chrome-extension://<your-id>" ollama serve`.)

> Just copy the exact value from the in-app card — it has the real ID. `chrome-extension://*` (any extension) or `*` (any origin) also work but are looser.

Then in the panel: **Advanced → Refresh models → Connect**. The connection is verified immediately; a **403** means the step above hasn't taken effect yet.

---

## Step 4: Test it

### Quick paste test

1. Paste a sample phishing message into the text box, e.g.:

   ```
   URGENT: Your account will be suspended! Click here now:
   http://paypa1.tk/verify and provide your password immediately.
   ```

2. Leave the type as **Email** and click **Analyze Message**.
3. You should get a verdict of **HIGHLY LIKELY PHISHING** with a high risk score, red flags, and advice.

### Legitimate message test

Paste a normal message (e.g. an Amazon shipping note with a real `amazon.com` link). It should return **SAFE** with a low risk score.

### Selected-text test

1. On any web page, select some text.
2. Open the side panel and click **Analyze Selected Text** (or right-click → **Analyze for Phishing**).
3. The text is pulled in and analyzed.

### Link test

Right-click any link on a page → **Check Link for Phishing**. The side panel opens with the URL pre-filled and analyzes it.

---

## What each analysis shows

- **Verdict** — `SAFE`, `SUSPICIOUS`, or `HIGHLY LIKELY PHISHING`
- **Risk Score** — 0–100
- **Red Flags** — specific issues found
- **Analysis Summary** — plain-language reasoning
- **Detailed Indicators** — sender, urgency, links, grammar/tone, requested action
- **Recommended Action** — what to do next

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "WebGPU is not available" error | Update to Chrome/Edge 114+ and confirm WebGPU works at <https://webgpureport.org>. Some older GPUs or Linux setups need WebGPU enabled via flags. |
| Model download stalls or fails | Check your connection; reload the side panel and try again. The CDN hosts (huggingface.co, jsDelivr) must be reachable. |
| "Load unpacked" shows a manifest error | Make sure you ran `npm run build` so `dist/sidepanel.bundle.js` exists, and that you selected the `extension/` folder. |
| Changes to code don't show up | Rebuild (`npm run build`) and click the reload icon on the extension card in `chrome://extensions`. |
| Analysis returns odd/empty JSON | Small models occasionally misformat output; the extension falls back to a safe "review manually" result. Try the **High Quality** model for more reliable results. |

---

## How it works (under the hood)

1. You paste or select a message in the side panel.
2. `src/sidepanel.js` sends it to the locally-loaded WebLLM engine with the phishing-analysis prompt from `src/prompts.js`.
3. The model generates a **JSON-schema-constrained** verdict on your GPU via WebGPU.
4. The result is rendered in the panel.

Nothing is sent to any server. The only network activity is the **one-time model download**; after that, analysis is fully on-device.
