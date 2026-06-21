/**
 * Chat panel for the side panel — a full conversational assistant ("PhishGuard")
 * stacked beneath the analyzer. Features:
 *   - Multi-turn chat using the already-loaded WebLLM model (no extra download).
 *   - Persistent conversation history in IndexedDB (clearable by the user).
 *   - RAG recall: pulls the most similar saved analyses from the example library
 *     so the assistant "remembers" past phishing attempts across conversations.
 *   - Voice: Piper neural TTS (speak replies) + Web Speech API mic (speech-to-text).
 */

import { ragStore } from './ragStore';
import { ttsService } from './ttsService';
import { sealMessage } from './provenance';
import type {
  ChatEngine,
  ChatMessage,
  ChatStreamChunk,
  Conversation,
  Message,
  ModelInfo,
  SpeakSession,
  SpeechRecognitionLike,
} from './types';

const CHAT_SYSTEM_PROMPT = `You are PhishGuard, a friendly cybersecurity assistant inside a phishing-detection browser extension.
You help the user understand suspicious emails, texts, links, and scams, explain phishing tactics, and give clear, practical safety advice.
Be concise and direct. If the user pastes or describes a message, assess how risky it looks and why.
If relevant past examples from the user's library are provided, use them to inform your answer.`;

const MAX_HISTORY_MESSAGES = 6; // sliding window of recent turns sent to the model

// TTS chunking: speak the first sentence immediately (target 1), then use modest
// batches. Each batch is one synthesis call = one brief main-thread block, so we
// keep them short (the panel stays scrollable); the playback queue keeps audio
// flowing across chunks. Sizes are in characters. Last value repeats.
const CHUNK_TARGETS = [1, 100, 200];
const RUNON_FLUSH = 400; // flush a run-on with no sentence end past this length

let getEngine: (() => ChatEngine | null) | null = null;
let getModelInfo: (() => ModelInfo) | null = null;
let conversations: Conversation[] = [];
let currentId: string | null = null;

let ttsEnabled = false;
let ttsLoading = false;
let recognition: SpeechRecognitionLike | null = null;
let isListening = false;
let hiddenMsg: Message | null = null; // assistant message to hide until speech starts
let thinking = false; // show the thinking spinner
let activeSpeak: SpeakSession | null = null; // current streaming TTS session

let c!: ReturnType<typeof cacheEls>; // cached DOM elements

export function setupChatPanel(
  engineGetter: () => ChatEngine | null,
  modelInfoGetter: () => ModelInfo
): void {
  getEngine = engineGetter;
  getModelInfo = modelInfoGetter;
  c = cacheEls();
  wireEvents();
  initSpeechRecognition();
  loadConversations();
}

/** Called by sidepanel.js once the analysis model has loaded. */
export function onChatModelReady(): void {
  c.chatInput.disabled = false;
  c.chatSendBtn.disabled = false;
  c.chatEmpty.textContent = 'Ask PhishGuard about a suspicious message, link, or scam.';
}

function cacheEls() {
  return {
    section: document.getElementById('chatSection') as HTMLElement,
    newBtn: document.getElementById('chatNewBtn') as HTMLElement,
    exportBtn: document.getElementById('chatExportBtn') as HTMLElement,
    historyToggle: document.getElementById('chatHistoryToggle') as HTMLElement,
    historyList: document.getElementById('chatHistoryList') as HTMLElement,
    clearAllBtn: document.getElementById('chatClearAllBtn') as HTMLElement,
    messages: document.getElementById('chatMessages') as HTMLElement,
    chatEmpty: document.getElementById('chatEmpty') as HTMLElement,
    chatInput: document.getElementById('chatInput') as HTMLTextAreaElement,
    chatSendBtn: document.getElementById('chatSendBtn') as HTMLButtonElement,
    chatMicBtn: document.getElementById('chatMicBtn') as HTMLElement,
    speakToggle: document.getElementById('chatSpeakToggle') as HTMLInputElement,
    stopSpeakBtn: document.getElementById('chatStopSpeakBtn') as HTMLElement,
    voiceStatus: document.getElementById('chatVoiceStatus') as HTMLElement,
    recallInfo: document.getElementById('chatRecallInfo') as HTMLElement,
  };
}

function wireEvents() {
  c.newBtn.addEventListener('click', newConversation);
  c.exportBtn.addEventListener('click', exportConversation);
  c.historyToggle.addEventListener('click', toggleHistory);
  c.clearAllBtn.addEventListener('click', clearAllConversations);
  c.chatSendBtn.addEventListener('click', sendMessage);
  c.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  c.chatMicBtn.addEventListener('click', toggleListening);
  c.speakToggle.addEventListener('change', onSpeakToggle);
  c.stopSpeakBtn.addEventListener('click', () => {
    activeSpeak?.stop();
    ttsService.stop();
    c.stopSpeakBtn.style.display = 'none';
  });
}

