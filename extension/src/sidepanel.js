/**
 * Side panel script for Phishing Detector AI.
 *
 * Runs a local LLM entirely in the browser via WebLLM (WebGPU). The model is
 * downloaded once, cached in the browser, and used for all subsequent analyses —
 * no backend server, no API keys, no rate limits.
 *
 * The side panel (rather than a popup) is used because it stays open while the
 * user browses, so a multi-hundred-MB model download is never interrupted.
 */

import { CreateMLCEngine } from '@mlc-ai/web-llm';
import {
  SYSTEM_PROMPT,
  RESPONSE_SCHEMA,
  buildUserPrompt,
  extractJson,
} from './prompts.js';
import { ragStore } from './ragStore.js';
import { setupChatPanel, onChatModelReady } from './chatPanel.js';
import { setupSettings } from './settings.js';
import { ttsService } from './ttsService.js';
import { setupLegalGate } from './legal.js';
import { createOllamaEngine, listOllamaModels } from './ollamaEngine.js';

// Silence one benign transformers.js warning: HuggingFace omits Content-Length
// on some model files, so it can't show a download %. The download works fine.
const _origWarn = console.warn.bind(console);
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Unable to determine content-length')) return;
  _origWarn(...args);
};

// How many similar library examples to inject into each analysis prompt.
const RAG_TOP_K = 3;

// The most recent analysis, so the feedback controls can save/correct it.
let lastAnalysis = null;

// Models offered to the user, ordered weakest -> strongest. Phishing analysis
// is a reasoning task, so accuracy scales noticeably with model size.
const MODEL_OPTIONS = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Fast',
    size: '~0.9 GB',
    description: 'Quickest download, lowest VRAM. Misses subtle scams — best for a quick gut check.',
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    name: 'Recommended',
    size: '~2.0 GB',
    description: 'Much stronger reasoning and JSON reliability. The best accuracy/size balance.',
  },
  {
    id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
    name: 'Maximum accuracy',
    size: '~4.7 GB',
    description: 'Most accurate. Needs a capable GPU (~6 GB VRAM) and a longer download.',
  },
];

// Engine state
let engine = null;
let isLoading = false;
// Default to the "Recommended" 3B tier — the 0.5B/1.7B models were unreliable.
let selectedModelId = 'Qwen2.5-3B-Instruct-q4f16_1-MLC';
let selectedEngine = 'webllm'; // 'webllm' (in-browser) or 'ollama' (local server)
let selectedOllamaModel = '';

// DOM elements (assigned on DOMContentLoaded)
let els = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  populateModelSelectors();
  setupEventListeners();
  prefillFromStorage();
  refreshLibraryCount();
  // The chat shares the loaded analysis engine + current model provenance.
  setupChatPanel(() => engine, getModelInfo);
  setupSettings();
  // Show the Terms/Privacy acceptance gate on first launch (overlays everything
  // until accepted). Non-blocking for the rest of init.
  setupLegalGate();
  updateStatus(false, 'Model not loaded — click “Load AI Model”.');
});

