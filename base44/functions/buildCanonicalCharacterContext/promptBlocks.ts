/**
 * PROMPT BLOCKS — family truth and family terms.
 *
 * These two blocks were part of entry.ts. They are pure functions of the character
 * record (no entity reads, no other helpers), so they live here and are imported back.
 * Moving them keeps the canonical prompt file editable as the prompt grows.
 */

// ── INTERNAL NPC FAMILY TRUTH BLOCK ─────────────────────────────────────────
// NPC family members stored on the character record are canonical hard facts —
// NOT memories to be retrieved, NOT deducible information.
// If an age field exists, the character KNOWS their family member's age.
// DOB is NOT required. Age alone is sufficient.
export function buildInternalFamilyTruth(character) {
  const members = character.family_members || [];
  if (members.length === 0) return '';
  const lines = members
    .filter(m => m.age != null || m.name)
    .map(m => {
      let line = `- ${m.name || 'unnamed'} (${m.relationship_type || 'family member'})`;
      if (m.age != null) line += `: currently ${m.age} years old`;
      if (m.isNPC === false || m.is_user_relative) line += ' — lives in your household';
      return line;
    });
  if (lines.length === 0) return '';
  return `\n════════════════════════════════════\nINTERNAL FAMILY HARD FACTS — ABSOLUTE TRUTH\nThese facts are embedded in your own family records. You KNOW this information without being told.\nDo NOT estimate, guess, or act uncertain about these facts.\n════════════════════════════════════\n${lines.join('\n')}\nCRITICAL: These are FACTS you already know. Never say "I'm not sure how old they are" or invent ages that contradict this list.\n════════════════════════════════════\n`;
}

export function buildFamilySection(character) {
  const members = character.family_members || [];
  const familialTermMap = {
    mother: "Mom", mom: "Mom", "birth mother": "Mom",
    father: "Dad", dad: "Dad", "birth father": "Dad",
    grandmother: "Grandma", grandma: "Grandma",
    "paternal grandmother": "Grandma", "maternal grandmother": "Grandma",
    grandfather: "Grandpa", grandpa: "Grandpa",
    "paternal grandfather": "Grandpa", "maternal grandfather": "Grandpa",
    "older sister": "my older sister", sister: "my sister", "younger sister": "my younger sister",
    "older brother": "my older brother", brother: "my brother", "younger brother": "my younger brother",
    aunt: "my aunt", uncle: "my uncle", cousin: "my cousin",
    stepmother: "my stepmom", stepfather: "my stepdad",
    "half sister": "my half-sister", "half brother": "my half-brother",
  };
  if (members.length > 0) {
    const lines = members.map(m => {
      const term = familialTermMap[m.relationship_type?.toLowerCase()] || `my ${m.relationship_type}`;
      return `- ${m.name} — your ${m.relationship_type}. When talking about them, call them "${term}" (e.g. "Mom told me..." or "I talked to my sister Vanessa"). Use their actual name only for context.`;
    }).join('\n');
    return `\nYOUR FAMILY MEMBERS (known relationships):\n${lines}\nIMPORTANT: Always use familiar terms (Mom, Dad, Grandma, my sister, etc.) in natural conversation.\nNOTE: Additional siblings or children may be listed in the AUTHORITATIVE FAMILY KNOWLEDGE block below — always consult that block before claiming you have no family.\n`;
  }
  // CRITICAL: Do NOT say "you are alone" or "you have no family" here.
  // The resolveCharacterFamilyGraph function derives siblings from shared parents and
  // children from reverse parent lookup. Family may exist even when family_members[] is empty.
  // The AUTHORITATIVE FAMILY KNOWLEDGE block (injected separately) is the final word.
  return '';
}