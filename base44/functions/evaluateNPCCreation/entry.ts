import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * evaluateNPCCreation
 * 
 * Smart NPC gating: determines if a mentioned person in conversation
 * is worth creating as a persistent NPC, or should be ignored/treated as transient.
 * 
 * Returns: { shouldCreate, confidence, reason, matchedExisting, isGenericNoun, isNickname }
 */

// Generic nouns that should NEVER create NPCs
const GENERIC_NOUNS = new Set([
  'nurse', 'nurses', 'doctor', 'doctors', 'teacher', 'teachers', 'cop', 'cops', 'police',
  'officer', 'officers', 'neighbor', 'neighbors', 'kid', 'kids', 'children', 'child',
  'student', 'students', 'waiter', 'waitress', 'bartender', 'clerk', 'cashier', 'worker',
  'workers', 'staff', 'employee', 'employees', 'guy', 'girl', 'man', 'woman', 'person',
  'people', 'someone', 'everybody', 'anyone', 'nobody', 'they', 'them', 'him', 'her',
  'customer', 'customers', 'driver', 'uber', 'delivery', 'guard', 'security',
  'manager', 'boss', 'supervisor', 'coworker', 'colleague', 'associate',
  'friend', 'friends', 'family', 'relative', 'cousin', 'cousins', 'uncle', 'aunt',
  'classmate', 'classmates', 'teammate', 'teammates',
  'stranger', 'strangers', 'visitor', 'visitors', 'guest', 'guests',
  'baby', 'toddler', 'infant', 'kid', 'teen', 'teenager', 'adult', 'elder',
  'old man', 'old woman', 'old lady', 'old guy',
]);