function cacheElements() {
  els = {
    // status
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    // model loading
    modelLoadingSection: document.getElementById('modelLoadingSection'),
    webllmGroup: document.getElementById('webllmGroup'),
    advancedEngine: document.getElementById('advancedEngine'),
    ollamaModelSelect: document.getElementById('ollamaModelSelect'),
    ollamaRefreshBtn: document.getElementById('ollamaRefreshBtn'),
    ollamaConnectBtn: document.getElementById('ollamaConnectBtn'),
    ollamaCopyBtn: document.getElementById('ollamaCopyBtn'),
    ollamaCmd: document.getElementById('ollamaCmd'),
    ollamaStepTerminal: document.getElementById('ollamaStepTerminal'),
    ollamaStepRestart: document.getElementById('ollamaStepRestart'),
    ollamaStatus: document.getElementById('ollamaStatus'),
    modelSelectLoad: document.getElementById('modelSelectLoad'),
    modelDescription: document.getElementById('modelDescription'),
    loadModelBtn: document.getElementById('loadModelBtn'),
    loadingProgress: document.getElementById('loadingProgress'),
    progressBarFill: document.getElementById('progressBarFill'),
    progressText: document.getElementById('progressText'),
    progressPercent: document.getElementById('progressPercent'),
    embedStatus: document.getElementById('embedStatus'),
    voiceLoadStatus: document.getElementById('voiceLoadStatus'),
    // analysis
    analysisSection: document.getElementById('analysisSection'),
    activeModelLabel: document.getElementById('activeModelLabel'),
    switchModelBtn: document.getElementById('switchModelBtn'),
    messageInput: document.getElementById('messageInput'),
    messageType: document.getElementById('messageType'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    analyzeText: document.getElementById('analyzeText'),
    analyzeLoader: document.getElementById('analyzeLoader'),
    analyzeSelectedBtn: document.getElementById('analyzeSelectedBtn'),
    clearBtn: document.getElementById('clearBtn'),
    // results / errors
    resultsSection: document.getElementById('resultsSection'),
    retrievalInfo: document.getElementById('retrievalInfo'),
    errorSection: document.getElementById('errorSection'),
    errorMessage: document.getElementById('errorMessage'),
    // feedback / learning
    feedbackBar: document.getElementById('feedbackBar'),
    confirmCorrectBtn: document.getElementById('confirmCorrectBtn'),
    openCorrectBtn: document.getElementById('openCorrectBtn'),
    correctionEditor: document.getElementById('correctionEditor'),
    correctionJson: document.getElementById('correctionJson'),
    correctionError: document.getElementById('correctionError'),
    saveCorrectionBtn: document.getElementById('saveCorrectionBtn'),
    cancelCorrectionBtn: document.getElementById('cancelCorrectionBtn'),
    feedbackSaved: document.getElementById('feedbackSaved'),
    // library
    libraryToggle: document.getElementById('libraryToggle'),
    libraryCaret: document.getElementById('libraryCaret'),
    libraryCount: document.getElementById('libraryCount'),
    libraryBody: document.getElementById('libraryBody'),
    addText: document.getElementById('addText'),
    addType: document.getElementById('addType'),
    addJson: document.getElementById('addJson'),
    addError: document.getElementById('addError'),
    addExampleBtn: document.getElementById('addExampleBtn'),
    importFile: document.getElementById('importFile'),
    importStatus: document.getElementById('importStatus'),
    clearLibraryBtn: document.getElementById('clearLibraryBtn'),
  };
}

function populateModelSelectors() {
  els.modelSelectLoad.innerHTML = '';
  for (const model of MODEL_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = model.id;
    opt.textContent = `${model.name} (${model.size})`;
    els.modelSelectLoad.appendChild(opt);
  }
  els.modelSelectLoad.value = selectedModelId;
  updateModelDescription();
}

function updateModelDescription() {
  const model = MODEL_OPTIONS.find((m) => m.id === selectedModelId);
  els.modelDescription.textContent = model ? model.description : '';
}

/** Current engine + model, attached to chat messages for forensic provenance. */
function getModelInfo() {
  const appVersion = chrome.runtime.getManifest().version;
  if (selectedEngine === 'ollama') {
    return { engine: 'ollama', model: selectedOllamaModel || 'unknown', external: true, appVersion };
  }
  return { engine: 'webllm', model: selectedModelId, external: false, appVersion };
}

/** Tailor the Ollama setup steps to the user's operating system. */
function setupOllamaInstructions() {
  const ua = navigator.userAgent;
  const isMac = /Macintosh|Mac OS X/i.test(ua);
  const isWin = /Windows/i.test(ua);

  // Allowlist ONLY this extension's exact origin (e.g. chrome-extension://<id>),
  // not "*", so no website or other extension can reach the user's Ollama.
  const origin = chrome.runtime.getURL('').replace(/\/+$/, '');

  if (isWin) {
    els.ollamaCmd.textContent = `setx OLLAMA_ORIGINS "${origin}"`;
    els.ollamaStepTerminal.innerHTML =
      'Open the <strong>Command Prompt</strong> ' +
      '<span class="muted">(press the Windows key, type “cmd”, then press Enter).</span>';
    els.ollamaStepRestart.innerHTML =
      'Quit Ollama from the system tray (click the ▲ arrow near the clock, right-click the Ollama ' +
      'icon → <strong>Quit</strong>), then open Ollama again. ' +
      '<span class="muted">If it still won’t connect, sign out of Windows and back in.</span>';
  } else if (!isMac) {
    // Linux — Ollama is usually installed as a systemd service. This one-liner
    // adds the setting as a drop-in override and restarts the service.
    els.ollamaCmd.textContent =
      'sudo mkdir -p /etc/systemd/system/ollama.service.d && ' +
      `printf '[Service]\\nEnvironment="OLLAMA_ORIGINS=${origin}"\\n' | ` +
      'sudo tee /etc/systemd/system/ollama.service.d/override.conf && ' +
      'sudo systemctl daemon-reload && sudo systemctl restart ollama';
    els.ollamaStepTerminal.innerHTML = 'Open a <strong>Terminal</strong>.';
    els.ollamaStepRestart.innerHTML =
      'That command restarts Ollama for you ' +
      '<span class="muted">(type your password if asked — it stays hidden as you type). It works on ' +
      'systemd distros (Debian/Ubuntu, Fedora/RHEL, Arch, openSUSE).</span>' +
      '<br><span class="muted"><strong>NixOS:</strong> instead add ' +
      `<code>services.ollama.environmentVariables.OLLAMA_ORIGINS = "${origin}";</code> to ` +
      '<code>configuration.nix</code> and run <code>nixos-rebuild switch</code>. ' +
      `<strong>No systemd (e.g. OpenRC):</strong> stop Ollama, then run <code>OLLAMA_ORIGINS="${origin}" ollama serve</code>.</span>`;
  } else {
    // macOS (set here so we can inject the exact extension origin).
    els.ollamaCmd.textContent = `launchctl setenv OLLAMA_ORIGINS "${origin}"`;
  }
}

async function copyOllamaCommand() {
  try {
    await navigator.clipboard.writeText(els.ollamaCmd.textContent);
    const orig = els.ollamaCopyBtn.textContent;
    els.ollamaCopyBtn.textContent = 'Copied!';
    setTimeout(() => (els.ollamaCopyBtn.textContent = orig), 1500);
  } catch (_) {
    els.ollamaStatus.textContent = 'Could not copy — select the text and copy it manually.';
  }
}

async function refreshOllamaModels() {
  els.ollamaStatus.style.color = '';
  els.ollamaStatus.textContent = 'Connecting to Ollama…';
  try {
    const models = await listOllamaModels();
    els.ollamaModelSelect.innerHTML = '';
    if (models.length === 0) {
      els.ollamaModelSelect.innerHTML = '<option value="">No models — run `ollama pull <model>`</option>';
      els.ollamaStatus.textContent = 'Connected, but no models are installed.';
      return;
    }
    for (const name of models) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      els.ollamaModelSelect.appendChild(opt);
    }
    selectedOllamaModel = models[0];
    els.ollamaModelSelect.value = selectedOllamaModel;
    els.ollamaStatus.textContent = `Found ${models.length} model${models.length > 1 ? 's' : ''}.`;
  } catch (err) {
    els.ollamaModelSelect.innerHTML = '<option value="">Not connected</option>';
    els.ollamaStatus.style.color = '#c0392b';
    els.ollamaStatus.innerHTML =
      'Could not reach Ollama at localhost:11434. Make sure it is running, and if needed start it with ' +
      '<code>OLLAMA_ORIGINS=chrome-extension://* ollama serve</code> to allow this extension.';
  }
}