// ---- Conversations ---------------------------------------------------------

async function loadConversations() {
  try {
    const all = await ragStore.getAllConversations();
    conversations = all.sort((a, b) => b.updatedAt - a.updatedAt);
    if (conversations.length > 0) currentId = conversations[0].id;
  } catch (err) {
    console.warn('Could not load conversations:', err);
  }
  renderHistory();
  renderMessages();
}

function currentConversation(): Conversation | null {
  return conversations.find((cv) => cv.id === currentId) || null;
}

function newConversation() {
  const conv: Conversation = {
    id: `${Date.now()}`,
    title: 'New chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  conversations.unshift(conv);
  currentId = conv.id;
  renderHistory();
  renderMessages();
}

async function persist(conv: Conversation) {
  conv.updatedAt = Date.now();
  try {
    await ragStore.saveConversation(JSON.parse(JSON.stringify(conv)));
  } catch (err) {
    console.warn('Could not save conversation:', err);
  }
}

async function deleteConversation(id: string) {
  conversations = conversations.filter((cv) => cv.id !== id);
  if (currentId === id) currentId = conversations[0]?.id || null;
  try {
    await ragStore.deleteConversation(id);
  } catch (err) {
    console.warn('Could not delete conversation:', err);
  }
  renderHistory();
  renderMessages();
}

async function clearAllConversations() {
  if (conversations.length === 0) return;
  if (!window.confirm(`Delete all ${conversations.length} chat conversation(s)?`)) return;
  conversations = [];
  currentId = null;
  try {
    await ragStore.clearConversations();
  } catch (err) {
    console.warn('Could not clear conversations:', err);
  }
  renderHistory();
  renderMessages();
}

function toggleHistory() {
  const open = c.historyList.style.display !== 'none';
  c.historyList.style.display = open ? 'none' : 'block';
}

/** Export the current conversation as a tamper-evident forensic JSON record. */
function exportConversation() {
  const conv = currentConversation();
  if (!conv || conv.messages.length === 0) {
    window.alert('No conversation to export yet.');
    return;
  }
  const record = {
    application: 'Phishing Detector AI',
    appVersion: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    integrityScheme:
      'Each message has integrity = SHA-256(previousIntegrity | role | content | provenanceJSON), ' +
      'chained from a "GENESIS" seed. Recompute the chain to verify the record was not altered.',
    notice:
      'Messages whose provenance.external is true were generated by a third-party model engine ' +
      '(e.g., Ollama) that the user installed, configured, and controls — outside the application ' +
      'and the developer\'s control.',
    conversation: conv,
  };
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `phishguard-record-${conv.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Sending ---------------------------------------------------------------

async function sendMessage() {
  const text = c.chatInput.value.trim();
  const engine = getEngine && getEngine();
  if (!text || !engine) return;

  c.chatInput.value = '';
  if (!currentConversation()) newConversation();
  const conv = currentConversation()!;

  const userMsg: Message = { role: 'user', content: text, timestamp: Date.now() };
  conv.messages.push(userMsg);
  await sealMessage(conv, userMsg, getModelInfo ? getModelInfo() : null);
  if (conv.messages.length === 1) {
    conv.title = text.slice(0, 32) + (text.length > 32 ? '…' : '');
  }
  renderMessages();
  renderHistory();
  setSending(true);

  try {
    // RAG recall: surface similar past flagged messages from the library.
    let recallContext = '';
    try {
      const similar = await ragStore.retrieve(text, 2);
      if (similar.length > 0) {
        recallContext =
          '\n\nRelevant past examples from the user\'s library:\n' +
          similar
            .map(
              (ex) =>
                `- A ${ex.type} previously labeled "${ex.analysis?.verdict}" (risk ${ex.analysis?.risk_score}): "${ex.text.slice(
                  0,
                  160
                )}"`
            )
            .join('\n');
        c.recallInfo.textContent = `🧠 Recalled ${similar.length} similar past message(s).`;
        c.recallInfo.style.display = 'block';
      } else {
        c.recallInfo.style.display = 'none';
      }
    } catch (_) {
      c.recallInfo.style.display = 'none';
    }

    const history = conv.messages
      .filter((m) => m.role !== 'system')
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content }));

    const messages: ChatMessage[] = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT + recallContext },
      ...history,
    ];

    const useVoice = ttsEnabled;

    // Placeholder assistant message we fill as tokens stream in.
    const assistantMsg: Message = { role: 'assistant', content: '', timestamp: Date.now() };
    conv.messages.push(assistantMsg);

    // Voice on: hide the text + show a thinking spinner until the first audio
    // chunk starts playing. Voice off: stream the text in as it generates.
    let textRevealed = !useVoice;
    if (useVoice) {
      hiddenMsg = assistantMsg;
      showThinking(true);
    } else {
      renderMessages();
    }

    const reveal = () => {
      if (textRevealed) return;
      textRevealed = true;
      hiddenMsg = null;
      thinking = false;
      renderMessages();
    };

    if (useVoice) {
      activeSpeak = ttsService.createSpeakSession({
        onFirstAudio: () => {
          reveal();
          c.stopSpeakBtn.style.display = 'inline-block';
        },
        onError: (e) => {
          console.error('TTS error:', e);
          reveal(); // fall back to showing text if speech fails
        },
        onDone: () => {
          c.stopSpeakBtn.style.display = 'none';
        },
      });
    }

    let sentenceBuffer = ''; // text with no complete sentence yet
    let pendingChunk = ''; // complete sentences accumulated toward a batch
    let chunkIndex = 0; // which CHUNK_TARGETS size we're filling

    const targetSize = () => CHUNK_TARGETS[Math.min(chunkIndex, CHUNK_TARGETS.length - 1)];
    const flushChunk = () => {
      const c2 = pendingChunk.trim();
      if (c2) {
        activeSpeak?.push(c2);
        chunkIndex++;
      }
      pendingChunk = '';
    };

    const stream = (await engine.chat.completions.create({
      messages,
      temperature: 0.4,
      max_tokens: 800,
      stream: true,
    })) as AsyncIterable<ChatStreamChunk>;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (!delta) continue;
      assistantMsg.content += delta;

      if (useVoice && activeSpeak) {
        sentenceBuffer += delta;
        const { sentences, rest } = takeSentences(sentenceBuffer);
        sentenceBuffer = rest;
        for (const s of sentences) {
          pendingChunk += (pendingChunk ? ' ' : '') + s;
          if (pendingChunk.length >= targetSize()) flushChunk();
        }
        // Run-on with no sentence end: flush so we don't stall.
        if (sentenceBuffer.length > RUNON_FLUSH) {
          pendingChunk += (pendingChunk ? ' ' : '') + sentenceBuffer.trim();
          sentenceBuffer = '';
          flushChunk();
        }
        // Once revealed, keep the visible text in sync with the audio.
        if (textRevealed) scheduleRender();
      } else {
        scheduleRender(); // incremental text when not speaking
      }
    }

    if (useVoice && activeSpeak) {
      // Flush whatever's left as the final chunk.
      if (sentenceBuffer.trim()) {
        pendingChunk += (pendingChunk ? ' ' : '') + sentenceBuffer.trim();
      }
      flushChunk();
      activeSpeak.end();
    }

    if (!assistantMsg.content) assistantMsg.content = 'No response.';
    reveal(); // ensure text shows even for very short / silent replies
    await sealMessage(conv, assistantMsg, getModelInfo ? getModelInfo() : null);
    renderMessages();
    await persist(conv);

    if (activeSpeak) activeSpeak.done.catch(() => {}); // let speech finish in bg
  } catch (err) {
    console.error('Chat error:', err);
    hiddenMsg = null;
    thinking = false;
    const conv2 = currentConversation()!;
    const last = conv2.messages[conv2.messages.length - 1];
    const errText = `Sorry, I hit an error: ${err?.message || String(err)}`;
    if (last && last.role === 'assistant' && !last.content) {
      last.content = errText;
    } else {
      conv2.messages.push({ role: 'assistant', content: errText, timestamp: Date.now() });
    }
    renderMessages();
    await persist(conv2);
  } finally {
    setSending(false);
  }
}

