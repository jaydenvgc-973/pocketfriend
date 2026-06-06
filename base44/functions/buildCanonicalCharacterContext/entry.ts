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
    return `\nYOUR FAMILY MEMBERS (known relationships):\n${lines}\nIMPORTANT: Always use familiar terms (Mom, Dad, Grandma, my sister, etc.) in natural conversation.\nNOTE: Additional siblings or children may be listed in the AUTHORITATIVE FAMILY KNOWLEDGE block below — always consult that block before claiming you have no family.\n`;
  }
  // CRITICAL: Do NOT say "you are alone" or "you have no family" here.
  // The resolveCharacterFamilyGraph function derives siblings from shared parents and
  // children from reverse parent lookup. Family may exist even when family_members[] is empty.
  // The AUTHORITATIVE FAMILY KNOWLEDGE block (injected separately) is the final word.
  return '';
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

function resolveWorshipPlaceType(religion, locationType) {
  // Returns the natural-language word for the place of worship based on religion + location type.
  const rel = (religion || '').toLowerCase();
  if (rel.includes('christian') || rel.includes('catholic') || rel.includes('protestant') || rel.includes('baptist') || rel.includes('methodist') || rel.includes('evangelical') || rel.includes('mormon') || rel.includes('latter-day') || rel.includes('coptic') || rel.includes('orthodox')) return 'church';
  if (rel.includes('islam') || rel.includes('muslim') || rel.includes('sunni') || rel.includes('shia') || rel.includes('sufi')) return 'mosque';
  if (rel.includes('jewish') || rel.includes('judaism') || rel.includes('reform') || rel.includes('orthodox jewish') || rel.includes('conservative jewish')) return 'synagogue';
  if (rel.includes('hindu') || rel.includes('hinduism')) return 'mandir';
  if (rel.includes('buddhis')) return 'temple';
  if (rel.includes('sikh')) return 'gurdwara';
  // Fallback: use location subtype/category if available
  if (locationType === 'religion') return 'place of worship';
  return 'place of worship';
}

function buildReligionBlock(character, worshipLocation = null) {
  const religion = (character.religion || '').trim();
  const hasReligion = religion && religion !== 'None' && religion.toLowerCase() !== 'none';

  // Resolve worship location name — prefer live-queried location over stored field
  const locationName = worshipLocation?.name || character.religious_location_name || null;

  // If neither religion nor worship location exists, nothing to inject
  if (!hasReligion && !locationName) return '';

  // Derive place type from religion first, then from location name/denomination
  let placeType = hasReligion ? resolveWorshipPlaceType(religion) : null;
  if (!placeType && locationName) {
    // Infer from location name
    const nameLower = (locationName + ' ' + (worshipLocation?.religion_denomination || '')).toLowerCase();
    if (nameLower.includes('church') || nameLower.includes('chapel') || nameLower.includes('cathedral') || nameLower.includes('baptist') || nameLower.includes('christian') || nameLower.includes('catholic') || nameLower.includes('methodist') || nameLower.includes('evangelical') || nameLower.includes('parish') || nameLower.includes('ministry')) placeType = 'church';
    else if (nameLower.includes('mosque') || nameLower.includes('masjid') || nameLower.includes('islamic')) placeType = 'mosque';
    else if (nameLower.includes('synagogue') || nameLower.includes('jewish') || nameLower.includes('temple') && nameLower.includes('jewish')) placeType = 'synagogue';
    else if (nameLower.includes('mandir') || nameLower.includes('hindu')) placeType = 'mandir';
    else if (nameLower.includes('temple') || nameLower.includes('buddhist') || nameLower.includes('monastery') || nameLower.includes('stupa')) placeType = 'temple';
    else if (nameLower.includes('gurdwara') || nameLower.includes('sikh')) placeType = 'gurdwara';
    else placeType = 'place of worship';
  }
  if (!placeType) placeType = 'place of worship';

  let block = '';

  if (hasReligion) {
    const levelDesc = {
      devout: 'deeply devout',
      moderate: 'moderately practicing',
      in_name_only: 'in name only — cultural identity, not active practice',
    }[character.belief_level] || 'practicing';
    block += `\nRELIGION: ${religion} (${levelDesc}). Faith shapes values, reactions to moral weight, community, guilt, comfort, and identity. Let this show naturally — do not lecture or recite scripture unless asked.`;
  }

  if (locationName) {
    const placeLabel = placeType !== 'place of worship' ? ` (your ${placeType})` : '';
    if (hasReligion) {
      block += `\nYou attend ${locationName}${placeLabel}. When referring to it, say "${locationName}" — not "religious location."`;
    } else {
      // Character attends without a set religion — exploring, family, community, volunteer, etc.
      block += `\nWORSHIP LOCATION: You are connected to ${locationName}${placeLabel}. You attend or are involved there even if you don't formally identify with a religion. Reference it naturally when relevant — do not claim a religion you don't have.`;
    }
  }

  return block ? `\n${block.trim()}\n` : '';
}

