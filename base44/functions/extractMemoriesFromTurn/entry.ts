import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, conversationId, userMessage, characterReply } = await req.json();

    if (!characterId || !conversationId || !userMessage || !characterReply) {
      return Response.json({ 
        error: 'characterId, conversationId, userMessage, and characterReply are required' 
      }, { status: 400 });
    }

    // Get character details
    const character = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).then(c => c?.[0]);
    
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Build existing people context so we don't duplicate
    const existingFamilyNames = (character.family_members || []).map(f => f.name?.toLowerCase()).filter(Boolean);
    const existingRelNames = (character.fictional_relationships || []).map(r => r.person_name?.toLowerCase()).filter(Boolean);
    const existingEncounterDescs = (character.transient_encounters || []).map(e => e.description?.toLowerCase()).filter(Boolean);
    const existingPeopleContext = [...existingFamilyNames, ...existingRelNames].join(', ');

    // Run memory extraction and people detection in parallel
    const [memoryResponse, peopleResponse] = await Promise.all([
      base44.integrations.Core.InvokeLLM({
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
- Details about the user's life, preferences, or relationships
- New names revealed (baby names, people's names)
- Life events (birth, death, new job, relationship changes)

Return a JSON object with:
- should_remember: boolean (true if there's something worth remembering)
- title: string (brief memory title, empty if should_remember is false)
- description: string (detailed description of the memory)
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
      }),

      base44.integrations.Core.InvokeLLM({
        prompt: `You are analyzing a chat message for mentions of people that ${character.name} knows or encountered.

CHARACTER: ${character.name}
EXISTING KNOWN PEOPLE (do NOT re-add these): ${existingPeopleContext || 'none yet'}

CONVERSATION TURN:
User: ${userMessage}
${character.name}: ${characterReply}

Detect any people mentioned — named or unnamed (e.g. "my coworker", "some guy at the bar", "a baby named Leo", "my sister").
For each person found, classify them:
- "family" → blood relative, spouse, child, parent, sibling
- "relationship" → close friend, colleague, romantic interest, someone known well
- "transient" → stranger, one-off encounter, unnamed/vague person

Special rules:
- If a baby or child is mentioned and named, classify as "family" child
- If a baby/child is unnamed, classify as "transient" with description "unnamed baby/child"
- If someone is mentioned with a vague role (coworker, neighbor, stranger), classify as "transient"
- Only return people that are clearly new and not already in the existing known people list
- If no new people detected, return empty arrays

Return JSON:
{
  "family": [{ "name": string, "relationship_type": string }],
  "relationships": [{ "person_name": string, "relationship_type": string, "description": string }],
  "transient": [{ "description": string, "context": string, "emotional_reaction": string }]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            family: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  relationship_type: { type: "string" }
                }
              }
            },
            relationships: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  person_name: { type: "string" },
                  relationship_type: { type: "string" },
                  description: { type: "string" }
                }
              }
            },
            transient: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string" },
                  context: { type: "string" },
                  emotional_reaction: { type: "string" }
                }
              }
            }
          }
        }
      })
    ]);

    // --- Save memory ---
    let createdMemory = null;
    if (memoryResponse.should_remember && memoryResponse.title && memoryResponse.description) {
      createdMemory = await base44.asServiceRole.entities.Memory.create({
        character_id: characterId,
        title: memoryResponse.title,
        description: memoryResponse.description,
        emotional_impact: memoryResponse.emotional_impact || 'neutral',
        lesson_learned: memoryResponse.lesson_learned || '',
        source_context: conversationId,
        timestamp: new Date().toISOString()
      });
    }

    // --- Merge new people into character ---
    let characterUpdates = {};
    let updatesNeeded = false;

    // New family members
    const newFamily = (peopleResponse.family || []).filter(f =>
      f.name && !existingFamilyNames.includes(f.name.toLowerCase())
    );
    if (newFamily.length > 0) {
      characterUpdates.family_members = [
        ...(character.family_members || []),
        ...newFamily
      ];
      updatesNeeded = true;
    }

    // New fictional relationships
    const newRels = (peopleResponse.relationships || []).filter(r =>
      r.person_name && !existingRelNames.includes(r.person_name.toLowerCase())
    );
    if (newRels.length > 0) {
      characterUpdates.fictional_relationships = [
        ...(character.fictional_relationships || []),
        ...newRels.map(r => ({
          person_name: r.person_name,
          relationship_type: r.relationship_type || 'acquaintance',
          description: r.description || '',
          current_status: 'ongoing',
          user_respect_level: 50,
          friendship_level: 50,
          romantic_level: 0,
          attraction_level: 0,
          chosen_family_level: 0
        }))
      ];
      updatesNeeded = true;
    }

    // New transient encounters (dedupe by description similarity)
    const newTransient = (peopleResponse.transient || []).filter(t =>
      t.description && !existingEncounterDescs.some(e => e.includes(t.description.toLowerCase().substring(0, 20)))
    );
    if (newTransient.length > 0) {
      characterUpdates.transient_encounters = [
        ...(character.transient_encounters || []),
        ...newTransient.map(t => ({
          description: t.description,
          context: t.context || '',
          emotional_reaction: t.emotional_reaction || 'neutral',
          date: new Date().toISOString()
        }))
      ];
      updatesNeeded = true;
    }

    if (updatesNeeded) {
      await base44.asServiceRole.entities.Character.update(characterId, characterUpdates);
    }

    return Response.json({ 
      success: true, 
      memoryCreated: !!createdMemory,
      memory: createdMemory,
      newPeopleDetected: {
        family: newFamily,
        relationships: newRels,
        transient: newTransient
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});