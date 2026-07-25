import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let { characterId, conversationId, userMessage, characterReply, characterResponse, playingAsCharacterId, witnessCharacterIds } = await req.json();
    // Normalize: accept both characterReply (Scene) and characterResponse (Chat background tasks) field names
    characterReply = characterReply || characterResponse || '';

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Auth FIRST — before any DB access
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // conversationId is optional — Scene page calls this without a conversationId
    // When absent, we skip the DB message lookup for playingAsCharacterId and use scene context only

    // If playingAsCharacterId not provided and conversationId exists, check the last user message for it
    if (!playingAsCharacterId && conversationId) {
      const lastUserMsg = await base44.entities.Message.filter(
        { conversation_id: conversationId, sender_type: 'user' },
        '-created_date',
        1
      ).then(r => r[0]);
      if (lastUserMsg?.played_as_character_id) {
        playingAsCharacterId = lastUserMsg.played_as_character_id;
      }
    }

    // LEGACY COMPATIBILITY: filter by id only — owner_email may be missing on legacy characters.
    // RLS enforces scope server-side. owner_email filter would hide valid legacy records.
    const [targetChar, playingAsChar] = await Promise.all([
      base44.entities.Character.filter({ id: characterId }).then(r => r[0]),
      playingAsCharacterId
        ? base44.entities.Character.filter({ id: playingAsCharacterId }).then(r => r[0])
        : Promise.resolve(null),
    ]);

    let newPeopleDetected = [];

    // ── BOUNDARY CHECK — Test Character Safety Addendum ──────────────────────
    // Use the existing authoritative classification (is_test_character) on
    // both participants. If one is a disposable test character and the other
    // is an actual (non-test) character, skip the cross-character writes
    // (fictional_relationships links and cross-referenced memories) but still
    // allow single-character writes that do not reference the other
    // character. Only the prohibited cross-character writes are skipped; the
    // surrounding function continues its unrelated work. This is an inline
    // condition within the existing write-owning function — not a new
    // helper, guard, or abstraction.
    const _testBoundaryBlocked = targetChar && playingAsChar
      ? (targetChar.is_test_character === true) !== (playingAsChar.is_test_character === true)
      : false;
    if (_testBoundaryBlocked) {
      console.warn(`[extractMemoriesFromTurn] BLOCKED test-to-real cross-character writes: ${targetChar?.name} (test=${targetChar?.is_test_character === true}) ↔ ${playingAsChar?.name} (test=${playingAsChar?.is_test_character === true})`);
    }

    // ── TARGET CHARACTER: memory + new people detection + played-as-character cross-memory ─────────────────
    if (targetChar && characterReply) {
      const senderLabel = playingAsChar ? playingAsChar.name : 'someone';

      // Build known people context to reduce false positives at the LLM level
      const knownPeople = [
        ...(targetChar.fictional_relationships || []).map(r => r.person_name).filter(Boolean),
        ...(targetChar.family_members || []).map(m => m.name).filter(Boolean),
      ];
      const knownPeopleStr = knownPeople.length > 0
        ? `Already known people (do NOT flag these): ${knownPeople.join(', ')}`
        : 'No known people yet.';

      const targetMemoryResult = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${targetChar.name}. ${senderLabel} just said: "${userMessage}" and you replied: "${characterReply}".

${knownPeopleStr}

Identify any clearly NEW people (full or partial names that refer to a specific individual) mentioned in this exchange who are NOT already in the known list above.

STRICT RULES — DO NOT flag:
- Common English words that coincidentally look like names (set, mark, will, may, etc.)
- Substrings inside larger words (e.g. "Jon" inside "conjunction")
- Stop words, articles, pronouns
- Location names, business names, place names
- The speaking character's own name (${targetChar.name})
- Very short words (2 chars or less)
- Names that are clearly possessive references to a place ("Anderson's" used as a bar name)
- Generic titles without a specific person (e.g. "the doctor", "a friend")

Only flag names that clearly refer to a specific real individual who is NEW.
If nothing new and clear is detected, return empty people array.

Return JSON only.`,
        response_json_schema: {
          type: "object",
          properties: {
            people: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  relationship_type: { type: "string" },
                  context: { type: "string" }
                }
              }
            }
          }
        }
      });

      newPeopleDetected = targetMemoryResult?.people || [];

      // Build a meaningful memory description for target character
      const targetMemDesc = playingAsChar
        ? `${playingAsChar.name} said: "${userMessage}". I responded: "${characterReply.substring(0, 200)}"`
        : `They said: "${userMessage}". I responded: "${characterReply.substring(0, 200)}"`;

      // DUPLICATE PREVENTION: only write if no memory with same source_context already exists
      const targetSourceCtx = conversationId
        ? (playingAsChar ? `play_as_${conversationId}_sender_${playingAsCharacterId}` : `conversation_${conversationId}`)
        : 'scene_interaction';
      const recentTargetMems = conversationId
        ? await base44.entities.Memory.filter({ character_id: characterId, source_context: targetSourceCtx }, '-created_date', 5).catch(() => [])
        : [];
      const targetMemExists = recentTargetMems.length > 0 &&
        (Date.now() - new Date(recentTargetMems[0].created_date || recentTargetMems[0].timestamp || 0).getTime()) < 30000;
      if (!targetMemExists && !_testBoundaryBlocked) {
        await base44.entities.Memory.create({
          character_id: characterId,
          title: playingAsChar ? `Interaction with ${playingAsChar.name}` : `Conversation moment`,
          description: targetMemDesc,
          emotional_impact: 'neutral',
          timestamp: new Date().toISOString(),
          source_context: targetSourceCtx,
        });
      }

      // If being addressed by a known active character, update the target's last_interaction_summary for that relationship
      if (playingAsChar && !_testBoundaryBlocked) {
        const existingRels = targetChar.fictional_relationships || [];
        const relIdx = existingRels.findIndex(r => r.related_character_id === playingAsCharacterId);
        const interactionSummary = `${playingAsChar.name} reached out: "${userMessage?.substring(0, 100)}"`;

        if (relIdx >= 0) {
          const updatedRels = existingRels.map((r, i) =>
            i === relIdx ? { ...r, last_interaction_summary: interactionSummary } : r
          );
          await base44.entities.Character.update(characterId, { fictional_relationships: updatedRels });
        } else {
          // Add a new relationship entry on target char pointing back to the played character
          const newRels = [
            ...existingRels,
            {
              person_name: playingAsChar.name,
              related_character_id: playingAsCharacterId,
              relationship_type: 'acquaintance',
              current_status: 'ongoing',
              friendship_level: 50,
              user_respect_level: 50,
              romantic_level: 0,
              attraction_level: 0,
              chosen_family_level: 0,
              last_interaction_summary: interactionSummary,
            },
          ];
          await base44.entities.Character.update(characterId, { fictional_relationships: newRels });
        }
      }
    }

    // ── PLAYED CHARACTER: full multi-dimensional memory extraction ─────────────
    // This is the core fix: the played character retains meaningful outcomes
    // from the interaction as if they lived through it — because they did.
    if (playingAsChar && targetChar && (userMessage || characterReply) && !_testBoundaryBlocked) {
      const extraction = await base44.integrations.Core.InvokeLLM({
        prompt: `You are analyzing a real interaction that ${playingAsChar.name} just had with ${targetChar.name}.

EXTRACTION LEXICAL DISCIPLINE — MANDATORY:
Your output will be stored permanently as memory, journal entries, and emotional state. Apply these rules without exception.

1. BANNED TERMS — never use "chaos" or "chaotic" in life_journal_entry, emotional_takeaway, relational_takeaway, factual_takeaway, or unresolved_thread.
   Do not describe busy, emotional, celebratory, complex, or multi-person exchanges as chaotic.
   Describe the actual mechanics instead: lively, layered, emotional, fast-moving, warm, complex, intense.

2. RESTRICTED TERM — do not use "heavy" as vague emotional shorthand for important, emotional, stressful, or meaningful.
   Describe what specifically made it difficult, meaningful, or significant.

3. VALENCE ACCURACY — extract from what actually happened, not from dramatic wording.
   If the interaction was joyful, affectionate, supportive, or celebratory → relationship_shift must be positive or neutral, not negative.
   If the interaction was harmful, conflicted, or genuinely unresolved → relationship_shift may be negative.
   Do not balance a positive interaction with negative framing. Do not inject negativity into a warm exchange.

4. IDENTITY PROTECTION — do not promote a single interaction into a character identity claim.
   One difficult conversation does not make someone toxic.
   One busy or emotionally layered exchange does not mean the relationship is troubled.

5. EMOTIONAL STATE ACCURACY — new_emotional_state must reflect what the character actually experienced in this exchange.
   A supportive, loving, or celebratory interaction should not produce anxious, sad, or stressed states unless the character's specific response clearly supports it.



${playingAsChar.name}'s personality: ${playingAsChar.personality_summary || 'unknown'}
${playingAsChar.name}'s emotional state going in: ${playingAsChar.emotional_state || 'calm'}

What ${playingAsChar.name} said/did: "${userMessage}"
How ${targetChar.name} responded: "${characterReply?.substring(0, 300) || '(no response)'}"

This interaction HAPPENED to ${playingAsChar.name}. Even though the user was guiding them, ${playingAsChar.name} experienced it.

Extract memory-worthy outcomes. Only populate a field if something real and meaningful occurred. Leave null if nothing significant happened for that category.

MEMORY THRESHOLD — only extract if the exchange contained:
emotional weight, conflict, affection, comfort, important news, planning, promises, revelations, intimacy, argument, apology, fear, grief-support, decisions, or changed relationships.

Return JSON.`,
        response_json_schema: {
          type: "object",
          properties: {
            has_meaningful_content: { type: "boolean" },
            emotional_takeaway: {
              type: "string",
              description: "How ${playingAsChar.name} feels now as a result. null if nothing emotional happened."
            },
            factual_takeaway: {
              type: "string",
              description: "Important information or facts learned. null if nothing new was revealed."
            },
            relational_takeaway: {
              type: "string",
              description: "How trust, closeness, tension, or bond with this person changed. null if unchanged."
            },
            unresolved_thread: {
              type: "string",
              description: "Anything left open, unfinished, or that may need follow-up. null if nothing."
            },
            life_journal_entry: {
              type: "string",
              description: "A 2-3 sentence first-person journal entry from the played character's perspective about what happened and why it mattered. Only if has_meaningful_content is true. null otherwise."
            },
            new_emotional_state: {
              type: "string",
              description: "If this interaction should change the played character's emotional state, what it should be now. Use one of: calm, content, happy, sad, anxious, excited, irritated, frustrated, defensive, reflective, closed-off, hopeful, hurt, empathy, love, gratitude, longing, guilt, shame, pride, confusion, trust, suspicion, relief. null if no change needed."
            },
            relationship_shift: {
              type: "string",
              enum: ["positive", "negative", "neutral", null],
              description: "Whether this interaction moved the relationship positively, negatively, or not at all."
            }
          },
          required: ["has_meaningful_content"]
        }
      });

      if (extraction?.has_meaningful_content) {
        const memoryParts = [
          extraction.emotional_takeaway,
          extraction.factual_takeaway,
          extraction.relational_takeaway,
          extraction.unresolved_thread,
        ].filter(Boolean);

        const memoryDescription = extraction.life_journal_entry || memoryParts.join(' ');

        if (memoryDescription) {
          await base44.entities.Memory.create({
            character_id: playingAsCharacterId,
            title: `Interaction with ${targetChar.name}`,
            description: memoryDescription,
            emotional_impact: extraction.relational_takeaway ? 'meaningful' : 'neutral',
            timestamp: new Date().toISOString(),
            source_context: conversationId ? `play_as_${conversationId}_with_${characterId}` : `scene_play_as_with_${characterId}`,
          });
        }

        // Update emotional state of the played character if the exchange changed it
        if (extraction.new_emotional_state) {
          await base44.entities.Character.update(playingAsCharacterId, {
            emotional_state: extraction.new_emotional_state,
          });
        }

        // Update fictional relationship on the played character toward the target
        if (extraction.relationship_shift && extraction.relationship_shift !== 'neutral') {
          const existingFictionalRels = playingAsChar.fictional_relationships || [];
          const relEntry = existingFictionalRels.find(r => r.related_character_id === characterId);
          const delta = extraction.relationship_shift === 'positive' ? 3 : -3;

          if (relEntry) {
            const updatedRels = existingFictionalRels.map(r =>
              r.related_character_id === characterId
                ? {
                    ...r,
                    friendship_level: Math.min(100, Math.max(0, (r.friendship_level ?? 50) + delta)),
                    last_interaction_summary: extraction.relational_takeaway || r.last_interaction_summary,
                  }
                : r
            );
            await base44.entities.Character.update(playingAsCharacterId, {
              fictional_relationships: updatedRels,
            });
          } else {
            // Create a new fictional relationship entry for this character
            const newRels = [
              ...existingFictionalRels,
              {
                person_name: targetChar.name,
                related_character_id: characterId,
                relationship_type: 'acquaintance',
                current_status: 'ongoing',
                friendship_level: 50 + delta,
                user_respect_level: 50,
                romantic_level: 0,
                attraction_level: 0,
                chosen_family_level: 0,
                last_interaction_summary: extraction.relational_takeaway || null,
              },
            ];
            await base44.entities.Character.update(playingAsCharacterId, {
              fictional_relationships: newRels,
            });
          }
        }
      }
    }

    // ── WITNESS CHARACTERS: others present in a scene who saw/heard the exchange ─
    // These are characters who were physically present but not the primary responder.
    // They get a lightweight factual memory so they can recall the scene later in Chat/Text.
    // Failures are collected and reported explicitly — never silently swallowed.
    const witnessMemoryFailures = [];
    if (witnessCharacterIds?.length > 0 && characterReply && targetChar) {
      const witnessResults = await Promise.allSettled(witnessCharacterIds.map(wid =>
        base44.entities.Memory.create({
          character_id: wid,
          title: `Scene exchange — ${targetChar.name}`,
          description: `${targetChar.name} said: "${characterReply.substring(0, 200)}" in response to: "${(userMessage || '').substring(0, 150)}"`,
          emotional_impact: 'neutral',
          timestamp: new Date().toISOString(),
          source_context: conversationId ? `scene_witness_${conversationId}` : 'scene_witness',
        })
      ));
      witnessResults.forEach((r, i) => {
        if (r.status === 'rejected') {
          witnessMemoryFailures.push({ character_id: witnessCharacterIds[i], error: r.reason?.message });
          console.error(`[extractMemoriesFromTurn] Witness memory write FAILED for ${witnessCharacterIds[i]}: ${r.reason?.message}`);
        }
      });
    }

    // Persist new people as unresolved CharacterMemory records before returning.
    // This ensures detection survives modal dismissal — the modal is a review UI, not the source of truth.
    // validation_status='unresolved_identity' marks them for future resolution without blocking retrieval.
    const newPeopleWriteFailures = [];
    if (newPeopleDetected.length > 0 && targetChar) {
      for (const person of newPeopleDetected) {
        if (!person.name) continue;
        try {
          await base44.asServiceRole.entities.CharacterMemory.create({
            character_id: characterId,
            owner_email: user.email,
            memory_type: 'relationship',
            memory_text: `${targetChar.name} knows someone named ${person.name} (${person.relationship_type || 'unknown relationship'}). Context: ${person.context || 'mentioned in conversation'}`,
            memory_summary: `Knows ${person.name}`,
            importance_score: 4,
            confidence_score: 0.6,
            permanence: 'long_term',
            validation_status: 'unresolved_identity',
            original_raw_reference: person.name,
          });
        } catch (personMemError) {
          newPeopleWriteFailures.push({ name: person.name, error: personMemError.message });
          console.error(`[extractMemoriesFromTurn] CharacterMemory write FAILED for new person "${person.name}": ${personMemError.message}`);
        }
      }
    }

    return Response.json({
      success: true,
      newPeopleDetected,
      witness_memory_failures: witnessMemoryFailures,
      new_people_write_failures: newPeopleWriteFailures,
    });
  } catch (error) {
    console.error('extractMemoriesFromTurn error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});