/** Pull complete sentences from a buffer, leaving the trailing partial behind. */
function takeSentences(buf: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  const re = /[^.!?\n]*[.!?\n]+["')\]]*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf)) !== null) {
    const s = m[0].trim();
    if (s) sentences.push(s);
    last = re.lastIndex;
  }
  return { sentences, rest: buf.slice(last) };
}

function setSending(sending: boolean) {
  c.chatSendBtn.disabled = sending;
  c.chatSendBtn.textContent = sending ? 'Thinking…' : 'Send';
}

// ---- Rendering -------------------------------------------------------------

function renderHistory() {
  c.historyList.innerHTML = '';
  if (conversations.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No saved chats yet.';
    c.historyList.appendChild(p);
    return;
  }
  for (const conv of conversations) {
    const row = document.createElement('div');
    row.className = `chat-history-item ${conv.id === currentId ? 'active' : ''}`;

    const title = document.createElement('span');
    title.className = 'chat-history-title';
    title.textContent = conv.title || 'Untitled';
    title.addEventListener('click', () => {
      currentId = conv.id;
      renderHistory();
      renderMessages();
    });

    const del = document.createElement('button');
    del.className = 'chat-history-delete';
    del.textContent = '×';
    del.title = 'Delete conversation';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });

    row.appendChild(title);
    row.appendChild(del);
    c.historyList.appendChild(row);
  }
}

