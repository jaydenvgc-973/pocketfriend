import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * extractMemoriesFromTurn
 *
 * STRICT MODE — Zero Trust Character Creation
 *
 * RULES:
 * - MAY store conversational memories (text) in the Memory entity
 * - MUST NOT create characters automatically from dialogue
 * - MUST NOT add family members automatically from dialogue
 * - MUST NOT add fictional_relationships automatically from dialogue
 * - MUST NOT add transient_encounters that reference new named individuals
 *
 * The only thing this function does automatically is store a Memory record
 * (plain text note). All people detection is DISABLED.
 * Family lock is always honored — if locked, no memory about family is stored.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, conversationId, userMessage, characterReply } = await req.json();

    if (!characterId || !userMessage || !characterReply) {
      return Response.json({
        error: 'characterId, userMessage, and characterReply are required'
      }, { status: 400 });
    }

    // Get character details
    const character = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).then(c => c?.[0]);

    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // ── FAMILY LOCK CHECK ─────────────────────────────────────────────────
    // If family list is locked, do not store any memory that mentions family members.
    // This prevents the memory system from being a back-channel for family data creation.
    const familyKeywords = /\b(mom|mother|dad|father|sister|brother|son|daughter|grandmother|grandfather|grandma|grandpa|aunt|uncle|cousin|niece|nephew|spouse|wife|husband|family|parent|sibling|child|kids?|baby|infant|pregnant|birth|born)\b/i;
    const messageText = `${userMessage} ${characterReply}`;
    const mentionsFamily = familyKeywords.test(messageText);

    if (character.family_list_locked && mentionsFamily) {
      // Family lock active + family mention → store nothing, return silently
      return Response.json({
        success: true,
        memoryCreated: false,
        blocked: true,
        reason: 'FAMILY_LIST_LOCKED — family mention ignored',
        newPeopleDetected: { family: [], relationships: [], transient: [] }
      });
    }

    // ── MEMORY EXTRACTION ONLY ────────────────────────────────────────────
    // Analyze the turn for significant conversational memories.
    // People detection (family/relationships/transient) is DISABLED — it was causing
    // automatic character creation and family member injection from dialogue.
    const memoryResponse = await base44.integrations.Core.InvokeLLM({
      prompt: `You are analyzing a conversation turn for ${character.name}, a character with:
- Personality: ${character.personality_summary}
- Traits: ${character.personality_traits?.join(', ') || 'N/A'}
- Current mood: ${character.emotional_state}

CONVERSATION TURN:
User: ${userMessage}
${character.name}: ${characterReply}

Does this exchange contain any significant memory that ${character.name} should remember? This could be:
- Important information about the user
- Decisions or commitments made
- Emotional moments
- Details about the user's life or preferences

IMPORTANT: Do NOT flag mentions of other people as memories that require creating new characters or family entries.
Just extract conversational facts and emotional moments.

Return a JSON object with:
- should_remember: boolean (true only if there is a clear, significant, memorable moment)
- title: string (brief memory title, empty if should_remember is false)
- description: string (description of the memory — focus on events/emotions, not people)
- emotional_impact: string (how it emotionally affects the character)
- lesson_learned: string (optional lesson or takeaway)`,
      response_json_schema: {
        type: "object",
        properties: {
          should_remember: { type: "boolean" },
          title: { type: "string" },
          description: { type: "string" },
          emotional_impact: { type: "string" },
          lesson_learned: { type: "string" }
        }
      }
    });

    // ── SAVE MEMORY (text only — no entity/character creation) ────────────
    let createdMemory = null;
    if (memoryResponse.should_remember && memoryResponse.title && memoryResponse.description) {
      createdMemory = await base44.asServiceRole.entities.Memory.create({
        character_id: characterId,
        title: memoryResponse.title,
        description: memoryResponse.description,
        emotional_impact: memoryResponse.emotional_impact || 'neutral',
        lesson_learned: memoryResponse.lesson_learned || '',
        source_context: conversationId || 'chat',
        timestamp: new Date().toISOString()
      });
    }

    // ── NO CHARACTER/FAMILY/RELATIONSHIP CREATION ─────────────────────────
    // People detected in dialogue are NOT persisted as entities, family members,
    // or fictional relationships. That must be done manually by the user.
    return Response.json({
      success: true,
      memoryCreated: !!createdMemory,
      memory: createdMemory,
      newPeopleDetected: {
        family: [],        // Always empty — no auto-creation
        relationships: [], // Always empty — no auto-creation
        transient: []      // Always empty — no auto-creation
      }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});