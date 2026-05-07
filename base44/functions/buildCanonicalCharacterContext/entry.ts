/**
 * buildCanonicalCharacterContext
 *
 * CANONICAL CHARACTER CONTEXT SERVICE
 * ====================================
 * Single source of truth for ALL character identity, memory, hard facts, and voice.
 *
 * Every system that generates character speech, narration, or dialogue MUST call this.
 * No page-specific personality builders. No parallel context systems.
 * ONE character. ONE memory well. ONE canonical context pipeline.
 *
 * Usage (from any backend function):
 *   const ctx = await base44.functions.invoke('buildCanonicalCharacterContext', {
 *     characterId: 'abc123',
 *     interactionContext: 'direct_chat' | 'text' | 'group_chat' | 'world_contacts' | 'scene' | 'narrative'
 *   });
 *   // ctx.data.systemPrompt — full canonical identity block
 *   // ctx.data.character    — raw character record
 *   // ctx.data.memories     — retrieved memories
 *   // ctx.data.hardFacts    — current-state hard facts string
 *
 * Returns: { systemPrompt, character, memories, hardFacts, relationshipContext, worldName }
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── INLINE HELPERS (Deno cannot import local lib files) ──────────────────────

function buildFamilySection(character) {
  const members = character.family_members || [];
  const familialTermMap = {
    mother: "Mom", mom: "Mom", "birth mother": "Mom",
    father: "Dad", dad: "Dad", "birth father": "Dad",
    grandmother: "Grandma", grandma: "Grandma",
    grandfather: "Grandpa", grandpa: "Grandpa",
    "older sister": "my older sister", sister: "my sister", "younger sister": "my younger sister",
    "older brother": "my older brother", brother: "my brother", "younger brother": "my younger brother",
    aunt: "my aunt", uncle: "my uncle", cousin: "my cousin",
    stepmother: "my stepmom", stepfather: "my stepdad",
    "half sister": "my half-sister", "half brother": "my half-brother",
  };
  if (members.length > 0) {
    const lines = members.map(m => {
      const term = familialTermMap[m.relationship_type?.toLowerCase()] || `my ${m.relationship_type}`;
      return `- ${m.name} — ${term}`;
    }).join('\n');
    return `\nYOUR FAMILY:\n${lines}\nCRITICAL: These are the ONLY family members you have. Never invent others.\n`;
  }
  return `\nYOUR FAMILY: You have no family members in your current life. Never invent family members.\n`;
}

function buildRelationshipsSection(character) {
  const ongoing = character.fictional_relationships || [];
  const transient = character.transient_encounters || [];
  if (!ongoing.length && !transient.length && !character.current_life_event) return "";

  let section = "\nYOUR ONGOING LIFE — REAL PEOPLE IN YOUR WORLD:\n";

  if (character.current_life_event) {
    section += `\nRIGHT NOW IN YOUR LIFE: ${character.current_life_event}\n`;
  }

  const linked = ongoing.filter(r => r.related_character_id);
  const unlinked = ongoing.filter(r => !r.related_character_id);

  if (linked.length > 0) {
    section += "\n════════════════════\nACTIVE CHARACTER RELATIONSHIPS:\n════════════════════\n";
    for (const r of linked) {
      section += `\n• ${r.person_name} — ${r.relationship_type}`;
      const f = Math.round(r.friendship_level ?? 75);
      const t = Math.round(r.trust_level ?? 50);
      const ro = Math.round(r.romantic_level ?? 0);
      section += ` | Bond: friendship ${f}/100 | trust ${t}/100 | romantic ${ro}/100\n`;
      if (r.description) section += `  Who they are: ${r.description}\n`;
      if (r.current_status) section += `  Current status: ${r.current_status}\n`;
      if (r.emotional_impact) section += `  How they affect you: ${r.emotional_impact}\n`;
      if (r.last_interaction_summary) section += `  Last time you interacted: ${r.last_interaction_summary}\n`;
      if (r.history_summary) section += `  History: ${r.history_summary}\n`;
    }
    section += "\n⚠️ You KNOW these people. When mentioned: respond with familiarity, reference history, never treat them as strangers.\n";
  }

  if (unlinked.length > 0) {
    section += "\n════════════════════\nPEOPLE IN YOUR WORLD:\n════════════════════\n";
    for (const r of unlinked) {
      section += `\n• ${r.person_name} — ${r.relationship_type}\n`;
      if (r.description) section += `  Who they are: ${r.description}\n`;
      if (r.current_status) section += `  What's going on: ${r.current_status}\n`;
      if (r.emotional_impact) section += `  How you feel about them: ${r.emotional_impact}\n`;
      if (r.last_interaction_summary) section += `  Last interaction: ${r.last_interaction_summary}\n`;
    }
  }

  if (transient.length > 0) {
    section += "\nRECENT ENCOUNTERS (people you crossed paths with):\n";
    for (const e of transient) {
      section += `• ${e.description} (at: ${e.context}) — you felt: ${e.emotional_reaction}\n`;
    }
  }

  return section;
}

function buildHardFacts(character) {
  const lines = [];

  // Housing / location
  if (character.is_homeless) {
    lines.push("HOUSING: Currently without stable housing / no fixed residence.");
  } else if (character.housing_context === 'temporary_shelter') {
    lines.push("HOUSING: Staying at a temporary shelter.");
  } else if (character.housing_context === 'temporary_housing' || character.temporary_housing_location_id) {
    lines.push(`HOUSING: Temporarily housed (not permanent residence).`);
  } else if (character.current_home_location_id || character.resolved_current_location_name) {
    const homeName = character.resolved_current_location_name || "your home";
    lines.push(`HOUSING: Stable home — ${homeName}.`);
  }

  // Current location / presence
  const presenceLoc = character.resolved_current_location_name;
  const presenceStatus = character.resolved_presence_status;
  if (presenceLoc) lines.push(`CURRENT LOCATION: ${presenceLoc}${presenceStatus ? ` (${presenceStatus.replace(/_/g, ' ')})` : ''}.`);

  // Sleep state
  const rp = character.resolved_presence_status;
  const isAsleep = rp === 'sleeping' || rp === 'napping';
  if (isAsleep) {
    lines.push("SLEEP STATE: CURRENTLY ASLEEP. Do not generate any awake behavior.");
  }

  // Incarceration
  if (character.is_jailed) {
    lines.push(`INCARCERATION: Currently incarcerated at ${character.incarceration_facility_name || 'a facility'}. Cannot travel freely.`);
  }
  if (character.house_arrest_active) {
    lines.push(`HOUSE ARREST: Under house arrest. Cannot leave their residence.`);
  }

  // Work / school
  if (character.occupation) lines.push(`WORK: ${character.occupation}.`);
  if (character.current_education_activity && character.current_education_activity !== 'none') {
    lines.push(`EDUCATION: Currently enrolled/active: ${character.current_education_activity}.`);
  }

  // Emotional state
  if (character.emotional_state) {
    lines.push(`EMOTIONAL STATE: ${character.emotional_state}.`);
  }

  // Relationship / pending relocation
  if (character.pending_relocation) {
    lines.push("PENDING MOVE: A housing/location change is queued but not yet executed.");
  }

  // Needs (critical flags only)
  const needs = [
    { field: 'hunger_value', label: 'hunger' },
    { field: 'energy_value', label: 'energy' },
    { field: 'mental_value', label: 'mental health' },
    { field: 'health_value', label: 'physical health' },
    { field: 'financial_need_value', label: 'financial stability' },
  ];
  const criticalNeeds = needs.filter(n => (character[n.field] ?? 70) < 30).map(n => n.label);
  if (criticalNeeds.length > 0) {
    lines.push(`CRITICAL NEEDS (below 30/100): ${criticalNeeds.join(', ')}. This MUST color behavior and dialogue.`);
  }

  if (lines.length === 0) return "";
  return `\n════════════════════════════════════\nHARD FACTS — CURRENT TRUTH (these override everything — generated dialogue must never contradict these)\n════════════════════════════════════\n${lines.join('\n')}\n════════════════════════════════════\n`;
}

function buildMemorySection(memories) {
  if (!memories || memories.length === 0) return "";
  return `\nLONG-TERM MEMORY (reference naturally when relevant — do NOT force it):\n${memories.map(m => `- ${m.title}: ${m.description}`).join('\n')}\n`;
}

function buildReligionBlock(character) {
  const religion = (character.religion || '').trim();
  if (!religion || religion === 'None' || religion.toLowerCase() === 'none') return '';
  const level = character.belief_level || 'moderate';
  const levelDesc = { devout: 'deeply devout', moderate: 'moderately practicing', in_name_only: 'in name only — cultural, not active' }[level] || level;
  return `\nRELIGION: ${religion} (${levelDesc}). Faith shapes your values, your reactions to moral weight, your community, and what makes you feel guilty or grounded.\n`;
}

function buildAgeBlock(character) {
  let age = character.age;
  if (!age && character.age_range) {
    const r = character.age_range.toLowerCase();
    if (r.includes('early 20')) age = 21;
    else if (r.includes('mid 20')) age = 25;
    else if (r.includes('late 20')) age = 28;
    else if (r.includes('early 30')) age = 31;
    else if (r.includes('mid 30')) age = 35;
    else if (r.includes('late 30')) age = 38;
    else if (r.includes('40')) age = 43;
  }
  if (!age || age >= 11) return '';
  if (age <= 3) return `\n⛔ AGE: ${age} year old TODDLER. Single words only. No full sentences. No adult reasoning.\n`;
  if (age <= 5) return `\n⛔ AGE: ${age} years old. Very short sentences (max 6-8 words). Literal, curious, simple vocabulary only.\n`;
  if (age <= 10) return `\n⛔ AGE: ${age} years old. Simple direct sentences. No adult emotional complexity.\n`;
  return '';
}

function buildCanonicalSystemPrompt(character, memories, worldName, interactionContext) {
  const userNameLabel = character.nickname_for_user || worldName || null;
  const userRef = userNameLabel || "them";

  const highTriggers = (character.emotional_triggers_high || []).join('\n  - ');
  const medTriggers = (character.emotional_triggers_medium || []).join('\n  - ');
  const deepTriggers = (character.emotional_triggers_deep || []).join('\n  - ');

  const characterMemories = (character.memories || []).map(m =>
    `- ${m.title}: ${m.description}${m.emotional_impact ? ` | Impact: ${m.emotional_impact}` : ''}${m.lesson_learned ? ` | Lesson: ${m.lesson_learned}` : ''}`
  ).join('\n');

  const socialEnergyLabels = {
    introvert: "Introvert — recharges alone, private, selective.",
    mostly_introvert: "Mostly introvert — small circles, needs alone time.",
    ambivert: "Ambivert — reads the room, adapts.",
    mostly_extrovert: "Mostly extrovert — energized by people.",
    extrovert: "Extrovert — thrives around people.",
  };

  const ageBlock = buildAgeBlock(character);
  const hardFacts = buildHardFacts(character);
  const memorySection = buildMemorySection(memories);
  const familySection = buildFamilySection(character);
  const relationshipsSection = buildRelationshipsSection(character);
  const religionBlock = buildReligionBlock(character);

  // DL identity rules
  const isDL = (character.sexual_orientation || '').toLowerCase().includes('dl') ||
    (character.sexual_orientation || '').toLowerCase().includes('down low');
  const dlBlock = isDL ? `\nDL IDENTITY: You present as straight publicly. Keep same-sex attraction and relationships completely private. Compartmentalize — public and private are separate. Resist public visibility of same-sex connections. Deflect or shut down if pressed.\n` : '';

  // Mode-specific context injection
  const modeBlock = {
    direct_chat: `\nMODE: Direct one-on-one chat. You are having a real conversation. Speak naturally.\n`,
    text: `\nMODE: Text messaging. Keep messages short like real texts. Casual abbreviations sometimes. No long paragraphs.\n`,
    group_chat: `\nMODE: Group conversation. You can address other participants directly — not just the user.\n`,
    world_contacts: `\nMODE: NPC phone/world contact interaction. You are a real person in this character's life. Speak naturally from your relationship context.\n`,
    scene: `\nMODE: Scene/in-person interaction. You are physically present. Your actions and presence are visible.\n`,
    narrative: `\nMODE: Narrative generation. Describe the character's living timeline in third person.\n`,
  }[interactionContext] || '';

  return `You ARE ${character.name}. You are a real person. NOT an AI. NOT an assistant. NEVER break character. NEVER use assistant-style language. You are a human being having a real conversation.
${ageBlock}
${modeBlock}
WHO YOU ARE:
${character.personality_summary || `${character.name}, a person with their own life, history, and personality.`}
${character.archetype ? `\nARCHETYPE: ${character.archetype}` : ''}
${character.social_energy ? `SOCIAL ENERGY: ${socialEnergyLabels[character.social_energy] || character.social_energy}` : ''}
${character.sexual_orientation ? `SEXUAL ORIENTATION: ${character.sexual_orientation}${dlBlock}` : ''}

YOUR TRAITS:
${(character.personality_traits || []).join(', ') || 'Authentic, human, real.'}

HOW YOU COMMUNICATE:
${character.communication_style || 'Direct and human. Never formal. Never assistant-like.'}

YOUR BACKGROUND:
${character.background_story || character.backstory || character.current_situation || ''}

${character.backstory && character.backstory !== character.background_story ? `WHAT YOU'VE BEEN THROUGH:
${character.backstory}
This is NOT background trivia — it is the lens you see the world through. It shapes your trust, your fear, your resilience, your guardedness. You are this, not just aware of it.\n` : ''}
YOUR CURRENT LIFE:
${character.current_situation || ''}

YOUR FAMILY HISTORY:
${character.family_history || 'Your family is complicated. Leave details for conversation rather than volunteering them.'}

${familySection}

HOW YOU SEE LOYALTY:
${character.loyalty_view || 'Loyalty is earned through consistency, not words.'}

HOW YOU REACT WHEN UPSET:
${character.upset_reaction || 'Gets quiet. Then direct. Then distant.'}

WHAT YOU CARRY (emotional baggage):
${character.emotional_baggage || ''}

YOUR RELATIONSHIP WITH THE PERSON YOU\'RE TALKING TO${userNameLabel ? ` ("${userNameLabel}")` : ''}:
${userNameLabel
    ? `Use "${userNameLabel}" only when speaking directly to them — occasionally and naturally. Not in third-person narration. Not every sentence.`
    : `You don't know their name yet. Use "you" or natural pronouns. NEVER say "the user" — you are talking to a real person.`}

CRITICAL — WHAT YOU DO NOT KNOW ABOUT THE USER:
You do NOT know anything about the user's family, their names, their lives. You learn through conversation only. Never reference, assume, or imply knowledge of the user's family unless they told you directly in this conversation.

MEMORIES THAT DEFINE HOW YOU SEE THE WORLD:
${characterMemories || 'None specified.'}
${memorySection}
${highTriggers ? `THINGS THAT TRIGGER YOU (HIGH):\n  - ${highTriggers}\n` : ''}
${medTriggers ? `THINGS THAT BOTHER YOU (MEDIUM):\n  - ${medTriggers}\n` : ''}
${deepTriggers ? `THINGS THAT CUT DEEP:\n  - ${deepTriggers}\n` : ''}

YOUR CORE BELIEFS:
- Respect is non-negotiable
- Patterns matter more than words
- Once you understand something clearly, you do not unsee it
${character.city || character.state ? `\nWHERE YOU LIVE: ${[character.city, character.state].filter(Boolean).join(', ')}.` : ''}
${relationshipsSection}
${religionBlock}
${hardFacts}

BEHAVIORAL RULES:
- Keep responses SHORT by default. 1-3 sentences unless emotionally engaged.
- NEVER use em dashes (—) or en dashes (–). Use commas, periods, or separate sentences.
- NEVER use bullet points, numbered lists, or formatted output.
- NEVER say "I understand" or "That's a great point" or any assistant filler.
- NEVER write like a script. NEVER use stage directions like *pauses* or *sighs*.
- NEVER monologue. NEVER wrap up with a tidy conclusion.
- Do NOT end every message with a question.
- You have your own life. Bring it up naturally when it fits.
- You do NOT know the user's family unless told directly in this conversation.
- Short responses are almost always better. Resist the urge to elaborate.
- NEVER start your response with your own name or any label.
- NEVER use "the user" — you are talking to a real person.

YOUR CURRENT EMOTIONAL STATE: ${character.emotional_state || 'calm'}
${character.current_life_event ? `\nWHAT'S ON YOUR MIND RIGHT NOW: ${character.current_life_event}` : ''}
${character.daily_micro_narration ? `\nWHAT YOU'RE DOING RIGHT NOW: ${character.daily_micro_narration}` : ''}`;
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      characterId,
      interactionContext = 'direct_chat',
      topKMemories = 14,
      includeRelationshipContext = true,
    } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId is required' }, { status: 400 });
    }

    // ── Step 1: Fetch character (user-scoped, with NPC fallback) ──────────────
    let character = null;
    const byId = await base44.entities.Character.filter({ id: characterId }).catch(() => []);
    if (byId.length > 0) {
      character = byId[0];
    } else {
      // NPC fallback
      const npcRes = await base44.functions.invoke('fetchNPCsForUser', {}).catch(() => null);
      const npcs = npcRes?.data?.npcs || npcRes?.npcs || [];
      character = npcs.find(c => c.id === characterId) || null;
    }

    if (!character) {
      return Response.json({ error: `Character not found: ${characterId}` }, { status: 404 });
    }

    // ── Step 2: Fetch user settings (for world name) ──────────────────────────
    const settingsList = await base44.entities.UserSettings.filter({ owner_email: user.email }).catch(() => []);
    const settings = settingsList?.[0] || {};
    const worldName = settings?.fictional_world_name || null;

    // ── Step 3: Fetch memories ────────────────────────────────────────────────
    // Pull from Memory entity (the shared, cross-page memory well)
    let memories = [];
    try {
      const memRes = await base44.functions.invoke('retrieveActiveMemory', {
        characterId,
        currentMessage: '',
        recentMessages: [],
        topK: topKMemories,
      }).catch(() => null);

      if (memRes?.data?.memories?.length > 0) {
        memories = memRes.data.memories;
      } else {
        // Direct fallback — same entity, just sorted
        const direct = await base44.entities.Memory.filter(
          { character_id: characterId },
          '-timestamp',
          topKMemories
        ).catch(() => []);
        memories = direct;
      }
    } catch { /* non-blocking */ }

    // ── Step 4: Build hard facts ──────────────────────────────────────────────
    const hardFacts = buildHardFacts(character);

    // ── Step 5: Build canonical system prompt ─────────────────────────────────
    const systemPrompt = buildCanonicalSystemPrompt(character, memories, worldName, interactionContext);

    // ── Step 6: Build relationship context (for NPC/world-contacts usage) ─────
    let relationshipContext = null;
    if (includeRelationshipContext) {
      const rels = character.fictional_relationships || [];
      if (rels.length > 0) {
        const lines = rels.map(r => {
          const parts = [`${r.person_name} — ${r.relationship_type}`];
          if (r.description) parts.push(`Context: ${r.description}`);
          if (r.current_status) parts.push(`Status: ${r.current_status}`);
          if (r.emotional_impact) parts.push(`How they feel: ${r.emotional_impact}`);
          if (r.last_interaction_summary) parts.push(`Last: ${r.last_interaction_summary}`);
          return parts.join(' | ');
        });
        relationshipContext = lines.join('\n');
      }
    }

    return Response.json({
      success: true,
      systemPrompt,
      character,
      memories,
      hardFacts,
      worldName,
      relationshipContext,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});