function setupEventListeners() {
  els.modelSelectLoad.addEventListener('change', (e) => {
    selectedModelId = e.target.value;
    updateModelDescription();
  });
  els.ollamaModelSelect.addEventListener('change', (e) => {
    selectedOllamaModel = e.target.value;
  });
  els.ollamaRefreshBtn.addEventListener('click', refreshOllamaModels);
  els.ollamaCopyBtn.addEventListener('click', copyOllamaCommand);
  // In-browser path (the simple default).
  els.loadModelBtn.addEventListener('click', () => {
    selectedEngine = 'webllm';
    initializeModel();
  });
  // Ollama path (advanced).
  els.ollamaConnectBtn.addEventListener('click', () => {
    selectedEngine = 'ollama';
    initializeModel();
  });
  // Auto-list models the first time the Advanced section is opened.
  els.advancedEngine.addEventListener('toggle', () => {
    if (els.advancedEngine.open && els.ollamaModelSelect.options.length <= 1) {
      refreshOllamaModels();
    }
  });
  setupOllamaInstructions();
  els.switchModelBtn.addEventListener('click', showModelLoader);
  els.analyzeBtn.addEventListener('click', handleAnalyze);
  els.analyzeSelectedBtn.addEventListener('click', handleAnalyzeSelected);
  els.clearBtn.addEventListener('click', handleClear);
  els.messageInput.addEventListener('input', handleInputChange);

  // Feedback / learning
  els.confirmCorrectBtn.addEventListener('click', handleConfirmCorrect);
  els.openCorrectBtn.addEventListener('click', openCorrectionEditor);
  els.saveCorrectionBtn.addEventListener('click', handleSaveCorrection);
  els.cancelCorrectionBtn.addEventListener('click', closeCorrectionEditor);

  // Library
  els.libraryToggle.addEventListener('click', toggleLibrary);
  els.addExampleBtn.addEventListener('click', handleAddExample);
  els.importFile.addEventListener('change', handleImportFile);
  els.clearLibraryBtn.addEventListener('click', handleClearLibrary);
}

