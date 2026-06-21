/**
 * Retrieval-Augmented Generation (RAG) store for the phishing detector.
 *
 * This is how the tool "learns over time" WITHOUT changing any model weights:
 *  - A growing library of labeled examples ({ message text -> correct analysis })
 *    is kept in IndexedDB.
 *  - Each example is embedded into a vector using WebLLM's built-in embedding
 *    model (snowflake-arctic-embed-s). No extra library is needed — we reuse the
 *    WebGPU/WebLLM runtime already bundled for the chat model.
 *  - At analysis time we embed the incoming message, find the most similar
 *    stored examples by cosine similarity, and inject them into the prompt as
 *    targeted few-shot examples.
 *
 * Examples enter the library three ways (all wired up in sidepanel.js):
 *  1. Correction feedback loop — user fixes a wrong verdict; the fix is saved.
 *  2. Manual add — user pastes a message + its correct analysis JSON.
 *  3. Import — bulk-load a .json file of labeled examples.
 */

import { CreateMLCEngine } from '@mlc-ai/web-llm';

const DB_NAME = 'phishing-detector-rag';
const DB_VERSION = 2;
const STORE = 'examples';
const CONV_STORE = 'conversations';

// Small (~33 MB) embedding model shipped with WebLLM.
export const EMBED_MODEL_ID = 'snowflake-arctic-embed-s-q0f32-MLC-b4';

/** Cosine similarity between two equal-length vectors. */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

class RagStore {
  constructor() {
    this.db = null;
    this.embedEngine = null;
    this._counter = 0;
  }

  // ---- IndexedDB ----------------------------------------------------------

  async initDB() {
    if (this.db) return;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(CONV_STORE)) {
          db.createObjectStore(CONV_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  _tx(mode) {
    return this.db.transaction([STORE], mode).objectStore(STORE);
  }

  _genId() {
    // Deterministic-enough unique id without Date precision collisions.
    this._counter += 1;
    return `${Date.now()}-${this._counter}`;
  }

  // ---- Embeddings ---------------------------------------------------------

  /** Whether the embedding engine is ready. */
  get embeddingsReady() {
    return this.embedEngine !== null;
  }

  /** Load the embedding model (call once, after the chat model). */
  async initEmbeddings(progressCallback) {
    if (this.embedEngine) return;
    this.embedEngine = await CreateMLCEngine(EMBED_MODEL_ID, {
      initProgressCallback: progressCallback,
    });
  }

  async embed(text) {
    if (!this.embedEngine) throw new Error('Embedding model not loaded');
    const reply = await this.embedEngine.embeddings.create({ input: [text] });
    return reply.data[0].embedding;
  }

  // ---- CRUD ---------------------------------------------------------------

  /**
   * Add a labeled example. `analysis` is the correct result JSON
   * (verdict/risk_score/red_flags/explanation/indicators/…).
   */
  async addExample({ text, type, analysis, source }) {
    if (!text || !analysis) throw new Error('Example needs text and analysis');
    const embedding = await this.embed(text);
    const example = {
      id: this._genId(),
      text,
      type: type || 'email',
      analysis,
      source: source || 'manual',
      createdAt: Date.now(),
      embedding,
    };
    await new Promise((resolve, reject) => {
      const req = this._tx('readwrite').put(example);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return example;
  }

  async getAll() {
    await this.initDB();
    return new Promise((resolve, reject) => {
      const req = this._tx('readonly').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async count() {
    await this.initDB();
    return new Promise((resolve, reject) => {
      const req = this._tx('readonly').count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(id) {
    return new Promise((resolve, reject) => {
      const req = this._tx('readwrite').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear() {
    await this.initDB();
    return new Promise((resolve, reject) => {
      const req = this._tx('readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ---- Conversations (chat history) --------------------------------------

  _convTx(mode) {
    return this.db.transaction([CONV_STORE], mode).objectStore(CONV_STORE);
  }

  async saveConversation(conv) {
    await this.initDB();
    return new Promise((resolve, reject) => {
      const req = this._convTx('readwrite').put(conv);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAllConversations() {
    await this.initDB();
    return new Promise((resolve, reject) => {
      const req = this._convTx('readonly').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteConversation(id) {
    await this.initDB();
    return new Promise((resolve, reject) => {
      const req = this._convTx('readwrite').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clearConversations() {
    await this.initDB();
    return new Promise((resolve, reject) => {
      const req = this._convTx('readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ---- Retrieval ----------------------------------------------------------

  /**
   * Return up to `k` stored examples most similar to `text`, each with a
   * similarity score. Returns [] if the library is empty or embeddings aren't
   * ready (the caller then falls back to the static few-shot examples).
   */
  async retrieve(text, k = 3) {
    if (!this.embeddingsReady) return [];
    const all = await this.getAll();
    if (all.length === 0) return [];

    const queryVec = await this.embed(text);
    return all
      .map((ex) => ({ ...ex, score: cosineSimilarity(queryVec, ex.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

export const ragStore = new RagStore();
