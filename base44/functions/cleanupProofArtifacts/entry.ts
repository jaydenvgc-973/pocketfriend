import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const log = [];
  const deleted = {};

  // ── Helper: hard delete all records from a list ────────────────────────────
  async function hardDeleteAll(entityName, records) {
    let count = 0;
    for (const rec of records) {
      try {
        await base44.asServiceRole.entities[entityName].delete(rec.id);
        count++;
      } catch (err) {
        log.push(`WARN: Failed to delete ${entityName} ${rec.id}: ${err.message}`);
      }
    }
    return count;
  }

  // ── Helper: is this a proof character? ────────────────────────────────────
  function isProofChar(name) {
    if (!name) return false;
    const n = name.toLowerCase();
    return (
      name.startsWith('ProofCharA') ||
      name.startsWith('ProofCharB') ||
      n.includes('proof_commit') ||
      n.includes('__proof_commitment') ||
      n.includes('proofchar')
    );
  }

  function isProofRecord(str) {
    if (!str) return false;
    const s = str.toLowerCase();
    return (
      s.includes('proof_commit') ||
      s.includes('__proof_commitment') ||
      s.includes('proofchara') ||
      s.includes('proofcharb') ||
      s.includes('proof convo') ||
      s.includes('proofchar')
    );
  }

  // ── STEP 1: Find all proof characters ─────────────────────────────────────
  let proofCharIds = new Set();
  let proofConvoIds = new Set();
  let proofCommitmentIds = new Set();

  try {
    // Fetch all characters owned by this user (service role to catch all)
    const allChars = await base44.asServiceRole.entities.Character.list('-created_date', 500);
    const proofChars = allChars.filter(c => isProofChar(c.name) || (c.is_test_character === true && isProofChar(c.name)));
    
    for (const c of proofChars) proofCharIds.add(c.id);
    log.push(`Found ${proofChars.length} proof characters: ${proofChars.map(c => c.name).join(', ')}`);
    
    deleted.characters = await hardDeleteAll('Character', proofChars);
    log.push(`Deleted ${deleted.characters} characters`);
  } catch (err) {
    log.push(`ERROR fetching characters: ${err.message}`);
    deleted.characters = 0;
  }

  // ── STEP 2: Find and delete proof Conversations ────────────────────────────
  try {
    const allConvos = await base44.asServiceRole.entities.Conversation.list('-created_date', 500);
    const proofConvos = allConvos.filter(c => isProofRecord(c.title) || isProofRecord(c.shared_conversation_key));
    for (const c of proofConvos) proofConvoIds.add(c.id);
    log.push(`Found ${proofConvos.length} proof conversations`);
    deleted.conversations = await hardDeleteAll('Conversation', proofConvos);
    log.push(`Deleted ${deleted.conversations} conversations`);
  } catch (err) {
    log.push(`ERROR fetching conversations: ${err.message}`);
    deleted.conversations = 0;
  }

  // ── STEP 3: Find and delete proof Messages ─────────────────────────────────
  deleted.messages = 0;
  for (const convoId of proofConvoIds) {
    try {
      const msgs = await base44.asServiceRole.entities.Message.filter({ conversation_id: convoId });
      const count = await hardDeleteAll('Message', msgs);
      deleted.messages += count;
    } catch (err) {
      log.push(`WARN: Could not fetch messages for convo ${convoId}: ${err.message}`);
    }
  }
  // Also scan messages with proof character IDs
  for (const charId of proofCharIds) {
    try {
      const msgs = await base44.asServiceRole.entities.Message.filter({ character_id: charId });
      const undeleted = msgs; // may already be gone with convo, but hard-delete anyway
      const count = await hardDeleteAll('Message', undeleted);
      deleted.messages += count;
    } catch (err) {
      // ignore — may already be deleted
    }
  }
  log.push(`Deleted ${deleted.messages} messages`);

  // ── STEP 4: Find and delete proof CharacterCommitments ────────────────────
  try {
    const allCommits = await base44.asServiceRole.entities.CharacterCommitment.list('-created_date', 500);
    const proofCommits = allCommits.filter(c =>
      proofCharIds.has(c.character_id) ||
      isProofRecord(c.source_message) ||
      isProofRecord(c.description) ||
      isProofRecord(c.character_name)
    );
    for (const c of proofCommits) proofCommitmentIds.add(c.id);
    log.push(`Found ${proofCommits.length} proof commitments`);
    deleted.commitments = await hardDeleteAll('CharacterCommitment', proofCommits);
    log.push(`Deleted ${deleted.commitments} commitments`);
  } catch (err) {
    log.push(`ERROR fetching commitments: ${err.message}`);
    deleted.commitments = 0;
  }

  // ── STEP 5: Find and delete proof ScheduledEvents ─────────────────────────
  try {
    const allEvents = await base44.asServiceRole.entities.ScheduledEvent.list('-created_date', 500);
    const proofEvents = allEvents.filter(e => {
      if (isProofRecord(e.description)) return true;
      if (proofConvoIds.has(e.conversation_id)) return true;
      if (e.character_ids && e.character_ids.some(id => proofCharIds.has(id))) return true;
      if (e.event_payload?.commitment_id && proofCommitmentIds.has(e.event_payload.commitment_id)) return true;
      return false;
    });
    log.push(`Found ${proofEvents.length} proof scheduled events`);
    deleted.scheduled_events = await hardDeleteAll('ScheduledEvent', proofEvents);
    log.push(`Deleted ${deleted.scheduled_events} scheduled events`);
  } catch (err) {
    log.push(`ERROR fetching scheduled events: ${err.message}`);
    deleted.scheduled_events = 0;
  }

  // ── STEP 6: Find and delete proof CharacterMemory ─────────────────────────
  try {
    const allMemories = await base44.asServiceRole.entities.CharacterMemory.list('-created_date', 500);
    const proofMemories = allMemories.filter(m =>
      proofCharIds.has(m.character_id) ||
      isProofRecord(m.memory_text) ||
      isProofRecord(m.memory_summary)
    );
    log.push(`Found ${proofMemories.length} proof memories`);
    deleted.memories = await hardDeleteAll('CharacterMemory', proofMemories);
    log.push(`Deleted ${deleted.memories} memories`);
  } catch (err) {
    log.push(`ERROR fetching memories: ${err.message}`);
    deleted.memories = 0;
  }

  // ── STEP 7: VERIFICATION — confirm all counts are 0 ───────────────────────
  const verification = {};

  try {
    const remaining = await base44.asServiceRole.entities.Character.list('-created_date', 500);
    verification.remaining_proof_characters = remaining.filter(c => isProofChar(c.name)).map(c => ({ id: c.id, name: c.name }));
  } catch (err) {
    verification.remaining_proof_characters = `ERROR: ${err.message}`;
  }

  try {
    const remaining = await base44.asServiceRole.entities.Conversation.list('-created_date', 500);
    verification.remaining_proof_convos = remaining.filter(c => isProofRecord(c.title)).map(c => ({ id: c.id, title: c.title }));
  } catch (err) {
    verification.remaining_proof_convos = `ERROR: ${err.message}`;
  }

  try {
    const remaining = await base44.asServiceRole.entities.CharacterCommitment.list('-created_date', 200);
    verification.remaining_proof_commitments = remaining.filter(c =>
      isProofRecord(c.source_message) || isProofRecord(c.character_name)
    ).map(c => ({ id: c.id, character_name: c.character_name }));
  } catch (err) {
    verification.remaining_proof_commitments = `ERROR: ${err.message}`;
  }

  try {
    const remaining = await base44.asServiceRole.entities.ScheduledEvent.list('-created_date', 200);
    verification.remaining_proof_events = remaining.filter(e => isProofRecord(e.description)).map(e => ({ id: e.id, description: e.description?.substring(0, 60) }));
  } catch (err) {
    verification.remaining_proof_events = `ERROR: ${err.message}`;
  }

  try {
    const remaining = await base44.asServiceRole.entities.CharacterMemory.list('-created_date', 200);
    verification.remaining_proof_memories = remaining.filter(m =>
      isProofRecord(m.memory_text) || isProofRecord(m.memory_summary)
    ).map(m => ({ id: m.id }));
  } catch (err) {
    verification.remaining_proof_memories = `ERROR: ${err.message}`;
  }

  // Check counts
  const counts = {
    proof_characters: Array.isArray(verification.remaining_proof_characters) ? verification.remaining_proof_characters.length : -1,
    proof_convos: Array.isArray(verification.remaining_proof_convos) ? verification.remaining_proof_convos.length : -1,
    proof_commitments: Array.isArray(verification.remaining_proof_commitments) ? verification.remaining_proof_commitments.length : -1,
    proof_events: Array.isArray(verification.remaining_proof_events) ? verification.remaining_proof_events.length : -1,
    proof_memories: Array.isArray(verification.remaining_proof_memories) ? verification.remaining_proof_memories.length : -1,
  };

  const allZero = Object.values(counts).every(v => v === 0);

  return Response.json({
    verdict: allZero ? '✅ ALL PROOF ARTIFACTS DELETED — ALL COUNTS ZERO' : '❌ SOME PROOF ARTIFACTS REMAIN',
    all_zero: allZero,
    deleted_counts: deleted,
    remaining_counts: counts,
    remaining_detail: verification,
    log,
  });
});