/**
 * App settings: theme, TTS voice/language, and a "Support the developer" link.
 * Persisted in chrome.storage.local.
 */

import { ttsService, VOICE_CATALOG } from './ttsService';
import type { VoiceGroup } from './types';

// Where the "Support the developer" button points.
const SUPPORT_URL = 'https://buymeacoffee.com/brandonnewtondev';

const DEFAULTS = { theme: 'light', voiceId: 'af_heart' };

let settings: { theme: string; voiceId: string } = { ...DEFAULTS };
let els!: ReturnType<typeof cacheEls>;

export async function setupSettings(): Promise<void> {
  els = cacheEls();
  await load();
  applyTheme();
  ttsService.setVoice(settings.voiceId);
  populateVoiceControls();
  wireEvents();
}

function cacheEls() {
  return {
    settingsBtn: document.getElementById('settingsBtn') as HTMLElement,
    settingsPanel: document.getElementById('settingsPanel') as HTMLElement,
    themeSelect: document.getElementById('themeSelect') as HTMLSelectElement,
    langSelect: document.getElementById('langSelect') as HTMLSelectElement,
    voiceSelect: document.getElementById('voiceSelect') as HTMLSelectElement,
    supportBtn: document.getElementById('supportBtn') as HTMLElement,
  };
}

/** Which language group holds the currently-selected voice. */
function groupForVoice(voiceId: string): VoiceGroup {
  return VOICE_CATALOG.find((g) => g.voices.some((v) => v.id === voiceId)) || VOICE_CATALOG[0];
}

function populateVoiceControls(): void {
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

function populateVoicesForLang(lang: string, selectId: string | null): void {
  const group = VOICE_CATALOG.find((g) => g.lang === lang) || VOICE_CATALOG[0];
  els.voiceSelect.innerHTML = '';
  for (const v of group.voices) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name;
    els.voiceSelect.appendChild(opt);
  }
  els.voiceSelect.value = group.voices.some((v) => v.id === selectId)
    ? (selectId as string)
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
      !els.settingsPanel.contains(e.target as Node) &&
      e.target !== els.settingsBtn
    ) {
      els.settingsPanel.style.display = 'none';
    }
  });
}

function togglePanel(e: Event): void {
  e.stopPropagation();
  const open = els.settingsPanel.style.display === 'block';
  els.settingsPanel.style.display = open ? 'none' : 'block';
}

async function selectVoice(voiceId: string): Promise<void> {
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