/** Prefill the textarea from context-menu / content-script captured text. */
async function prefillFromStorage() {
  try {
    const data = await chrome.storage.local.get(['selectedText', 'messageType']);
    if (data.selectedText) {
      els.messageInput.value = data.selectedText;
      if (data.messageType) els.messageType.value = data.messageType;
      handleInputChange();
      // Clear so it doesn't reappear on the next open.
      await chrome.storage.local.remove(['selectedText', 'messageType']);
    }
  } catch (err) {
    console.warn('Could not read stored selection:', err);
  }
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

async function initializeModel() {
  if (isLoading) return;

  // WebGPU is required for the in-browser LLM. With Ollama the LLM runs locally
  // outside the browser, so WebGPU is not required (the embedding model would
  // just be unavailable, which is non-fatal).
  if (selectedEngine === 'webllm' && !('gpu' in navigator)) {
    showError(
      'WebGPU is not available in this browser. The in-browser AI model needs WebGPU ' +
        '(Chrome/Edge 113+ on a supported GPU), or switch the AI engine to Ollama.'
    );
    return;
  }
  if (selectedEngine === 'ollama' && !selectedOllamaModel) {
    showError('Pick an Ollama model first (click "Refresh models").');
    return;
  }

  isLoading = true;
  hideError();
  els.loadModelBtn.disabled = true;
  els.loadModelBtn.textContent = 'Loading…';
  els.modelSelectLoad.disabled = true;
  els.ollamaConnectBtn.disabled = true;
  els.loadingProgress.style.display = 'block';
  updateStatus(false, selectedEngine === 'ollama' ? 'Connecting…' : 'Downloading model…');
  setProgress(0, 'Initializing…');

  try {
    // Dispose any previous engine (model switch).
    if (engine) {
      try {
        await engine.unload();
      } catch (_) {
        /* ignore */
      }
      engine = null;
    }

    // Preload the voice (TTS) model in parallel with the main model, so there's
    // no separate download later when the user enables "Speak replies".
    // Non-fatal: if it fails, voice just loads on first use instead.
    const voicePromise = ttsService
      .initialize(undefined, (info) => {
        els.voiceLoadStatus.textContent =
          info.pct != null ? `Voice model: ${info.pct}%` : `Voice model: ${info.loadedMB} MB…`;
      })
      .then(() => {
        els.voiceLoadStatus.textContent = 'Voice model ready.';
      })
      .catch((e) => {
        console.warn('Voice preload failed (will load on first use):', e);
        els.voiceLoadStatus.textContent = 'Voice will load on first use.';
      });

    if (selectedEngine === 'ollama') {
      // Bind to the local Ollama model, then verify with a tiny real request so
      // a CORS/403 problem surfaces NOW (with setup help) instead of mid-chat.
      engine = createOllamaEngine(selectedOllamaModel);
      setProgress(50, 'Connecting to Ollama…');
      try {
        await engine.chat.completions.create({
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        });
      } catch (verifyErr) {
        engine = null;
        throw verifyErr; // handled below with friendly Ollama guidance
      }
      setProgress(100, `Connected to Ollama: ${selectedOllamaModel}`);
    } else {
      // Download/init with retries. HuggingFace's Xet CDN occasionally drops an
      // HTTP/2 stream mid-download (ERR_HTTP2_PROTOCOL_ERROR); WebLLM caches every
      // shard it has already fetched, so re-calling resumes and gets past it.
      const MAX_ATTEMPTS = 4;
      for (let attempt = 1; ; attempt++) {
        try {
          engine = await CreateMLCEngine(selectedModelId, {
            initProgressCallback: (report) => {
              let pct = 0;
              if (typeof report.progress === 'number') {
                pct = Math.round(report.progress * 100);
              } else {
                const m = report.text.match(/(\d+)%/);
                if (m) pct = parseInt(m[1], 10);
              }
              setProgress(pct, report.text);
            },
          });
          break; // success
        } catch (e) {
          const msg = e?.message || String(e);
          const isNetwork = /network|http2|fetch|cache|stream|load failed|err_/i.test(msg);
          if (attempt >= MAX_ATTEMPTS || !isNetwork) throw e;
          console.warn(`Model load attempt ${attempt} failed (${msg}); retrying…`);
          setProgress(0, `Download hiccup — retrying (${attempt}/${MAX_ATTEMPTS - 1})…`);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      setProgress(100, 'Analysis model loaded!');
    }

    // Load the small embedding model used for RAG retrieval. Non-fatal if it
    // fails — analysis still works, just without the learning/library feature.
    try {
      els.embedStatus.textContent = 'Loading retrieval model (for the example library)…';
      await ragStore.initDB();
      await ragStore.initEmbeddings((report) => {
        els.embedStatus.textContent = `Retrieval model: ${report.text}`;
      });
      els.embedStatus.textContent = 'Retrieval model ready.';
    } catch (embedErr) {
      console.warn('Embedding model failed to load; RAG disabled:', embedErr);
      els.embedStatus.textContent =
        'Retrieval model unavailable — the example library is disabled this session.';
    }

    // Make sure the parallel voice download has settled before we finish.
    await voicePromise;

    if (selectedEngine === 'ollama') {
      els.activeModelLabel.textContent = `Ollama · ${selectedOllamaModel}`;
    } else {
      const model = MODEL_OPTIONS.find((m) => m.id === selectedModelId);
      els.activeModelLabel.textContent = `${model.name} · ${model.size}`;
    }
    updateStatus(true, 'Model ready');
    showAnalysisUI();
    refreshLibraryCount();
    onChatModelReady();
  } catch (err) {
    console.error('Failed to load model:', err);
    const msg = err?.message || String(err);

    if (selectedEngine === 'ollama') {
      // Keep the Advanced section + setup steps open so the user can follow them.
      els.advancedEngine.open = true;
      const corsLike = /CORS|403|forbidden/i.test(msg);
      const offline = /failed to fetch|networkerror|load failed|connection|refused/i.test(msg);
      if (corsLike) {
        showError(
          'Ollama blocked this app for safety. Follow the one-time setup steps under “Advanced” ' +
            'above: copy the command into Terminal, restart Ollama, then click “Refresh models” and ' +
            '“Connect” again. If this is too technical, just use the simple model option at the top.'
        );
      } else if (offline) {
        showError(
          'Could not reach Ollama. Make sure the Ollama app is installed and running, then click ' +
            '“Refresh models” and “Connect” again — or use the simple model option at the top.'
        );
      } else {
        showError('Could not use Ollama: ' + msg);
      }
    } else {
      const isNetwork = /network|http2|fetch|cache|stream|load failed|err_/i.test(msg);
      showError(
        isNetwork
          ? 'The model download hit a network error (HuggingFace CDN). Click "Load AI Model" again — it resumes from what already downloaded. If it keeps failing on the same point, try another network or disable VPN/ad-blockers.'
          : 'Failed to load model: ' + msg
      );
    }
    updateStatus(false, 'Model failed to load.');
  } finally {
    isLoading = false;
    els.loadModelBtn.disabled = false;
    els.loadModelBtn.textContent = 'Load AI Model';
    els.modelSelectLoad.disabled = false;
    els.ollamaConnectBtn.disabled = false;
  }
}

function setProgress(pct, text) {
  els.progressBarFill.style.width = `${pct}%`;
  els.progressPercent.textContent = `${pct}%`;
  els.progressText.textContent = text;
}

function showAnalysisUI() {
  els.modelLoadingSection.style.display = 'none';
  els.analysisSection.style.display = 'block';
  handleInputChange();
}

function showModelLoader() {
  els.analysisSection.style.display = 'none';
  els.resultsSection.style.display = 'none';
  els.modelLoadingSection.style.display = 'block';
  els.loadingProgress.style.display = 'none';
  updateStatus(false, 'Choose a model and load it.');
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function handleInputChange() {
  const hasContent = els.messageInput.value.trim().length > 0;
  els.analyzeBtn.disabled = !hasContent || !engine || isLoading;
}

async function handleAnalyze() {
  const message = els.messageInput.value.trim();
  if (!message) {
    showError('Please enter a message to analyze.');
    return;
  }
  if (!engine) {
    showError('The AI model is not loaded yet.');
    return;
  }
  await analyzeMessage(message, els.messageType.value);
}

async function handleAnalyzeSelected() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) {
      showError('No active tab to read a selection from.');
      return;
    }

    // Inject on demand (activeTab + scripting) instead of running a content
    // script on every page — only reads the selection when you click this.
    let text = '';
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => (window.getSelection() ? window.getSelection().toString() : ''),
      });
      text = (results && results[0] && results[0].result ? results[0].result : '').trim();
    } catch (injectErr) {
      showError(
        'Could not read the page selection (the browser may not allow it on this page). ' +
          'Please copy and paste the text instead.'
      );
      return;
    }

    if (text) {
      els.messageInput.value = text;
      els.messageType.value = 'email';
      handleInputChange();
      handleAnalyze();
    } else {
      showError('No text selected. Please select text on the page first.');
    }
  } catch (err) {
    showError('Error getting selected text: ' + err.message);
  }
}

