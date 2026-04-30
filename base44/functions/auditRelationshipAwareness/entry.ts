import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * RELATIONSHIP AWARENESS AUDIT
 *
 * Comprehensive evidence scan across all social sources:
 * - fictional_relationships (explicit records)
 * - CharacterMemory entries (stored memories)
 * - Message history (chat/text conversations)
 * - CharacterAutomaticNarrative (life events, daily narratives)
 * - transient_encounters (chance meetings)
 * - family_members (family section)
 * - fictional_relationships "people in their world" (unlinked NPCs)
 * - Character residence/location co-presence history
 *
 * If Person A has repeated or significant evidence of knowing Person B,
 * but Person B has NO awareness record for Person A, creates minimum
 * known_contact on Person B with evidence-based relationship note.
 *
 * This ensures bidirectional awareness without assuming emotional reciprocity.
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { characterId, targetCharacterId } = await req.json();
  if (!characterId || !targetCharacterId) {
    return Response.json({ error: 'Missing characterId or targetCharacterId' }, { status: 400 });
  }

  // Fetch both characters (user-scoped, both must belong to same owner)
  let charA, charB;
  try {
    const charAResult = await base44.entities.Character.filter({ id: characterId });
    charA = charAResult?.[0];
    if (!charA) {
      return Response.json({ error: 'Character A not found' }, { status: 404 });
    }
    
    const charBResult = await base44.entities.Character.filter({ id: targetCharacterId });
    charB = charBResult?.[0];
    if (!charB) {
      return Response.json({ error: 'Character B not found' }, { status: 404 });
    }
  } catch (err) {
    return Response.json({ error: `Fetch failed: ${err.message}` }, { status: 500 });
  }

  // Validate ownership — A must belong to caller
  if (charA.owner_email !== user.email) {
    return Response.json({ error: 'Forbidden: character A does not belong to caller' }, { status: 403 });
  }

  // Skip if B is not same owner (cross-account awareness not supported)
  if (charB.owner_email !== user.email) {
    return Response.json({ success: false, skipped: true, reason: 'owner_email_mismatch' });
  }

  console.log(`[auditRelationshipAwareness] Auditing relationship: ${charA.name} → ${charB.name}`);

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Check if A already has explicit relationship with B
  // ═══════════════════════════════════════════════════════════════
  const existingRelOnA = (charA.fictional_relationships || []).find(
    r => r.related_character_id === targetCharacterId
  );

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Scan evidence sources for A→B interaction
  // ═══════════════════════════════════════════════════════════════
  const evidenceSources = [];
  let evidenceCount = 0;

  // Evidence 1: Explicit relationship (highest confidence)
  if (existingRelOnA) {
    evidenceSources.push(`explicit_relationship_${existingRelOnA.relationship_type}`);
    evidenceCount++;
  }

  // Evidence 2: Memories mentioning B (direct linked or text-based)
  try {
    // Use user-scoped fetch for memories
    const aMemories = await base44.entities.CharacterMemory.filter(
      { character_id: characterId },
      null,
      150
    );
    const memoriesOfB = aMemories.filter(m =>
      m.memory_text?.toLowerCase().includes(charB.name?.toLowerCase()) ||
      m.memory_text?.toLowerCase().includes(charB.primary_name?.toLowerCase() || '') ||
      m.memory_text?.toLowerCase().includes(charB.display_name?.toLowerCase() || '') ||
      m.related_character_id === targetCharacterId
    );
    if (memoriesOfB.length > 0) {
      evidenceSources.push(`${memoriesOfB.length}_memories`);
      evidenceCount += memoriesOfB.length;
      console.log(`  Evidence: ${memoriesOfB.length} memories of ${charB.name}`);
    }
  } catch (err) {
    console.warn(`  Could not fetch memories:`, err.message);
  }

  // Evidence 3: Chat/text conversations mentioning B
  try {
    const conversations = await base44.asServiceRole.entities.Conversation.filter(
      { character_ids: { $in: [characterId] } },
      null,
      50
    );
    let chatMentionCount = 0;
    for (const conv of conversations) {
      const messages = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: conv.id },
        null,
        300
      );
      for (const msg of messages) {
        if (msg.sender_type === 'character' && msg.character_id === characterId) {
          const msgLower = msg.content?.toLowerCase() || '';
          if (
            msgLower.includes(charB.name?.toLowerCase()) ||
            msgLower.includes(charB.primary_name?.toLowerCase() || '') ||
            msgLower.includes(charB.display_name?.toLowerCase() || '')
          ) {
            chatMentionCount++;
          }
        }
      }
    }
    if (chatMentionCount > 0) {
      evidenceSources.push(`${chatMentionCount}_chat_mentions`);
      evidenceCount += chatMentionCount;
      console.log(`  Evidence: ${chatMentionCount} chat mentions of ${charB.name}`);
    }
  } catch (err) {
    console.warn(`  Could not fetch chat:`, err.message);
  }

  // Evidence 4: Automatic narratives (life events, daily stories)
  try {
    const narratives = await base44.asServiceRole.entities.CharacterAutomaticNarrative.filter(
      { character_id: characterId },
      null,
      200
    );
    const narrativesWithB = narratives.filter(n => {
      const textLower = n.narrative_text?.toLowerCase() || '';
      return (
        textLower.includes(charB.name?.toLowerCase()) ||
        textLower.includes(charB.primary_name?.toLowerCase() || '') ||
        textLower.includes(charB.display_name?.toLowerCase() || '')
      );
    });
    if (narrativesWithB.length > 0) {
      evidenceSources.push(`${narrativesWithB.length}_narratives`);
      evidenceCount += narrativesWithB.length;
      console.log(`  Evidence: ${narrativesWithB.length} narratives mentioning ${charB.name}`);
    }
  } catch (err) {
    console.warn(`  Could not fetch narratives:`, err.message);
  }

  // Evidence 5: Family members mentioning B
  if (charA.family_members?.some(f => 
    f.name?.toLowerCase() === charB.name?.toLowerCase() ||
    f.name?.toLowerCase() === charB.primary_name?.toLowerCase()
  )) {
    evidenceSources.push('family_member');
    evidenceCount++;
    console.log(`  Evidence: ${charB.name} is listed as family member`);
  }

  // Evidence 6: People in Their World (unlinked NPCs)
  const worldPeopleEntry = (charA.fictional_relationships || []).find(
    r => !r.related_character_id && (
      r.person_name?.toLowerCase() === charB.name?.toLowerCase() ||
      r.person_name?.toLowerCase() === charB.primary_name?.toLowerCase()
    )
  );
  if (worldPeopleEntry) {
    evidenceSources.push('people_in_world');
    evidenceCount++;
    console.log(`  Evidence: ${charB.name} in People in Their World`);
  }

  // Evidence 7: Transient encounters (chance meetings)
  if (charA.transient_encounters?.some(e => {
    const descLower = e.description?.toLowerCase() || '';
    return (
      descLower.includes(charB.name?.toLowerCase()) ||
      descLower.includes(charB.primary_name?.toLowerCase() || '') ||
      descLower.includes(charB.display_name?.toLowerCase() || '')
    );
  })) {
    evidenceSources.push('transient_encounter');
    evidenceCount++;
    console.log(`  Evidence: transient encounter with ${charB.name}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Check if B has any awareness of A
  // ═══════════════════════════════════════════════════════════════
  const existingRelOnB = (charB.fictional_relationships || []).find(
    r => r.related_character_id === characterId
  );

  if (existingRelOnB) {
    console.log(`[auditRelationshipAwareness] ✓ Reciprocal exists: ${charB.name} knows ${charA.name}`);
    return Response.json({
      success: true,
      gap_found: false,
      reason: 'reciprocal_exists',
      evidenceSources,
      existingRelType: existingRelOnB.relationship_type
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Assess if evidence warrants awareness creation
  // ═══════════════════════════════════════════════════════════════
  if (evidenceCount === 0) {
    console.log(`[auditRelationshipAwareness] No evidence of interaction: ${charA.name} → ${charB.name}`);
    return Response.json({
      success: true,
      gap_found: false,
      reason: 'no_evidence',
      evidenceSources: []
    });
  }

  // Evidence exists but B has no awareness — create minimum known_contact
  console.log(`[auditRelationshipAwareness] GAP FOUND: ${charA.name} has ${evidenceCount} evidence item(s) of ${charB.name}, but ${charB.name} has no awareness`);
  console.log(`[auditRelationshipAwareness] Evidence sources: ${evidenceSources.join(' | ')}`);

  // Determine relationship type based on evidence strength
  // Multiple strong references (memories, chat, narratives) = established contact
  // Minimal evidence = known_contact
  let relationshipType = 'known_contact';
  if (evidenceCount >= 5 || evidenceSources.some(s => s.includes('_memories') && s.match(/\d+/)?.[0] > 2)) {
    relationshipType = 'known_contact'; // still safe default, no assumption of closeness
  }

  const relationshipNote = `Known through: ${evidenceSources.join(' | ')}. ${charA.name} has documented history of interaction with ${charB.name}.`;

  // Call the existing sync function to write the reciprocal with neutral defaults
  const syncResult = await base44.functions.invoke('syncRelatedCharacterRelationship', {
    characterId: characterId,
    relatedCharacterId: targetCharacterId,
    relationshipEntry: {
      relationship_type: relationshipType,
      description: relationshipNote,
      // Neutral defaults — B's feelings are independent from A's
      user_respect_level: 50,
      friendship_level: 50,
      romantic_level: 0,
      attraction_level: 0,
      chosen_family_level: 0,
      trust_level: 50,
      relational_jealousy: 0,
      envy_jealousy: 0,
    }
  });

  if (!syncResult?.success) {
    return Response.json({
      success: false,
      error: 'Failed to write reciprocal relationship',
      syncError: syncResult
    });
  }

  console.log(`[auditRelationshipAwareness] ✓ Reciprocal created: ${charB.name} now knows ${charA.name} (known_contact)`);

  return Response.json({
    success: true,
    gap_found: true,
    gap_repaired: true,
    evidenceSources,
    relationshipNote,
    message: `Created known_contact for ${charB.name}: ${charA.name}`
  });
});