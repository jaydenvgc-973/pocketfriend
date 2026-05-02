import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── PROGRESSION DOMAIN KEYWORDS ──────────────────────────────────────────────
// Maps life event types and natural language patterns to affected domains and
// whether they are a permanent state change (progression) vs reflection/conditional.

const PROGRESSION_KEYWORDS = {
  housing: {
    patterns: [
      /moved? out/i, /got (my|his|her|their) own (place|apartment|flat|house)/i,
      /moving (out|in)/i, /new (place|apartment|home|house)/i,
      /bought (a|the) (house|home|condo|property)/i,
      /renting (a|my) (place|apartment|flat)/i,
      /evicted/i, /homeless/i, /living alone/i,
    ],
    weight: 90,
  },
  household: {
    patterns: [
      /living (with|alone)/i, /moved in (with|together)/i,
      /roommate/i, /sharing (a|the) (place|apartment|house)/i,
      /staying with (mom|dad|family|parents)/i,
      /kids (moved|living) with/i,
    ],
    weight: 80,
  },
  relationship: {
    patterns: [
      /broke up/i, /breaking up/i, /ended (the|our) relationship/i,
      /got (engaged|married|divorced|separated)/i,
      /getting (engaged|married|divorced|separated)/i,
      /started dating/i, /became official/i, /in a relationship/i,
      /single (again|now)/i, /back together/i, /reconciled/i,
    ],
    weight: 85,
  },
  children: {
    patterns: [
      /had a (baby|child|kid)/i, /became a (father|mother|parent)/i,
      /custody (changed|settled|arrangement)/i,
      /kids? (visit|come|stay) (on weekends?|sometimes|occasionally)/i,
      /weekend visits/i, /co.?paren/i,
    ],
    weight: 75,
  },
  work: {
    patterns: [
      /got (a |the )?(new )?job/i, /started (working|a new job)/i,
      /quit (my|the) job/i, /got fired/i, /laid off/i,
      /promoted/i, /new (position|role|career)/i,
      /stopped working/i, /retired/i,
    ],
    weight: 80,
  },
  health: {
    patterns: [
      /diagnosed with/i, /health (scare|crisis|issue)/i,
      /surgery/i, /hospital(ized)?/i, /recovering from/i,
      /chronic (illness|condition|pain)/i, /sober/i, /sobriety/i,
    ],
    weight: 70,
  },
  legal: {
    patterns: [
      /arrested/i, /jail/i, /prison/i, /got out (of jail|of prison)/i,
      /charges (dropped|filed)/i, /probation/i, /conviction/i,
    ],
    weight: 90,
  },
};

// Patterns that indicate PAST REFERENCE (not current) — must not become present baseline
const PAST_REFERENCE_PATTERNS = [
  /used to/i, /back when/i, /back then/i, /at the time/i, /that was/i,
  /i (miss|missed)/i, /i (remember|remembered)/i, /thinking about when/i,
  /felt like/i, /those days/i, /growing up/i, /years ago/i,
  /before (i|he|she|they)/i, /when i (was|lived|had|worked)/i,
  /when (he|she|they) (was|were|had|lived)/i,
];

// Patterns that indicate CONDITIONAL presence (only active sometimes)
const CONDITIONAL_PATTERNS = [
  /on (the )?weekends?/i, /sometimes visits?/i, /occasionally/i,
  /when (they|she|he|kids?) (comes?|visits?)/i,
  /when (i|she|he|they) (have|has) (the )?kids?/i,
  /during (holidays?|visits?|events?)/i,
  /if (she|he|they) comes?/i, /might visit/i,
];