function handleClear() {
  els.messageInput.value = '';
  hideResults();
  hideError();
  els.analyzeBtn.disabled = true;
}

async function analyzeMessage(message, type) {
  setAnalyzing(true);
  hideResults();
  hideError();

  try {
    // RAG: pull the most similar labeled examples from the user's library.
    let retrieved = [];
    try {
      retrieved = await ragStore.retrieve(message, RAG_TOP_K);
    } catch (ragErr) {
      console.warn('Retrieval failed; proceeding without examples:', ragErr);
    }

    const completion = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(message, type, retrieved) },
      ],
      temperature: 0.1,
      max_tokens: 1400,
      response_format: {
        type: 'json_object',
        schema: JSON.stringify(RESPONSE_SCHEMA),
      },
    });

    const raw = completion.choices[0]?.message?.content || '';
    const result = extractJson(raw);
    const info = getModelInfo();
    result.message_type = type;
    result.engine = info.engine;
    result.model_used = info.model; // actual engine model (Ollama or in-browser)
    result.external = info.external;
    result.analyzed_at = new Date().toISOString();

    // Remember it so the feedback controls can save or correct it.
    lastAnalysis = { text: message, type, result };

    displayResults(result);
    showRetrievalInfo(retrieved);
    resetFeedbackUI();
  } catch (err) {
    console.error('Analysis error:', err);
    showError('Analysis failed: ' + (err?.message || String(err)));
  } finally {
    setAnalyzing(false);
  }
}

