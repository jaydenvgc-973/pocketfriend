/**
 * worldPhoneEchoGuard.js
 *
 * PIPELINE AUTHORITY GUARD
 *
 * Enforces the rule: User instruction → Character A interpretation → Character A message → Message table.
 * Never: User instruction → Message table.
 *
 * The echo guard is called BEFORE any inter-character Message.content is committed.
 * It blocks sends where the outbound message substantially matches the user's trigger sentence.
 *
 * Three field classifications:
 *
 *   user_instruction_context   — what the user told Character A to do. NEVER becomes Message.content.
 *   requested_message          — direct outbound content ONLY if user explicitly said "send this exact message."
 *   generated_outbound_message — the actual message Character A sends, always in Character A's voice.
 *
 * Echo categories blocked:
 *   1. Exact match (case-insensitive, trimmed)
 *   2. Substantial match: normalized overlap ≥ 0.65 (Jaccard token similarity)
 *   3. Question-echo: user asked a question about Character B → Character A sends that same question TO Character B
 *   4. Meta-instruction echo: user's sentence contains "did you", "have you", "reach out", "contact", "text", "message"
 *      → these are instructions TO Character A, never outbound content FROM Character A
 */

/**
 * Normalize text for comparison: lowercase, strip punctuation, collapse whitespace.
 */
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Jaccard token similarity between two strings.
 * Returns 0–1 where 1 = identical token sets.
 */
function jaccardSimilarity(a, b) {
  const setA = new Set(normalize(a).split(' ').filter(w => w.length > 2));
  const setB = new Set(normalize(b).split(' ').filter(w => w.length > 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Returns true if the candidate outbound message is an echo of the user's trigger sentence.
 *
 * @param {string} userInstruction  — the raw user input to Character A
 * @param {string} candidateMessage — the proposed outbound message from Character A to Character B
 * @returns {{ isEcho: boolean, reason: string|null }}
 */
export function checkEcho(userInstruction, candidateMessage) {
  if (!userInstruction || !candidateMessage) return { isEcho: false, reason: null };

  const normInstruction = normalize(userInstruction);
  const normCandidate = normalize(candidateMessage);

  // 1. Exact match
  if (normInstruction === normCandidate) {
    return { isEcho: true, reason: 'exact_match' };
  }

  // 2. Substantial token overlap
  const similarity = jaccardSimilarity(normInstruction, normCandidate);
  if (similarity >= 0.65) {
    return { isEcho: true, reason: `token_overlap_${Math.round(similarity * 100)}pct` };
  }

  // 3. Meta-instruction keywords: these phrases signal a user instruction to Character A,
  //    never content Character A should forward verbatim to Character B.
  const metaInstructionPatterns = [
    /\b(did you|have you|did you reach out|have you reached out|did you contact|did you text|did you message|did you call)\b/i,
    /\b(reach out to|contact|text|message|call)\s+[A-Za-z]+/i,
    /\b(why (haven'?t|didn'?t) you|you (should|need to|must) (text|call|message|contact))\b/i,
  ];
  for (const pattern of metaInstructionPatterns) {
    if (pattern.test(userInstruction) && pattern.test(candidateMessage)) {
      return { isEcho: true, reason: 'meta_instruction_mirrored' };
    }
  }

  // 4. Question echo: user asked about Character B → candidate sends that same question to Character B
  //    A question from the user ("Did you reach out to Andre?") should never become the outbound message.
  const isUserQuestion = userInstruction.trim().endsWith('?') || /^(did|have|has|do|does|can|could|would|should|is|are|was|were)\b/i.test(userInstruction.trim());
  const candidateContainsUserQuestionCore = normCandidate.includes(normInstruction.replace(/\?$/, '').trim());
  if (isUserQuestion && candidateContainsUserQuestionCore) {
    return { isEcho: true, reason: 'question_echo' };
  }

  return { isEcho: false, reason: null };
}

/**
 * Classifies whether the user's message represents a past-tense verification request
 * ("did you reach out to X?", "have you texted X?") rather than a forward instruction.
 *
 * Verification requests should trigger a check of whether outreach already happened,
 * NOT trigger a new message send.
 *
 * @param {string} userText
 * @returns {boolean}
 */
export function isVerificationRequest(userText) {
  if (!userText) return false;
  return /\b(did you|have you|did you already|have you already|did you reach out|have you reached out|did you contact|have you contacted|did you text|have you texted|did you message|have you messaged|did you call|have you called)\b/i.test(userText);
}

/**
 * Classifies whether the user's message is an explicit exact-send instruction.
 * Only when explicitly marked should the user's words become verbatim outbound content.
 *
 * @param {string} userText
 * @returns {boolean}
 */
export function isExactSendInstruction(userText) {
  if (!userText) return false;
  return /\b(send this exact(ly)?|send exactly this|tell them exactly|word for word|verbatim|copy this|forward this exactly)\b/i.test(userText);
}