function classifyEntry(entry) {
  const text = `${entry.title || ''} ${entry.description || ''}`.toLowerCase();
  
  // Check if it's explicitly a past reference
  if (PAST_REFERENCE_PATTERNS.some(p => p.test(text))) {
    return { type: 'past_reference', domains: [], weight: 0, causes_state_change: false };
  }

  // Check if it's a conditional state
  if (CONDITIONAL_PATTERNS.some(p => p.test(text))) {
    return { type: 'conditional_present', domains: detectDomains(text), weight: 20, causes_state_change: false };
  }

  // Check for progression events
  const detectedDomains = [];
  let maxWeight = 0;
  for (const [domain, config] of Object.entries(PROGRESSION_KEYWORDS)) {
    if (config.patterns.some(p => p.test(text))) {
      detectedDomains.push(domain);
      maxWeight = Math.max(maxWeight, config.weight);
    }
  }

  if (detectedDomains.length > 0 && maxWeight >= 70) {
    return { type: 'progression_event', domains: detectedDomains, weight: maxWeight, causes_state_change: true };
  }

  // Default: treat as emotional reference (not a state lock)
  return { type: 'emotional_reference', domains: detectDomains(text), weight: 30, causes_state_change: false };
}

function detectDomains(text) {
  return Object.entries(PROGRESSION_KEYWORDS)
    .filter(([, config]) => config.patterns.some(p => p.test(text)))
    .map(([domain]) => domain);
}

// Build the domain state map from progression events (newest wins per domain)
function buildDomainStateMap(events) {
  const domainMap = {};
  // Sort by date, newest last so newest wins
  const sorted = [...events].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  
  for (const entry of sorted) {
    const classification = classifyEntry(entry);
    if (classification.type === 'progression_event' && classification.causes_state_change) {
      for (const domain of classification.domains) {
        domainMap[domain] = {
          current_state_text: entry.title,
          entry_id: entry.id,
          timestamp: entry.timestamp,
          entry_body: entry.description,
        };
      }
    }
  }
  return domainMap;
}