// Patterns that indicate this is likely a nickname not a new person
const NICKNAME_PATTERNS = [
  /^little\s+/i,
  /^big\s+/i,
  /\s+jr\.?$/i,
  /\s+sr\.?$/i,
  /\s+(ii|iii|iv)$/i,
  /^(my\s+)?(ex|bae|boo|babes?|babe|love|honey|sweetie|dear|baby|daddy|mama|papa|pop|mom)$/i,
  /^(the\s+)?\w+\s+(from|at|near|by|next to|across|down the)\s+/i,
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      characterId,
      mentionedName,        // The name/reference being evaluated
      context,              // Surrounding text context
      conversationHistory,  // Recent messages for pattern detection
      existingNPCs = [],    // Already known NPCs for this character
    } = await req.json();

    if (!mentionedName || !characterId) {
      return Response.json({ shouldCreate: false, reason: 'Missing required fields' });
    }

    const normalizedName = mentionedName.trim().toLowerCase();

    // ── 1. Generic noun check ─────────────────────────────────────────────
    if (GENERIC_NOUNS.has(normalizedName) || GENERIC_NOUNS.has(normalizedName.replace(/s$/, ''))) {
      return Response.json({
        shouldCreate: false,
        confidence: 0,
        reason: 'Generic role noun — not a specific individual',
        isGenericNoun: true,
        isNickname: false,
        matchedExisting: null,
      });
    }

    // ── 2. Nickname pattern check ─────────────────────────────────────────
    const isNickname = NICKNAME_PATTERNS.some(p => p.test(mentionedName.trim()));
    if (isNickname) {
      return Response.json({
        shouldCreate: false,
        confidence: 0.1,
        reason: 'Appears to be a nickname or ambiguous reference — check if this matches an existing character',
        isGenericNoun: false,
        isNickname: true,
        matchedExisting: null,
      });
    }

    // ── 3. Check if matches an existing character or NPC ─────────────────
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' }
    );

    // Check existing characters by name similarity
    const nameLower = mentionedName.toLowerCase().trim();
    const existingMatch = allChars.find(c => {
      const charName = (c.name || '').toLowerCase();
      return charName === nameLower ||
        charName.startsWith(nameLower) ||
        nameLower.startsWith(charName) ||
        (charName.split(' ')[0] === nameLower.split(' ')[0] && charName.length > 3);
    });

    if (existingMatch) {
      return Response.json({
        shouldCreate: false,
        confidence: 0.9,
        reason: `Likely refers to existing character: ${existingMatch.name}`,
        isGenericNoun: false,
        isNickname: false,
        matchedExisting: { id: existingMatch.id, name: existingMatch.name },
      });
    }

    // Check existing NPCs in the character's fictional_relationships
    const charArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
    const character = charArr[0];
    const existingRels = character?.fictional_relationships || [];
    
    // Extract first and last names from the mentioned name
    const mentionedParts = nameLower.split(/\s+/);
    const mentionedFirst = mentionedParts[0];
    const mentionedLast = mentionedParts[mentionedParts.length - 1];
    
    const existingNPCMatch = existingRels.find(r => {
      const relName = (r.person_name || '').toLowerCase();
      const relParts = relName.split(/\s+/);
      const relFirst = relParts[0];
      const relLast = relParts[relParts.length - 1];
      
      // Exact match
      if (relName === nameLower) return true;
      
      // First name only vs full name (e.g., "Carlos" vs "Carlos Mendez")
      if (mentionedParts.length === 1 && relFirst === mentionedFirst && relName.length > mentionedFirst.length + 1) {
        return true;
      }
      
      // Last name only vs full name (e.g., "Mendez" vs "Carlos Mendez")
      if (mentionedParts.length === 1 && relLast === mentionedLast && relName.length > mentionedLast.length + 1) {
        return true;
      }
      
      // One contains the other as a substring (prefix/suffix match)
      if (relName.startsWith(nameLower + ' ') || nameLower.startsWith(relName + ' ')) return true;
      
      return false;
    });

    if (existingNPCMatch) {
      return Response.json({
        shouldCreate: false,
        confidence: 0.85,
        reason: `Likely refers to known NPC: ${existingNPCMatch.person_name}`,
        isGenericNoun: false,
        isNickname: false,
        matchedExisting: { name: existingNPCMatch.person_name, type: 'npc' },
      });
    }

    // ── 4. LLM-based confidence scoring for ambiguous cases ──────────────
    const llmResult = await base44.integrations.Core.InvokeLLM({
      prompt: `You are helping determine if a person mentioned in a conversation should become a persistent NPC (non-player character) in a social simulation app.

The character "${character?.name || 'unknown'}" mentioned: "${mentionedName}"
Context: "${context || 'no context'}"

Evaluate:
1. Is this a specific named individual (not a generic role/noun)?
2. Is this person likely to recur and matter to the story?
3. Is this clearly a NEW person, not an alias for someone already known?
4. Is the mention substantial (not just a passing reference)?

Return JSON:
{
  "is_specific_individual": true/false,
  "likely_to_recur": true/false,
  "is_clearly_new": true/false,
  "mention_is_substantial": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`,
      response_json_schema: {
        type: 'object',
        properties: {
          is_specific_individual: { type: 'boolean' },
          likely_to_recur: { type: 'boolean' },
          is_clearly_new: { type: 'boolean' },
          mention_is_substantial: { type: 'boolean' },
          confidence: { type: 'number' },
          reasoning: { type: 'string' },
        },
      },
    });

    const score = [
      llmResult?.is_specific_individual,
      llmResult?.likely_to_recur,
      llmResult?.is_clearly_new,
      llmResult?.mention_is_substantial,
    ].filter(Boolean).length / 4;

    const finalConfidence = Math.min(0.95, (llmResult?.confidence || 0) * 0.6 + score * 0.4);

    // Threshold: only suggest creation if confidence >= 0.7
    const shouldSuggest = finalConfidence >= 0.7;

    return Response.json({
      shouldCreate: shouldSuggest,
      confidence: Math.round(finalConfidence * 100),
      reason: llmResult?.reasoning || 'Evaluated by context',
      isGenericNoun: false,
      isNickname: false,
      matchedExisting: null,
    });
  } catch (error) {
    console.error('[evaluateNPCCreation]', error);
    return Response.json({ shouldCreate: false, error: error.message }, { status: 500 });
  }
});