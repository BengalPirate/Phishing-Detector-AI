/**
 * Phishing-analysis prompts and output schema.
 *
 * Ported from the original Python backend (phishing_detector.py) and adapted for
 * small in-browser models. The key adaptation: the model is made to REASON
 * BEFORE it concludes. Both the JSON schema and the few-shot examples emit the
 * per-dimension analysis, red flags, explanation, and score FIRST, and the
 * final `verdict` LAST. With grammar-constrained generation the model writes
 * keys in schema order, so putting the verdict last gives it "thinking space"
 * instead of forcing a snap judgment (which biased small models toward SAFE/0).
 */

import type { AnalysisResult, RetrievedExample } from './types';

export const SYSTEM_PROMPT = `You are an expert cybersecurity analyst specializing in phishing detection.
Your task is to analyze a message (email, SMS, chat message, or URL) and produce a
structured risk assessment. Assume the message may be hostile. Be skeptical.

ANALYSIS FRAMEWORK - Evaluate each dimension:

1. SENDER / SOURCE
   - Impersonation of known brands/organizations
   - Typosquatting / lookalike names (e.g., paypa1, amaz0n, micros0ft, rnicrosoft)
   - Free email providers used for "official" corporate messages
   - Mismatched display name vs. actual address

2. URGENCY & PSYCHOLOGICAL MANIPULATION
   - Artificial time pressure ("act now", "within 24 hours", "immediately")
   - Fear/threat tactics (account suspension, fraud alert, legal action)
   - Too-good-to-be-true offers, prizes, or rewards
   - Authority exploitation (pretending to be a CEO, IT, bank, government)

3. LINKS & DOMAINS  (treat these as STRONG signals)
   - Suspicious or uncommon TLDs are a major red flag: .tk .ml .ga .cf .gq .ru .win .top .xyz .zip .click
   - Typosquatted or lookalike domains (paypa1-secure.tk, amaz0n-rewards.win)
   - Brand name placed in a subdomain of an unrelated domain
     (e.g., chase-secure-verify.account-check.ru, secure-microsoft-login.account-verify.tk)
   - Link text / claimed brand does not match the real destination
   - URL shorteners (bit.ly, tinyurl) hiding the destination, especially around payments

4. GRAMMAR, TONE & FORMATTING
   - Poor grammar, spelling, awkward phrasing, inconsistent styling
   - Generic greetings ("Dear Customer", "Dear Valued Customer")

5. REQUESTED ACTION  (these are HIGH-RISK when present)
   - Asks for passwords, card numbers, CVV, SSN, bank details
   - Asks for MFA / one-time / verification codes
   - "Unpaid fee", "verify to release your package", unexpected refund
   - Prize/gift-card claims that require a "processing fee" or card details
   - Wire transfers or payments, especially urgent, secret, or to a new account (BEC)
   - Requests to install software or grant remote access

HOW TO SCORE (risk_score 0-100, and the verdict MUST match the score band):
   - 0-30   -> "SAFE"        : no meaningful indicators; legitimate-looking.
   - 31-70  -> "SUSPICIOUS"  : some concerning signals but not conclusive.
   - 71-100 -> "HIGHLY LIKELY PHISHING" : multiple/strong indicators.
   Any of these ALONE should push the score to at least 70: a suspicious TLD,
   a typosquatted/lookalike domain, a request for credentials/card/SSN/OTP, a
   "pay a fee to release/claim", or an urgent secret wire transfer.
   When genuinely uncertain, lean toward the more cautious (higher) verdict.

PROCEDURE: First fill in "indicators" for every dimension, then list concrete
"red_flags", then write a short "explanation", then assign "risk_score", and
ONLY THEN state the final "verdict" consistent with that score.

OUTPUT FORMAT - respond with ONLY valid JSON in exactly this structure and order:
{
    "indicators": {
        "sender_analysis": "Brief assessment",
        "urgency_tactics": "Brief assessment",
        "link_analysis": "Brief assessment",
        "grammar_tone": "Brief assessment",
        "requested_action": "Brief assessment"
    },
    "red_flags": ["List of specific red flags found"],
    "explanation": "2-4 sentence summary of your reasoning",
    "user_advice": "Clear, actionable advice for the user",
    "risk_score": <integer 0-100>,
    "verdict": "SAFE" | "SUSPICIOUS" | "HIGHLY LIKELY PHISHING"
}

Return ONLY the JSON object, no text before or after.`;