// Build a structured context string for injection into chat/narrative prompts
function buildProgressionContextString(char, events, domainMap) {
  const lines = [];

  // Current life state (derived from progression)
  if (Object.keys(domainMap).length > 0) {
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('PROGRESSION STATE — CURRENT LIFE TRUTH (LOCKED)');
    lines.push('These are the CHARACTER\'S PRESENT REALITY, derived from their latest life progression.');
    lines.push('Do NOT contradict these. Do NOT revert to older states.');
    lines.push('═══════════════════════════════════════════════════════════');

    if (domainMap.housing) {
      lines.push(`🏠 CURRENT HOME: ${domainMap.housing.current_state_text}`);
    }
    if (domainMap.household) {
      lines.push(`👤 LIVING ARRANGEMENT: ${domainMap.household.current_state_text}`);
    }
    if (domainMap.relationship) {
      lines.push(`💑 RELATIONSHIP STATUS: ${domainMap.relationship.current_state_text}`);
    }
    if (domainMap.work) {
      lines.push(`💼 WORK STATUS: ${domainMap.work.current_state_text}`);
    }
    if (domainMap.children) {
      lines.push(`👶 CHILDREN/FAMILY PRESENCE: ${domainMap.children.current_state_text}`);
    }
    if (domainMap.health) {
      lines.push(`🏥 HEALTH STATUS: ${domainMap.health.current_state_text}`);
    }
    if (domainMap.legal) {
      lines.push(`⚖️ LEGAL STATUS: ${domainMap.legal.current_state_text}`);
    }
    lines.push('═══════════════════════════════════════════════════════════');
  }

  // Recent progression events (last 3 major changes, newest to oldest)
  const progressionEvents = events
    .map(e => ({ ...e, _cls: classifyEntry(e) }))
    .filter(e => e._cls.type === 'progression_event')
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, 3);

  if (progressionEvents.length > 0) {
    lines.push('\nRECENT LIFE CHANGES (most recent first — these are CURRENT STATE, not memories):');
    for (const ev of progressionEvents) {
      const valence = ev.valence === 'positive' ? '✅' : ev.valence === 'negative' ? '⚠️' : '📌';
      lines.push(`${valence} ${ev.title}${ev.description ? ': ' + ev.description.substring(0, 120) : ''}`);
    }
  }

  // Conditional states (must be flagged as NOT always active)
  const conditionalEvents = events
    .map(e => ({ ...e, _cls: classifyEntry(e) }))
    .filter(e => e._cls.type === 'conditional_present')
    .slice(0, 3);

  if (conditionalEvents.length > 0) {
    lines.push('\nCONDITIONAL STATES (only true sometimes — do NOT present as constant reality):');
    for (const ev of conditionalEvents) {
      lines.push(`⏱ SOMETIMES: ${ev.title}`);
    }
  }

  // HARD RULES injected at end
  lines.push('\n⛔ JOURNAL RULE: Life journal history exists but OLDER states that were superseded by the above CANNOT be used as present truth.');
  lines.push('⛔ Past housing, past relationships, and past routines are HISTORY — frame them as "used to" or "back then" if referenced.');
  lines.push('⛔ Do NOT revive previous life stages as current reality under any circumstances.');

  return lines.join('\n');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId, currentMessage } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Load character
    const char = await base44.entities.Character.get(characterId).catch(() => null);
    if (!char) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Load life events (up to 30 most recent)
    const events = await base44.entities.LifeEvent.filter(
      { character_id: characterId }, '-timestamp', 30
    ).catch(() => []);

    // Load character memories (for character-to-character continuity)
    // This includes World Contacts conversations and other relationship history
    const memories = await base44.entities.CharacterMemory.filter(
      { character_id: characterId, memory_type: 'relationship' },
      '-created_date',
      15
    ).catch(() => []);

    if (!events || events.length === 0) {
      return Response.json({
        success: true,
        progressionContext: '',
        domainStateMap: {},
        eventCount: 0,
        memoryCount: memories.length
      });
    }

    // Build domain state map (progression locks)
    const domainMap = buildDomainStateMap(events);

    // Build context string
    const progressionContext = buildProgressionContextString(char, events, domainMap);

    // Build character memory context (character-to-character continuity)
    let memoryContext = '';
    if (memories.length > 0) {
      const worldContactsMems = memories.filter(m =>
        m.memory_summary?.includes('[world_contacts]')
      );

      if (worldContactsMems.length > 0) {
        const memLines = [
          '\n═══════════════════════════════════════════════════════════',
          'CHARACTER-TO-CHARACTER CONVERSATION HISTORY (AVAILABLE ACROSS ALL PAGES)',
          'These conversations happened in World Contacts. Both characters remember them.',
          '═══════════════════════════════════════════════════════════'
        ];

        for (const mem of worldContactsMems.slice(0, 5)) {
          const tone = mem.memory_summary?.includes('warm') ? '🤍' :
                       mem.memory_summary?.includes('tense') ? '⚡' :
                       mem.memory_summary?.includes('positive') ? '😊' :
                       mem.memory_summary?.includes('vulnerable') ? '💭' : '💬';
          memLines.push(`${tone} ${mem.memory_summary}`);
          if (mem.memory_text) {
            memLines.push(`   "${mem.memory_text.substring(0, 150)}..."`);
          }
        }

        memoryContext = memLines.join('\n');
      }
    }

    const fullContext = progressionContext + memoryContext;

    // Also build a compact invalidation map for debugging/logging
    const invalidatedStates = {};
    for (const [domain, state] of Object.entries(domainMap)) {
      // Find older entries for the same domain that are now superseded
      const olderEntries = events
        .map(e => ({ ...e, _cls: classifyEntry(e) }))
        .filter(e =>
          e._cls.type === 'progression_event' &&
          e._cls.domains.includes(domain) &&
          e.id !== state.entry_id &&
          new Date(e.timestamp || 0) < new Date(state.timestamp || 0)
        )
        .map(e => e.title);
      if (olderEntries.length > 0) {
        invalidatedStates[domain] = olderEntries;
      }
    }

    console.log(`[PROGRESSION] Character: ${char.name} | Domains locked: ${Object.keys(domainMap).join(', ')} | Events: ${events.length}`);
    if (Object.keys(invalidatedStates).length > 0) {
      console.log(`[PROGRESSION] Invalidated states:`, JSON.stringify(invalidatedStates));
    }

    return Response.json({
      success: true,
      progressionContext: fullContext,
      domainStateMap: domainMap,
      invalidatedStates,
      eventCount: events.length,
      memoryCount: memories.length,
      worldContactsMemoryCount: memories.filter(m => m.memory_summary?.includes('[world_contacts]')).length
    });

  } catch (error) {
    console.error('[buildProgressionFilteredContext]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});