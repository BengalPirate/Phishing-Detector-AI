/**
 * Forensic provenance helpers.
 *
 * Every chat message is tagged with which engine + exact model produced it, the
 * app version, and an ISO timestamp, and is sealed with a CHAINED SHA-256 hash:
 *
 *   integrity = SHA256( previousIntegrity | role | content | provenanceJSON )
 *
 * This makes the conversation a tamper-evident chain: a technically literate
 * examiner can recompute it and detect any edit, insertion, or deletion after
 * the fact. Crucially, it records when output came from an EXTERNAL engine
 * (e.g., a user-installed Ollama model) rather than the app's vetted in-browser
 * model — so output from a third-party/"uncensored" model the user supplied is
 * attributable to that model, not to the application.
 *
 * Honest limitation: because the data lives in the user's own browser, a
 * determined user could recompute the whole chain to forge a record. This raises
 * the bar and preserves provenance for good-faith records; it is not an
 * unforgeable signature (which would require a server-held private key).
 */

const GENESIS = 'GENESIS';
const encoder = new TextEncoder();

export async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(str));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Seal a message in place: attach provenance + a chained integrity hash based on
 * the previous message's integrity in the same conversation.
 */
export async function sealMessage(conv, msg, modelInfo) {
  const idx = conv.messages.indexOf(msg);
  const prevIntegrity = idx > 0 ? conv.messages[idx - 1].integrity || GENESIS : GENESIS;

  const provenance = {
    engine: modelInfo?.engine || 'unknown',
    model: modelInfo?.model || 'unknown',
    external: !!modelInfo?.external,
    appVersion: modelInfo?.appVersion || 'unknown',
    sealedAt: new Date().toISOString(),
  };
  msg.provenance = provenance;

  const payload = `${prevIntegrity}|${msg.role}|${msg.content}|${JSON.stringify(provenance)}`;
  msg.integrity = await sha256Hex(payload);
}
