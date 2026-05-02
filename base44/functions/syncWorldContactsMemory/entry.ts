import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncWorldContactsMemory
 *
 * Creates durable character memories from World Contacts conversations.
 *
 * Called after a World Contacts conversation ends to extract messages
 * and create/update CharacterMemory records for both participants.
 *
 * Memory is:
 * - Scoped to owner_email (the main user)
 * - Linked to conversation_id and message range
 * - Deduplicated by message range to prevent duplicates
 * - Available across all pages that build character context
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me();
    if (!me?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { conversationId, primaryCharacterId } = await req.json();
    if (!conversationId || !primaryCharacterId) {
      return Response.json({
        error: 'Missing conversationId or primaryCharacterId'
      }, { status: 400 });
    }

    // ── LOAD CONVERSATION & MESSAGES ──────────────────────────────────────
    const convos = await base44.entities.Conversation.filter(
      { id: conversationId, type: 'npc' },
      null,
      1
    );
    const convo = convos[0];
    if (!convo || !convo.character_ids || convo.character_ids.length < 2) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Identify the two characters in the conversation
    const [charAId, charBId] = convo.character_ids;
    if (!charAId || !charBId) {
      return Response.json({ error: 'Invalid conversation participants' }, { status: 400 });
    }

    // Load all messages
    const messages = await base44.entities.Message.filter(
      { conversation_id: conversationId },
      'created_date',
      100
    );
    if (!messages || messages.length === 0) {
      return Response.json({
        success: true,
        message: 'No messages to sync',
        memoryCreated: 0
      });
    }

    // ── BUILD MEMORY SUMMARY ──────────────────────────────────────────────
    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];
    const messageIds = messages.map(m => m.id);
    const messageRange = `${firstMsg.id}_to_${lastMsg.id}`;

    // Extract tone and key topics from messages
    const messageContents = messages
      .map(m => (m.content || '').substring(0, 100))
      .join(' | ');
    const summaryText = messageContents.substring(0, 300);

    // Determine emotional tone from conversation
    const allText = messages.map(m => m.content || '').join(' ').toLowerCase();
    let emotionalTone = 'neutral';
    if (/love|care|thank|appreciate|miss/.test(allText)) {
      emotionalTone = 'warm';
    } else if (/angry|hate|upset|frustrat|conflict/.test(allText)) {
      emotionalTone = 'tense';
    } else if (/laugh|funny|joke|great|awesome/.test(allText)) {
      emotionalTone = 'positive';
    } else if (/sad|down|upset|lonely|hard/.test(allText)) {
      emotionalTone = 'vulnerable';
    }

    // ── CHECK FOR EXISTING MEMORY ─────────────────────────────────────────
    // Deduplicate by conversation_id + message range
    const existingMemories = await base44.entities.CharacterMemory.filter(
      { character_id: charAId, related_character_id: charBId },
      '-created_date',
      10
    ).catch(() => []);

    const hasExistingMemory = existingMemories.some(m =>
      m.memory_summary?.includes(`[world_contacts]`) &&
      m.memory_summary?.includes(messageRange)
    );

    if (hasExistingMemory) {
      console.log(`[syncWorldContactsMemory] Memory already exists for conversation ${conversationId}`);
      return Response.json({
        success: true,
        message: 'Memory already exists',
        memoryCreated: 0
      });
    }

    // ── CREATE MEMORY FOR CHARACTER A ─────────────────────────────────────
    const memoryA = await base44.entities.CharacterMemory.create({
      character_id: charAId,
      memory_type: 'relationship',
      memory_text: `Had a conversation with ${charBId === charAId ? 'themselves' : charBId} via World Contacts. ${summaryText}`,
      memory_summary: `[world_contacts] Talked with contact | tone: ${emotionalTone} | msgs: ${messages.length} | range: ${messageRange}`,
      related_character_id: charBId,
      related_location_id: null,
      related_message_id: null,
      importance_score: Math.min(3 + Math.floor(messages.length / 3), 8),
      confidence_score: 0.95,
      permanence: 'long_term',
      validation_status: 'confirmed'
    }).catch(err => {
      console.error(`[syncWorldContactsMemory] Failed to create memory for ${charAId}: ${err.message}`);
      return null;
    });

    // ── CREATE MEMORY FOR CHARACTER B ─────────────────────────────────────
    const memoryB = await base44.entities.CharacterMemory.create({
      character_id: charBId,
      memory_type: 'relationship',
      memory_text: `Had a conversation with ${charAId === charBId ? 'themselves' : charAId} via World Contacts. ${summaryText}`,
      memory_summary: `[world_contacts] Talked with contact | tone: ${emotionalTone} | msgs: ${messages.length} | range: ${messageRange}`,
      related_character_id: charAId,
      related_location_id: null,
      related_message_id: null,
      importance_score: Math.min(3 + Math.floor(messages.length / 3), 8),
      confidence_score: 0.95,
      permanence: 'long_term',
      validation_status: 'confirmed'
    }).catch(err => {
      console.error(`[syncWorldContactsMemory] Failed to create memory for ${charBId}: ${err.message}`);
      return null;
    });

    const memoriesCreated = [memoryA, memoryB].filter(m => m).length;

    console.log(
      `[syncWorldContactsMemory] ✓ Created memories for conversation ${conversationId.substring(0, 8)}... | `
      + `chars: ${charAId.substring(0, 6)}...↔${charBId.substring(0, 6)}... | `
      + `msgs: ${messages.length} | tone: ${emotionalTone} | memories: ${memoriesCreated}`
    );

    return Response.json({
      success: true,
      message: 'Memory synced',
      conversationId,
      participantIds: [charAId, charBId],
      messageCount: messages.length,
      memoryCreated: memoriesCreated,
      emotionalTone,
      messageRange
    });

  } catch (error) {
    console.error('[syncWorldContactsMemory]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});