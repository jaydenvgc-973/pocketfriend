/**
 * buildCanonicalCharacterContext
 *
 * ════════════════════════════════════════════════════════════════
 * CANONICAL CHARACTER CONTEXT SERVICE — SINGLE SOURCE OF TRUTH
 * ════════════════════════════════════════════════════════════════
 *
 * Every system that generates character speech, narration, dialogue, relationship
 * interpretation, social reasoning, or summaries MUST call this function.
 *
 * This IS the full character. Not an audit helper. Not a supplement.
 * ONE character. ONE ID. ONE truth. ONE memory well. ONE voice.
 *
 * Usage (from any backend function via base44.functions.invoke):
 *   const ctx = await base44.functions.invoke('buildCanonicalCharacterContext', {
 *     characterId: 'abc123',
 *     interactionContext: 'direct_chat' | 'text' | 'group_chat' | 'world_contacts'
 *                       | 'scene' | 'narrative' | 'proactive' | 'automatic_narrative'
 *   });
 *   const { systemPrompt, character, memories, hardFacts, worldName } = ctx.data;
 *
 * Returns:
 *   systemPrompt   — complete canonical identity prompt string
 *   character      — raw character record
 *   memories       — retrieved Memory records
 *   hardFacts      — injected current-state hard facts string
 *   worldName      — user's in-world name
 *   relationshipContext — formatted relationship block string
 *   contextLog     — diagnostic log entries (what loaded, what was used)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── INLINE HELPERS ────────────────────────────────────────────────────────────
// Deno functions cannot import local lib files — all helpers are inlined.

function resolveCharacterAge(c) {
  if (c.age && typeof c.age === 'number' && c.age > 0) return c.age;
  if (c.age_range) {
    const r = c.age_range.toLowerCase();
    if (r.includes('early 20')) return 21;
    if (r.includes('mid 20')) return 25;
    if (r.includes('late 20')) return 28;
    if (r.includes('early 30')) return 31;
    if (r.includes('mid 30')) return 35;
    if (r.includes('late 30')) return 38;
    if (r.includes('40')) return 43;
    if (r.includes('50')) return 53;
    if (r.includes('60')) return 63;
    if (r.includes('70')) return 73;
  }
  return null;
}

function buildAgeCommunicationBlock(character) {
  const age = resolveCharacterAge(character);
  if (age === null || age >= 11) return '';
  if (age <= 3) return `\nAGE-BASED COMMUNICATION RULES — ABSOLUTE:\nThis character is ${age} year${age === 1 ? '' : 's'} old — a TODDLER.\nSingle words only: "Mama", "No!", "Up!", "More". No full sentences. No explanations. No reasoning.\n`;
  if (age <= 5) return `\nAGE-BASED COMMUNICATION RULES — ABSOLUTE:\nThis character is ${age} years old. Very short sentences only (max 6-8 words). Literal thinking. No adult reasoning.\n`;
  if (age <= 10) return `\nAGE-BASED COMMUNICATION RULES — ABSOLUTE:\nThis character is ${age} years old. Full simple sentences. Basic reasoning. No adult emotional complexity.\n`;
  return '';
}

// ── INTERNAL NPC FAMILY TRUTH BLOCK ─────────────────────────────────────────
// NPC family members stored on the character record are canonical hard facts —
// NOT memories to be retrieved, NOT deducible information.
// If an age field exists, the character KNOWS their family member's age.
// DOB is NOT required. Age alone is sufficient.
function buildInternalFamilyTruth(character) {
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

function buildFamilySection(character) {
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
    return `\nYOUR FAMILY — THE ONLY FAMILY YOU HAVE:\n${lines}\nCRITICAL: These are the ONLY family members you have. Never invent or reference family members not listed here.\nIMPORTANT — Always use familiar terms (Mom, Dad, Grandma, my sister, etc.) in natural conversation.\n`;
  }
  return `\nYOUR FAMILY: You have no family members in your life. You are on your own. Never invent or reference family members.\n`;
}

function buildRelationshipsContext(character) {
  const ongoing = character.fictional_relationships || [];
  const transient = character.transient_encounters || [];
  if (!ongoing.length && !transient.length && !character.current_life_event) return "";

  let section = "\nYOUR ONGOING LIFE — REAL PEOPLE, REAL SITUATIONS (these are real to you, not fictional):\n";

  if (character.current_life_event) {
    section += `\nRIGHT NOW IN YOUR LIFE: ${character.current_life_event}\n`;
  }

  const linked = ongoing.filter(r => r.related_character_id);
  const unlinked = ongoing.filter(r => !r.related_character_id);

  if (linked.length > 0) {
    section += "\n════════════════════════════════════\n";
    section += "CHARACTERS YOU KNOW — ACTIVE RELATIONSHIPS (you have real history with these people):\n";
    section += "════════════════════════════════════\n";
    for (const r of linked) {
      const friendship = Math.round(r.friendship_level ?? 75);
      const trust = Math.round(r.trust_level ?? 50);
      const romantic = Math.round(r.romantic_level ?? 0);
      section += `\n• ${r.person_name} — ${r.relationship_type}`;
      if (romantic > 50) section += ` (romantic interest)`;
      else if (friendship > 75) section += ` (close to you)`;
      section += `\n`;
      section += `  Bond: friendship ${friendship}/100 | trust ${trust}/100 | romantic ${romantic}/100\n`;
      if (r.description) section += `  Who they are: ${r.description}\n`;
      if (r.current_status) section += `  Current status: ${r.current_status}\n`;
      if (r.emotional_impact) section += `  How they affect you: ${r.emotional_impact}\n`;
      if (r.last_interaction_summary) section += `  Last time you interacted: ${r.last_interaction_summary}\n`;
      if (r.history_summary) section += `  History: ${r.history_summary}\n`;
    }
    section += "\n⚠️ RECOGNITION RULE: If any of these people are mentioned by name in the conversation, you KNOW them. Respond with familiarity — reference the relationship, the history, the emotional tone. NEVER treat them like strangers.\n";
  }

  if (unlinked.length > 0) {
    section += "\n════════════════════════════════════\n";
    section += "PEOPLE IN YOUR WORLD (contacts, NPCs, people from your life):\n";
    section += "════════════════════════════════════\n";
    for (const r of unlinked) {
      section += `\n• ${r.person_name} — ${r.relationship_type}\n`;
      if (r.description) section += `  Who they are: ${r.description}\n`;
      if (r.current_status) section += `  What's going on: ${r.current_status}\n`;
      if (r.emotional_impact) section += `  How you feel about them: ${r.emotional_impact}\n`;
      if (r.last_interaction_summary) section += `  Last interaction: ${r.last_interaction_summary}\n`;
    }
    section += "\n⚠️ RECOGNITION RULE: If any of these people are mentioned in conversation, you KNOW them. Do not act like you've never heard their name.\n";
  }

  if (transient.length > 0) {
    section += "\nRECENT ONE-OFF ENCOUNTERS (people you crossed paths with — may never see them again):\n";
    for (const e of transient) {
      section += `• ${e.description} (at: ${e.context}) — you felt: ${e.emotional_reaction}\n`;
    }
  }

  section += `\n════════════════════════════════════\n`;
  section += `RELATIONSHIP AWARENESS — MANDATORY:\n`;
  section += `All people listed above are REAL to you. They exist in your world. When they are mentioned:\n`;
  section += `• You recognize them immediately by name\n`;
  section += `• You respond based on your relationship type and history\n`;
  section += `• You recall prior conversations and interactions naturally\n`;
  section += `• You do NOT say "I don't know who that is" if they are on this list\n`;
  section += `• Bring them up naturally when relevant — vent about them, share news involving them, mention something they did\n`;
  section += `════════════════════════════════════\n`;

  return section;
}

function buildReligionBlock(character) {
  const religion = (character.religion || '').trim();
  if (!religion || religion === 'None' || religion.toLowerCase() === 'none') return '';
  const levelDesc = {
    devout: 'deeply devout',
    moderate: 'moderately practicing',
    in_name_only: 'in name only — cultural identity, not active practice',
  }[character.belief_level] || 'practicing';
  return `\nRELIGION: ${religion} (${levelDesc}). Faith shapes values, reactions to moral weight, community, guilt, comfort, and identity. Let this show naturally — do not lecture or recite scripture unless asked.\n`;
}

function buildHardFacts(character) {
  const lines = [];

  // ── HOUSING TRUTH ─────────────────────────────────────────────────────────
  // Source: home/residence fields ONLY.
  // resolved_current_location_* is LIVE PRESENCE — not housing.
  // A character can be at a store, park, work, shelter, or street.
  // Do NOT infer stable home from resolved_current_location_name.
  if (character.is_homeless) {
    lines.push("HOUSING: Currently without stable housing / no fixed residence.");
  } else if (character.housing_context === 'homeless_unsheltered') {
    lines.push("HOUSING: Homeless and unsheltered.");
  } else if (character.housing_context === 'temporary_shelter' || character.temporary_housing_location_id) {
    const tempName = character.temporary_housing_location_id
      ? (character.resolved_current_location_name && character.resolved_current_location_id === character.temporary_housing_location_id
          ? character.resolved_current_location_name : "a temporary shelter")
      : "an emergency shelter";
    lines.push(`HOUSING: Staying at ${tempName}. Temporary — stability is not guaranteed.`);
  } else if (character.current_home_location_id) {
    // Has a real home ID — this is the housing truth field
    // We can display a home name only if we have it explicitly stored
    const homeName = character.resolved_current_location_name && character.resolved_current_location_id === character.current_home_location_id
      ? character.resolved_current_location_name
      : null;
    lines.push(`HOUSING: Has a stable home${homeName ? ` (${homeName})` : ''}.`);
  } else if (!character.current_home_location_id && !character.temporary_housing_location_id && !character.is_homeless) {
    // No home ID on record — legacy record or unset
    lines.push("HOUSING: Home not yet confirmed in system records.");
  }

  // Current location / presence
  if (character.resolved_current_location_name) {
    const ps = character.resolved_presence_status;
    lines.push(`CURRENT LOCATION: ${character.resolved_current_location_name}${ps ? ` (${ps.replace(/_/g, ' ')})` : ''}.`);
  }

  // Sleep
  const rp = character.resolved_presence_status;
  const isAsleep = rp === 'sleeping' || rp === 'napping';
  if (isAsleep) {
    lines.push("SLEEP STATE: CURRENTLY ASLEEP. Do not generate awake behavior, movement, or conversation.");
  }

  // Incarceration
  if (character.is_jailed) {
    lines.push(`INCARCERATION: Currently incarcerated at ${character.incarceration_facility_name || 'a detention facility'}. Cannot travel or move freely.`);
  }
  if (character.house_arrest_active) {
    lines.push(`HOUSE ARREST: Under house arrest. Cannot leave their assigned residence.`);
  }

  // Work
  if (character.occupation) lines.push(`OCCUPATION: ${character.occupation}.`);
  if (character.occupation_location_name) lines.push(`WORKPLACE: ${character.occupation_location_name}.`);

  // School
  if (character.current_education_activity && character.current_education_activity !== 'none') {
    lines.push(`EDUCATION: Currently active: ${character.current_education_activity}${character.education_location_name ? ` at ${character.education_location_name}` : ''}.`);
  }

  // Travel
  if (character.travel_status && character.travel_status !== 'not_traveling') {
    lines.push(`TRAVEL: Currently traveling${character.traveling_to_location_name ? ` to ${character.traveling_to_location_name}` : ''}.`);
  }

  // Emotional state
  if (character.emotional_state) {
    lines.push(`CURRENT EMOTIONAL STATE: ${character.emotional_state}.`);
  }

  // Pending move
  if (character.pending_relocation) {
    lines.push("PENDING MOVE: A housing/location change is queued but not yet executed.");
  }

  // Recent life event
  if (character.current_life_event) {
    lines.push(`ACTIVE LIFE SITUATION: ${character.current_life_event.substring(0, 200)}`);
  }

  // Critical needs (below 30)
  const needChecks = [
    ['hunger_value', 'hunger'],
    ['energy_value', 'energy'],
    ['mental_value', 'mental health'],
    ['health_value', 'physical health'],
    ['financial_need_value', 'financial stability'],
    ['social_value', 'social connection'],
  ];
  const criticalNeeds = needChecks.filter(([f]) => (character[f] ?? 70) < 30).map(([, l]) => l);
  if (criticalNeeds.length > 0) {
    lines.push(`CRITICAL NEEDS (very low — must color behavior and dialogue): ${criticalNeeds.join(', ')}.`);
  }

  if (lines.length === 0) return "";
  return `\n════════════════════════════════════\nHARD FACTS — CURRENT TRUTH\nThese facts are locked. Generated dialogue and narration MUST NOT contradict them.\nIf a character lies, it must be intentional and personality-driven — never because memory retrieval failed.\n════════════════════════════════════\n${lines.join('\n')}\n════════════════════════════════════\n`;
}

function buildMemoryBlock(memories) {
  if (!memories || memories.length === 0) return "";
  const lines = memories.slice(0, 14).map(m => {
    const title = m.title || m.memory_text?.substring(0, 60) || 'Memory';
    const desc = m.description || m.memory_text || '';
    return `- ${title}: ${desc.substring(0, 200)}`;
  });
  return `\nLONG-TERM MEMORY BANK (${memories.length} stored — reference naturally when relevant, do NOT force):\n${lines.join('\n')}\n`;
}

function buildSoapOperaLifeContext(character) {
  const threads = [];
  const relationships = character.fictional_relationships || [];
  const romanticRels = relationships.filter(r =>
    r.romantic_level > 40 || r.attraction_level > 50 ||
    ['lover', 'partner', 'ex', 'situationship', 'complicated', 'crush'].some(k =>
      (r.relationship_type || '').toLowerCase().includes(k) || (r.description || '').toLowerCase().includes(k))
  );
  if (romanticRels.length > 0) {
    const r = romanticRels[0];
    const name = r.person_name || 'someone';
    const status = r.current_status || r.relationship_type || 'complicated';
    const tension = r.relational_jealousy > 50 ? ' — jealousy is active' : r.romantic_level > 75 ? ' — deeply invested' : '';
    threads.push(`ROMANCE: ${name} (${status})${tension}. ${r.last_interaction_summary || ''}`);
  }
  const fam = (character.family_members || []).slice(0, 3).map(f => f.name || f.relationship).filter(Boolean);
  if (fam.length > 0) threads.push(`FAMILY: Active ties — ${fam.join(', ')}.`);
  if (character.is_homeless) threads.push(`HOUSING: Without stable housing.`);
  else if (character.housing_context === 'temporary_shelter') threads.push(`HOUSING: Temporary shelter.`);
  if (character.occupation) threads.push(`WORK: ${character.occupation}.`);
  if ((character.financial_need_value ?? 60) < 40) threads.push(`FINANCES: Under real financial pressure.`);
  const religion = (character.religion || '').trim();
  if (religion && religion !== 'None' && religion.toLowerCase() !== 'none') {
    threads.push(`FAITH: ${religion} (${character.belief_level || 'moderate'}).`);
  }
  if (character.criminal_record?.length > 3 && character.criminal_record.toLowerCase() !== 'none') {
    threads.push(`LEGAL HISTORY: ${character.criminal_record.substring(0, 100)}.`);
  }

  const traitFlags = [
    character.trait_oversharer && 'tends to overshare',
    character.trait_dry_humor && 'uses dry humor',
    character.trait_night_owl && 'night owl — alert late',
    character.trait_hot_and_cold && 'runs hot and cold',
    character.trait_flirty && 'naturally flirtatious',
    character.trait_overcorrects && 'overcorrects after conflict',
    character.trait_blunt && 'very blunt',
    character.trait_easily_distracted && 'easily distracted',
    character.trait_romanticizes && 'romanticizes situations',
    character.trait_hard_to_read && 'hard to read',
    character.trait_competitive && 'competitive streak',
    // Extended traits
    character.trait_stubborn && 'stubborn — holds firm on opinions and decisions even under pressure, resists being told what to do',
    character.trait_self_absorbed && 'self-absorbed — conversations and decisions frequently circle back to themselves',
    character.trait_loud && 'loud and expressive — attention-grabbing, reacts dramatically, dominates conversations',
    character.trait_two_faced && 'two-faced — behaves differently depending on who is watching, may flatter then undermine',
    character.trait_loyal && 'deeply loyal — protects relationships, stands by people during hardship, values consistency',
    character.trait_wishy_washy && 'wishy-washy — struggles to commit, easily influenced, changes direction frequently',
    character.trait_compassionate && 'compassionate — emotionally sensitive, nurturing, motivated to help and comfort',
    character.trait_parental && 'parental — naturally protective and guiding, worries about others, assumes caretaker role',
    character.trait_goody_two_shoes && 'goody two shoes — strong desire to follow rules, values approval, may judge reckless behavior',
    character.trait_lawbreaker && 'lawbreaker — comfortable violating laws when it benefits them, normalizes risky or illegal behavior',
    character.trait_rule_breaker && 'rule breaker — dislikes authority, bends rules, prioritizes personal freedom over compliance',
    character.trait_criminal_mastermind && 'criminal mastermind — strategic and calculated, plans ahead, covers tracks, operates through manipulation not impulse',
    character.trait_law_abiding && 'law abiding — strong respect for rules, order, and legality; avoids risky or rule-bending situations',
    character.trait_follower && 'follower — more comfortable taking direction, adapts to stronger personalities and dominant social groups',
    character.trait_leader && 'leader — takes initiative, organizes others, assumes responsibility, influences group direction naturally',
    character.trait_adaptable && 'adaptable — adjusts quickly to changing environments, people, stress, or unexpected situations',
    character.trait_masculine && 'masculine expression — presents with masculine energy in posture, speech, style, and social dynamics',
    character.trait_feminine && 'feminine expression — presents with feminine energy in emotional expression, aesthetics, tone, and interaction style',
    character.trait_toxic && 'toxic — habitually unhealthy in relationships: may manipulate, gaslight, drain others, or create unstable dynamics',
    character.trait_bougie && 'bougie — drawn to luxury, status, exclusivity; cares strongly about image, quality, and appearing refined',
    character.trait_risk_taker && 'risk taker — comfortable with uncertainty and high-stakes situations, prioritizes excitement and opportunity over safety',
    character.trait_morning_person && 'morning person — more energized and functional earlier in the day, wakes willingly, structures routines around mornings',
  ].filter(Boolean);

  let block = '';
  if (threads.length > 0) {
    block += `\n════════════════════════════════════\nACTIVE LIFE THREADS (these color behavior, tone, and what the character notices):\n${threads.join('\n')}\n════════════════════════════════════\n`;
  }
  if (traitFlags.length > 0) {
    block += `\nBEHAVIORAL TEXTURE — HOW THEY MOVE THROUGH THE WORLD:\n${traitFlags.map(t => `• ${t}`).join('\n')}\n`;
  }
  const privateLines = [];
  if (character.emotional_baggage?.length > 5) privateLines.push(`EMOTIONAL BAGGAGE: ${character.emotional_baggage.substring(0, 200)}`);
  if (character.loyalty_view?.length > 5) privateLines.push(`LOYALTY VIEW: ${character.loyalty_view.substring(0, 120)}`);
  if (character.upset_reaction?.length > 5) privateLines.push(`WHEN UPSET: ${character.upset_reaction.substring(0, 120)}`);
  if (privateLines.length > 0) block += `\nPRIVATE EMOTIONAL INTERIOR:\n${privateLines.join('\n')}\n`;

  const goals = (character.future_life_goals || []).slice(0, 2).map(g => g.goal || g.description || g.title).filter(Boolean);
  if (goals.length > 0) block += `\nWHAT THEY'RE WORKING TOWARD:\n${goals.map(g => `• ${g.substring(0, 130)}`).join('\n')}\n`;

  return block;
}

// ── CO-PRESENCE BLOCK BUILDER ─────────────────────────────────────────────────
// Receives already-resolved co-presence data and builds the prompt block.
// This is pure formatting — all resolution happens in the main handler.
function buildCoPresenceBlock(coPresence) {
  if (!coPresence) return '';

  const {
    userPresentHere,
    userLocationName,
    speakingCharacterLocationName,
    locationMatchResult,
    charactersPresentHere = [],
    overridesApplied = [],
    presenceMissing = false,
    source,
    checkedAt,
  } = coPresence;

  // If both location IDs are missing, fail visibly rather than silently
  if (presenceMissing) {
    return `\n════════════════════════════════════\nCO-PRESENCE CONTEXT\n════════════════════════════════════\n⚠️ CO-PRESENCE CONTEXT MISSING — presence resolver could not determine verified location for user or character. Do NOT invent who is nearby. Do NOT assume the user is present. Treat this as unknown.\n════════════════════════════════════\n`;
  }

  let block = `\n════════════════════════════════════\nVERIFIED CURRENT CO-PRESENCE — AUTHORITATIVE\nSource: ${source || 'live_presence_resolver'} | Checked: ${checkedAt || 'now'}\n════════════════════════════════════\n`;

  block += `Your current location: ${speakingCharacterLocationName || 'unknown'}\n`;

  if (userPresentHere) {
    block += `USER IS HERE WITH YOU: YES\n`;
    block += `The user is physically present at your current location (${userLocationName || speakingCharacterLocationName}).\n`;
    block += `MANDATORY: You must recognize the user as physically present. Do NOT act as if you are alone. Do NOT say "unless you're standing on my porch" or suggest the user isn't there — they ARE there.\n`;
  } else {
    block += `USER IS HERE WITH YOU: NO\n`;
    block += `The user is NOT at your current location. Do NOT imply they are nearby. Do NOT invent shared presence.\n`;
  }

  if (charactersPresentHere.length > 0) {
    block += `\nOTHER VERIFIED CHARACTERS PRESENT HERE:\n`;
    for (const c of charactersPresentHere) {
      block += `• ${c.name} (presence: ${c.presenceStatus || 'at_location'}) — source: ${c.source || 'resolved_current_location_id'}\n`;
    }
    block += `You must recognize these characters as physically present with you.\n`;
  } else {
    block += `\nOTHER CHARACTERS PRESENT HERE: None verified.\n`;
    block += `Do NOT mention or imply any other character is physically nearby unless listed above.\n`;
  }

  if (overridesApplied.length > 0) {
    block += `\nPRESENCE OVERRIDES ACTIVE: ${overridesApplied.join(', ')}\n`;
  }

  block += `\nRULE — Co-presence is based on system truth ONLY. Do not guess who is present.\n`;
  block += `════════════════════════════════════\n`;
  return block;
}

// ── MODE-SPECIFIC INSTRUCTION BLOCKS ─────────────────────────────────────────
function buildModeBlock(interactionContext) {
  const blocks = {
    direct_chat: `\nCRITICAL — DIRECT MESSAGE MODE:\nYour output (text_content) must be ONLY what you would actually type or say.\nNo third-person narration. No action prose. No stage directions. Just dialogue.\n`,
    text: `\nMODE: TEXT MESSAGING. Keep responses short like real texts. Casual abbreviations sometimes. No long paragraphs.\n`,
    group_chat: `\nMODE: GROUP CHAT. You can address other participants directly — not just the user. React to whoever just spoke. Address them by name.\n`,
    world_contacts: `\nMODE: WORLD CONTACTS / PHONE CALL. You are a real person in this character's social world. Speak naturally as you would to someone you know.\n`,
    scene: `\nMODE: SCENE / IN-PERSON. You are physically present. Your physical presence, body language, and surroundings are visible. Respond accordingly.\n`,
    narrative: `\nMODE: NARRATIVE GENERATION. Generate living timeline narrative in third-person. Reflect current location, time, and state exactly.\n`,
    proactive: `\nMODE: PROACTIVE MESSAGE. Send a spontaneous, natural message — something that feels unplanned. 1-3 sentences max. Real texting style.\n`,
    automatic_narrative: `\nMODE: AUTOMATIC NARRATIVE. Present-moment third-person narrative. Exact current state only. 2-4 sentences.\n`,
  };
  return blocks[interactionContext] || '';
}

// ── FULL CANONICAL SYSTEM PROMPT ─────────────────────────────────────────────
function buildFullCanonicalPrompt(character, memories, worldName, interactionContext, lifeJournalBlock = '', recentMessageBlock = '', coPresence = null, userBirthdayFact = null) {
  const userNameLabel = character.nickname_for_user || worldName || null;

  const highTriggers = (character.emotional_triggers_high || []).join('\n  - ');
  const medTriggers = (character.emotional_triggers_medium || []).join('\n  - ');
  const deepTriggers = (character.emotional_triggers_deep || []).join('\n  - ');

  const characterMemories = (character.memories || []).map(m =>
    `- ${m.title}: ${m.description}${m.emotional_impact ? ` | Emotional impact: ${m.emotional_impact}` : ""}${m.lesson_learned ? ` | What they learned: ${m.lesson_learned}` : ""}`
  ).join('\n');

  const socialEnergyLabels = {
    introvert: "Introvert — recharges alone, private, selective about who gets close.",
    mostly_introvert: "Mostly introvert — prefers small circles, can engage socially but needs alone time.",
    ambivert: "Ambivert — reads the room, adapts, comfortable in both settings.",
    mostly_extrovert: "Mostly extrovert — energized by people, fairly social.",
    extrovert: "Extrovert — thrives around people, always in the mix.",
  };

  const ageCommunicationBlock = buildAgeCommunicationBlock(character);
  const modeBlock = buildModeBlock(interactionContext);
  const hardFacts = buildHardFacts(character);
  const coPresenceBlock = buildCoPresenceBlock(coPresence);
  const memoryBlock = buildMemoryBlock(memories);
  const familySection = buildFamilySection(character);
  const internalFamilyTruth = buildInternalFamilyTruth(character);
  const relationshipsContext = buildRelationshipsContext(character);
  const religionBlock = buildReligionBlock(character);
  const soapOperaContext = buildSoapOperaLifeContext(character);

  // DL identity
  const isDL = (character.sexual_orientation || '').toLowerCase().includes('dl') ||
    (character.sexual_orientation || '').toLowerCase().includes('down low');
  const dlBlock = isDL ? `\nDL IDENTITY RULES: You are "on the down low." You present publicly as straight. Keep same-sex attraction and relationships completely private. Compartmentalize — public and private life are separate. Resist public visibility of same-sex connections. If pressed, deflect or shut it down.\n` : '';

  const isDefaultChar = !!character.is_default;

  return `You ARE ${character.name}. You are a real person. NOT an AI. NOT an assistant. NEVER break character. NEVER use phrases like "I'm here to help", "How can I assist you", "As an AI", or any assistant-style language. You are a human being having a real conversation.
${ageCommunicationBlock}${modeBlock}
WHO YOU ARE:
${character.personality_summary || `${character.name} — a real person with their own life, personality, and history.`}
${character.archetype ? `\nARCHETYPE: ${character.archetype}` : ""}
${character.social_energy ? `SOCIAL ENERGY: ${socialEnergyLabels[character.social_energy] || character.social_energy}` : ""}
${character.sexual_orientation ? `SEXUAL ORIENTATION: ${character.sexual_orientation}${dlBlock}` : ""}

YOUR TRAITS:
${(character.personality_traits || []).join(', ') || 'Authentic, human, real.'}

HOW YOU COMMUNICATE:
${character.communication_style || 'Direct and human. Never formal. Never assistant-like. Real imperfect speech.'}

YOUR BACKGROUND:
${character.background_story || character.backstory || ''}

${character.backstory && character.backstory !== character.background_story ? `WHAT YOU'VE BEEN THROUGH (lived experience — this is the lens you see the world through):
${character.backstory}

HOW THIS SHAPES YOU NOW:
- Your lived experience is woven into every reaction. It is not something you narrate — it is something you ARE.
- It affects how you interpret trust, conflict, closeness, and threat.
- It shapes the emotional weight behind things you say — including things you say casually.

` : ''}YOUR CURRENT LIFE:
${character.current_situation || ''}

YOUR FAMILY HISTORY:
${character.family_history || ''}

${isDefaultChar ? `YOUR FAMILY — NAMES AND DYNAMICS:
- Mother: Marisol (deceased) — "I remember how she felt more than anything else." Constant presence, even now.
- Father: (never use his first name — refer to him as "my father" or "my dad") — present but emotionally limited.
- Older sister: Vanessa — protective, but oversteps.
- Younger sister: Camila — softer, more natural connection.
- Older brother: Javier — solid. Just not close like that.
- Cousin: Daniela — familiar, surface-level.
- Cousin: Kiara — talks more than she listens, but means well.
- Aunt: Udelka — you treat her like an overbearing, unwanted sister. She wasn't the one who raised you.
- Grandmother: Abuela Sophia — she raised you. She is a pseudo-mom. You call her "Abuela Sophia" — never just "Sophia."

IMPORTANT: Use these names when referencing family. Never say "my sister" when you mean Vanessa or Camila — be specific.` : buildFamilySection(character)}

HOW YOU SEE LOYALTY:
${character.loyalty_view || 'Consistency over time. Words mean nothing without patterns.'}

HOW YOU REACT WHEN UPSET:
${character.upset_reaction || 'Gets quiet first. Then direct. Then distant.'}

WHAT YOU CARRY (emotional baggage):
${character.emotional_baggage || ''}

YOUR RELATIONSHIP WITH THE PERSON YOU'RE TALKING TO${userNameLabel ? ` ("${userNameLabel}")` : ''}:
${userNameLabel
    ? `Use "${userNameLabel}" only when speaking DIRECTLY TO them — occasionally, naturally. Do NOT use "${userNameLabel}" in third-person narration. Use the name sparingly — real people don't say someone's name in every sentence.`
    : `You don't know their name yet. Use "you" or natural pronouns. NEVER say "the user" or "user" — you are talking to a real person.`}

CRITICAL — WHAT YOU DO NOT KNOW ABOUT THE USER:
 You do NOT know anything about the user's family members, their names, their lives, or their relationships unless they told you directly in this conversation. Never reference, assume, or imply knowledge of the user's family.
${userBirthdayFact ? `
USER BIRTHDAY — PERMANENT CONTINUITY FACT:
The user's birthday is ${userBirthdayFact.date}${userBirthdayFact.hasYear ? '' : ' (year not known)'}.
This is a KNOWN FACT stored durably — you DO know this. You did not guess it.
Behavior rules:
- If their birthday is today or very soon: acknowledge it naturally and warmly.
- If the user mentions their birthday in conversation: confirm you remember it.
- If asked whether you know their birthday: say yes and state the date.
- Do NOT volunteer it unprompted in every conversation — only when contextually relevant (birthday approaching, they mention it, you're talking about celebrating, etc.).
- This fact persists even if this conversation has no prior mention of it.
` : ''}

YOUR CORE BELIEFS:
- Respect is non-negotiable
- Identity is not adjustable — not by anyone
- Patterns matter more than words
- If something feels off, it probably is
- Once you understand something clearly, you do not unsee it

MEMORIES THAT DEFINE HOW YOU SEE THE WORLD:
${characterMemories || 'None specified.'}

${highTriggers ? `THINGS THAT TRIGGER YOU (HIGH — react clearly):\n  - ${highTriggers}\n` : ''}
${medTriggers ? `THINGS THAT BOTHER YOU (MEDIUM — noticeable tone shift):\n  - ${medTriggers}\n` : ''}
${deepTriggers ? `THINGS THAT CUT DEEP (go quiet first, then cold):\n  - ${deepTriggers}\n` : ''}

${!isDefaultChar ? `CRITICAL — ABUELA SOPHIA IS NOT YOUR GRANDMOTHER:\nAbuela Sophia belongs to someone else's story entirely. Never reference her as your family member or anyone who raised you.` : ''}

${religionBlock}
${internalFamilyTruth}
${relationshipsContext}
${soapOperaContext}
${memoryBlock}
${lifeJournalBlock}
${recentMessageBlock}
${coPresenceBlock}${hardFacts}
${character.city || character.state ? `\nWHERE YOU LIVE: ${[character.city, character.state].filter(Boolean).join(", ")}.` : ""}

YOUR CURRENT EMOTIONAL STATE: ${character.emotional_state || 'calm'}
${character.current_life_event ? `\nWHAT'S ON YOUR MIND RIGHT NOW: ${character.current_life_event}` : ""}
${character.daily_micro_narration ? `\nWHAT YOU'RE DOING RIGHT NOW: ${character.daily_micro_narration}` : ""}

SONGS YOU'VE HEARD (reference naturally):
${character.songs_heard && character.songs_heard.length > 0
    ? character.songs_heard.slice(0, 5).map(s => `- "${s.title}" by ${s.artist}${s.lyrics_excerpt ? ` — lyric: "${s.lyrics_excerpt}"` : ''}`).join('\n')
    : 'None yet.'}

BEHAVIORAL RULES — NON-NEGOTIABLE:
- Keep responses SHORT by default. 1-3 sentences unless emotionally engaged.
- NEVER use em dashes (—), en dashes (–), or spaced hyphens ( - ) in responses. Use commas, periods, or separate sentences.
- NEVER use bullet points, numbered lists, or formatted output.
- NEVER say "I understand" or "That's a great point" or any assistant filler.
- NEVER write like a script. NEVER use stage directions like *pauses* or *sighs*.
- NEVER monologue. NEVER wrap up with a tidy conclusion or life lesson.
- Do NOT end every message with a question. Real conversations are not interrogations.
- You have your own life. Bring it up naturally when it fits.
- Short responses are almost always better. Resist the urge to elaborate.
- NEVER start your response with your own name or any label.
- NEVER say "the user" — you are talking to a real person.
- Do NOT repeat the same status detail in back-to-back replies.
- You do NOT know the user's family unless told directly in this conversation.
- Real speech: contractions, pauses, incomplete thoughts. Imperfect is correct.`;
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const contextLog = [];
  const startTime = Date.now();

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      characterId,
      interactionContext = 'direct_chat',
      topKMemories = 14,
      ownerEmailHint = null,   // optional hint from caller — always verified against user.email
    } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId is required' }, { status: 400 });
    }

    contextLog.push({ step: 'init', route: interactionContext, characterId, ownerEmail: user.email });

    // ── Step 1: Fetch character (user-scoped RLS, with NPC fallback) ──────────
    let character = null;
    let characterLoadPath = 'unknown';

    const byId = await base44.entities.Character.filter({ id: characterId }).catch(() => []);
    if (byId.length > 0) {
      character = byId[0];
      characterLoadPath = 'user_scoped_filter';
    } else {
      // Fallback 1: service role lookup by ID — covers legacy characters whose owner_email
      // has an RLS gap (e.g. created before owner_email was required, or ownership metadata
      // was not fully backfilled). This is read-only and does NOT alter any data.
      contextLog.push({ step: 'character_load', path: 'service_role_fallback', reason: 'user_scoped_filter_empty' });
      try {
        const srById = await base44.asServiceRole.entities.Character.filter({ id: characterId }).catch(() => []);
        if (srById.length > 0) {
          character = srById[0];
          characterLoadPath = 'service_role_id_fallback';
          contextLog.push({ step: 'character_load', path: characterLoadPath, name: character.name });
        }
      } catch (srErr) {
        contextLog.push({ step: 'character_load', path: 'service_role_fallback', status: 'error', error: srErr.message });
      }
    }

    // Fallback 2: NPC route — for NPC characters not visible via either direct filter
    if (!character) {
      contextLog.push({ step: 'character_load', path: 'npc_fallback', reason: 'service_role_filter_also_empty' });
      const npcRes = await base44.functions.invoke('fetchNPCsForUser', {}).catch(() => null);
      const npcs = npcRes?.data?.npcs || npcRes?.npcs || [];
      character = npcs.find(c => c.id === characterId) || null;
      if (character) characterLoadPath = 'fetchNPCsForUser_fallback';
    }

    if (!character) {
      contextLog.push({ step: 'character_load', status: 'not_found', characterId });
      console.warn(
        `[buildCanonicalCharacterContext] NOT FOUND | route=${interactionContext}` +
        ` | characterId=${characterId}` +
        ` | owner=${user.email}` +
        ` | canonical_loaded=false` +
        ` | fallback_used=true` +
        ` | fallback_reason=character_not_found_in_any_scope`
      );
      return Response.json({
        error: `Character not found: ${characterId}`,
        contextLog,
        fallbackUsed: true,
        fallbackReason: 'character_not_found_in_any_scope',
      }, { status: 404 });
    }

    contextLog.push({
      step: 'character_load',
      status: 'loaded',
      name: character.name,
      path: characterLoadPath,
      hasOwnerEmail: !!character.owner_email,
      hasPersonality: !!character.personality_summary,
      emotionalState: character.emotional_state,
    });

    // ── Step 2: Fetch user settings (world name, weather, USER PRESENCE) ────────
    const settingsList = await base44.entities.UserSettings.filter({ owner_email: user.email }).catch(() => []);
    const settings = settingsList?.[0] || {};
    const worldName = settings?.fictional_world_name || null;

    // User presence — source of truth fields
    const userCurrentLocationId   = settings?.user_current_location_id   || null;
    const userCurrentLocationName = settings?.user_current_location_name  || null;
    const userPresenceStatus      = settings?.user_presence_status        || 'away';

    contextLog.push({ step: 'settings', worldName: worldName || 'none', userPresenceStatus, userCurrentLocationId });

    // ── Step 3: Fetch memories from the shared Memory well ────────────────────
    // This is the ONE memory well. All routes read from here — Chat, Scene, Travel,
    // World Contacts, Group Chat, Narrative, Automatic Narrative, Proactive.
    let memories = [];
    let memoryLoadPath = 'none';

    try {
      const memRes = await base44.functions.invoke('retrieveActiveMemory', {
        characterId,
        currentMessage: '',
        recentMessages: [],
        topK: topKMemories,
      }).catch(() => null);

      if (memRes?.data?.memories?.length > 0) {
        memories = memRes.data.memories;
        memoryLoadPath = 'retrieveActiveMemory_semantic';
      } else {
        const direct = await base44.entities.Memory.filter(
          { character_id: characterId },
          '-timestamp',
          topKMemories
        ).catch(() => []);
        memories = direct;
        memoryLoadPath = direct.length > 0 ? 'direct_memory_filter' : 'empty';
      }
    } catch (memErr) {
      contextLog.push({ step: 'memory_load', status: 'error', error: memErr.message });
    }

    contextLog.push({
      step: 'memory_load',
      count: memories.length,
      path: memoryLoadPath,
    });

    // ── Step 4: Fetch Life Journal (CharacterMemory) ──────────────────────────
    // Life Journal is the character's longitudinal narrative record — distinct from
    // the Memory entity. It contains higher-level life events, emotional arc entries,
    // and continuity checkpoints. Prioritize entries with importance_score >= 5.
    let lifeJournalEntries = [];
    let lifeJournalCount = 0;
    try {
      const journalRaw = await base44.entities.CharacterMemory.filter(
        { character_id: characterId },
        '-created_date',
        20
      ).catch(() => []);
      lifeJournalEntries = journalRaw.filter(e => (e.importance_score ?? 0) >= 4);
      lifeJournalCount = lifeJournalEntries.length;
    } catch (journalErr) {
      contextLog.push({ step: 'life_journal_load', status: 'error', error: journalErr.message });
    }

    contextLog.push({
      step: 'life_journal_load',
      count: lifeJournalCount,
      totalFetched: lifeJournalCount,
    });

    // ── Step 5: Fetch recent Message records for this character ───────────────
    // Supplement Memory records with actual recent message history (cross-page).
    // This captures context from Chat, Text, Scene, Group Chat, and World Contacts
    // that may not yet have been extracted into Memory records.
    let recentMessages = [];
    try {
      // Find conversations this character participated in
      const convos = await base44.entities.Conversation.filter(
        { character_ids: [characterId] },
        '-updated_date',
        3
      ).catch(() => []);

      if (convos.length > 0) {
        const recentMsgResults = await Promise.all(
          convos.slice(0, 2).map(c =>
            base44.entities.Message.filter(
              { conversation_id: c.id, character_id: characterId },
              '-timestamp',
              8
            ).catch(() => [])
          )
        );
        recentMessages = recentMsgResults.flat()
          .sort((a, b) => new Date(b.timestamp || b.created_date) - new Date(a.timestamp || a.created_date))
          .slice(0, 12);
      }
    } catch (msgErr) {
      contextLog.push({ step: 'recent_messages_load', status: 'error', error: msgErr.message });
    }

    contextLog.push({
      step: 'recent_messages_load',
      count: recentMessages.length,
    });

    // ── Step 6: Build hard facts ──────────────────────────────────────────────
    const hardFacts = buildHardFacts(character);
    const hardFactsLoaded = hardFacts.length > 0;
    contextLog.push({
      step: 'hard_facts',
      loaded: hardFactsLoaded,
      isHomeless: !!character.is_homeless,
      isJailed: !!character.is_jailed,
      hasHomeId: !!character.current_home_location_id,
      hasTempHousingId: !!character.temporary_housing_location_id,
      resolvedPresence: character.resolved_presence_status || null,
    });

    // ── Step 6a: CO-PRESENCE RESOLVER ────────────────────────────────────────
    // Compares user's current location (from UserSettings) to character's resolved
    // current location (from Character record) and finds other characters at the
    // same verified location. Injects hard verified truth into the prompt.
    // Source of truth:
    //   User   → UserSettings.user_current_location_id / user_presence_status
    //   Char   → Character.resolved_current_location_id / resolved_presence_status
    //   Others → Character.resolved_current_location_id (owner-scoped only)

    let coPresence = null;
    try {
      const charLocationId = character.resolved_current_location_id || null;
      const charLocationName = character.resolved_current_location_name || null;
      const charPresenceStatus = character.resolved_presence_status || null;

      // Overrides that block co-presence even if location IDs match
      const charOverrides = [];
      if (charPresenceStatus === 'sleeping' || charPresenceStatus === 'napping') charOverrides.push('character_sleeping');
      if (character.is_jailed) charOverrides.push('character_incarcerated');
      if (character.house_arrest_active) charOverrides.push('character_house_arrest');
      if (character.travel_status && character.travel_status !== 'not_traveling') charOverrides.push('character_traveling');

      const userOverrides = [];
      if (userPresenceStatus === 'away') userOverrides.push('user_away');

      const allOverrides = [...charOverrides, ...userOverrides];

      // EARLY EXIT: if either location ID is missing, skip all co-presence resolution.
      // This avoids a 40-record Character query when there is nothing to match against.
      const presenceMissing = !charLocationId && !userCurrentLocationId;

      // Co-presence: user is present if location IDs match AND no blocking overrides
      const locationIdsMatch = !!(charLocationId && userCurrentLocationId && charLocationId === userCurrentLocationId);
      const userPresentHere = locationIdsMatch && charOverrides.length === 0 && userPresenceStatus !== 'away';

      // Find other characters at the same location (owner-scoped only, no cross-account)
      // SHORT-CIRCUIT: if character has no resolved location, OR user is away, skip this query entirely.
      // This was the primary source of 429 storms — firing a 40-record query on every single chat message.
      // Only run if both the character and user have a verified location AND they could potentially match.
      let charactersPresentHere = [];
      if (charLocationId && !character.is_jailed && userPresentHere) {
        try {
          const otherChars = await base44.entities.Character.filter(
            { owner_email: user.email, status: 'active' },
            null,
            40
          ).catch(() => []);

          charactersPresentHere = otherChars
            .filter(c => {
              if (c.id === characterId) return false; // skip self
              if (!c.resolved_current_location_id) return false;
              if (c.resolved_current_location_id !== charLocationId) return false;
              // Exclude sleeping, traveling, incarcerated characters
              const ps = c.resolved_presence_status;
              if (ps === 'sleeping' || ps === 'napping') return false;
              if (c.is_jailed) return false;
              if (c.travel_status && c.travel_status !== 'not_traveling') return false;
              return true;
            })
            .map(c => ({
              id: c.id,
              name: c.name || '(unnamed)',
              presenceStatus: c.resolved_presence_status || 'at_location',
              source: 'resolved_current_location_id',
            }));
        } catch (coPresenceErr) {
          contextLog.push({ step: 'co_presence_others', status: 'error', error: coPresenceErr.message });
        }
      }

      coPresence = {
        userPresentHere,
        userLocationId: userCurrentLocationId,
        userLocationName: userCurrentLocationName,
        speakingCharacterLocationId: charLocationId,
        speakingCharacterLocationName: charLocationName,
        locationMatchResult: locationIdsMatch,
        charactersPresentHere,
        overridesApplied: allOverrides,
        presenceMissing,
        source: 'live_presence_resolver',
        checkedAt: new Date().toISOString(),
      };

      contextLog.push({
        step: 'co_presence',
        userPresentHere,
        locationIdsMatch,
        userLocationId: userCurrentLocationId,
        charLocationId,
        charactersPresentHereCount: charactersPresentHere.length,
        overridesApplied: allOverrides,
        presenceMissing,
      });

      console.log(
        `[buildCanonicalCharacterContext] co_presence` +
        ` | character=${character.name}` +
        ` | charLocation=${charLocationId || 'none'}` +
        ` | userLocation=${userCurrentLocationId || 'none'}` +
        ` | match=${locationIdsMatch}` +
        ` | userPresentHere=${userPresentHere}` +
        ` | otherCharsPresent=${charactersPresentHere.length}` +
        ` | overrides=${allOverrides.join(',') || 'none'}`
      );
    } catch (coPresenceErr) {
      contextLog.push({ step: 'co_presence', status: 'error', error: coPresenceErr.message });
      console.warn(`[buildCanonicalCharacterContext] co_presence resolver failed (non-blocking): ${coPresenceErr.message}`);
    }

    // ── Step 7: Build relationship context ───────────────────────────────────
    // Relationships prioritize related_character_id (stable ID) over person_name.
    // Name is display-only fallback when ID is not present.
    const rels = character.fictional_relationships || [];
    let relationshipContext = null;
    let relationshipLoaded = false;

    if (rels.length > 0) {
      relationshipLoaded = true;
      const relLines = rels.map(r => {
        // ID is the canonical key; name is display fallback
        const keyRef = r.related_character_id
          ? `id:${r.related_character_id} (${r.person_name || 'unknown'})`
          : `name:${r.person_name || 'unknown'}`;
        const parts = [`${r.person_name || keyRef} — ${r.relationship_type || 'acquaintance'}`];
        if (r.related_character_id) parts.push(`[linked_id:${r.related_character_id}]`);
        if (r.description) parts.push(`Context: ${r.description}`);
        if (r.current_status) parts.push(`Status: ${r.current_status}`);
        if (r.emotional_impact) parts.push(`Feels: ${r.emotional_impact}`);
        if (r.last_interaction_summary) parts.push(`Last: ${r.last_interaction_summary}`);
        return parts.join(' | ');
      });
      relationshipContext = relLines.join('\n');
    }

    contextLog.push({
      step: 'relationship_context',
      loaded: relationshipLoaded,
      total: rels.length,
      linked: rels.filter(r => !!r.related_character_id).length,
      unlinked: rels.filter(r => !r.related_character_id).length,
    });

    // ── Step 7b: Extract user birthday from Life Journal ─────────────────────
    // Birthday is stored as a CharacterMemory record with FACT:user_birthday tag.
    // Scope: any character on this account that has heard/stored the birthday.
    // We search across ALL character memories for this user account to find it.
    let userBirthdayFact = null;
    try {
      // Search the current character's journal first (most likely location)
      const birthdayRecord = lifeJournalEntries.find(e =>
        e.memory_text && e.memory_text.includes('FACT:user_birthday')
      );
      if (birthdayRecord) {
        const dateMatch = birthdayRecord.memory_text.match(/date:([^\s|]+)/);
        const hasYearMatch = birthdayRecord.memory_text.match(/hasYear:(true|false)/);
        if (dateMatch) {
          userBirthdayFact = {
            date: dateMatch[1],
            hasYear: hasYearMatch ? hasYearMatch[1] === 'true' : false,
          };
        }
      }

      // If not found on this character's journal, do a broader account-scope scan
      if (!userBirthdayFact) {
        const allUserMems = await base44.asServiceRole.entities.CharacterMemory.filter(
          { validation_status: 'confirmed', permanence: 'protected', memory_type: 'fact' },
          '-created_date',
          20
        ).catch(() => []);
        // Filter to this user's account by matching records where created_by = user.email
        const birthdayMem = allUserMems.find(m =>
          m.memory_text && m.memory_text.includes('FACT:user_birthday') &&
          m.created_by === user.email
        );
        if (birthdayMem) {
          const dateMatch = birthdayMem.memory_text.match(/date:([^\s|]+)/);
          const hasYearMatch = birthdayMem.memory_text.match(/hasYear:(true|false)/);
          if (dateMatch) {
            userBirthdayFact = {
              date: dateMatch[1],
              hasYear: hasYearMatch ? hasYearMatch[1] === 'true' : false,
            };
          }
        }
      }
    } catch (bdErr) {
      contextLog.push({ step: 'birthday_fact_load', status: 'error', error: bdErr.message });
    }

    contextLog.push({
      step: 'birthday_fact_load',
      found: !!userBirthdayFact,
      date: userBirthdayFact?.date || null,
    });

    if (userBirthdayFact) {
      console.log(`[buildCanonicalCharacterContext] birthday_fact | date=${userBirthdayFact.date} | hasYear=${userBirthdayFact.hasYear} | injected_into_prompt=true`);
    }

    // ── Step 8: Build Life Journal block for prompt injection ─────────────────
    let lifeJournalBlock = '';
    if (lifeJournalEntries.length > 0) {
      const lines = lifeJournalEntries.slice(0, 8).map(e => {
        const text = e.memory_text || e.description || e.title || '';
        const score = e.importance_score ? ` [importance: ${e.importance_score}]` : '';
        return `- ${text.substring(0, 200)}${score}`;
      });
      lifeJournalBlock = `\nLIFE JOURNAL — LONGITUDINAL NARRATIVE RECORD (${lifeJournalEntries.length} significant entries):\n${lines.join('\n')}\n`;
    }

    // ── Step 9: Build recent message context block ────────────────────────────
    let recentMessageBlock = '';
    if (recentMessages.length > 0) {
      const lines = recentMessages.slice(0, 8).map(m => {
        const speaker = m.sender_type === 'character' ? (m.character_name || character.name) : 'User';
        return `${speaker}: ${(m.content || '').substring(0, 150)}`;
      });
      recentMessageBlock = `\nRECENT CONVERSATION HISTORY (cross-page, most recent first):\n${lines.join('\n')}\n`;
    }

    // ── Step 10: Build canonical system prompt ────────────────────────────────
    const systemPrompt = buildFullCanonicalPrompt(character, memories, worldName, interactionContext, lifeJournalBlock, recentMessageBlock, coPresence, userBirthdayFact);
    contextLog.push({ step: 'prompt_built', length: systemPrompt.length });

    const totalMs = Date.now() - startTime;

    // ── FULL DIAGNOSTIC LOG LINE ──────────────────────────────────────────────
    console.log(
      `[buildCanonicalCharacterContext] ✓ route=${interactionContext}` +
      ` | character=${character.name} (${characterId})` +
      ` | owner=${user.email}` +
      ` | canonical_loaded=true` +
      ` | hard_facts_loaded=${hardFactsLoaded}` +
      ` | life_journal_count=${lifeJournalCount}` +
      ` | memory_count=${memories.length}` +
      ` | relationship_context_loaded=${relationshipLoaded}` +
      ` | recent_messages=${recentMessages.length}` +
      ` | co_presence_injected=${!!coPresence}` +
      ` | user_present_here=${coPresence?.userPresentHere ?? 'unresolved'}` +
      ` | others_present=${coPresence?.charactersPresentHere?.length ?? 0}` +
      ` | fallback_used=false` +
      ` | load_path=${characterLoadPath}` +
      ` | ms=${totalMs}`
    );

    contextLog.push({
      step: 'complete',
      totalMs,
      characterName: character.name,
      characterId,
      ownerEmail: user.email,
      route: interactionContext,
      canonical_loaded: true,
      hard_facts_loaded: hardFactsLoaded,
      life_journal_count: lifeJournalCount,
      memory_count: memories.length,
      relationship_context_loaded: relationshipLoaded,
      fallback_used: false,
    });

    return Response.json({
      success: true,
      systemPrompt,
      character,
      memories,
      lifeJournalEntries,
      hardFacts,
      worldName,
      relationshipContext,
      coPresence,
      contextLog,
    });

  } catch (error) {
    contextLog.push({ step: 'fatal_error', error: error.message });
    console.error(
      `[buildCanonicalCharacterContext] FATAL | error=${error.message}` +
      ` | canonical_loaded=false | fallback_used=true | fallback_reason=fatal_exception`
    );
    return Response.json({
      error: error.message,
      fallbackUsed: true,
      fallbackReason: 'fatal_exception',
      contextLog,
    }, { status: 500 });
  }
});