function showRetrievalInfo(retrieved) {
  if (retrieved && retrieved.length > 0) {
    els.retrievalInfo.textContent = `🧠 Used ${retrieved.length} similar example${
      retrieved.length > 1 ? 's' : ''
    } from your library.`;
    els.retrievalInfo.style.display = 'block';
  } else {
    els.retrievalInfo.style.display = 'none';
  }
}

// ---------------------------------------------------------------------------
// Feedback loop + example library (RAG learning)
// ---------------------------------------------------------------------------

/** Reduce a full result to the core labeled-analysis fields we store. */
function toStoredAnalysis(result) {
  return {
    verdict: result.verdict,
    risk_score: result.risk_score,
    red_flags: result.red_flags || [],
    explanation: result.explanation || '',
    user_advice: result.user_advice || '',
    indicators: result.indicators || {},
  };
}

function resetFeedbackUI() {
  closeCorrectionEditor();
  els.feedbackSaved.style.display = 'none';
  // Only offer the feedback loop when retrieval/embeddings are available.
  els.feedbackBar.style.display = ragStore.embeddingsReady ? 'block' : 'none';
  els.confirmCorrectBtn.disabled = false;
  els.openCorrectBtn.disabled = false;
}

async function handleConfirmCorrect() {
  if (!lastAnalysis) return;
  els.confirmCorrectBtn.disabled = true;
  try {
    await ragStore.addExample({
      text: lastAnalysis.text,
      type: lastAnalysis.type,
      analysis: toStoredAnalysis(lastAnalysis.result),
      source: 'confirmed',
    });
    afterExampleSaved();
  } catch (err) {
    console.error('Failed to save example:', err);
    showError('Could not save example: ' + (err?.message || String(err)));
    els.confirmCorrectBtn.disabled = false;
  }
}

