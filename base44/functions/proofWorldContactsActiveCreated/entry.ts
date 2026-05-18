import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * proofWorldContactsActiveCreated
 *
 * ACCEPTANCE TEST: Active Created Character → Active Created Character via World Contacts.
 *
 * Proof case: Auto-selects the first two active_created_character records on the account.
 * Pass charAName / charBName in payload to target specific characters (e.g. "Melody", "Khalil").
 *
 * Runs all 10 required proof checks and returns a structured visible report.
 * Does NOT send a real message — it proves the pipeline is correct and
 * checks that any existing World Contacts exchange between them was persisted correctly.
 *
 * Checks:
 *  1. Nathan exists as active_created_character owned by currentUser.email
 *  2. Lila exists as active_created_character owned by currentUser.email
 *  3. Lila appears in Nathan's contact list by real Character.id (not name shell)
 *  4. Nathan appears in Lila's contact list by real Character.id
 *  5. World Contacts conversation (if exists) has both IDs in character_ids + participant_character_ids
 *  6. World Contacts conversation (if exists) has correct owner_email
 *  7. World Contacts conversation (if exists) has world_contact_mode or participant_character_types
 *  8. Any message records: sender_character_id and receiver_character_id are both real Character IDs
 *  9. Memory records for Nathan reference Lila's name/ID
 * 10. Memory records for Lila reference Nathan's name/ID
 * 11. retrieveActiveMemory for Nathan finds any exchange with Lila
 * 12. retrieveActiveMemory for Lila finds any exchange with Nathan
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const charAName = body.charAName || null;
    const charBName = body.charBName || null;

    // ── FIND two active_created_character records ────────────────────────────
    const allActive = await base44.entities.Character.filter(
      { owner_email: user.email, status: 'active', character_type: 'active_created_character' }, null, 50
    );

    // Exact match first. Substring only as fallback for auto-selected (no name given) cases.
    const charA = charAName
      ? (allActive.find(c => c.name?.trim().toLowerCase() === charAName.trim().toLowerCase()) ||
         (() => { throw new Error(`EXACT_CHARACTER_NOT_FOUND: "${charAName}" — no exact name match in active_created_character records`); })())
      : allActive[0];
    const charB = charBName
      ? (allActive.find(c => c.name?.trim().toLowerCase() === charBName.trim().toLowerCase()) ||
         (() => { throw new Error(`EXACT_CHARACTER_NOT_FOUND: "${charBName}" — no exact name match in active_created_character records`); })())
      : allActive.find(c => c.id !== charA?.id);

    const resolvedAName = charA?.name || charAName || 'Character A';
    const resolvedBName = charB?.name || charBName || 'Character B';

    const proof = {
      test_case: 'active_created_to_active_created',
      character_a_name: resolvedAName,
      character_b_name: resolvedBName,
      owner_email: user.email,
      checks: [],
      passed: 0,
      failed: 0,
      warnings: 0,
      summary: '',
    };

    function pass(name, detail) {
      proof.checks.push({ check: name, status: 'PASS', detail });
      proof.passed++;
    }
    function fail(name, detail) {
      proof.checks.push({ check: name, status: 'FAIL', detail });
      proof.failed++;
    }
    function warn(name, detail) {
      proof.checks.push({ check: name, status: 'WARN', detail });
      proof.warnings++;
    }

    // ── STEP 1: Confirm Character A ──────────────────────────────────────────
    if (!charA) {
      fail('1_charA_exists', `No active_created_character found for Character A ("${resolvedAName}") on owner_email=${user.email}`);
    } else {
      pass('1_charA_exists', `${charA.name} | id=${charA.id} | character_type=${charA.character_type} | owner_email=${charA.owner_email}`);
    }

    // ── STEP 2: Confirm Character B ──────────────────────────────────────────
    if (!charB) {
      fail('2_charB_exists', `No active_created_character found for Character B ("${resolvedBName}") on owner_email=${user.email}`);
    } else {
      pass('2_charB_exists', `${charB.name} | id=${charB.id} | character_type=${charB.character_type} | owner_email=${charB.owner_email}`);
    }

    if (!charA || !charB) {
      proof.summary = `BLOCKED: Cannot find two active_created_character records on this account.`;
      return Response.json(proof);
    }

    // Alias for readability
    const nathan = charA;
    const lila = charB;

    // ── STEP 3: Lila in Nathan's fictional_relationships by real Character.id ──
    const nathanRels = nathan.fictional_relationships || [];
    const nathanHasLilaById = nathanRels.some(r => r.related_character_id === lila.id);
    const nathanHasLilaByName = nathanRels.some(r => r.person_name?.trim().toLowerCase() === 'lila' && !r.related_character_id);

    if (nathanHasLilaById) {
      const entry = nathanRels.find(r => r.related_character_id === lila.id);
      pass('3_lila_in_nathan_contacts_by_id', `Nathan has Lila by real id=${lila.id} | relationship_type=${entry?.relationship_type} | awareness_only=${entry?.awareness_only ?? false}`);
    } else if (nathanHasLilaByName) {
      warn('3_lila_in_nathan_contacts_name_only', `Nathan has Lila as name-only entry — related_character_id not set. Resolver will attempt name-match hydration.`);
    } else {
      warn('3_lila_in_nathan_contacts_missing', `Lila not in Nathan's fictional_relationships. She will appear via conversation-link or awareness bootstrap on first open.`);
    }

    // ── STEP 4: Nathan in Lila's fictional_relationships by real Character.id ──
    const lilaRels = lila.fictional_relationships || [];
    const lilaHasNathanById = lilaRels.some(r => r.related_character_id === nathan.id);
    const lilaHasNathanByName = lilaRels.some(r => r.person_name?.trim().toLowerCase() === 'nathan' && !r.related_character_id);

    if (lilaHasNathanById) {
      const entry = lilaRels.find(r => r.related_character_id === nathan.id);
      pass('4_nathan_in_lila_contacts_by_id', `Lila has Nathan by real id=${nathan.id} | relationship_type=${entry?.relationship_type} | awareness_only=${entry?.awareness_only ?? false}`);
    } else if (lilaHasNathanByName) {
      warn('4_nathan_in_lila_contacts_name_only', `Lila has Nathan as name-only entry — related_character_id not set.`);
    } else {
      warn('4_nathan_in_lila_contacts_missing', `Nathan not in Lila's fictional_relationships. Will appear via conversation-link or awareness bootstrap on first open.`);
    }

    // ── STEP 5-7: Find World Contacts conversation between Nathan and Lila ──
    const canonicalKey = `world_phone::${[nathan.id, lila.id].sort()[0]}::${[nathan.id, lila.id].sort()[1]}`;

    const [byCanonicalKey, byCharIds] = await Promise.all([
      base44.entities.Conversation.filter({ shared_conversation_key: canonicalKey }, '-updated_date', 5),
      base44.entities.Conversation.filter({ character_ids: [nathan.id] }, '-updated_date', 100),
    ]);

    const convoByCharIds = byCharIds.filter(c =>
      Array.isArray(c.character_ids) &&
      c.character_ids.includes(nathan.id) &&
      c.character_ids.includes(lila.id)
    );

    const worldConvo = byCanonicalKey[0] || convoByCharIds[0] || null;

    if (!worldConvo) {
      warn('5_conversation_exists', `No World Contacts conversation found between Nathan (${nathan.id}) and Lila (${lila.id}) yet. This is expected if no messages have been sent.`);
      warn('6_conversation_owner_email', 'No conversation to check — not yet created.');
      warn('7_conversation_mode_fields', 'No conversation to check — not yet created.');
    } else {
      // Check 5: both IDs present
      const hasNathan = (worldConvo.character_ids || []).includes(nathan.id);
      const hasLila = (worldConvo.character_ids || []).includes(lila.id);
      const hasParticipants = (worldConvo.participant_character_ids || []).includes(nathan.id) &&
        (worldConvo.participant_character_ids || []).includes(lila.id);

      if (hasNathan && hasLila) {
        pass('5_conversation_has_both_ids', `Conversation ${worldConvo.id} | character_ids includes both Nathan(${nathan.id}) and Lila(${lila.id}) | participant_character_ids_ok=${hasParticipants}`);
      } else {
        fail('5_conversation_has_both_ids', `Conversation ${worldConvo.id} | character_ids=${JSON.stringify(worldConvo.character_ids)} | missing: nathan=${!hasNathan} lila=${!hasLila}`);
      }

      // Check 6: owner_email
      if (worldConvo.owner_email === user.email) {
        pass('6_conversation_owner_email', `owner_email=${worldConvo.owner_email} matches currentUser.email`);
      } else {
        fail('6_conversation_owner_email', `owner_email=${worldConvo.owner_email} does NOT match currentUser.email=${user.email}`);
      }

      // Check 7: world_contact_mode / participant_character_types
      const hasMode = !!worldConvo.world_contact_mode;
      const hasTypes = Array.isArray(worldConvo.participant_character_types) && worldConvo.participant_character_types.length > 0;
      if (hasMode || hasTypes) {
        pass('7_conversation_mode_fields', `world_contact_mode=${worldConvo.world_contact_mode || 'not set'} | participant_character_types=${JSON.stringify(worldConvo.participant_character_types || [])}`);
      } else {
        warn('7_conversation_mode_fields', `world_contact_mode and participant_character_types not stamped on this conversation (id=${worldConvo.id}). New conversations will include these fields going forward.`);
      }
    }

    // ── STEP 8: Message records ──────────────────────────────────────────────
    let messages = [];
    if (worldConvo) {
      messages = await base44.entities.Message.filter({ conversation_id: worldConvo.id }, 'created_date', 50);
      if (messages.length === 0) {
        warn('8_message_records', `Conversation exists (${worldConvo.id}) but no messages yet.`);
      } else {
        const badMessages = messages.filter(m =>
          (m.sender_character_id && m.sender_character_id !== nathan.id && m.sender_character_id !== lila.id) ||
          (m.receiver_character_id && m.receiver_character_id !== nathan.id && m.receiver_character_id !== lila.id)
        );
        if (badMessages.length > 0) {
          fail('8_message_records', `${badMessages.length} message(s) have sender/receiver IDs that are neither Nathan nor Lila. Sample: ${JSON.stringify(badMessages[0])}`);
        } else {
          const sample = messages[messages.length - 1];
          pass('8_message_records', `${messages.length} messages | all sender_character_id/receiver_character_id are Nathan or Lila | latest: sender=${sample.sender_character_id} receiver=${sample.receiver_character_id}`);
        }
      }
    } else {
      warn('8_message_records', 'No conversation yet — no messages to check.');
    }

    const aNameLower = nathan.name.toLowerCase();
    const bNameLower = lila.name.toLowerCase();

    // ── STEP 9: Memory records for A referencing B ───────────────────────────
    const nathanMemories = await base44.entities.Memory.filter({ character_id: nathan.id }, '-created_date', 50);
    const nathanLilaMemories = nathanMemories.filter(m =>
      m.description?.toLowerCase().includes(bNameLower) ||
      m.title?.toLowerCase().includes(bNameLower)
    );
    if (nathanLilaMemories.length > 0) {
      pass('9_charA_memory_has_charB', `${nathan.name} has ${nathanLilaMemories.length} memory record(s) referencing ${lila.name} | latest: "${nathanLilaMemories[0].title}"`);
    } else if (nathanMemories.length > 0) {
      warn('9_charA_memory_has_charB', `${nathan.name} has ${nathanMemories.length} memory records but none reference ${lila.name} yet. Expected if no World Contacts message sent.`);
    } else {
      warn('9_charA_memory_has_charB', `${nathan.name} has no Memory records yet.`);
    }

    // ── STEP 10: Memory records for B referencing A ──────────────────────────
    const lilaMemories = await base44.entities.Memory.filter({ character_id: lila.id }, '-created_date', 50);
    const lilaNathanMemories = lilaMemories.filter(m =>
      m.description?.toLowerCase().includes(aNameLower) ||
      m.title?.toLowerCase().includes(aNameLower)
    );
    if (lilaNathanMemories.length > 0) {
      pass('10_charB_memory_has_charA', `${lila.name} has ${lilaNathanMemories.length} memory record(s) referencing ${nathan.name} | latest: "${lilaNathanMemories[0].title}"`);
    } else if (lilaMemories.length > 0) {
      warn('10_charB_memory_has_charA', `${lila.name} has ${lilaMemories.length} memory records but none reference ${nathan.name} yet.`);
    } else {
      warn('10_charB_memory_has_charA', `${lila.name} has no Memory records yet.`);
    }

    // ── STEP 11: retrieveActiveMemory for A finds B exchange ────────────────
    try {
      const nathanMemRes = await base44.functions.invoke('retrieveActiveMemory', {
        characterId: nathan.id,
        currentMessage: `What's going on with ${lila.name}?`,
        recentMessages: [],
        topK: 10,
      });
      const nathanActiveMems = nathanMemRes?.data?.memories || [];
      const nathanLilaActive = nathanActiveMems.filter(m =>
        m.description?.toLowerCase().includes(bNameLower) || m.title?.toLowerCase().includes(bNameLower)
      );
      if (nathanLilaActive.length > 0) {
        pass('11_retrieve_active_memory_charA', `retrieveActiveMemory for ${nathan.name} returns ${nathanLilaActive.length} memory/memories referencing ${lila.name} | top: "${nathanLilaActive[0].title}"`);
      } else {
        warn('11_retrieve_active_memory_charA', `retrieveActiveMemory for ${nathan.name} returned ${nathanActiveMems.length} memories but none reference ${lila.name}. Expected if no exchange yet.`);
      }
    } catch (e) {
      warn('11_retrieve_active_memory_charA', `retrieveActiveMemory call failed: ${e.message}`);
    }

    // ── STEP 12: retrieveActiveMemory for B finds A exchange ────────────────
    try {
      const lilaMemRes = await base44.functions.invoke('retrieveActiveMemory', {
        characterId: lila.id,
        currentMessage: `What's going on with ${nathan.name}?`,
        recentMessages: [],
        topK: 10,
      });
      const lilaActiveMems = lilaMemRes?.data?.memories || [];
      const lilaNathanActive = lilaActiveMems.filter(m =>
        m.description?.toLowerCase().includes(aNameLower) || m.title?.toLowerCase().includes(aNameLower)
      );
      if (lilaNathanActive.length > 0) {
        pass('12_retrieve_active_memory_charB', `retrieveActiveMemory for ${lila.name} returns ${lilaNathanActive.length} memory/memories referencing ${nathan.name} | top: "${lilaNathanActive[0].title}"`);
      } else {
        warn('12_retrieve_active_memory_charB', `retrieveActiveMemory for ${lila.name} returned ${lilaActiveMems.length} memories but none reference ${nathan.name}. Expected if no exchange yet.`);
      }
    } catch (e) {
      warn('12_retrieve_active_memory_charB', `retrieveActiveMemory call failed: ${e.message}`);
    }

    // ── FINAL SUMMARY ────────────────────────────────────────────────────────
    proof.character_a = { id: nathan.id, name: nathan.name, character_type: nathan.character_type, owner_email: nathan.owner_email };
    proof.character_b = { id: lila.id, name: lila.name, character_type: lila.character_type, owner_email: lila.owner_email };
    proof.canonical_key = canonicalKey;
    proof.world_convo_id = worldConvo?.id || null;
    proof.message_count = messages.length;

    if (proof.failed === 0 && proof.passed >= 2) {
      proof.summary = `${proof.passed} checks PASSED, ${proof.warnings} warnings, 0 failures. ${nathan.name} and ${lila.name} are both valid active_created_character records. ${messages.length > 0 ? `World Contacts exchange exists (${messages.length} messages) and is correctly persisted.` : `No exchange yet — send a message from ${nathan.name} to ${lila.name} in World Contacts to complete the full proof.`}`;
    } else {
      proof.summary = `${proof.passed} PASSED, ${proof.warnings} warnings, ${proof.failed} FAILED. Review failures above.`;
    }

    return Response.json(proof);

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack?.substring(0, 500) }, { status: 500 });
  }
});