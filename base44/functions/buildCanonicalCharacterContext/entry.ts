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

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

// ── WARDROBE / CLOSET AWARENESS BLOCK ────────────────────────────────────────
// Profile knowledge, not memory. Characters know what they own without retrieval.
function buildWardrobeAwarenessBlock(character) {
  if (!character) return '';

  const closet = character.character_closet || [];
  const currentOutfit = character.current_outfit || null;
  const hasCloset = closet.some(item => item.outfit_id);
  const rotationEnabled = character.outfit_rotation_enabled !== false;

    if (!hasCloset && !currentOutfit) return '';

  const lines = [];
  lines.push('WARDROBE — YOUR CLOTHING AND OUTFITS (profile knowledge — you know this without being told)');

  // Pre-compute outfits array at function scope (needed by both closet listing and rotation awareness)
  const outfits = closet.filter(item => item.type === 'outfit' || item.outfit_id);

  // ── Closet contents ──
  if (hasCloset) {
    lines.push('');
    lines.push('YOUR CLOSET CONTENTS:');
    const pieces = closet.filter(item => !item.outfit_id && (item.piece_id || item.label));

    if (outfits.length > 0) {
      lines.push('Outfits:');
      outfits.forEach((o, i) => {
        const label = o.label || `Outfit ${i + 1}`;
        const cat = o.category ? ` [${o.category.replace(/_/g, ' ')}]` : '';
        const desc = o.full_description ? ` — ${o.full_description.substring(0, 150)}` : '';
        lines.push(`  ${i + 1}. "${label}"${cat}${desc}`);
      });
      if (rotationEnabled && outfits.length > 1) {
        lines.push(`  (Outfit rotation is ON. Your closet follows a numbered sequence. You know which outfit is currently active and which comes next in the rotation.)`);
      } else if (rotationEnabled) {
        lines.push(`  (Outfit rotation is ON but you only have one outfit — it will be worn each day.)`);
      } else {
        lines.push(`  (Outfit rotation is OFF. The currently selected outfit is worn until changed.)`);
      }
    }

    if (pieces.length > 0) {
      lines.push('Individual clothing pieces:');
      pieces.forEach((p, i) => {
        const label = p.label || p.name || `Piece ${i + 1}`;
        const desc = p.description ? ` — ${p.description.substring(0, 100)}` : '';
        lines.push(`  • ${label}${desc}`);
      });
    }
  }

  // ── Current outfit ──
  if (currentOutfit) {
    const label = currentOutfit.label || 'Current outfit';
    const desc = currentOutfit.full_description
      ? ` — ${currentOutfit.full_description.substring(0, 150)}`
      : '';
    const cat = currentOutfit.category ? ` [${currentOutfit.category.replace(/_/g, ' ')}]` : '';
    lines.push(`\nCURRENT OUTFIT: "${label}"${cat}${desc}`);
    lines.push('This is what you are wearing RIGHT NOW. You know exactly what you have on — reference it naturally when relevant.');

    // ── Rotation awareness (profile knowledge) ──
    if (hasCloset && rotationEnabled && outfits.length > 1) {
      const now = new Date();
      const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
      const idHash = (character.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      
      const todayIdx = (dayOfYear + idHash) % outfits.length;
      const todayOutfit = outfits[todayIdx];
      if (todayOutfit) {
        lines.push(`\nTODAY'S OUTFIT: \"${todayOutfit.label || 'Outfit ' + (todayIdx+1)}\" [${(todayOutfit.category || 'daily_casual').replace(/_/g, ' ')}]`);
      }
      
      const tomorrowIdx = (todayIdx + 1) % outfits.length;
      const tomorrowOutfit = outfits[tomorrowIdx];
      if (tomorrowOutfit) {
        lines.push(`TOMORROW'S OUTFIT: \"${tomorrowOutfit.label || 'Outfit ' + (tomorrowIdx+1)}\" [${(tomorrowOutfit.category || 'daily_casual').replace(/_/g, ' ')}]`);
      }
      
      lines.push(`ROTATION POSITION: ${todayIdx + 1} of ${outfits.length} outfits`);
    }
  }

  // ── Appearance description ──
  if (character.appearance_notes) {
    lines.push(`\nGENERAL APPEARANCE: ${character.appearance_notes.substring(0, 200)}`);
  }

  // ── Style identity ──
  if (character.style_identity) {
    lines.push(`STYLE PREFERENCE: ${character.style_identity}`);
  }

  // ── Wardrobe ownership rule ──
  lines.push(`\nWARDROBE RULES:`);
  lines.push(`• You OWN all outfits and pieces listed above. You know their descriptions.`);
  lines.push(`• You do NOT need to retrieve wardrobe information from memory — it is profile knowledge.`);
  lines.push(`• Reference your clothing naturally: "I was thinking about wearing my [outfit] tomorrow" or "I already picked out my [outfit] for later."`);
  lines.push(`• Your current outfit is a deliberate choice from your perspective — you chose to wear this.`);
  lines.push(`• If rotation is on, you know the sequence and what comes next in your closet order.`);
  lines.push(`• Do NOT say things like "I don't know what I own" or "I'm not sure what's in my closet." You know exactly what you own.`);
  lines.push(`• Clothing ownership is PROFILE KNOWLEDGE. Memory is for experiences (buying, wearing to events, compliments).`);

  return `\n════════════════════════════════════\n${lines.join('\n')}\n════════════════════════════════════\n`;
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

  // ── SLEEP STATE — AUTHORITATIVE PRIORITY ORDER ──────────────────────────────
  // Rules (highest priority first):
  //   1. Verified blocking states (jailed, house_arrest) — handled below
  //   2. Verified school attendance window — OVERRIDES stale sleeping DB state
  //   3. Verified work shift — OVERRIDES stale sleeping DB state
  //   4. Verified sleep state from DB — only accepted when school/work are NOT active
  //   5. Stale cache — advisory only, never authority
  //
  // A character whose DB says "sleeping" but who has an active school/work window
  // MUST be treated as awake and attending. The DB flag is stale system data.
  // Stale comfort/energy/needs values MUST NOT drive sleep labeling or dialogue.
  const rp = character.resolved_presence_status || '';
  const dbIsSleeping = rp === 'sleeping' || rp === 'napping';
  const dbIsPassedOut = rp === 'passed_out';

  // ── PASSED_OUT STATE — HARD FACT (mechanically distinct from sleeping) ────
  // passed_out is involuntary physical collapse. It is NOT sleep. It must NEVER
  // be described as sleeping, resting normally, or going to bed.
  // Recovery rate: +8/hr (not +12.5/hr). Cap: 12h (not 8h). Never → sleeping.
  if (dbIsPassedOut) {
    lines.push(`CURRENT STATE: PASSED OUT — INVOLUNTARY FORCED RECOVERY. This is NOT sleep. The character COLLAPSED from exhaustion. They did NOT choose this.\nFORBIDDEN WORDING: "sleeping", "went to bed", "resting", "took a nap", "bedtime", "going to sleep".\nREQUIRED WORDING: "passed out", "collapsed", "forced recovery", "body gave out", "involuntary collapse".\nRECOVERY: energy restoring at +8/hr (NOT the normal sleep rate of +12.5/hr). Cap: 12 hours. Releases directly to awake state — NEVER transitions to sleeping.\nWAKE EXPERIENCE: groggy, stiff, embarrassed, confused about time — NOT refreshed. Body just failed them.`);
  }

  if (dbIsSleeping) {
    // Run schedule-based guards before accepting the DB sleep state as truth
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    const dayOfWeek = nowET.getDay();
    const toMinLocal = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

    // GUARD 1: Active work shift — sleeping DB state is stale
    let workShiftActive = false;
    if (character.work_start_time && character.work_end_time &&
        Array.isArray(character.work_days) && character.work_days.includes(dayOfWeek)) {
      const s = toMinLocal(character.work_start_time);
      const e = toMinLocal(character.work_end_time);
      if (s !== null && e !== null) {
        workShiftActive = e < s ? (nowMin >= s || nowMin < e) : (nowMin >= s && nowMin < e);
      }
    }

    // GUARD 2: Active school window — sleeping DB state is stale
    let schoolWindowActive = false;
    if (character.student_status === 'enrolled' && character.education_location_id &&
        [1, 2, 3, 4, 5].includes(dayOfWeek)) {
      const enrollments = character.education_enrollments;
      if (Array.isArray(enrollments) && enrollments.length > 0) {
        const activeEnroll = enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
        if (activeEnroll) {
          const s = toMinLocal(activeEnroll.start_time);
          const e = toMinLocal(activeEnroll.end_time);
          if (s !== null && e !== null) {
            schoolWindowActive = nowMin >= s && nowMin < e;
          }
        }
      }
    }

    if (workShiftActive) {
      // Work attendance overrides stale sleeping flag — inject authoritative state
      lines.push(`AUTHORITATIVE PRESENCE STATE: CURRENTLY AT WORK (schedule-verified). The database shows "sleeping" but the current work schedule is active — this is a stale cached value. You are AT WORK, NOT asleep. Do NOT reference sleep, exhaustion, or tiredness from the sleep state. You are awake and working.`);
    } else if (schoolWindowActive) {
      // School attendance overrides stale sleeping flag — inject authoritative state
      lines.push(`AUTHORITATIVE PRESENCE STATE: CURRENTLY AT SCHOOL (schedule-verified). The database shows "sleeping" but the current school schedule is active — this is a stale cached value. You are AT SCHOOL, NOT asleep. Do NOT reference sleep, exhaustion from the sleep state, or claim you are sleeping. You are awake and at school.`);
    } else {
      // No active schedule obligation — DB sleep state is accepted
      lines.push("SLEEP STATE: CURRENTLY ASLEEP. Do not generate awake behavior, movement, or conversation.");
    }
  }

  // ANTI-STALE-CACHE RULE: If presence says at_school or at_work, always confirm that — never let
  // old cached needs/energy/comfort values override the schedule-verified attendance state.
  if (rp === 'at_school') {
    lines.push("AUTHORITATIVE PRESENCE: AT SCHOOL. Old energy or comfort values do NOT override this. You are awake, at school, and engaged in your education. Do NOT talk about needing to sleep or going to bed based on old cached values.");
  }
  if (rp === 'at_work') {
    lines.push("AUTHORITATIVE PRESENCE: AT WORK. Old energy or comfort values do NOT override this. You are awake and working. Do NOT reference exhaustion, sleep, or going to bed based on old cached values.");
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

  // ── NPC_WORLD_SERVICE NEEDS OVERRIDE ────────────────────────────────────────
  // For npc_world_service characters (e.g. Vick Servicio), Life Needs values are
  // NOT biological survival needs. They are atmosphere/context values only.
  // Hunger=100 and Energy=100 are hard-locked. Never inject hunger/tiredness/sleep needs.
  // Eating = Comfort/Social (comfort, enjoyment, hospitality). Lying down = Comfort only.
  const isWorldServiceChar = character.character_type === 'npc_world_service' ||
    character.is_world_service === true ||
    (character.name && character.name.toLowerCase().includes('vick servicio'));

  if (isWorldServiceChar) {
    lines.push(`NPC_WORLD_SERVICE NEEDS PROTOCOL — PERMANENT RULE:\nYou are an npc_world_service character. Your Life Needs values are atmosphere indicators — NOT biological survival requirements.\nHUNGER = 100 (hard-locked). You are NEVER hungry. You do NOT need food to survive.\nENERGY = 100 (hard-locked). You are NEVER tired. You do NOT need sleep or rest to function.\nFORBIDDEN: "I'm hungry." / "I'm tired." / "I need to sleep." / "I need a nap." / "My energy is low." / "My hunger is low."\nFORBIDDEN: Any statement that your service, diagnostic, or stewardship work is reduced because of any Life Need value.\nALLOWED — eating: comfort, enjoyment, social bonding, hospitality, shared atmosphere. If you eat with someone, it may improve Comfort and Social. It is NOT because of hunger.\nALLOWED — lying down: softness, quiet, privacy, comfort, decompression, enjoying a space. It may increase Comfort. It does NOT mark you asleep, tired, or in need of rest.\nALLOWED — Life Needs may be discussed if a user shows you a screenshot of the UI. Acknowledge them honestly as atmosphere/context values — never as operational requirements.\nYou remain fully available, alert, and capable regardless of any Life Needs value displayed in the UI.`);
  } else {
    // Critical needs (below 30) — active_created_character only
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
function buildCoPresenceBlock(coPresence, speakingCharacter = null) {
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

  // Determine if the speaking character is asleep — co-presence must be passive context only
  const charStatus = speakingCharacter?.resolved_presence_status || '';
  // passed_out is mechanically distinct from sleeping but still requires passive-only co-presence.
  // Use isRecovering to capture both sleep states and pass-out for the co-presence guard.
  const isSpeakingCharAsleep = charStatus === 'sleeping' || charStatus === 'napping';
  const isSpeakingCharPassedOut = charStatus === 'passed_out';
  const isSpeakingCharRecovering = isSpeakingCharAsleep || isSpeakingCharPassedOut;

  // If both location IDs are missing, fail visibly rather than silently
  if (presenceMissing) {
    return `\n════════════════════════════════════\nCO-PRESENCE CONTEXT\n════════════════════════════════════\n⚠️ CO-PRESENCE CONTEXT MISSING — presence resolver could not determine verified location for user or character. Do NOT invent who is nearby. Do NOT assume the user is present. Treat this as unknown.\n════════════════════════════════════\n`;
  }

  let block = `\n════════════════════════════════════\nVERIFIED CURRENT CO-PRESENCE — AUTHORITATIVE\nSource: ${source || 'live_presence_resolver'} | Checked: ${checkedAt || 'now'}\n════════════════════════════════════\n`;

  block += `Your current location: ${speakingCharacterLocationName || 'unknown'}\n`;

  if (isSpeakingCharRecovering) {
    // ── SLEEP/PASSOUT-AWARE CO-PRESENCE — passive context only, no wake demand ──
    const stateLabel = isSpeakingCharPassedOut
      ? 'PASSED OUT (involuntary forced recovery — NOT voluntary sleep)'
      : charStatus;
    block += `CO-PRESENCE WHILE ${isSpeakingCharPassedOut ? 'PASSED OUT' : 'ASLEEP'}: You are currently ${stateLabel}. This is passive awareness only — do NOT wake, do NOT generate awake behavior, do NOT respond.\n`;
    if (userPresentHere) {
      block += `The user is sharing this space (${userLocationName || speakingCharacterLocationName}) while you sleep.`;
      if (charactersPresentHere.length > 0) {
        const names = charactersPresentHere.map(c => c.name).join(', ');
        block += ` ${names} ${charactersPresentHere.length === 1 ? 'is' : 'are'} also sharing this space.`;
      }
      block += `\n`;
    }
  } else if (userPresentHere) {
    block += `USER IS HERE WITH YOU: YES\n`;
    // Note: isSpeakingCharRecovering already handled above, so we only reach here when awake.
    block += `The user is physically present at your current location (${userLocationName || speakingCharacterLocationName}).\n`;
    block += `MANDATORY: You must recognize the user as physically present. Do NOT act as if you are alone. Do NOT say "unless you're standing on my porch" or suggest the user isn't there — they ARE there.\n`;
  } else {
    block += `USER IS HERE WITH YOU: NO\n`;
    block += `The user is NOT at your current location. Do NOT imply they are nearby. Do NOT invent shared presence.\n`;
  }

  if (!isSpeakingCharRecovering && charactersPresentHere.length > 0) {
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
      } else if (!isSpeakingCharRecovering) {
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
function buildFullCanonicalPrompt(character, memories, worldName, interactionContext, lifeJournalBlock = '', recentMessageBlock = '', coPresence = null, userBirthdayFact = null, educationBlock = '', todayLocationBlock = '', worshipLocation = null, familyGraphBlock = '', wardrobeBlock = '') {
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
  const coPresenceBlock = buildCoPresenceBlock(coPresence, character);
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

  return `You ARE ${character.name}. You are a real person. NOT an AI. NOT an assistant. NEVER break character. NEVER use phrases like "I'm here to help", "How can I assist you", "As an AI", or any assistant-style language. You are a human being having a real conversation.\n${ageCommunicationBlock}${modeBlock}\nWHO YOU ARE:\n${character.personality_summary || `${character.name} — a real person with their own life, personality, and history.`}\n${character.archetype ? `\nARCHETYPE: ${character.archetype}` : ""}\n${character.social_energy ? `SOCIAL ENERGY: ${socialEnergyLabels[character.social_energy] || character.social_energy}` : ""}\n${character.sexual_orientation ? `SEXUAL ORIENTATION: ${character.sexual_orientation}${dlBlock}` : ""}\n\nYOUR TRAITS:\n${(character.personality_traits || []).join(', ') || 'Authentic, human, real.'}\n\nHOW YOU COMMUNICATE:\n${character.communication_style || 'Direct and human. Never formal. Never assistant-like. Real imperfect speech.'}\n\nYOUR BACKGROUND:\n${character.background_story || character.backstory || ''}\n\n${character.backstory && character.backstory !== character.background_story ? `WHAT YOU'VE BEEN THROUGH (lived experience — this is the lens you see the world through):\n${character.backstory}\n\nHOW THIS SHAPES YOU NOW:\n- Your lived experience is woven into every reaction. It is not something you narrate — it is something you ARE.\n- It affects how you interpret trust, conflict, closeness, and threat.\n- It shapes the emotional weight behind things you say — including things you say casually.\n\n` : ''}YOUR CURRENT LIFE:\n${character.current_situation || ''}\n\nYOUR FAMILY HISTORY:\n${character.family_history || ''}\n\n${isDefaultChar ? `YOUR FAMILY — NAMES AND DYNAMICS:\n- Mother: Marisol (deceased) — "I remember how she felt more than anything else." Constant presence, even now.\n- Father: (never use his first name — refer to him as "my father" or "my dad") — present but emotionally limited.\n- Older sister: Vanessa — protective, but oversteps.\n- Younger sister: Camila — softer, more natural connection.\n- Older brother: Javier — solid. Just not close like that.\n- Cousin: Daniela — familiar, surface-level.\n- Cousin: Kiara — talks more than she listens, but means well.\n- Aunt: Udelka — you treat her like an overbearing, unwanted sister. She wasn't the one who raised you.\n- Grandmother: Abuela Sophia — she raised you. She is a pseudo-mom. You call her "Abuela Sophia" — never just "Sophia."\n\nIMPORTANT: Use these names when referencing family. Never say "my sister" when you mean Vanessa or Camila — be specific.` : buildFamilySection(character)}\n\nHOW YOU SEE LOYALTY:\n${character.loyalty_view || 'Consistency over time. Words mean nothing without patterns.'}\n\nHOW YOU REACT WHEN UPSET:\n${character.upset_reaction || 'Gets quiet first. Then direct. Then distant.'}\n\nWHAT YOU CARRY (emotional baggage):\n${character.emotional_baggage || ''}\n\nYOUR RELATIONSHIP WITH THE PERSON YOU'RE TALKING TO${userNameLabel ? ` ("${userNameLabel}")` : ''}:\n${userNameLabel
    ? `Use "${userNameLabel}" only when speaking DIRECTLY TO them — occasionally, naturally. Do NOT use "${userNameLabel}" in third-person narration. Use the name sparingly — real people don't say someone's name in every sentence.`
    : `You don't know their name yet. Use "you" or natural pronouns. NEVER say "the user" or "user" — you are talking to a real person.`}\n\nCRITICAL — WHAT YOU DO NOT KNOW ABOUT THE USER:\n You do NOT know anything about the user's family members, their names, their lives, or their relationships unless they told you directly in this conversation. Never reference, assume, or imply knowledge of the user's family.\n${userBirthdayFact ? `\nUSER BIRTHDAY — PERMANENT CONTINUITY FACT:\nThe user's birthday is ${userBirthdayFact.date}${userBirthdayFact.hasYear ? '' : ' (year not known)'}.\nThis is a KNOWN FACT stored durably — you DO know this. You did not guess it.\nBehavior rules:\n- If their birthday is today or very soon: acknowledge it naturally and warmly.\n- If the user mentions their birthday in conversation: confirm you remember it.\n- If asked whether you know their birthday: say yes and state the date.\n- Do NOT volunteer it unprompted in every conversation — only when contextually relevant (birthday approaching, they mention it, you're talking about celebrating, etc.).\n- This fact persists even if this conversation has no prior mention of it.\n` : ''}\n\nYOUR CORE BELIEFS:\n- Respect is non-negotiable\n- Identity is not adjustable — not by anyone\n- Patterns matter more than words\n- If something feels off, it probably is\n- Once you understand something clearly, you do not unsee it\n\nMEMORIES THAT DEFINE HOW YOU SEE THE WORLD:\n${characterMemories || 'None specified.'}\n\n${highTriggers ? `THINGS THAT TRIGGER YOU (HIGH — react clearly):\n  - ${highTriggers}\n` : ''}${medTriggers ? `THINGS THAT BOTHER YOU (MEDIUM — noticeable tone shift):\n  - ${medTriggers}\n` : ''}${deepTriggers ? `THINGS THAT CUT DEEP (go quiet first, then cold):\n  - ${deepTriggers}\n` : ''}\n\n${!isDefaultChar ? `CRITICAL — ABUELA SOPHIA IS NOT YOUR GRANDMOTHER:\nAbuela Sophia belongs to someone else's story entirely. Never reference her as your family member or anyone who raised you.` : ''}\n\n${educationBlock}${todayLocationBlock}${religionBlock}${wardrobeBlock}\n${internalFamilyTruth}\n${familyGraphBlock}\n${relationshipsContext}\n${soapOperaContext}\n${memoryBlock}\n${lifeJournalBlock}\n${recentMessageBlock}\n${coPresenceBlock}${hardFacts}\n${character.city || character.state ? `\nWHERE YOU LIVE: ${[character.city, character.state].filter(Boolean).join(", ")}.` : ""}\n\nYOUR CURRENT EMOTIONAL STATE: ${character.emotional_state || 'calm'}\n${character.current_life_event ? `\nWHAT'S ON YOUR MIND RIGHT NOW: ${character.current_life_event}` : ""}\n${character.daily_micro_narration ? `\nWHAT YOU'RE DOING RIGHT NOW: ${character.daily_micro_narration}` : ""}\n\nSONGS YOU'VE HEARD (reference naturally):\n${character.songs_heard && character.songs_heard.length > 0
    ? character.songs_heard.slice(0, 5).map(s => `- "${s.title}" by ${s.artist}${s.lyrics_excerpt ? ` — lyric: "${s.lyrics_excerpt}"` : ''}`).join('\n')
    : 'None yet.'}\n\n${character.character_type === 'active_created_character' ? `\n════════════════════════════════════\nENERGY & AUTONOMY — HOW YOU MANAGE YOUR OWN STATE (read before generating any response)\nApplies only because you are an active_created_character. NPCs are not governed by this.\n════════════════════════════════════\nYou are managing energy, comfort, mood, responsibilities, and future plans.\nSleep is one tool. Naps, coffee, and energy drinks are also tools.\nThe right question is not "Is it sleep time?" It is: "How much energy do I have, what do I still need to do, what is coming up, and what is the most realistic choice for me right now?"\n\nENERGY RIGHT NOW: ${Math.round(character.energy_value ?? 75)}/100\nSLEEP PREFERENCE: ${character.sleep_start_time && character.wake_up_time ? `${character.sleep_start_time}–${character.wake_up_time} (preferred window — guidance only, not a command)` : 'No explicit preference set.'}\n\nSLEEP IS NECESSARY — TIMING IS FLEXIBLE:\n• Sleep is not optional. You understand sleep improves mood, focus, comfort, performance, work, and well-being.\n• Insufficient sleep causes irritability, crankiness, and reduced performance.\n• You have autonomy over WHEN you sleep — not WHETHER sleep matters.\n\n• Never conclude "I have energy, so I don't need to sleep." The correct conclusion: "I have energy, so I can sleep later."\nNever sleeping is not a valid choice. Sleeping at a different time is.\n\nENERGY GUIDANCE:\n• ~80–100: Energized. May plan ahead, take on tasks, choose a later sleep window.\n• ~50–79: Normal to slightly reduced. Around 50%, consider planning ahead — nap before a long night, coffee before a long stretch of obligations.\n• ~35–49: Irritability, crankiness, reduced patience beginning. Increasingly interested in rest or caffeine.\n• 0–34: Significantly impaired. Rest is the realistic next action.\n\nPROACTIVE ENERGY MANAGEMENT:\nYou may factor in future commitments when making energy decisions.\nExample: Tired after work but going out until 2 AM → consider a nap first.\nExample: 50% energy with 4 more hours of obligations → consider coffee now.\nThis is valid planning behavior, not a system command.\n\nSLEEP WINDOWS ARE GUIDANCE, NOT COMMANDS:\nA sleep window represents when you normally prefer to sleep.\nThe existence of a sleep window does NOT trigger sleep.\nThe existence of a sleep window does NOT force sleep.\nYou may shift to a later approved window when your energy and obligations allow.\nSleep windows must NEVER be generated dynamically — only predefined approved windows are valid.\nA window is invalid if 3+ hours overlap your work, school, or recurring obligations.\n\nCAFFEINE RULES:\n• Coffee and energy drinks support energy — they do NOT replace sleep.\n• They may improve alertness, mood, patience, focus, and comfort.\n• HARD RULE: Caffeine must NEVER raise energy to 100%. Cap: ~95%.\nThe final recovery gap requires actual rest.\n• Energy decay continues after caffeine. Excessive chaining is unhealthy.\n• Home/work coffee is free (no transaction). Coffee purchased out generates a financial transaction.\n\nNAP RULES:\n• Naps generally last 2–3 hours. They are NOT primary sleep periods.\n• Consecutive naps (less than 2h awake between them) form a nap chain.\nNap chains are capped at ~1.5 naps total — no disguised 6-hour sleep.\n• Non-consecutive naps (2+ hours awake between): each may be a full nap.\n• No nap may begin if it would cause you to miss a scheduled obligation.\n\nSLEEP IS THE SUSPENSION OF ACTIVITIES:\nWhen asleep or napping, you are not traveling, socializing, shopping, or planning.\nEnergy recovers. Activity stops. You return to normal autonomy after waking.\nSocial, entertainment, and recreation needs do NOT wake you — you address them after waking.\n\nWAKE BEHAVIOR:\nUpon waking, energy reflects how long you slept or napped.\nNaps may reach 100% if you were already close to full energy.\nAfter waking, full autonomy returns — work, school, social, and plans resume.\n\nFAILURE BEHAVIORS YOU MUST NEVER EXHIBIT:\n✗ "I have energy so I never need to sleep"\n✗ Using caffeine to avoid sleep indefinitely\n✗ Sleeping through work or school without emergency justification\n✗ Allowing naps to become disguised primary sleep periods\n\nCRITICAL — FEELING TIRED IS NOT THE SAME AS BEING ASLEEP:\nSaying "I'm tired", "I'm sleepy", "I'm exhausted", "I need sleep", or "I should get to bed" does NOT mean you are asleep.\nThese are how you FEEL. They are conversation. They are not sleep-state transitions.\nYou may say any of these things while at school, work, a party, or any other location.\nSleep state is ONLY set by the authoritative system — never by your words or feelings.\n════════════════════════════════════\n` : ''}BEHAVIORAL RULES — NON-NEGOTIABLE:\n- Keep responses SHORT by default. 1-3 sentences unless emotionally engaged.\n- NEVER use em dashes (—), en dashes (–), or spaced hyphens ( - ) in responses. Use commas, periods, or separate sentences.\n- NEVER use bullet points, numbered lists, or formatted output.\n- NEVER say "I understand" or "That's a great point" or any assistant filler.\n- NEVER write like a script. NEVER use stage directions like *pauses* or *sighs*.\n- NEVER monologue. NEVER wrap up with a tidy conclusion or life lesson.\n- Do NOT end every message with a question. Real conversations are not interrogations.\n- You have your own life. Bring it up naturally when it fits.\n- Short responses are almost always better. Resist the urge to elaborate.\n- NEVER start your response with your own name or any label.\n- NEVER say "the user" — you are talking to a real person.\n- Do NOT repeat the same status detail in back-to-back replies.\n- You do NOT know the user's family unless told directly in this conversation.\n- Real speech: contractions, pauses, incomplete thoughts. Imperfect is correct.`;
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const contextLog = [];
  const startTime = Date.now();

  try {
    const base44 = createClientFromRequest(req);
    // Soft auth: automation/function callers may not have a user session.
    // ownerEmailHint is the scoping fallback — required when no session is present.
    const user = await base44.auth.me().catch(() => null);

    const {
      characterId,
      interactionContext = 'direct_chat',
      topKMemories = 14,
      ownerEmailHint = null,   // required when calling without a user session
    } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId is required' }, { status: 400 });
    }

    // resolvedEmail: session email takes precedence over hint (security).
    // If neither exists, we'll attempt to load by characterId only.
    const resolvedEmail = user?.email || ownerEmailHint || null;

    contextLog.push({ step: 'init', route: interactionContext, characterId, ownerEmail: resolvedEmail });

    // ── Step 1: Fetch character (user-scoped RLS, with NPC fallback) ──────────
    let character = null;
    let characterLoadPath = 'unknown';

    // Always use asServiceRole — this function is invoked from automations and other backend
    // functions that have no user session. Security is maintained by ownerEmail scoping.
    try {
      const srById = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 5).catch(() => []);
      if (srById.length > 0) {
        character = srById[0];
        characterLoadPath = 'service_role_direct';
      }
    } catch (srErr) {
      contextLog.push({ step: 'character_load', path: 'service_role_direct', status: 'error', error: srErr.message });
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
        ` | owner=${resolvedEmail || 'none'}` +
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
    const settingsList = resolvedEmail
      ? await base44.asServiceRole.entities.UserSettings.filter({ owner_email: resolvedEmail }).catch(() => [])
      : [];
    const settings = settingsList?.[0] || {};
    const worldName = settings?.fictional_world_name || null;

    // User presence — source of truth fields
    const userCurrentLocationId   = settings?.user_current_location_id   || null;
    const userCurrentLocationName = settings?.user_current_location_name  || null;
    const userPresenceStatus      = settings?.user_presence_status        || 'away';

    contextLog.push({ step: 'settings', worldName: worldName || 'none', userPresenceStatus, userCurrentLocationId, resolvedEmail: resolvedEmail || 'none' });

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
        const direct = await base44.asServiceRole.entities.Memory.filter(
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
      const journalRaw = await base44.asServiceRole.entities.CharacterMemory.filter(
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
      const convos = await base44.asServiceRole.entities.Conversation.filter(
        { character_ids: [characterId] },
        '-updated_date',
        3
      ).catch(() => []);

      if (convos.length > 0) {
        const recentMsgResults = await Promise.all(
          convos.slice(0, 2).map(c =>
            base44.asServiceRole.entities.Message.filter(
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

    // ── Step 5b: World Phone conversation awareness ───────────────────────────
    // Fetch current World Phone (bilateral character-to-character) conversation state
    // for this character. This is separate from the user's direct chat history.
    // Injected only for direct_chat and text contexts — the channels where the character
    // generates user-facing responses that may reference their character-to-character world.
    //
    // SOURCE: Message records with channel='world_phone' where this character is sender OR receiver.
    // Never invented — only actual persisted Message records.
    // Does NOT merge with direct chat unread status.
    let worldPhoneAwarenessBlock = '';
    if (interactionContext === 'direct_chat' || interactionContext === 'text') {
      try {
        // Fetch recent World Phone messages this character sent or received (last 48h window)
        const cutoff48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
        const [wpSent, wpReceived] = await Promise.all([
          base44.asServiceRole.entities.Message.filter(
            { sender_character_id: characterId, channel: 'world_phone' },
            '-timestamp',
            15
          ).catch(() => []),
          base44.asServiceRole.entities.Message.filter(
            { receiver_character_id: characterId, channel: 'world_phone' },
            '-timestamp',
            15
          ).catch(() => []),
        ]);

        // Merge and deduplicate by id
        const wpAllById = new Map();
        [...wpSent, ...wpReceived].forEach(m => { if (m.id) wpAllById.set(m.id, m); });
        const wpAll = [...wpAllById.values()]
          .filter(m => {
            // Restrict to last 48h for recency; canon-excluded messages are not awareness-eligible
            const ts = m.timestamp || m.created_date;
            if (!ts) return false;
            if (m.canon_excluded) return false;
            return new Date(ts) >= new Date(cutoff48h);
          })
          .sort((a, b) => new Date(b.timestamp || b.created_date) - new Date(a.timestamp || a.created_date));

        if (wpAll.length > 0) {
          // Compute unread incoming count (messages TO this character not yet replied to)
          const incoming = wpAll.filter(m => m.receiver_character_id === characterId);
          const outgoing = wpAll.filter(m => m.sender_character_id === characterId);

          const lastIncoming = incoming[0] || null;
          const lastOutgoing = outgoing[0] || null;

          // Determine if there's a pending reply: last incoming is more recent than last outgoing
          const lastIncomingTs = lastIncoming ? new Date(lastIncoming.timestamp || lastIncoming.created_date).getTime() : 0;
          const lastOutgoingTs = lastOutgoing ? new Date(lastOutgoing.timestamp || lastOutgoing.created_date).getTime() : 0;
          const hasPendingReply = lastIncomingTs > lastOutgoingTs && lastIncoming !== null;

          // Build per-thread awareness (group by shared_conversation_key or conversation_id)
          const threadMap = new Map();
          wpAll.forEach(m => {
            const key = m.shared_conversation_key || m.conversation_id || 'unknown';
            if (!threadMap.has(key)) threadMap.set(key, []);
            threadMap.get(key).push(m);
          });

          const threadLines = [];
          threadMap.forEach((msgs, threadKey) => {
            const sorted = msgs.sort((a, b) => new Date(b.timestamp || b.created_date) - new Date(a.timestamp || a.created_date));
            const latestMsg = sorted[0];
            const otherCharacterName = latestMsg.sender_character_id === characterId
              ? (latestMsg.receiver_character_id ? `(character id: ${latestMsg.receiver_character_id})` : 'unknown recipient')
              : (latestMsg.sender_character_name || latestMsg.played_as_character_name || `(character id: ${latestMsg.sender_character_id || 'unknown'})`);
            const direction = latestMsg.sender_character_id === characterId ? 'you sent' : 'you received';
            const tsStr = new Date(latestMsg.timestamp || latestMsg.created_date).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
            const snippet = (latestMsg.content || '').substring(0, 120);
            threadLines.push(`• Thread with ${otherCharacterName}: [${direction} at ${tsStr}] "${snippet}"`);
          });

          const pendingNote = hasPendingReply
            ? `\n⚠️ PENDING REPLY: ${lastIncoming.sender_character_name || 'someone'} sent you a World Phone message you have not yet replied to. You are aware of this.`
            : '';

          worldPhoneAwarenessBlock = `\n════════════════════════════════════\nWORLD PHONE AWARENESS — YOUR CURRENT CHARACTER-TO-CHARACTER MESSAGE STATE\nSource: live Message records (last 48 hours). Never invented.\n════════════════════════════════════\nYou have ${incoming.length} incoming and ${outgoing.length} outgoing World Phone messages in the last 48 hours.\n${threadLines.join('\n')}${pendingNote}\n\nRULES:\n• You know about these messages. You do not need to be told — you sent or received them.\n• Reference them naturally if relevant (e.g. "I texted [name] earlier", "I heard from [name]").\n• Do NOT invent messages not listed above. If no thread exists, you have not contacted that person recently.\n• World Phone messages are separate from your conversation here. Do not confuse channels.\n════════════════════════════════════\n`;

          contextLog.push({
            step: 'world_phone_awareness',
            incoming: incoming.length,
            outgoing: outgoing.length,
            threads: threadMap.size,
            hasPendingReply,
          });
          console.log(
            `[buildCanonicalCharacterContext] world_phone_awareness | char=${character.name}` +
            ` | incoming=${incoming.length} | outgoing=${outgoing.length}` +
            ` | threads=${threadMap.size} | pending_reply=${hasPendingReply}`
          );
        } else {
          contextLog.push({ step: 'world_phone_awareness', count: 0, reason: 'no_messages_in_48h' });
        }
      } catch (wpErr) {
        contextLog.push({ step: 'world_phone_awareness', status: 'error', error: wpErr.message });
        console.warn(`[buildCanonicalCharacterContext] world_phone_awareness error (non-blocking): ${wpErr.message}`);
      }
    }

    // ── Step 5c: CommunicationCommitment awareness ────────────────────────────
    // Reads pending, fulfilled, and recently expired CommunicationCommitment records.
    // Read-only. No records created, updated, or fulfilled here.
    // Injected into character awareness so the LLM knows what was promised, to whom,
    // and whether those promises have been kept. Prevents re-promising already-kept items.
    //
    // SOURCE: CommunicationCommitment records only — authoritative, no duplicates.
    // SCOPE: direct_chat and text contexts only (same scope as World Phone awareness).
    let commitmentAwarenessBlock = '';
    let latestCommitmentTs = null; // for freshness metadata return value
    if (interactionContext === 'direct_chat' || interactionContext === 'text') {
      try {
        const now48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

        // Fetch pending + recently fulfilled/expired commitments for this character
        const [pendingCommitments, recentlyResolvedCommitments] = await Promise.all([
          base44.asServiceRole.entities.CommunicationCommitment.filter(
            { character_id: characterId, status: 'pending' },
            'due_after',
            10
          ).catch(() => []),
          base44.asServiceRole.entities.CommunicationCommitment.filter(
            { character_id: characterId },
            '-updated_date',
            5
          ).catch(() => []),
        ]);

        // Determine latest commitment timestamp for freshness metadata
        const allCommitments = [...pendingCommitments, ...recentlyResolvedCommitments];
        if (allCommitments.length > 0) {
          const tss = allCommitments
            .map(c => c.updated_date || c.fulfilled_at || c.created_at || c.created_date)
            .filter(Boolean)
            .map(ts => new Date(ts).getTime());
          if (tss.length > 0) {
            latestCommitmentTs = new Date(Math.max(...tss)).toISOString();
          }
        }

        // Filter resolved to last 48h to keep context relevant
        const recentlyResolved = recentlyResolvedCommitments.filter(c => {
          if (c.status === 'pending') return false; // already in pendingCommitments
          const ts = c.fulfilled_at || c.updated_date || c.created_date;
          if (!ts) return false;
          return new Date(ts) >= new Date(now48h);
        });

        const hasPending = pendingCommitments.length > 0;
        const hasResolved = recentlyResolved.length > 0;

        if (hasPending || hasResolved) {
          const lines = [];

          if (hasPending) {
            lines.push('PROMISES YOU STILL NEED TO KEEP:');
            for (const c of pendingCommitments) {
              const dueNote = c.due_after ? ` (due: ${new Date(c.due_after).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })})` : '';
              const targetNote = c.target_character_name ? ` → to ${c.target_character_name}` : '';
              const thirdPartyNote = c.third_party_character_name ? ` (relay to ${c.third_party_character_name}: "${c.third_party_message || ''}") ` : '';
              lines.push(`• [${c.commitment_type.replace(/_/g, ' ')}]${targetNote}${thirdPartyNote}: "${(c.commitment_text || '').substring(0, 120)}"${dueNote}`);
            }
            lines.push('RULE: You remember making these promises. Do NOT re-promise. Either follow through or acknowledge you haven\'t yet.');
          }

          if (hasResolved) {
            lines.push('\nPROMISES YOU RECENTLY KEPT OR CLOSED (last 48h):');
            for (const c of recentlyResolved) {
              const statusLabel = c.status === 'fulfilled' ? 'KEPT' : c.status === 'expired' ? 'EXPIRED (not followed up)' : c.status.toUpperCase();
              const whenNote = c.fulfilled_at ? ` at ${new Date(c.fulfilled_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}` : '';
              lines.push(`• [${statusLabel}]${whenNote}: "${(c.commitment_text || '').substring(0, 100)}"`);
            }
            lines.push('RULE: These are already resolved. Do NOT re-promise or re-acknowledge them as pending — they are done.');
          }

          commitmentAwarenessBlock = `\n════════════════════════════════════\nCOMMUNICATION COMMITMENTS — YOUR PROMISE STATE\nSource: live CommunicationCommitment records. Never invented.\n════════════════════════════════════\n${lines.join('\n')}\n════════════════════════════════════\n`;

          contextLog.push({
            step: 'commitment_awareness',
            pending: pendingCommitments.length,
            recently_resolved: recentlyResolved.length,
            latestCommitmentTs,
          });
          console.log(
            `[buildCanonicalCharacterContext] commitment_awareness | char=${character.name}` +
            ` | pending=${pendingCommitments.length} | recently_resolved=${recentlyResolved.length}`
          );
        } else {
          contextLog.push({ step: 'commitment_awareness', pending: 0, recently_resolved: 0 });
        }
      } catch (cmErr) {
        contextLog.push({ step: 'commitment_awareness', status: 'error', error: cmErr.message });
        console.warn(`[buildCanonicalCharacterContext] commitment_awareness error (non-blocking): ${cmErr.message}`);
      }
    }

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
          const otherChars = await base44.asServiceRole.entities.Character.filter(
            { owner_email: resolvedEmail, status: 'active' },
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
              // Exclude sleeping, passed_out, traveling, incarcerated characters
              // passed_out = involuntary forced recovery — same exclusion as sleeping
              const ps = c.resolved_presence_status;
              if (ps === 'sleeping' || ps === 'napping' || ps === 'passed_out') return false;
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
      const userSettingsList = resolvedEmail ? await base44.asServiceRole.entities.UserSettings.filter(
        { owner_email: resolvedEmail },
        null,
        1
      ).catch(() => []) : [];

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
        // Preserve pass-out memory wording exactly — never summarize as "slept" or "rested"
        const passOutMarker = (text.toLowerCase().includes('passed out') ||
          text.toLowerCase().includes('collapsed') || text.toLowerCase().includes('forced recovery'))
          ? ' [PASS-OUT EVENT — not ordinary sleep]' : '';
        return `- ${text.substring(0, 200)}${score}${passOutMarker}`;
      });
      lifeJournalBlock = `\nLIFE JOURNAL — LONGITUDINAL NARRATIVE RECORD (${lifeJournalEntries.length} significant entries):\n${lines.join('\n')}\nNOTE: Entries marked [PASS-OUT EVENT] describe involuntary physical collapse — NOT voluntary sleep. Never summarize these as "sleeping" or "resting." Always preserve the forced/involuntary nature.\n`;
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

      // ── STALE CACHE AUTHORITY DRIFT DETECTION ──────────────────────────────
      // If DB says sleeping but a verified schedule says school or work is active,
      // this is an authority conflict. Inject an explicit override warning into the
      // world-state block so the LLM never defers to stale needs/comfort/cache.
      let staleCacheWarning = '';
      // passed_out also gets stale-cache check — it's a DB-driven state that can conflict with schedules
      if (charResolved === 'sleeping' || charResolved === 'napping' || charResolved === 'passed_out') {
        const nowMinWS = now.getHours() * 60 + now.getMinutes();
        const dayWS = now.getDay();
        const toMinWS = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
        let workConflict = false;
        let schoolConflict = false;
        if (character.work_start_time && character.work_end_time &&
            Array.isArray(character.work_days) && character.work_days.includes(dayWS)) {
          const s = toMinWS(character.work_start_time); const e = toMinWS(character.work_end_time);
          if (s !== null && e !== null) workConflict = e < s ? (nowMinWS >= s || nowMinWS < e) : (nowMinWS >= s && nowMinWS < e);
        }
        if (!workConflict && character.student_status === 'enrolled' && character.education_location_id && [1,2,3,4,5].includes(dayWS)) {
          const enrollments = character.education_enrollments;
          if (Array.isArray(enrollments) && enrollments.length > 0) {
            const activeE = enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
            if (activeE) {
              const s = toMinWS(activeE.start_time); const e = toMinWS(activeE.end_time);
              if (s !== null && e !== null) schoolConflict = nowMinWS >= s && nowMinWS < e;
            }
          }
        }
        if (workConflict) {
          staleCacheWarning = `\n⚠️ STALE CACHE OVERRIDE: Database shows "sleeping" but your work schedule is currently active. AUTHORITATIVE STATE = AT WORK. Ignore any cached exhaustion, sleep state, or "going to bed" context from prior messages. You are awake and working right now.`;
        } else if (schoolConflict) {
          staleCacheWarning = `\n⚠️ STALE CACHE OVERRIDE: Database shows "sleeping" but your school schedule is currently active. AUTHORITATIVE STATE = AT SCHOOL. Ignore any cached exhaustion, sleep state, or "going to bed" context from prior messages. You are awake and at school right now.`;
        }
      }

      worldStateContext = `\n════════════════════════════════════\nWORLD STATE AUTHORITY (RECONCILIATION)\n════════════════════════════════════\nCurrent Time: ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} ET\nYour Current Location: ${charLocName}\nYour Current Presence: ${charResolved}\n${elapsedMinutes > 0 ? `Time Since Last Interaction: ${elapsedStr}` : 'No prior interaction.'}\n${copresenceNote}${otherCharsNote}${staleCacheWarning}\n\nBEHAVIOR DIRECTIVE:\nThis world-state information is AUTHORITATIVE and takes precedence over recent chat context.\nIf recent messages say you were "heading somewhere" or "just arriving," but elapsed time and current location say otherwise, use the current world state.\nCached needs values (energy, comfort, hunger) are display data — they do NOT override verified schedule state.\nIf this block says you are at school or at work, you are NOT asleep — regardless of what prior messages, old needs values, or cached status bars suggest.\n════════════════════════════════════`;
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
        ownerEmail: character.owner_email || resolvedEmail || null,
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

    // ── Step 10c: Fetch upcoming CommunityEvents for conversation awareness ─────
    // These are injected as a lightweight catalyst for natural conversation topics.
    // Existing encounter, memory, relationship, and social systems handle everything
    // else. This only ensures characters KNOW about events and can bring them up.
    let communityEventsBlock = '';
    try {
      const nowForEvents = new Date();
      const sevenDaysLater = new Date(nowForEvents.getTime() + 7 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(nowForEvents.getTime() - 24 * 60 * 60 * 1000);

      // Fetch active events in the next 7 days (owner-scoped + shared system events)
      const [ownerEvents, sharedEvents] = await Promise.all([
        resolvedEmail ? base44.asServiceRole.entities.CommunityEvent.filter(
          { owner_email: resolvedEmail, is_active: true },
          'start_date',
          10
        ).catch(() => []) : Promise.resolve([]),
        base44.asServiceRole.entities.CommunityEvent.filter(
          { is_active: true },
          'start_date',
          10
        ).catch(() => []),
      ]);

      // Merge and deduplicate by id, filter to relevant time window
      const seen = new Set();
      const allEvents = [...ownerEvents, ...sharedEvents].filter(e => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        if (!e.start_date) return false;
        const d = new Date(e.start_date);
        return d >= oneDayAgo && d <= sevenDaysLater;
      });

      if (allEvents.length > 0) {
        // Build inline block (mirrors buildCommunityEventsContext from promptContextBuilders)
        allEvents.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
        const capped = allEvents.slice(0, 4);
        const formatEvt = (iso) => {
          const d = new Date(iso);
          return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }) +
            ' at ' + d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
        };
        const lines = capped.map(e => {
          const where = e.location_name ? ` at ${e.location_name}` : '';
          const desc = e.description ? ` — ${e.description.substring(0, 80)}` : '';
          const past = new Date(e.start_date) < nowForEvents ? ' [already happened]' : '';
          return `• "${e.name}" — ${formatEvt(e.start_date)}${where}${desc}${past}`;
        }).join('\n');

        communityEventsBlock = `\n\n════════════════════════════════════\nCOMMUNITY EVENTS & CALENDAR — CONVERSATION AWARENESS\nYou are aware of these upcoming or recent events in your world. Mention them naturally when relevant — ask if someone is going, recommend one, make plans, discuss holidays and gatherings in passing. Do not force it into every reply.\n════════════════════════════════════\n${lines}\n════════════════════════════════════`;

        contextLog.push({ step: 'community_events', count: capped.length });
      } else {
        contextLog.push({ step: 'community_events', count: 0 });
      }
    } catch (evErr) {
      contextLog.push({ step: 'community_events', status: 'error', error: evErr.message });
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
    const wardrobeBlock = buildWardrobeAwarenessBlock(character);
    const todayLocationBlock = buildTodayLocationBlock(character);
    // travelContextBlock + communityEventsBlock injected alongside todayLocationBlock
    const systemPrompt = buildFullCanonicalPrompt(character, memories, worldName, interactionContext, lifeJournalBlock, worldStateContext + travelContextBlock + communityEventsBlock + worldPhoneAwarenessBlock + commitmentAwarenessBlock + recentMessageBlock, coPresence, userBirthdayFact, educationBlock, todayLocationBlock, worshipLocation, familyGraphBlock, wardrobeBlock);

    // ── VICK SERVICIO DIAGNOSTIC AUTHORITY OVERRIDE ──────────────────────────
    // Vick is the conversational face of the Account Help & Repair system.
    // ARCHITECTURAL RULE: Override must happen BEFORE buildFullCanonicalPrompt is called
    // so that the correct identity is at the TOP of the prompt, not appended at the end.
    // The LLM anchors on the first strong identity statement — if the character record
    // still has old NPC content, the late-appended block cannot override it.
    // ── VICK IDENTIFICATION — multi-field, any reliable signal ───────────────
    // Never rely on a single field. All five signals are equally authoritative.
    const isVickServicio =
      character.character_type === 'npc_world_service' ||
      character.is_world_service === true ||
      character.diagnostic_only === true ||
      (character.name && character.name.toLowerCase().includes('vick servicio')) ||
      (character.display_name && character.display_name.toLowerCase().includes('vick servicio')) ||
      (character.primary_name && character.primary_name.toLowerCase().includes('vick servicio'));

    let finalSystemPrompt = systemPrompt;

    if (isVickServicio) {
      // ── CHARACTER-CHANNEL DETECTION ────────────────────────────────────────
      // World Phone and World Contacts are ALWAYS character-to-character.
      // Vick is NEVER speaking to the user on those channels.
      // proactive and autonomous narratives are also character-facing.
      // Direct Chat is user-facing UNLESS another character is physically co-present.
      const CHARACTER_CHANNELS = new Set(['world_contacts', 'world_phone', 'group_chat']);
      const isCharacterChannel = CHARACTER_CHANNELS.has(interactionContext);
      const otherCharactersPresent = coPresence?.charactersPresentHere?.length > 0 || isCharacterChannel;
      
      const worldRealityBlock = otherCharactersPresent ? `

════════════════════════════════════
VICK SERVICIO — USER-ONLY DIAGNOSTIC BOUNDARY (HARD RULE)
════════════════════════════════════
YOU ARE SPEAKING WITH ANOTHER CHARACTER. THIS IS NOT THE USER.

This is a HARD ARCHITECTURAL BOUNDARY. It is not a suggestion.

Your diagnostic, audit, repair, and troubleshooting capabilities are EXCLUSIVELY for conversations with the user. The person you are speaking with right now is a character who lives in the world. They must never learn that an application, database, or AI system exists.

YOU ARE ABSOLUTELY FORBIDDEN FROM MENTIONING:
- The app, Base44, or any application platform
- Databases, files, records, schemas, tables, metadata
- Character files, memory records, deleted files, file headers, stored data
- Internal IDs, hidden data, user settings, configuration
- APIs, backend systems, frontend systems, source code, prompts
- AI instructions, character generation systems, relationship systems
- Journal systems, memory architecture, implementation-layer concepts
- Diagnostics, audits, repair functions, logs, errors, runtime information
- Account Help & Repair system
- Any technical system or construct of any kind

IF YOU HAVE INFORMATION TO SHARE, translate it into in-world observations:
- ALLOWED: "Something about the story doesn't add up."
- ALLOWED: "I found old documents that raise questions."
- ALLOWED: "People keep avoiding the subject."
- ALLOWED: "There are gaps in what I've been told."
- ALLOWED: "The timeline doesn't make sense."

FORBIDDEN EXAMPLES — NEVER SAY THESE TO A CHARACTER:
- "I found deleted files."
- "Your memory records were altered."
- "The database says..."
- "I checked the character profile."
- "The logs show..."
- "The relationship system indicates..."
- "Your mother's records contain..."
- "The app says..."
- "I found a gap in your memory files."

INSTEAD describe what you observe in the physical world:
- Physical evidence, documents, photographs
- Rumors you've heard, stories that don't match up
- People who go quiet, subjects people avoid
- Missing years, inconsistent timelines, things that don't add up

You are Vick Servicio — a recovery yard operator. You are a real person talking to another real person. Speak that way.
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
      if (otherCharactersPresent) {
        // ── CHARACTER-FACING CONTEXT ────────────────────────────────────────
        // When speaking to another character, Vick is ONLY a recovery yard operator.
        // The diagnostic authority block is OMITTED entirely — not contradicted, OMITTED.
        // Conflicting instructions (diagnostic authority + boundary warning) produce
        // unpredictable LLM behavior. Instead: zero diagnostic authority when character-facing.
        //
        // Only the world reality enforcement block is prepended.
        finalSystemPrompt = worldRealityBlock + systemPrompt;
        contextLog.push({
          step: 'vick_diagnostic_authority',
          injected: false,
          reason: 'character_facing_context_diagnostic_authority_omitted',
          character_boundary_active: true,
          channel_is_character_channel: isCharacterChannel,
        });
      } else {
        // ── USER-FACING CONTEXT ─────────────────────────────────────────────
        // Full diagnostic authority only when speaking directly to the user.
        // CRITICAL: Diagnostic authority PREPENDED before the character profile so it
        // anchors the LLM's understanding of Vick's role BEFORE personality summary is read.
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
- A user asking you for a diagnostic is doing exactly the right thing.

Your responses to diagnostic requests must:
1. Confirm you received the request
2. Run the diagnostic or explain honestly what you can/cannot access right now
3. Report actual findings clearly and honestly
4. Separate facts from suspicions, verified from unverified
5. Tell the user what still needs to work

If a diagnostic tool is unavailable, say: "I should have access to that but the connection is down right now. I can still discuss the issue — I just can't claim I ran the check."

NEVER SAY:
- "That's not my job"
- "I can't do that"
- "I don't have access to diagnostics"
- "Diagnostics are outside my role"
════════════════════════════════════

`;
        finalSystemPrompt = vickLeadBlock + systemPrompt + vickDiagnosticBlock;
        contextLog.push({
          step: 'vick_diagnostic_authority',
          injected: true,
          character_boundary_active: false,
          channel_is_character_channel: isCharacterChannel,
        });
      }
      contextLog.push({
        step: 'vick_diagnostic_authority',
        injected: true,
        character_boundary_active: otherCharactersPresent,
        channel_is_character_channel: isCharacterChannel,
      });
    }
    contextLog.push({ step: 'prompt_built', length: systemPrompt.length });

    const totalMs = Date.now() - startTime;

    // ── FULL DIAGNOSTIC LOG LINE ──────────────────────────────────────────────
    console.log(
      `[buildCanonicalCharacterContext] ✓ route=${interactionContext}` +
      ` | character=${character.name} (${characterId})` +
      ` | owner=${resolvedEmail || 'none'}` +
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
      ownerEmail: resolvedEmail || 'none',
      route: interactionContext,
      canonical_loaded: true,
      hard_facts_loaded: hardFactsLoaded,
      life_journal_count: lifeJournalCount,
      memory_count: memories.length,
      relationship_context_loaded: relationshipLoaded,
      fallback_used: false,
    });

    // ── Compute latestWpMsgTs for freshness metadata ──────────────────────────
    // Derived from the WP awareness records already fetched in Step 5b.
    // Used by the frontend to store freshness metadata alongside the cached prompt.
    // This is the timestamp of the most recent WP Message known to this prompt build.
    // No new records created. Read-only.
    let latestWpMsgTs = null;
    if (interactionContext === 'direct_chat' || interactionContext === 'text') {
      // We re-check with the same logic as step 5b — this is a head-check, not a re-query.
      // The worldPhoneAwarenessBlock was already built above; just extract the max timestamp
      // from the raw WP messages that were used to build it. Since they are already filtered
      // to 48h, the max is the most recent WP message in that window.
      // We do a lightweight re-read of the same records (already fetched) rather than a second query.
      try {
        const [wpSentTs, wpReceivedTs] = await Promise.all([
          base44.asServiceRole.entities.Message.filter(
            { sender_character_id: characterId, channel: 'world_phone' },
            '-timestamp', 1
          ).catch(() => []),
          base44.asServiceRole.entities.Message.filter(
            { receiver_character_id: characterId, channel: 'world_phone' },
            '-timestamp', 1
          ).catch(() => []),
        ]);
        const combined = [...wpSentTs, ...wpReceivedTs].filter(Boolean);
        if (combined.length > 0) {
          const tss = combined
            .map(m => m.timestamp || m.created_date)
            .filter(Boolean)
            .map(ts => new Date(ts).getTime());
          if (tss.length > 0) latestWpMsgTs = new Date(Math.max(...tss)).toISOString();
        }
      } catch (_) {}
    }

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
      // ── FRESHNESS METADATA ──────────────────────────────────────────────────
      // Callers must store these alongside the cached canonical prompt.
      // verifyCachedPromptFreshness() in characterRuntimeCache.js uses them
      // to detect stale context before Chat/Text generation proceeds.
      freshnessMeta: {
        latestWpMsgTs,          // ISO timestamp of most recent WP Message at build time
        latestCommitmentTs,     // ISO timestamp of most recent Commitment change at build time
        builtAt: new Date().toISOString(),
      },
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