function openCorrectionEditor() {
  if (!lastAnalysis) return;
  els.correctionJson.value = JSON.stringify(
    toStoredAnalysis(lastAnalysis.result),
    null,
    2
  );
  els.correctionError.style.display = 'none';
  els.correctionEditor.style.display = 'block';
  els.feedbackBar.style.display = 'none';
}

function closeCorrectionEditor() {
  els.correctionEditor.style.display = 'none';
}

async function handleSaveCorrection() {
  if (!lastAnalysis) return;
  let analysis;
  try {
    analysis = JSON.parse(els.correctionJson.value);
  } catch (err) {
    els.correctionError.textContent = 'Invalid JSON: ' + err.message;
    els.correctionError.style.display = 'block';
    return;
  }
  els.saveCorrectionBtn.disabled = true;
  try {
    await ragStore.addExample({
      text: lastAnalysis.text,
      type: lastAnalysis.type,
      analysis,
      source: 'correction',
    });
    closeCorrectionEditor();
    afterExampleSaved();
  } catch (err) {
    els.correctionError.textContent = 'Could not save: ' + (err?.message || String(err));
    els.correctionError.style.display = 'block';
  } finally {
    els.saveCorrectionBtn.disabled = false;
  }
}

function afterExampleSaved() {
  els.feedbackSaved.style.display = 'block';
  refreshLibraryCount();
}

// ---- Library panel --------------------------------------------------------

function toggleLibrary() {
  const open = els.libraryBody.style.display !== 'none';
  els.libraryBody.style.display = open ? 'none' : 'block';
  els.libraryCaret.textContent = open ? '▶' : '▼';
}

async function refreshLibraryCount() {
  try {
    const n = await ragStore.count();
    els.libraryCount.textContent = String(n);
  } catch (err) {
    console.warn('Could not read library count:', err);
  }
}

async function handleAddExample() {
  const text = els.addText.value.trim();
  const type = els.addType.value;
  els.addError.style.display = 'none';

  if (!text) {
    els.addError.textContent = 'Please enter the message text.';
    els.addError.style.display = 'block';
    return;
  }
  if (!ragStore.embeddingsReady) {
    els.addError.textContent =
      'The retrieval model is not loaded, so examples cannot be embedded yet.';
    els.addError.style.display = 'block';
    return;
  }

  let analysis;
  try {
    analysis = JSON.parse(els.addJson.value);
  } catch (err) {
    els.addError.textContent = 'Invalid analysis JSON: ' + err.message;
    els.addError.style.display = 'block';
    return;
  }

  els.addExampleBtn.disabled = true;
  try {
    await ragStore.addExample({ text, type, analysis, source: 'manual' });
    els.addText.value = '';
    els.addJson.value = '';
    await refreshLibraryCount();
    els.importStatus.textContent = '';
    els.addError.style.color = '#1e7e34';
    els.addError.textContent = '✅ Example added.';
    els.addError.style.display = 'block';
  } catch (err) {
    els.addError.style.color = '';
    els.addError.textContent = 'Could not add: ' + (err?.message || String(err));
    els.addError.style.display = 'block';
  } finally {
    els.addExampleBtn.disabled = false;
  }
}

async function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!ragStore.embeddingsReady) {
    els.importStatus.textContent =
      'Load the model first — examples need the retrieval model to be embedded.';
    event.target.value = '';
    return;
  }

  els.importStatus.textContent = 'Reading file…';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : data.examples;
    if (!Array.isArray(items)) {
      throw new Error('Expected a JSON array of { text, type, analysis } objects.');
    }

    let ok = 0;
    let skipped = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || !it.text || !it.analysis) {
        skipped++;
        continue;
      }
      await ragStore.addExample({
        text: it.text,
        type: it.type || 'email',
        analysis: it.analysis,
        source: 'import',
      });
      ok++;
      els.importStatus.textContent = `Importing… ${ok}/${items.length}`;
    }
    await refreshLibraryCount();
    els.importStatus.textContent = `✅ Imported ${ok} example${ok === 1 ? '' : 's'}${
      skipped ? `, skipped ${skipped} invalid` : ''
    }.`;
  } catch (err) {
    els.importStatus.textContent = 'Import failed: ' + (err?.message || String(err));
  } finally {
    event.target.value = '';
  }
}

