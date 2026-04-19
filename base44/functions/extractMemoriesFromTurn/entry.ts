import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let { characterId, conversationId, userMessage, characterReply, playingAsCharacterId } = await req.json();

    if (!characterId || !conversationId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // If playingAsCharacterId not provided, check the last user message for it
    if (!playingAsCharacterId) {
      const lastUserMsg = await base44.entities.Message.filter(
        { conversation_id: conversationId, sender_type: 'user' },
        '-created_date',
        1
      ).then(r => r[0]);
      if (lastUserMsg?.played_as_character_id) {
        playingAsCharacterId = lastUserMsg.played_as_character_id;
      }
    }

    const [targetChar, playingAsChar] = await Promise.all([
      base44.entities.Character.filter({ id: characterId }).then(r => r[0]),
      playingAsCharacterId
        ? base44.entities.Character.filter({ id: playingAsCharacterId }).then(r => r[0])
        : Promise.resolve(null),
    ]);

    let newPeopleDetected = [];

    // ── TARGET CHARACTER: basic memory + new people detection ─────────────────
    if (targetChar && characterReply) {
      const targetMemoryResult = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${targetChar.name}. Someone just said: "${userMessage}" and you replied: "${characterReply}".

Extract any NEW people names mentioned (not yet in your world) from the exchange. Return JSON only.`,
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

      await base44.entities.Memory.create({
        character_id: characterId,
        title: `Conversation moment`,
        description: `They said: "${userMessage}". I responded: "${characterReply.substring(0, 200)}"`,
        emotional_impact: 'neutral',
        timestamp: new Date().toISOString(),
        source_context: `conversation_${conversationId}`,
      });
    }

    // ── PLAYED CHARACTER: full multi-dimensional memory extraction ─────────────
    // This is the core fix: the played character retains meaningful outcomes
    // from the interaction as if they lived through it — because they did.
    if (playingAsChar && targetChar && (userMessage || characterReply)) {
      const extraction = await base44.integrations.Core.InvokeLLM({
        prompt: `You are analyzing a real interaction that ${playingAsChar.name} just had with ${targetChar.name}.

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
            source_context: `play_as_${conversationId}_with_${characterId}`,
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

    return Response.json({ success: true, newPeopleDetected });
  } catch (error) {
    console.error('extractMemoriesFromTurn error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});