export const FEW_SHOT_EXAMPLES = `
EXAMPLE 1 - Clear Phishing:

MESSAGE:
URGENT: Your account will be suspended! Click here now: http://paypa1.tk/verify
Provide your password immediately.

ANALYSIS:
{
    "indicators": {
        "sender_analysis": "Domain uses typosquatting (paypa1) and a suspicious TLD",
        "urgency_tactics": "Extreme urgency with 'URGENT' and 'immediately'",
        "link_analysis": "Typosquatted domain paypa1.tk on a high-risk .tk TLD",
        "grammar_tone": "Generic, unprofessional, no personalization",
        "requested_action": "Requests the password directly - major red flag"
    },
    "red_flags": [
        "Typosquatting domain: paypa1.tk instead of paypal.com",
        "Suspicious TLD: .tk",
        "Extreme urgency: 'URGENT', 'immediately'",
        "Requests sensitive information: password"
    ],
    "explanation": "Classic credential-phishing: typosquatted paypa1.tk on a high-risk TLD, extreme urgency, and a direct request for the password, which legitimate companies never do via unsolicited messages.",
    "user_advice": "Do NOT click the link or provide any information. Delete it. If concerned, visit paypal.com directly by typing the URL.",
    "risk_score": 95,
    "verdict": "HIGHLY LIKELY PHISHING"
}

EXAMPLE 2 - Legitimate Email:

MESSAGE:
Subject: Your Amazon Order #123-456 Has Shipped
Hello John Smith,
Your recent order has shipped. Track it at: https://www.amazon.com/your-orders
Thank you for shopping with Amazon.

ANALYSIS:
{
    "indicators": {
        "sender_analysis": "Uses the legitimate amazon.com domain",
        "urgency_tactics": "No urgency or pressure tactics",
        "link_analysis": "Link points to the real amazon.com domain",
        "grammar_tone": "Professional, personalized greeting (uses the name)",
        "requested_action": "No sensitive information requested; no action required"
    },
    "red_flags": [],
    "explanation": "A legitimate shipping notification: real Amazon domain, personalized greeting, no urgency, and no request for sensitive information.",
    "user_advice": "Appears legitimate. You can still verify by logging into Amazon directly rather than clicking the link.",
    "risk_score": 5,
    "verdict": "SAFE"
}

EXAMPLE 3 - Smishing with a suspicious link:

MESSAGE:
[Chase] Fraud Alert: A $750 charge was attempted. If this wasn't you, verify now:
http://chase-secure-verify.account-check.ru/login

ANALYSIS:
{
    "indicators": {
        "sender_analysis": "Claims to be Chase but uses an unrelated domain",
        "urgency_tactics": "Fear tactic: fake fraud alert demanding immediate action",
        "link_analysis": "'chase' is only a subdomain of account-check.ru; .ru TLD and brand-in-subdomain are strong phishing signals",
        "grammar_tone": "Terse alert designed to provoke panic",
        "requested_action": "Pushes the user to 'verify' identity on a fake login page"
    },
    "red_flags": [
        "Brand name in subdomain of unrelated domain: chase-secure-verify.account-check.ru",
        "Suspicious TLD: .ru",
        "Fake fraud-alert urgency",
        "Credential-harvesting login link"
    ],
    "explanation": "The real domain is account-check.ru, not Chase; the brand name is only a subdomain. Combined with the .ru TLD and a panic-inducing fake fraud alert, this is a smishing attempt to steal login credentials.",
    "user_advice": "Do not tap the link. Contact Chase using the number on the back of your card or their official app.",
    "risk_score": 92,
    "verdict": "HIGHLY LIKELY PHISHING"
}
`;

const ANALYZE_INSTRUCTION =
  'Now analyze the following message using the same framework and the same JSON order:';

