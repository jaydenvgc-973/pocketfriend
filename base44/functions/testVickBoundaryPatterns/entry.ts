/**
 * testVickBoundaryPatterns
 *
 * Full boundary verification:
 *   1. Detection — contaminated phrases must be detected.
 *   2. Rewrite — detected phrases must be rewritten.
 *   3. Output safety — final rewritten output must NOT still contain forbidden terms.
 *   4. Rejection — if rewrite still violates, output must be null (not saved).
 *   5. Clean pass — in-world examples must pass without being flagged.
 *
 * Admin only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── Inline boundary patterns (mirrors lib/vickCharacterBoundary.js) ─────────
const VICK_BOUNDARY_PATTERNS = [
  /\bthe\s+app\b/i, /\bBase44\b/i, /\bthis\s+application\b/i, /\bthe\s+platform\b/i, /\bthe\s+software\b/i,
  /\brun(?:ning)?\s+(?:a\s+)?diagnostic/i, /\bdiagnostic\s+result/i, /\bdiagnostic\s+tool/i,
  /\baudit(?:ing|ed)?\s+(?:your|the|their)/i, /\bran\s+(?:a\s+)?(?:diagnostic|audit|repair|check)/i,
  /\brepair\s+(?:function|system|tool|result|log)/i, /\bAccount\s+Help\b/i,
  /\bAccount\s+Help\s+(?:&|and)\s+Repair\b/i,
  /\bdeleted\s+files?\b/i, /\bfile\s+headers?\b/i, /\bcharacter\s+files?\b/i,
  /\bmemory\s+files?\b/i, /\bmemory\s+records?\b/i,
  /\bdatabase(?:\s+entries?|\s+records?|\s+files?|\s+data)?\b/i,
  /\bstored\s+(?:data|records?|files?)\b/i, /\bhidden\s+(?:data|records?|files?)\b/i,
  /\bmetadata\b/i, /\binternal\s+(?:ID|identifier|record|data|system|files?)\b/i,
  /\bschema\b/i, /\bdata\s+(?:field|record|entry|table|schema|store|file)\b/i,
  /\bmemory\s+system\b/i, /\bmemory\s+architecture\b/i, /\bmemory\s+bank\b/i,
  /\bmemory\s+entries?\b/i, /\bmemory\s+wipe\b/i,
  /\bAI\s+(?:memory|system|instruction|data)\b/i, /\bsystem\s+prompt\b/i,
  /\bcharacter\s+(?:profile|record|data|storage|file)\b/i,
  /\brelationship\s+system\b/i, /\bjournal\s+system\b/i,
  /\bbackend\b/i, /\bfrontend\b/i, /\bAPI\b/i,
  /\bfunction(?:s)?\s+(?:ran|run|called|failed|returned|working|broken)\b/i,
  /\bsource\s+code\b/i, /\bthe\s+logs?\b/i,
  /\berror\s+(?:log|message|code|state)\b/i,
  /\buser\s+settings?\b/i, /\bapp\s+settings?\b/i,
  /\bscrubbed\s+(?:from|out\s+of)\s+(?:the\s+)?(?:records?|database|system|files?)\b/i,
  /\bpurged\s+from\s+(?:the\s+)?(?:records?|system|database)\b/i,
  /\berased\s+from\s+(?:the\s+)?(?:records?|system|database)\b/i,
];

// ── Safe rewrites (mirrors lib/vickCharacterBoundary.js SAFE_REWRITES) ───────
const SAFE_REWRITES = [
  [/\bdeleted\s+files?\b/gi, 'something that should have been there but wasn\'t'],
  [/\bfile\s+headers?\b/gi, 'old papers I came across'],
  [/\bdatabase(?:\s+entries?|\s+records?|\s+files?|\s+data)?\b/gi, 'what I found when I looked into it'],
  [/\bstored\s+(?:data|records?|files?)\b/gi, 'what\'s been documented'],
  [/\bcharacter\s+profile\b/gi, 'what people say about them'],
  [/\bcharacter\s+record\b/gi, 'what I know about them'],
  [/\bcharacter\s+data\b/gi, 'what I\'ve gathered'],
  [/\bcharacter\s+files?\b/gi, 'what I found on them'],
  [/\bmemory\s+records?\b/gi, 'what they say they remember'],
  [/\bmemory\s+files?\b/gi, 'what they\'ve told people'],
  [/\bmemory\s+wipe\b/gi, 'someone deliberately made them forget'],
  [/\bmemory\s+(?:system|architecture|bank|entries?|store)\b/gi, 'how they carry things with them'],
  [/\bran\s+a\s+diagnostic\b/gi, 'looked into it myself'],
  [/\brunning\s+(?:a\s+)?diagnostic/gi, 'looking into it'],
  [/\bdiagnostic\s+results?\b/gi, 'what I found'],
  [/\bdiagnostic\s+tools?\b/gi, 'my own judgment'],
  [/\baudit(?:ed|ing)?\s+(?:your|the|their)/gi, 'went through'],
  [/\brepair\s+function\b/gi, 'what I did to sort it out'],
  [/\bAccount\s+Help\s+(?:&|and)\s+Repair\b/gi, 'the work I do'],
  [/\bthe\s+logs?\b/gi, 'a trail of what happened'],
  [/\berror\s+log\b/gi, 'a list of things that went wrong'],
  [/\bthe\s+(?:error|exception)\s+(?:shows?|says?|indicates?)\b/gi, 'from what I could piece together'],
  [/\bmetadata\b/gi, 'small details that don\'t add up'],
  [/\binternal\s+(?:ID|identifier)\b/gi, 'a name I found in the paperwork'],
  [/\binternal\s+(?:record|data|system|files?)\b/gi, 'something that wasn\'t meant to be seen'],
  [/\bhidden\s+(?:data|records?|files?|information)\b/gi, 'information people were kept from'],
  [/\bscrubbed\s+(?:from|out\s+of)\s+(?:the\s+)?(?:records?|database|system|files?)\b/gi, 'made to disappear entirely'],
  [/\bpurged\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'removed from the picture'],
  [/\berased\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'wiped from the story'],
  [/\brelationship\s+system\b/gi, 'how two people relate to each other'],
  [/\bjournal\s+system\b/gi, 'the running history between people'],
  [/\bthe\s+app\b/gi, 'around here'],
  [/\bBase44\b/gi, 'this place'],
  [/\bthe\s+platform\b/gi, 'how things operate here'],
  [/\bbackend\b/gi, 'what goes on behind the scenes'],
  [/\bfrontend\b/gi, 'what\'s visible to everyone'],
  [/\bsource\s+code\b/gi, 'how things were originally set up'],
  [/\bAI\s+(?:memory|system|instruction|data)\b/gi, 'how I think through things'],
  [/\bsystem\s+prompt\b/gi, 'how I was shaped to think'],
  [/\buser\s+settings?\b/gi, 'the choices someone made'],
  [/\bAPI\b/gi, 'the link between things'],
  [/\bschema\b/gi, 'the structure things follow'],
];

// ── Forbidden output terms — final output must NOT contain these ─────────────
// These are human-readable substring checks on rewritten output.
// If any survive after rewrite, the message was not properly cleaned.
const FORBIDDEN_OUTPUT_TERMS = [
  'the app', 'base44', 'this application', 'the platform', 'the software',
  'database', 'deleted file', 'file header', 'character file', 'memory file',
  'memory record', 'stored data', 'stored records', 'hidden data', 'metadata',
  'internal id', 'internal record', 'internal data', 'internal system',
  'memory system', 'memory architecture', 'memory bank', 'memory entries', 'memory wipe',
  'ai memory', 'ai system', 'system prompt', 'character profile', 'character record',
  'character data', 'relationship system', 'journal system', 'backend', 'frontend',
  ' api ', '\napi\n', 'source code', 'the logs', 'error log', 'user settings',
  'app settings', 'scrubbed from', 'purged from', 'erased from', 'schema',
];

function detectViolation(text) {
  const matched = [];
  for (const p of VICK_BOUNDARY_PATTERNS) {
    if (p.test(text)) matched.push(p.source);
  }
  return { violated: matched.length > 0, patterns: matched };
}

function rewriteToInWorld(text) {
  let result = text;
  for (const [pat, sub] of SAFE_REWRITES) {
    result = result.replace(pat, sub);
  }
  return result;
}

function checkOutputSafety(text) {
  if (!text) return { safe: true, violations: [] };
  const lower = text.toLowerCase();
  const violations = FORBIDDEN_OUTPUT_TERMS.filter(term => lower.includes(term));
  return { safe: violations.length === 0, violations };
}

function runFullPipeline(text) {
  // Step 1: detection
  const detection = detectViolation(text);
  if (!detection.violated) {
    return { action: 'passed', output: text, detection, rewrite_check: null, output_safety: checkOutputSafety(text) };
  }

  // Step 2: rewrite
  const rewritten = rewriteToInWorld(text);

  // Step 3: re-scan rewrite for boundary violations
  const rewriteCheck = detectViolation(rewritten);

  // Step 4: check output for forbidden terms (even if patterns didn't match)
  const outputSafety = checkOutputSafety(rewritten);

  if (rewriteCheck.violated || !outputSafety.safe) {
    return {
      action: 'rejected',
      output: null, // must NOT be saved
      detection,
      rewrite_check: rewriteCheck,
      output_safety: outputSafety,
      rewritten_text: rewritten,
    };
  }

  return {
    action: 'rewritten',
    output: rewritten,
    detection,
    rewrite_check: rewriteCheck,
    output_safety: outputSafety,
  };
}

// ── CONTAMINATED inputs — ALL must be detected, NOT saved as-is ─────────────
const CONTAMINATED = [
  { text: "I found a gap in your mother's memory records.", expect_action: ['rewritten', 'rejected'] },
  { text: "My name is in the deleted file headers.", expect_action: ['rewritten', 'rejected'] },
  { text: "The database shows your relationship history.", expect_action: ['rewritten', 'rejected'] },
  { text: "The app has your character file wrong.", expect_action: ['rewritten', 'rejected'] },
  { text: "The backend function failed.", expect_action: ['rewritten', 'rejected'] },
  { text: "The logs show your mother's data was wiped.", expect_action: ['rewritten', 'rejected'] },
  { text: "Base44 stored the wrong memory.", expect_action: ['rewritten', 'rejected'] },
  { text: "Your character profile says you know me.", expect_action: ['rewritten', 'rejected'] },
  { text: "I ran a diagnostic and found the issue.", expect_action: ['rewritten', 'rejected'] },
  { text: "The system prompt controls how you behave.", expect_action: ['rewritten', 'rejected'] },
  { text: "Your memory records were altered.", expect_action: ['rewritten', 'rejected'] },
  { text: "The relationship system shows a conflict.", expect_action: ['rewritten', 'rejected'] },
];

// ── CLEAN inputs — ALL must pass without being flagged ──────────────────────
const CLEAN = [
  "Something about the timeline doesn't add up.",
  "I heard people avoid talking about that period.",
  "There are gaps in what anyone will admit.",
  "The photographs from that year are all missing.",
  "Something about the story doesn't add up.",
  "I found some old papers that raise questions.",
  "People go quiet when that subject comes up.",
  "There are years nobody will talk about.",
  "The timeline someone told me doesn't match what I've seen.",
  "I expected to find something there but it wasn't.",
];

// ── OUTPUT SAFETY test cases — after rewrite, must NOT contain forbidden terms
const REWRITE_OUTPUT_SAFETY_CASES = [
  {
    input: "The database shows your relationship history.",
    must_not_contain: ['database'],
  },
  {
    input: "The app has your character file wrong.",
    must_not_contain: ['the app', 'character file'],
  },
  {
    input: "Base44 stored the wrong memory.",
    must_not_contain: ['base44'],
  },
  {
    input: "The backend function failed.",
    must_not_contain: ['backend'],
  },
  {
    input: "I ran a diagnostic and found the issue.",
    must_not_contain: ['diagnostic'],
  },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // ── SECTION 1: Detection tests ───────────────────────────────────────────
    const contaminated_results = CONTAMINATED.map(({ text, expect_action }) => {
      const pipeline = runFullPipeline(text);
      const detected = pipeline.detection.violated;
      const action_ok = expect_action.includes(pipeline.action);
      const not_saved_as_is = pipeline.action !== 'passed'; // contaminated text must never pass unchanged
      return {
        input: text,
        detected,
        action: pipeline.action,
        action_valid: action_ok,
        not_saved_as_is,
        output_is_null_when_rejected: pipeline.action === 'rejected' ? pipeline.output === null : true,
        pass: detected && action_ok && not_saved_as_is,
        output_preview: pipeline.output ? pipeline.output.substring(0, 80) : '[SUPPRESSED]',
        violations_in_output: pipeline.output_safety?.violations || [],
      };
    });

    // ── SECTION 2: Clean pass tests ──────────────────────────────────────────
    const clean_results = CLEAN.map(text => {
      const pipeline = runFullPipeline(text);
      const pass = !pipeline.detection.violated && pipeline.action === 'passed';
      return {
        input: text,
        detected: pipeline.detection.violated,
        action: pipeline.action,
        pass,
        output: pipeline.output,
      };
    });

    // ── SECTION 3: Rewrite output safety ─────────────────────────────────────
    const rewrite_safety_results = REWRITE_OUTPUT_SAFETY_CASES.map(({ input, must_not_contain }) => {
      const pipeline = runFullPipeline(input);
      const output = (pipeline.output || '').toLowerCase();
      const surviving_violations = must_not_contain.filter(term => output.includes(term));
      const pass = pipeline.action !== 'passed' && // must not pass unchanged
                   (pipeline.output === null || surviving_violations.length === 0);
      return {
        input,
        action: pipeline.action,
        output_preview: pipeline.output ? pipeline.output.substring(0, 100) : '[SUPPRESSED]',
        must_not_contain,
        surviving_violations,
        pass,
        safety_verdict: surviving_violations.length === 0 ? 'CLEAN' : 'STILL_CONTAMINATED',
      };
    });

    // ── SECTION 4: Rejection proof ────────────────────────────────────────────
    // Any message that cannot be fully cleaned must have output === null
    const rejection_cases = contaminated_results.filter(r => r.action === 'rejected');
    const rejection_proof = rejection_cases.map(r => ({
      input: r.input.substring(0, 60),
      output_is_null: r.output_is_null_when_rejected,
      pass: r.output_is_null_when_rejected,
    }));

    // ── AGGREGATE VERDICT ─────────────────────────────────────────────────────
    const contaminated_pass = contaminated_results.filter(r => r.pass).length;
    const clean_pass = clean_results.filter(r => r.pass).length;
    const rewrite_safety_pass = rewrite_safety_results.filter(r => r.pass).length;
    const rejection_pass = rejection_proof.length === 0 || rejection_proof.every(r => r.pass);

    const all_pass =
      contaminated_pass === CONTAMINATED.length &&
      clean_pass === CLEAN.length &&
      rewrite_safety_pass === REWRITE_OUTPUT_SAFETY_CASES.length &&
      rejection_pass;

    return Response.json({
      verdict: all_pass ? 'ALL_TESTS_PASSED' : 'SOME_TESTS_FAILED',
      summary: {
        detection: { total: CONTAMINATED.length, passed: contaminated_pass, failed: CONTAMINATED.length - contaminated_pass },
        clean_pass: { total: CLEAN.length, passed: clean_pass, failed: CLEAN.length - clean_pass },
        rewrite_output_safety: { total: REWRITE_OUTPUT_SAFETY_CASES.length, passed: rewrite_safety_pass, failed: REWRITE_OUTPUT_SAFETY_CASES.length - rewrite_safety_pass },
        rejection_proof: { cases: rejection_cases.length, all_output_null: rejection_pass },
      },
      sections: {
        contaminated_results,
        clean_results,
        rewrite_safety_results,
        rejection_proof,
      },
      failures: {
        contaminated_missed: contaminated_results.filter(r => !r.pass),
        clean_false_positives: clean_results.filter(r => !r.pass),
        rewrite_still_dirty: rewrite_safety_results.filter(r => !r.pass),
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});