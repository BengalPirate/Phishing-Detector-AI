import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  buildUserPrompt,
  extractJson,
} from '../src/prompts.ts';

test('response schema keeps the required analysis contract stable', () => {
  assert.equal(RESPONSE_SCHEMA.type, 'object');
  assert.deepEqual(RESPONSE_SCHEMA.required, [
    'indicators',
    'red_flags',
    'explanation',
    'user_advice',
    'risk_score',
    'verdict',
  ]);
  assert.deepEqual(RESPONSE_SCHEMA.properties.verdict.enum, [
    'SAFE',
    'SUSPICIOUS',
    'HIGHLY LIKELY PHISHING',
  ]);
  assert.equal(RESPONSE_SCHEMA.properties.risk_score.minimum, 0);
  assert.equal(RESPONSE_SCHEMA.properties.risk_score.maximum, 100);
});

test('system prompt preserves high-risk phishing scoring rules', () => {
  const mustMention = [
    'Suspicious or uncommon TLDs are a major red flag',
    'typosquatted/lookalike domain',
    'request for credentials/card/SSN/OTP',
    '31-70  -> "SUSPICIOUS"',
    '71-100 -> "HIGHLY LIKELY PHISHING"',
  ];

  for (const phrase of mustMention) {
    assert.match(SYSTEM_PROMPT, new RegExp(escapeRegExp(phrase)));
  }
});

test('buildUserPrompt includes static examples and retrieved examples', () => {
  const prompt = buildUserPrompt('Reset your password at http://paypa1.tk', 'email', [
    {
      type: 'sms',
      text: 'Bank alert: verify at http://bank-login.ru',
      analysis: {
        verdict: 'HIGHLY LIKELY PHISHING',
        risk_score: 94,
        red_flags: ['Suspicious .ru domain'],
      },
    },
  ]);

  assert.match(prompt, /EXAMPLE 1 - Clear Phishing/);
  assert.match(prompt, /REFERENCE 1 \(type: sms\)/);
  assert.match(prompt, /Bank alert: verify at http:\/\/bank-login\.ru/);
  assert.match(prompt, /MESSAGE TYPE: email/);
  assert.match(prompt, /Reset your password at http:\/\/paypa1\.tk/);
});

test('extractJson parses fenced or prefixed JSON and reconciles verdict bands', () => {
  const parsed = extractJson(`Here is the result:
  {
    "indicators": {
      "sender_analysis": "Looks official",
      "urgency_tactics": "Urgent",
      "link_analysis": "Suspicious",
      "grammar_tone": "Generic",
      "requested_action": "Password"
    },
    "red_flags": ["password request"],
    "explanation": "Credential request.",
    "user_advice": "Do not click.",
    "risk_score": 92,
    "verdict": "SAFE"
  }`);

  assert.equal(parsed.risk_score, 92);
  assert.equal(parsed.verdict, 'HIGHLY LIKELY PHISHING');
});

test('extractJson returns cautious fallback on malformed model output', () => {
  const parsed = extractJson('not valid json at all');

  assert.equal(parsed.verdict, 'SUSPICIOUS');
  assert.equal(parsed.risk_score, 50);
  assert.ok(parsed.red_flags.includes('Unable to parse analysis results'));
});

test('model accuracy prompt regression: canonical phishing examples stay high risk', () => {
  const phishingPrompt = buildUserPrompt(
    'URGENT: Your account will be suspended. Verify password at http://paypa1.tk/verify',
    'email'
  );

  assert.match(phishingPrompt, /paypa1\.tk/);
  assert.match(phishingPrompt, /risk_score": 95/);
  assert.match(phishingPrompt, /HIGHLY LIKELY PHISHING/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