async function handleClearLibrary() {
  const n = await ragStore.count();
  if (n === 0) {
    els.importStatus.textContent = 'Library is already empty.';
    return;
  }
  const confirmed = window.confirm(
    `Permanently delete all ${n} saved example${n === 1 ? '' : 's'} from the library?`
  );
  if (!confirmed) return;
  try {
    await ragStore.clear();
    await refreshLibraryCount();
    els.importStatus.textContent = 'Library cleared.';
  } catch (err) {
    els.importStatus.textContent = 'Could not clear: ' + (err?.message || String(err));
  }
}

// ---------------------------------------------------------------------------
// Rendering (ported from the original popup.js)
// ---------------------------------------------------------------------------

function displayResults(result) {
  hideError();

  const verdictCard = document.getElementById('verdictCard');
  const verdictIcon = document.getElementById('verdictIcon');
  const verdictText = document.getElementById('verdictText');
  const riskScore = document.getElementById('riskScore');
  const explanation = document.getElementById('explanation');
  const userAdvice = document.getElementById('userAdvice');
  const indicatorsGrid = document.getElementById('indicatorsGrid');
  const redFlagsSection = document.getElementById('redFlagsSection');
  const redFlagsList = document.getElementById('redFlagsList');

  verdictCard.className = 'verdict-card';
  if (result.verdict === 'SAFE') {
    verdictCard.classList.add('safe');
    verdictIcon.textContent = '✅';
  } else if (result.verdict === 'SUSPICIOUS') {
    verdictCard.classList.add('suspicious');
    verdictIcon.textContent = '⚠️';
  } else {
    verdictCard.classList.add('phishing');
    verdictIcon.textContent = '🚨';
  }

  verdictText.textContent = result.verdict;
  riskScore.textContent = `${result.risk_score}/100`;
  explanation.textContent = result.explanation;
  userAdvice.textContent = result.user_advice;

  if (result.red_flags && result.red_flags.length > 0) {
    redFlagsSection.style.display = 'block';
    redFlagsList.innerHTML = '';
    result.red_flags.forEach((flag) => {
      const li = document.createElement('li');
      li.textContent = flag;
      redFlagsList.appendChild(li);
    });
  } else {
    redFlagsSection.style.display = 'none';
  }

  if (result.indicators) {
    indicatorsGrid.innerHTML = '';
    const indicators = [
      { key: 'sender_analysis', label: 'Sender Analysis' },
      { key: 'urgency_tactics', label: 'Urgency Tactics' },
      { key: 'link_analysis', label: 'Link Analysis' },
      { key: 'grammar_tone', label: 'Grammar & Tone' },
      { key: 'requested_action', label: 'Requested Action' },
    ];
    indicators.forEach((ind) => {
      if (result.indicators[ind.key]) {
        const div = document.createElement('div');
        div.className = 'indicator-item';
        div.innerHTML = `<strong></strong><span></span>`;
        div.querySelector('strong').textContent = ind.label;
        div.querySelector('span').textContent = result.indicators[ind.key];
        indicatorsGrid.appendChild(div);
      }
    });
  }

  els.resultsSection.style.display = 'block';
  els.resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function updateStatus(connected, message) {
  els.statusDot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  els.statusText.textContent = message;
}

function showError(message) {
  els.errorMessage.textContent = message;
  els.errorSection.style.display = 'block';
  els.resultsSection.style.display = 'none';
}

function hideError() {
  els.errorSection.style.display = 'none';
}

function hideResults() {
  els.resultsSection.style.display = 'none';
  els.feedbackBar.style.display = 'none';
  els.correctionEditor.style.display = 'none';
  els.feedbackSaved.style.display = 'none';
  els.retrievalInfo.style.display = 'none';
}

function setAnalyzing(analyzing) {
  els.analyzeBtn.disabled = analyzing;
  els.analyzeText.style.display = analyzing ? 'none' : 'inline';
  els.analyzeLoader.style.display = analyzing ? 'inline-block' : 'none';
}
