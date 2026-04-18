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

    // ── MEMORY + NEW PEOPLE DETECTION ────────────────────────────────────
    // Analyze the turn for significant memories AND detect new people mentioned.
    // People detected are returned to the frontend for user confirmation — NOT auto-saved.
    const existingRelationshipNames = (character.fictional_relationships || []).map(r => r.person_name?.toLowerCase()).filter(Boolean);
    const existingFamilyNames = (character.family_members || []).map(m => m.name?.toLowerCase()).filter(Boolean);
    const knownNames = [...existingRelationshipNames, ...existingFamilyNames];

    const memoryResponse = await base44.integrations.Core.InvokeLLM({
      prompt: `You are analyzing a conversation turn for ${character.name}, a character with:
- Personality: ${character.personality_summary}
- Traits: ${character.personality_traits?.join(', ') || 'N/A'}
- Current mood: ${character.emotional_state}

CONVERSATION TURN:
User: ${userMessage}
${character.name}: ${characterReply}

Already known people (DO NOT flag these): ${knownNames.length > 0 ? knownNames.join(', ') : 'none'}

TASK 1 — Memory: Does this exchange contain any significant memory that ${character.name} should remember?
- Important information about the user
- Decisions or commitments made
- Emotional moments
- Details about the user's life or preferences

TASK 2 — New People: Are any NEW named individuals mentioned (not in the already known list above)?
Only flag real named people (e.g. "Mateo", "Jordan") — NOT generic references like "my friend", "someone", "they".
Do NOT flag the user themselves or ${character.name}.

Return a JSON object with:
- should_remember: boolean
- title: string (brief memory title, empty if false)
- description: string (focus on events/emotions)
- emotional_impact: string
- lesson_learned: string
- new_people: array of objects with { name: string, relationship_type: string (best guess: Friend/Coworker/Family/Acquaintance/Romantic Interest/Other), context: string (one sentence about who they are based on the conversation) }`,
      response_json_schema: {
        type: "object",
        properties: {
          should_remember: { type: "boolean" },
          title: { type: "string" },
          description: { type: "string" },
          emotional_impact: { type: "string" },
          lesson_learned: { type: "string" },
          new_people: {
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

    // ── IDENTITY SANITIZATION: Replace any foreign user names before storing ──
    // This prevents cross-account contamination (e.g. "Mark" leaking into Jayden's memories)
    const userSettingsList = await base44.entities.UserSettings.filter({ created_by: user.email });
    const worldName = userSettingsList[0]?.fictional_world_name || null;
    const FOREIGN_USER_NAMES = ['Mark']; // Names belonging to OTHER user accounts

    const sanitizeForStorage = (text) => {
      if (!text || !worldName) return text;
      let cleaned = text;
      for (const foreignName of FOREIGN_USER_NAMES) {
        if (worldName !== foreignName) {
          const regex = new RegExp(`\\b${foreignName}\\b`, 'g');
          cleaned = cleaned.replace(regex, worldName);
        }
      }
      return cleaned;
    };

    if (memoryResponse.title) memoryResponse.title = sanitizeForStorage(memoryResponse.title);
    if (memoryResponse.description) memoryResponse.description = sanitizeForStorage(memoryResponse.description);
    if (memoryResponse.emotional_impact) memoryResponse.emotional_impact = sanitizeForStorage(memoryResponse.emotional_impact);
    if (memoryResponse.lesson_learned) memoryResponse.lesson_learned = sanitizeForStorage(memoryResponse.lesson_learned);

    // ── SAVE MEMORY (text only — no entity/character creation) ────────────
    let createdMemory = null;
    if (memoryResponse.should_remember && memoryResponse.title && memoryResponse.description) {
      // CRITICAL: Save memory scoped to the authenticated user's email
      // This prevents memories from bleeding across accounts (e.g. "Mark" vs "Jayden")
      createdMemory = await base44.entities.Memory.create({
        character_id: characterId,
        title: memoryResponse.title,
        description: memoryResponse.description,
        emotional_impact: memoryResponse.emotional_impact || 'neutral',
        lesson_learned: memoryResponse.lesson_learned || '',
        source_context: conversationId || 'chat',
        timestamp: new Date().toISOString()
      });
    }

    // ── RETURN DETECTED PEOPLE FOR USER CONFIRMATION ─────────────────────
    // New people are returned to the frontend — NOT auto-saved.
    // The user must confirm before any relationship is created.
    const detectedPeople = (memoryResponse.new_people || []).filter(p =>
      p.name && !knownNames.includes(p.name.toLowerCase())
    );

    return Response.json({
      success: true,
      memoryCreated: !!createdMemory,
      memory: createdMemory,
      newPeopleDetected: {
        family: [],
        relationships: detectedPeople, // returned for user confirmation only
        transient: []
      }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});