function renderMessages() {
  const conv = currentConversation();
  const msgs = conv?.messages || [];

  // Preserve the user's scroll: only auto-follow the bottom if they're already
  // there. If they've scrolled up to read, keep their position — never yank.
  const prevTop = c.messages.scrollTop;
  const stick = c.messages.scrollHeight - prevTop - c.messages.clientHeight <= 60;

  c.messages.innerHTML = '';

  if (msgs.length === 0) {
    c.chatEmpty.style.display = 'block';
    c.messages.appendChild(c.chatEmpty);
    return;
  }
  c.chatEmpty.style.display = 'none';

  for (const m of msgs) {
    if (m === hiddenMsg) continue; // hidden until speech starts
    const wrap = document.createElement('div');
    wrap.className = `chat-msg ${m.role}`;

    const role = document.createElement('div');
    role.className = 'chat-msg-role';
    role.textContent = m.role === 'user' ? 'You' : 'PhishGuard';

    const body = document.createElement('div');
    body.className = 'chat-msg-body';
    body.textContent = m.content; // textContent — never inject model output as HTML

    wrap.appendChild(role);
    wrap.appendChild(body);

    // Provenance tag on assistant messages (forensic attribution of the model).
    if (m.role === 'assistant' && m.provenance) {
      const tag = document.createElement('div');
      tag.className = 'chat-msg-provenance' + (m.provenance.external ? ' external' : '');
      const label = m.provenance.engine === 'ollama'
        ? `Ollama: ${m.provenance.model}`
        : `In-browser: ${m.provenance.model}`;
      tag.textContent = (m.provenance.external ? '⚠ External model — ' : 'Model — ') + label;
      tag.title = m.provenance.external
        ? 'This response was generated by an external model you installed and control (Ollama), outside the application.'
        : 'This response was generated by the in-browser model.';
      wrap.appendChild(tag);
    }

    c.messages.appendChild(wrap);
  }

  if (thinking) {
    const t = document.createElement('div');
    t.className = 'chat-msg assistant';
    t.innerHTML =
      '<div class="chat-msg-role">PhishGuard</div>' +
      '<div class="chat-msg-body"><span class="chat-thinking"><span></span><span></span><span></span></span></div>';
    c.messages.appendChild(t);
  }

  // Follow the bottom only if we were at the bottom; otherwise keep the user's
  // scroll position so they can read earlier messages while generation continues.
  c.messages.scrollTop = stick ? c.messages.scrollHeight : prevTop;
}

function showThinking(on: boolean) {
  thinking = on;
  renderMessages();
}

// Coalesce rapid streaming updates into at most one render per animation frame
// so token-by-token generation doesn't thrash the DOM (which also froze scroll).
let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderMessages();
  });
}

// ---- Voice: TTS ------------------------------------------------------------

async function onSpeakToggle() {
  if (c.speakToggle.checked) {
    ttsEnabled = true;
    // Ensure the engine/voice currently selected in Settings is loaded.
    if (!ttsService.isReady() && !ttsLoading) {
      ttsLoading = true;
      c.voiceStatus.textContent = 'Downloading voice…';
      try {
        await ttsService.initialize(undefined, (info) => {
          c.voiceStatus.textContent =
            info.pct != null ? `Downloading voice… ${info.pct}%` : `Downloading voice… ${info.loadedMB} MB`;
        });
        c.voiceStatus.textContent = 'Voice ready.';
        setTimeout(() => (c.voiceStatus.textContent = ''), 2000);
      } catch (err) {
        console.error('Voice load failed:', err);
        c.voiceStatus.textContent = 'Voice failed to load.';
        ttsEnabled = false;
        c.speakToggle.checked = false;
      } finally {
        ttsLoading = false;
      }
    }
  } else {
    ttsEnabled = false;
    activeSpeak?.stop();
    ttsService.stop();
    c.stopSpeakBtn.style.display = 'none';
  }
}

// ---- Voice: STT (Web Speech API) ------------------------------------------

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    c.chatMicBtn.style.display = 'none';
    return;
  }
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    c.chatMicBtn.classList.add('listening');
    c.chatMicBtn.textContent = '🔴';
  };
  recognition.onend = () => {
    isListening = false;
    c.chatMicBtn.classList.remove('listening');
    c.chatMicBtn.textContent = '🎤';
  };
  recognition.onerror = () => {
    isListening = false;
    c.chatMicBtn.classList.remove('listening');
    c.chatMicBtn.textContent = '🎤';
  };
  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    if (transcript) {
      c.chatInput.value = (c.chatInput.value + ' ' + transcript).trim();
    }
  };
}

function toggleListening() {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
  } else {
    try {
      recognition.start();
    } catch (_) {
      /* already started */
    }
  }
}