/**
 * JSON schema matching the OUTPUT FORMAT above. Passed to WebLLM as a
 * grammar-constrained `response_format`. Property order matters: it forces the
 * model to emit the analysis (indicators, red_flags, explanation, score) BEFORE
 * the final verdict, which acts as built-in chain-of-thought reasoning.
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    indicators: {
      type: 'object',
      properties: {
        sender_analysis: { type: 'string' },
        urgency_tactics: { type: 'string' },
        link_analysis: { type: 'string' },
        grammar_tone: { type: 'string' },
        requested_action: { type: 'string' },
      },
      required: [
        'sender_analysis',
        'urgency_tactics',
        'link_analysis',
        'grammar_tone',
        'requested_action',
      ],
    },
    red_flags: { type: 'array', items: { type: 'string' } },
    explanation: { type: 'string' },
    user_advice: { type: 'string' },
    risk_score: { type: 'integer', minimum: 0, maximum: 100 },
    verdict: {
      type: 'string',
      enum: ['SAFE', 'SUSPICIOUS', 'HIGHLY LIKELY PHISHING'],
    },
  },
  required: [
    'indicators',
    'red_flags',
    'explanation',
    'user_advice',
    'risk_score',
    'verdict',
  ],
};

/**
 * Format RAG-retrieved examples into a few-shot block. Each example is a stored
 * { text, type, analysis } pair the user previously labeled or corrected.
 */
function formatRetrievedExamples(examples: RetrievedExample[]) {
  if (!examples || examples.length === 0) return '';
  let block =
    '\nADDITIONAL REFERENCE EXAMPLES from the user\'s library, most similar to the message below. ' +
    'Treat these labeled examples as authoritative guidance:\n';
  examples.forEach((ex, i) => {
    block += `\nREFERENCE ${i + 1} (type: ${ex.type}):\nMESSAGE:\n${ex.text}\n\nANALYSIS:\n${JSON.stringify(
      ex.analysis
    )}\n`;
  });
  return block;
}

/**
 * Build the user-turn prompt for a given message and type. If `retrievedExamples`
 * are supplied (from the RAG store), they are appended after the static few-shot
 * examples so the model sees precedents relevant to this specific message.
 */
export function buildUserPrompt(
  message: string,
  messageType: string,
  retrievedExamples: RetrievedExample[] = []
) {
  return `${FEW_SHOT_EXAMPLES}${formatRetrievedExamples(retrievedExamples)}

${ANALYZE_INSTRUCTION}

MESSAGE TYPE: ${messageType}
MESSAGE:
${message}

Provide your analysis in the required JSON format and order.`;
}

/**
 * Defensive JSON extraction, mirroring the Python backend's
 * _extract_json_from_response. Also reconciles verdict with risk_score in case a
 * weak model emits a score and verdict that disagree.
 */
export function extractJson(responseText: string): AnalysisResult {
  let parsed: any = null;
  try {
    parsed = JSON.parse(responseText);
  } catch (_) {
    const match = responseText.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch (_) {
        /* fall through */
      }
    }
  }

  if (!parsed) {
    return {
      verdict: 'SUSPICIOUS',
      risk_score: 50,
      red_flags: ['Unable to parse analysis results'],
      explanation:
        'The analysis could not be completed properly. Please review the message manually.',
      user_advice:
        'Exercise caution and verify the message through official channels.',
      indicators: {
        sender_analysis: 'Unable to analyze',
        urgency_tactics: 'Unable to analyze',
        link_analysis: 'Unable to analyze',
        grammar_tone: 'Unable to analyze',
        requested_action: 'Unable to analyze',
      },
    };
  }

  // Keep verdict and score consistent with the documented bands. The score is
  // the more reliable signal from the reasoning, so derive the verdict from it.
  if (typeof parsed.risk_score === 'number') {
    const s = parsed.risk_score;
    const band =
      s >= 71 ? 'HIGHLY LIKELY PHISHING' : s >= 31 ? 'SUSPICIOUS' : 'SAFE';
    if (parsed.verdict !== band) parsed.verdict = band;
  }

  return parsed;
}