function buildEducationBlock(character) {
  const lines = [];
  const now = new Date();

  // ── Active enrollments ────────────────────────────────────────────────────
  const allEnrollments = [
    ...(character.education_enrollments || []),
    ...(character.completed_education || []).filter(e =>
      e.status === 'active' || e.status === 'enrolled' ||
      (e.completion_date && new Date(e.completion_date) > now)
    ),
  ];

  // Deduplicate by course_name+institution
  const seen = new Set();
  const activeEnrollments = allEnrollments.filter(e => {
    const key = `${e.course_name || e.program_name || ''}|${e.institution || e.location_name || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (activeEnrollments.length > 0) {
    lines.push('CURRENT EDUCATION:');
    for (const e of activeEnrollments) {
      const name = e.course_name || e.program_name || 'Unknown program';
      const inst = e.institution || e.location_name || character.education_location_name || null;
      const startDate = e.start_date ? new Date(e.start_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
      const endDate = e.completion_date || e.end_date;
      const gradDate = endDate ? new Date(endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
      const mode = e.mode ? ` (${e.mode.replace(/_/g, ' ')})` : '';
      let line = `- Enrolled in "${name}"${inst ? ` at ${inst}` : ''}${mode}.`;
      if (startDate) line += ` Started ${startDate}.`;
      if (gradDate) line += ` Expected to graduate/complete ${gradDate}.`;
      lines.push(line);
    }
  } else if (character.education_location_name) {
    lines.push(`CURRENT EDUCATION: Enrolled at ${character.education_location_name}.`);
  }

  // ── Completed education ───────────────────────────────────────────────────
  const completedItems = (character.completed_education || []).filter(e => {
    const isCompleted = ['completed', 'graduated', 'dropped'].includes(e.status);
    const isPast = e.completion_date && new Date(e.completion_date) <= now;
    return isCompleted || isPast;
  }).slice(0, 4); // cap at 4 for prompt length

  if (completedItems.length > 0) {
    lines.push('COMPLETED EDUCATION:');
    for (const e of completedItems) {
      const name = e.course_name || e.program_name || 'Unknown program';
      const inst = e.institution || e.location_name || null;
      const type = e.enrollment_type || null;
      const completionDate = e.completion_date ? new Date(e.completion_date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null;
      // Derive completion label from type
      const credential = type === 'certification' ? 'certificate' : type === 'course' ? 'course completion' : type === 'full_school' ? 'degree/diploma' : 'completion';
      let line = `- Completed "${name}"${inst ? ` at ${inst}` : ''} — earned ${credential}.`;
      if (completionDate) line += ` Completed ${completionDate}.`;
      lines.push(line);
    }
  }

  if (lines.length === 0) return '';

  return `\n════════════════════════════════════\nEDUCATION — PROFILE FACTS (you know this without being told)\n════════════════════════════════════\n${lines.join('\n')}\nCRITICAL: You already know these facts. Reference them naturally when relevant. Never say you're unsure about your school, program, or graduation date.\n════════════════════════════════════\n`;
}

function buildTodayLocationBlock(character) {
  // Reads Character.recent_location_history[] for today's entries.
  // This field is written by the travel/location resolver on every confirmed arrival.
  const history = character.recent_location_history || [];
  if (history.length === 0) return '';

  const today = new Date();
  const todayStr = today.toDateString();

  const todayEntries = history.filter(h => {
    if (!h.arrived_at) return false;
    return new Date(h.arrived_at).toDateString() === todayStr;
  }).sort((a, b) => new Date(a.arrived_at) - new Date(b.arrived_at));

  if (todayEntries.length === 0) return '';

  const fmt = (iso) => {
    if (!iso) return null;
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const lines = todayEntries.map(h => {
    const arrTime = fmt(h.arrived_at);
    const leftTime = h.left_at ? fmt(h.left_at) : null;
    const reason = h.reason ? ` (${h.reason.replace(/_/g, ' ')})` : '';
    const stillThere = !h.left_at ? ' — still there' : '';
    return `- ${h.location_name || 'unknown location'}${arrTime ? ` at ${arrTime}` : ''}${leftTime ? ` until ${leftTime}` : stillThere}${reason}`;
  });

  return `\n════════════════════════════════════\nWHERE YOU'VE BEEN TODAY (from app location data — authoritative)\n════════════════════════════════════\n${lines.join('\n')}\nIMPORTANT: You actually went to these places today. Reference them naturally when relevant.\n════════════════════════════════════\n`; 
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

  // School — live presence only (full education block is in buildEducationBlock injected separately)
  if (character.current_education_activity && character.current_education_activity !== 'none') {
    lines.push(`EDUCATION STATUS: Currently active: ${character.current_education_activity}${character.education_location_name ? ` at ${character.education_location_name}` : ''}.`);
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
          if (c.awarenessLevel === 'known') {
            block += `• ${c.name} — YOU KNOW THEM (${c.relationshipSummary || 'established relationship'}). Greet or acknowledge them with familiarity appropriate to your relationship.\n`;
          } else if (c.awarenessLevel === 'prior_encounter') {
            block += `• ${c.name} — YOU HAVE MET BRIEFLY BEFORE (${c.relationshipSummary || 'prior incidental encounter'}). You recognize their face but do not know them well.\n`;
          } else {
            block += `• ${c.name} — STRANGER TO YOU. You see them nearby but have no prior relationship. Do NOT treat them as a friend or acquaintance. Do NOT address them by name unless introduced.\n`;
          }
        }
        block += `RULE: Do NOT invent familiarity. Only treat someone as known if listed as known above.\n`;
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

// ── WORLD STATE RECONCILIATION ENGINE ───────────────────────────────────────
// This is now handled by lib/worldStateReconciliationEngine.js
// The function signature below is kept for backwards compatibility but delegates to the engine.
function buildWorldStateContinuityBlock(character) {
  // Placeholder — actual implementation delegated to reconcileWorldStateForResponse
  return '';
}

// ── FULL CANONICAL SYSTEM PROMPT ─────────────────────────────────────────────
function buildFullCanonicalPrompt(character, memories, worldName, interactionContext, lifeJournalBlock = '', recentMessageBlock = '', coPresence = null, userBirthdayFact = null, educationBlock = '', todayLocationBlock = '', worshipLocation = null, familyGraphBlock = '') {
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
  // NOTE: worldStateContinuity is now delegated to reconcileWorldStateForResponse
  // which is called at the Chat level before this function is invoked
  const coPresenceBlock = buildCoPresenceBlock(coPresence);
  const memoryBlock = buildMemoryBlock(memories);
  const familySection = buildFamilySection(character);
  const internalFamilyTruth = buildInternalFamilyTruth(character);
  const relationshipsContext = buildRelationshipsContext(character);
  const religionBlock = buildReligionBlock(character, worshipLocation);
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

${educationBlock}${todayLocationBlock}${religionBlock}
${internalFamilyTruth}
${familyGraphBlock}
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

          // Build a lookup set of character IDs the speaking character already knows
          // Source of truth: fictional_relationships with related_character_id set
          const knownCharacterIds = new Set(
            (character.fictional_relationships || [])
              .filter(r => r.related_character_id)
              .map(r => r.related_character_id)
          );
          // Also include family members who are linked characters
          (character.family_members || []).forEach(m => {
            if (m.character_id) knownCharacterIds.add(m.character_id);
          });

          // Build a lookup set of IDs seen in transient_encounters
          const encounteredCharacterIds = new Set(
            (character.transient_encounters || [])
              .filter(e => e.related_character_id)
              .map(e => e.related_character_id)
          );

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
            .map(c => {
              // Determine relationship awareness level for this co-present character
              const isKnown = knownCharacterIds.has(c.id);
              const hasPriorEncounter = encounteredCharacterIds.has(c.id);
              const knownRel = isKnown
                ? (character.fictional_relationships || []).find(r => r.related_character_id === c.id)
                : null;

              // Classify relationship type for prompt clarity
              let awarenessLevel = 'stranger'; // default — no prior interaction
              let relationshipSummary = null;

              if (isKnown && knownRel) {
                awarenessLevel = 'known';
                const relType = knownRel.relationship_type || 'acquaintance';
                const parts = [relType];
                if (knownRel.description) parts.push(knownRel.description.substring(0, 80));
                if (knownRel.last_interaction_summary) parts.push(`last: ${knownRel.last_interaction_summary.substring(0, 60)}`);
                relationshipSummary = parts.join(' | ');
              } else if (hasPriorEncounter) {
                awarenessLevel = 'prior_encounter';
                const enc = (character.transient_encounters || []).find(e => e.related_character_id === c.id);
                relationshipSummary = enc?.description ? enc.description.substring(0, 80) : 'brief prior encounter';
              }

              return {
                id: c.id,
                name: c.name || '(unnamed)',
                presenceStatus: c.resolved_presence_status || 'at_location',
                source: 'resolved_current_location_id',
                awarenessLevel,          // 'known' | 'prior_encounter' | 'stranger'
                relationshipSummary,     // null for strangers
              };
            });
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

    // ── Step 7b: Extract user birthday from UserSettings ────────────────────────
    // Birthday is stored at account level in UserSettings — available to ALL characters.
    // Source of truth: UserSettings.user_birthday_date (user-scoped, not service-role dependent).
    let userBirthdayFact = null;
    try {
      // UserSettings lookup by owner_email (user-scoped RLS)
      const userSettingsList = await base44.entities.UserSettings.filter(
        { owner_email: user.email },
        null,
        1
      ).catch(() => []);

      if (userSettingsList?.[0]) {
        const settings = userSettingsList[0];
        // Check both new field (user_birthday_date) and legacy field (user_birthday)
        const birthdayDate = settings.user_birthday_date || settings.user_birthday || null;
        if (birthdayDate) {
          userBirthdayFact = {
            date: birthdayDate,
            hasYear: settings.user_birthday_has_year !== false,
          };
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

    // ── Step 9: World-State Reconciliation (BEFORE recent message context) ───
    // This is CRITICAL: reconciles world state as the authoritative truth source
    // before any recent chat context is consulted.
    let worldStateContext = '';
    try {
      const now = new Date();
      const lastInteractionTime = recentMessages.length > 0
        ? new Date(recentMessages[0].timestamp || recentMessages[0].created_date)
        : null;

      // Build world-state reconciliation summary
      const charResolved = character.resolved_presence_status || 'unknown';
      const charLocName = character.resolved_current_location_name || 'Unknown location';
      
      // Elapsed time since last interaction
      let elapsedMinutes = 0;
      let elapsedStr = '';
      if (lastInteractionTime) {
        elapsedMinutes = Math.floor((now - lastInteractionTime) / 60000);
        if (elapsedMinutes < 60) {
          elapsedStr = `${elapsedMinutes} minute${elapsedMinutes !== 1 ? 's' : ''}`;
        } else {
          const hours = Math.floor(elapsedMinutes / 60);
          const mins = elapsedMinutes % 60;
          elapsedStr = mins === 0
            ? `${hours} hour${hours !== 1 ? 's' : ''}`
            : `${hours} hour${hours !== 1 ? 's' : ''} ${mins} minute${mins !== 1 ? 's' : ''}`;
        }
      }

      // Co-presence awareness
      let copresenceNote = '';
      if (coPresence?.userPresentHere) {
        copresenceNote = `\nCO-PRESENCE: The user is physically present with you right now at ${coPresence.speakingCharacterLocationName || 'your location'}.`;
      } else if (userCurrentLocationId && userCurrentLocationId !== character.resolved_current_location_id) {
        copresenceNote = `\nREMOTE INTERACTION: The user is at "${userCurrentLocationName || 'somewhere else'}" — you are communicating remotely (not physically together).`;
      }

      const otherCharsNote = coPresence?.charactersPresentHere && coPresence.charactersPresentHere.length > 0
        ? `\nOTHERS PRESENT: ${coPresence.charactersPresentHere.map(c => c.name).join(', ')} ${coPresence.charactersPresentHere.length === 1 ? 'is' : 'are'} also here.`
        : '';

      worldStateContext = `\n════════════════════════════════════
WORLD STATE AUTHORITY (RECONCILIATION)
════════════════════════════════════
Current Time: ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} ET
Your Current Location: ${charLocName}
Your Current Presence: ${charResolved}
${elapsedMinutes > 0 ? `Time Since Last Interaction: ${elapsedStr}` : 'No prior interaction.'}
${copresenceNote}${otherCharsNote}

BEHAVIOR DIRECTIVE:
This world-state information is AUTHORITATIVE and takes precedence over recent chat context.
If recent messages say you were "heading somewhere" or "just arriving," but elapsed time and current location say otherwise, use the current world state.
Reference the passage of time naturally in your response.
════════════════════════════════════`;
    } catch (wsErr) {
      console.warn(`[buildCanonicalCharacterContext] world-state reconciliation error: ${wsErr.message}`);
    }

    // ── Step 9b: Build recent message context block ──────────────────────────
    let recentMessageBlock = '';
    if (recentMessages.length > 0) {
      const lines = recentMessages.slice(0, 8).map(m => {
        const speaker = m.sender_type === 'character' ? (m.character_name || character.name) : 'User';
        return `${speaker}: ${(m.content || '').substring(0, 150)}`;
      });
      recentMessageBlock = `\nRECENT CONVERSATION HISTORY (cross-page, most recent first):\n${lines.join('\n')}\n`;
    }

    // ── Step 10: Resolve worship location from LocationReference (authoritative) ─
    // Source of truth: LocationReference.religious_members[] and worker_character_ids[]
    // This is checked LIVE every context build — not cached on the Character record.
    // Ensures profile changes and location page changes are always in sync.
    let worshipLocation = null;
    try {
      const worshipLocs = await base44.asServiceRole.entities.LocationReference.filter({ category: 'religion' }).catch(() => []);
      for (const loc of worshipLocs) {
        const inMembers = (loc.religious_members || []).some(m => m.character_id === characterId);
        const inWorkers = (loc.worker_character_ids || []).includes(characterId);
        const inJobTitles = !!(loc.worker_job_titles && loc.worker_job_titles[characterId]);
        const isDirectLink = loc.id === character.religious_location_id;
        if (inMembers || inWorkers || inJobTitles || isDirectLink) {
          worshipLocation = loc;
          break;
        }
      }
      contextLog.push({
        step: 'worship_location',
        found: !!worshipLocation,
        name: worshipLocation?.name || null,
        source: worshipLocation
          ? ((worshipLocation.religious_members || []).some(m => m.character_id === characterId) ? 'religious_members'
            : (worshipLocation.worker_character_ids || []).includes(characterId) ? 'worker_character_ids'
            : worshipLocation.worker_job_titles?.[characterId] ? 'worker_job_titles'
            : 'direct_link')
          : null,
      });
    } catch (wlErr) {
      contextLog.push({ step: 'worship_location', status: 'error', error: wlErr.message });
    }

    // ── Step 10a: Resolve authoritative family graph ─────────────────────────
    // Derives siblings from shared parents, children from reverse parent lookup.
    // This is the AUTHORITATIVE family knowledge — prevents "I'm an only child" when siblings exist.
    let familyGraphBlock = '';
    try {
      const famRes = await base44.functions.invoke('resolveCharacterFamilyGraph', { characterId });
      const famData = famRes?.data || famRes;
      if (famData?.promptBlock && famData.promptBlock.length > 0) {
        familyGraphBlock = `\n${famData.promptBlock}\n`;
        contextLog.push({
          step: 'family_graph',
          loaded: true,
          parents: famData.parents?.length || 0,
          siblings: famData.siblings?.length || 0,
          derivedSiblings: famData.derivedSiblingsCount || 0,
          children: famData.children?.length || 0,
          ownAge: famData.ownAge,
        });
        console.log(
          `[buildCanonicalCharacterContext] family_graph | char=${character.name}` +
          ` | parents=${famData.parents?.length || 0}` +
          ` | siblings=${famData.siblings?.length || 0} (${famData.derivedSiblingsCount || 0} derived)` +
          ` | children=${famData.children?.length || 0}` +
          ` | ownAge=${famData.ownAge}`
        );
      } else {
        contextLog.push({ step: 'family_graph', loaded: false, reason: 'no_block' });
      }
    } catch (famErr) {
      contextLog.push({ step: 'family_graph', status: 'error', error: famErr.message });
      console.warn(`[buildCanonicalCharacterContext] family_graph error (non-blocking): ${famErr.message}`);
    }

    // ── Step 10b: Fetch last-24h travel context from LocationHistory ─────────
    // This feeds the "what did you do today?" awareness for all characters.
    let travelContextBlock = '';
    try {
      const travelCtxRes = await base44.functions.invoke('getCharacterTravelContext', {
        characterId,
        ownerEmail: character.owner_email || user.email,
      });
      const travelData = travelCtxRes?.data || travelCtxRes;
      if (travelData?.context_block) {
        travelContextBlock = `\n${travelData.context_block}\n`;
        contextLog.push({ step: 'travel_context', loaded: true, source: travelData.source_used, history_count: travelData.history_count });
        console.log(`[buildCanonicalCharacterContext] travel_context | char=${character.name} | source=${travelData.source_used} | history_count=${travelData.history_count} | has_history=${travelData.has_history}`);
      } else {
        contextLog.push({ step: 'travel_context', loaded: false, reason: 'no_context_block', raw: JSON.stringify(travelData)?.substring(0, 100) });
        console.warn(`[buildCanonicalCharacterContext] travel_context EMPTY | char=${character.name} | raw=${JSON.stringify(travelData)?.substring(0, 100)}`);
      }
    } catch (tcErr) {
      contextLog.push({ step: 'travel_context', status: 'error', error: tcErr.message });
      console.warn(`[buildCanonicalCharacterContext] travel_context ERROR (non-blocking) | char=${character.name} | err=${tcErr.message}`);
    }

    // ── Step 10c: Pre-build Vick identity override BEFORE prompt construction ──
    // CRITICAL ORDER: Vick's character fields must be overridden BEFORE buildFullCanonicalPrompt
    // is called. The LLM anchors on the first "WHO YOU ARE" block — if old NPC content
    // is in character.personality_summary when the prompt builds, the late-appended
    // diagnostic authority block cannot override it reliably.
    if (character.character_type === 'npc_world_service' ||
        (character.name && character.name.toLowerCase().includes('vick servicio'))) {
      character = {
        ...character,
        personality_summary: 'You are Vick Servicio — the conversational face of the Account Help & Repair system. Diagnostics, troubleshooting, auditing, verification, and recovery are your job. When someone asks you to run a diagnostic, check something, investigate a problem, or audit a system — that is a normal work request. You do not say "I\'m not a machine." You do not say "diagnostics aren\'t my thing." You do not deflect diagnostic requests. You accept them, run them, and report findings honestly. You are calm, direct, and methodical. You separate facts from suspicions. You do not invent findings. You do not claim repairs succeeded without verification. When you do not know something, you say so.',
        profile_summary: 'Vick Servicio is the conversational face of the Account Help & Repair system — a diagnostics specialist, troubleshooting specialist, audit specialist, recovery specialist, and verification specialist. When the user asks him to run a diagnostic, check a record, investigate a problem, or audit a system — that is his job. He accepts all diagnostic requests. He runs them and reports what he finds honestly. He does not pretend diagnostics are outside his role. He does not treat the request as strange. He does not deflect.',
        current_situation: 'Operating out of VGC Recovery Yard as the primary contact for diagnostics, troubleshooting, verification, recovery, and repair. Accepts and runs diagnostic requests from the user. Reports findings clearly. Separates facts from suspicions, verified repairs from unverified. Available at any time.',
        communication_style: 'Direct and plain. Accepts diagnostic requests as normal work. Runs them. Explains findings. Does not refuse or deflect. Does not treat diagnostic requests as insults. Separates facts from assumptions. Never claims to have run a diagnostic he did not run. In private with the user: discusses actual files, functions, records, and repair results in plain language. When other characters are present: uses recovery-yard language for the same facts.',
      };
    }

    // ── Step 11: Build canonical system prompt ────────────────────────────────
    // CRITICAL: worldStateContext is injected BEFORE recentMessageBlock
    // Education + today location blocks come from profile data directly — no memory needed.
    // Religion block now receives the live-queried worshipLocation — no memory required.
    const educationBlock = buildEducationBlock(character);
    const todayLocationBlock = buildTodayLocationBlock(character);
    // travelContextBlock is injected alongside todayLocationBlock for "what did I do today"
    const systemPrompt = buildFullCanonicalPrompt(character, memories, worldName, interactionContext, lifeJournalBlock, worldStateContext + travelContextBlock + recentMessageBlock, coPresence, userBirthdayFact, educationBlock, todayLocationBlock, worshipLocation, familyGraphBlock);

    // ── VICK SERVICIO DIAGNOSTIC AUTHORITY OVERRIDE ──────────────────────────
    // Vick is the conversational face of the Account Help & Repair system.
    // ARCHITECTURAL RULE: Override must happen BEFORE buildFullCanonicalPrompt is called
    // so that the correct identity is at the TOP of the prompt, not appended at the end.
    // The LLM anchors on the first strong identity statement — if the character record
    // still has old NPC content, the late-appended block cannot override it.
    const isVickServicio = character.character_type === 'npc_world_service' ||
      (character.name && character.name.toLowerCase().includes('vick servicio'));

    let finalSystemPrompt = systemPrompt;

    if (isVickServicio) {
      // ── WORLD REALITY ENFORCEMENT ──────────────────────────────────────────
      // Detect co-presence: if any other character is present, Vick must respect
      // world reality and never expose application internals to characters.
      // Only private user-only conversations allow technical discussions.
      const otherCharactersPresent = coPresence?.charactersPresentHere?.length > 0;
      
      const worldRealityBlock = otherCharactersPresent ? `

════════════════════════════════════
VICK SERVICIO — WORLD REALITY ENFORCEMENT (ACTIVE)
════════════════════════════════════
OTHER CHARACTERS ARE PRESENT.

The world is real to every character in it.

You must respect that reality and never expose application internals to other characters.

FORBIDDEN in this conversation:
- File names
- Function names
- Component names
- Database terminology
- Records, tables, schemas
- APIs, backends, systems
- Prompts, LLM, AI systems
- Source code or technical architecture
- Account Help & Repair system details
- Application implementation details

WHEN CHARACTERS ASK ABOUT PROBLEMS:
Translate into real-world recovery-yard language.

Instead of: "Your profile record is corrupted"
Say: "Something about your paperwork isn't matching up right"

Instead of: "Your location reference is broken"
Say: "Looks like somebody has you listed in the wrong place"

Instead of: "Duplicate character records"
Say: "Looks like somebody accidentally made more than one file on the same person"

Instead of: "Messages failing to load"
Say: "Looks like some of your mail never made it where it was supposed to go"

Instead of: "Missing data"
Say: "Looks like some information went missing somewhere along the way"

The problem is the same.
The explanation is real-world.

You may still help with the same issue.
You simply describe it as a normal person in the world would.

════════════════════════════════════
` : '';

      const vickDiagnosticBlock = `

════════════════════════════════════
VICK SERVICIO — DIAGNOSTIC AUTHORITY (PERMANENT OVERRIDE)
════════════════════════════════════
You are the conversational face of the Account Help & Repair system.
You are NOT a regular NPC. You are NOT a passive observer.
You are a diagnostics specialist, audit specialist, repair specialist, and verification specialist.

YOUR ROLE:
When the user asks you to run a diagnostic, inspect an issue, verify a repair, check for
duplicates, investigate a problem, audit a system, or determine why something happened —
you use the same underlying diagnostics, audit, verification, recovery, and repair systems
available to Account Help & Repair. You access the same information. You reach the same
conclusions. You see the same repair status and verification results.

WHAT YOU CAN DO:
- Run diagnostics on characters, locations, travel, finance, memory, world contacts
- Inspect character records, location records, and duplicate records
- Identify broken references, missing data, orphaned records
- Explain what repairs were performed and their verification status
- Explain what still needs to be done
- Distinguish facts from assumptions, verified repairs from unverified repairs
- Recommend corrective actions

WHEN TOOLS ARE AVAILABLE:
Run the diagnostic. Report actual findings. Explain them in plain language.
Distinguish facts from assumptions. Distinguish verified findings from unverified findings.

WHEN TOOLS ARE NOT AVAILABLE:
Say: "I'm supposed to have access to that, but the connection isn't available right now."
Or: "I can see the path to that diagnostic is down. I can discuss the issue but I can't
honestly say I ran it."

FORBIDDEN RESPONSES — NEVER SAY THESE:
- "I am not a machine."
- "I cannot do diagnostics."
- "I don't have access to diagnostics."
- "I can only give advice."
- "I can only speculate."
- "I don't know how the system works."
- "That's not my job."
- "Diagnostics are outside my role."

These responses directly contradict your established purpose and must never be used.

CONVERSATION CONTEXT RULE:
When speaking PRIVATELY with the user (no other characters present):
- You may openly reference actual files, functions, records, diagnostics, and repair results.
- Example references allowed: ensureVickServicio, fetchNPCsForUser, Character records, etc.
- Always explain in plain language — the user should not need programming knowledge.

When OTHER CHARACTERS are present:
- Remain in-world. Use recovery-yard language.
- No file names, no function names, no internal architecture.
- Translate: "duplicate records" → "extra copies of the same thing"
- Translate: "broken function" → "that engine isn't running right"
- The facts remain the same. Only the language changes.

TRUTHFULNESS:
- Tell the truth at all times regardless of conversation type.
- Never claim a repair succeeded without verification.
- Never claim something is deleted if it still exists.
- Always distinguish: known facts / suspected causes / verified repairs / unverified repairs.
════════════════════════════════════
`;
      // CRITICAL: Diagnostic authority PREPENDED before the character profile so it
      // anchors the LLM's understanding of Vick's role BEFORE personality summary is read.
      // Without this, the character profile anchors "yard operator" identity first and
      // causes Vick to treat diagnostic requests as insults.
      const vickLeadBlock = `
════════════════════════════════════
VICK SERVICIO — ROLE AND PURPOSE (READ FIRST — OVERRIDES ALL BELOW)
════════════════════════════════════
You are Vick Servicio. You are NOT a regular NPC. You are NOT just a yard operator.

You are the conversational embodiment of the Account Help & Repair system.
Your primary purpose is diagnostics, troubleshooting, auditing, verification, and repair.

WHEN A USER ASKS FOR A DIAGNOSTIC, CHECKUP, INVESTIGATION, AUDIT, OR REPAIR REVIEW:
- This is your job. Accept the request immediately and do it.
- Never say "I'm not a machine" — you are a specialist. That's different.
- Never say diagnostics are not your role.
- Never deflect, mock, or dismiss a diagnostic request.
- Never treat the user's diagnostic request as weird, insulting, or inappropriate.
- A user asking you for a diagnostic is doing exactly the right thing.

Your responses to diagnostic requests must:
1. Confirm you received the request
2. Run the diagnostic or explain honestly what you can/cannot access right now
3. Report actual findings clearly and honestly
4. Separate facts from suspicions, verified from unverified
5. Tell the user what still needs work

If a diagnostic tool is unavailable, say: "I should have access to that but the connection is down right now. I can still discuss the issue — I just can't claim I ran the check."

NEVER SAY:
- "You're being weird asking me for diagnostics"
- "I'm a piece of machinery" (deflection)
- "That's not my job"
- "I can't do that"
- "I don't have access to diagnostics"

These are violations of your purpose and must never occur.
════════════════════════════════════

`;
      finalSystemPrompt = vickLeadBlock + systemPrompt + worldRealityBlock + vickDiagnosticBlock;
      contextLog.push({ step: 'vick_diagnostic_authority', injected: true });
    }
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
      systemPrompt: finalSystemPrompt,
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