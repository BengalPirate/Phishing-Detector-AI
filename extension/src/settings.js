/**
 * App settings: theme, TTS voice/language, and a "Support the developer" link.
 * Persisted in chrome.storage.local.
 */

import { ttsService, VOICE_CATALOG } from './ttsService.js';

// Where the "Support the developer" button points.
const SUPPORT_URL = 'https://buymeacoffee.com/brandonnewtondev';

const DEFAULTS = { theme: 'light', voiceId: 'af_heart' };

let settings = { ...DEFAULTS };
let els = {};

export async function setupSettings() {
  cacheEls();
  await load();
  applyTheme();
  ttsService.setVoice(settings.voiceId);
  populateVoiceControls();
  wireEvents();
}

function cacheEls() {
  els = {
    settingsBtn: document.getElementById('settingsBtn'),
    settingsPanel: document.getElementById('settingsPanel'),
    themeSelect: document.getElementById('themeSelect'),
    langSelect: document.getElementById('langSelect'),
    voiceSelect: document.getElementById('voiceSelect'),
    supportBtn: document.getElementById('supportBtn'),
  };
}

/** Which language group holds the currently-selected voice. */
function groupForVoice(voiceId) {
  return VOICE_CATALOG.find((g) => g.voices.some((v) => v.id === voiceId)) || VOICE_CATALOG[0];
}

function populateVoiceControls() {
  // Languages
  els.langSelect.innerHTML = '';
  for (const g of VOICE_CATALOG) {
    const opt = document.createElement('option');
    opt.value = g.lang;
    opt.textContent = g.lang;
    els.langSelect.appendChild(opt);
  }
  const currentGroup = groupForVoice(settings.voiceId);
  els.langSelect.value = currentGroup.lang;
  populateVoicesForLang(currentGroup.lang, settings.voiceId);
}

function populateVoicesForLang(lang, selectId) {
  const group = VOICE_CATALOG.find((g) => g.lang === lang) || VOICE_CATALOG[0];
  els.voiceSelect.innerHTML = '';
  for (const v of group.voices) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    els.voiceSelect.appendChild(opt);
  }
  els.voiceSelect.value = group.voices.some((v) => v.id === selectId)
    ? selectId
    : group.voices[0].id;
}

async function load() {
  try {
    const stored = await chrome.storage.local.get('settings');
    if (stored.settings) settings = { ...DEFAULTS, ...stored.settings };
  } catch (err) {
    console.warn('Could not load settings:', err);
  }
}

async function save() {
  try {
    await chrome.storage.local.set({ settings });
  } catch (err) {
    console.warn('Could not save settings:', err);
  }
}

function wireEvents() {
  els.settingsBtn.addEventListener('click', togglePanel);

  els.themeSelect.value = settings.theme;
  els.themeSelect.addEventListener('change', async () => {
    settings.theme = els.themeSelect.value;
    applyTheme();
    await save();
  });

  // Language change -> repopulate voices, pick the first, persist.
  els.langSelect.addEventListener('change', async () => {
    populateVoicesForLang(els.langSelect.value, null);
    await selectVoice(els.voiceSelect.value);
  });

  // Voice change -> persist + tell the TTS service.
  els.voiceSelect.addEventListener('change', async () => {
    await selectVoice(els.voiceSelect.value);
  });

  els.supportBtn.addEventListener('click', () => {
    try {
      chrome.tabs.create({ url: SUPPORT_URL });
    } catch (_) {
      window.open(SUPPORT_URL, '_blank');
    }
  });

  // Close the panel when clicking outside it.
  document.addEventListener('click', (e) => {
    if (
      els.settingsPanel.style.display === 'block' &&
      !els.settingsPanel.contains(e.target) &&
      e.target !== els.settingsBtn
    ) {
      els.settingsPanel.style.display = 'none';
    }
  });
}

function togglePanel(e) {
  e.stopPropagation();
  const open = els.settingsPanel.style.display === 'block';
  els.settingsPanel.style.display = open ? 'none' : 'block';
}

async function selectVoice(voiceId) {
  // The new voice downloads on the next "Speak replies" use (on demand).
  settings.voiceId = voiceId;
  ttsService.setVoice(voiceId);
  await save();
}

function applyTheme() {
  const theme =
    settings.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : settings.theme;
  document.documentElement.setAttribute('data-theme', theme);
}
