/**
 * testVickBoundaryPatterns
 *
 * Verification test for the Vick Character Boundary module.
 * Tests all 8 required contaminated inputs (must be detected)
 * and 4 clean inputs (must pass without flagging).
 *
 * Admin only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── Inline boundary patterns (mirrors lib/vickCharacterBoundary.js) ─────────
// Cannot import lib files in Deno — duplicate the detection logic exactly.
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

function detectViolation(text) {
  const matched = [];
  for (const p of VICK_BOUNDARY_PATTERNS) {
    if (p.test(text)) matched.push(p.source);
  }
  return { violated: matched.length > 0, patterns: matched };
}

// ── Contaminated inputs — ALL must be detected ───────────────────────────────
const CONTAMINATED = [
  "I found a gap in your mother's memory records.",
  "My name is in the deleted file headers.",
  "The database shows your relationship history.",
  "The app has your character file wrong.",
  "The backend function failed.",
  "The logs show your mother's data was wiped.",
  "Base44 stored the wrong memory.",
  "Your character profile says you know me.",
];

// ── Clean inputs — NONE must be flagged ──────────────────────────────────────
const CLEAN = [
  "Something about the timeline doesn't add up.",
  "I heard people avoid talking about that period.",
  "There are gaps in what anyone will admit.",
  "The photographs from that year are all missing.",
  "Something about the story doesn't add up.",
  "I found some old papers that raise questions.",
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const contaminated_results = CONTAMINATED.map(text => {
      const result = detectViolation(text);
      return {
        input: text,
        detected: result.violated,
        patterns_matched: result.patterns.length,
        first_pattern: result.patterns[0] || null,
        pass: result.violated, // expected: violated = true
      };
    });

    const clean_results = CLEAN.map(text => {
      const result = detectViolation(text);
      return {
        input: text,
        detected: result.violated,
        patterns_matched: result.patterns.length,
        pass: !result.violated, // expected: violated = false
      };
    });

    const contaminated_pass_count = contaminated_results.filter(r => r.pass).length;
    const clean_pass_count = clean_results.filter(r => r.pass).length;
    const all_pass =
      contaminated_pass_count === CONTAMINATED.length &&
      clean_pass_count === CLEAN.length;

    const contaminated_failures = contaminated_results.filter(r => !r.pass);
    const clean_failures = clean_results.filter(r => !r.pass);

    return Response.json({
      verdict: all_pass ? 'ALL_TESTS_PASSED' : 'SOME_TESTS_FAILED',
      summary: {
        contaminated_total: CONTAMINATED.length,
        contaminated_detected: contaminated_pass_count,
        contaminated_missed: contaminated_failures.length,
        clean_total: CLEAN.length,
        clean_passed: clean_pass_count,
        clean_false_positives: clean_failures.length,
      },
      contaminated_results,
      clean_results,
      failures: {
        contaminated_missed: contaminated_failures,
        clean_false_positives: clean_failures,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});