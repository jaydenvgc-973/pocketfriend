import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { subDays, isAfter, parseISO } from 'npm:date-fns@3.6.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const charId = body.character_id;
    if (!charId) return Response.json({ error: 'character_id required' }, { status: 400 });

    // Read the character
    const charList = await base44.entities.Character.filter({ id: charId }, null, 1);
    const character = charList[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    const ownerEmail = character.owner_email;
    const now = new Date();
    const cutoff3d = subDays(now, 3).toISOString();
    const cutoff3dMs = parseISO(cutoff3d).getTime();
    const nowMs = now.getTime();

    // ── Run ALL dashboard queries (same as CharacterDashboard) ──────────
    const results = {};

    // Query 0: Messages sent by character
    const msgs = await base44.entities.Message.filter({ character_id: charId }, "-created_date", 200).catch(() => []);
    results.outgoingMessages = { raw: msgs.length, ids: msgs.slice(0, 5).map(m => m.id) };

    // Query 1: FinancialTransaction
    const txns = await base44.entities.FinancialTransaction.filter({ character_id: charId }, "-timestamp", 20).catch(() => []);
    results.financialTransactions = { raw: txns.length };

    // Query 2: AutomaticNarrative
    const narrs = await base44.entities.AutomaticNarrative.filter({ character_id: charId }, "-timestamp", 80).catch(() => []);
    results.automaticNarratives = { raw: narrs.length };

    // Query 3: CharacterAutomaticNarrative
    const charNarrs = await base44.entities.CharacterAutomaticNarrative.filter({ character_id: charId }, "-timestamp", 80).catch(() => []);
    results.charAutomaticNarratives = { raw: charNarrs.length };

    // Query 4: Conversations
    const convos = ownerEmail
      ? await base44.entities.Conversation.filter({ owner_email: ownerEmail, character_ids: [charId] }, "-updated_date", 120).catch(() => [])
      : [];
    results.conversations = { 
      raw: convos.length, 
      ownerEmail: ownerEmail || 'MISSING', 
      sampleIds: convos.slice(0, 3).map(c => ({ id: c.id, title: c.title, type: c.type, character_ids: c.character_ids }))
    };

    // Query 5: LocationReference
    const locsArr = ownerEmail
      ? await base44.entities.LocationReference.filter({ owner_email: ownerEmail }, null, 200).catch(() => [])
      : [];
    results.locationReferences = { raw: locsArr.length };

    // Query 6: LifeEvent
    const lifeEvents = await base44.entities.LifeEvent.filter({ character_id: charId }, "-timestamp", 100).catch(() => []);
    results.lifeEvents = { raw: lifeEvents.length };

    // Query 7: Messages received by character
    const rcvMsgs = await base44.entities.Message.filter({ receiver_character_id: charId }, "-created_date", 100).catch(() => []);
    results.receivedMessages = { raw: rcvMsgs.length, ids: rcvMsgs.slice(0, 5).map(m => m.id) };

    // Query 8: LocationHistory
    const locHistory = ownerEmail
      ? await base44.entities.LocationHistory.filter({ character_id: charId, owner_email: ownerEmail }, "-arrival_time", 30).catch(() => [])
      : [];
    results.locationHistory = { raw: locHistory.length };

    // Query 9: All Characters for this owner (for name resolution)
    const allChars = ownerEmail
      ? await base44.entities.Character.filter({ owner_email: ownerEmail }, null, 200).catch(() => [])
      : [];
    results.allCharacters = { raw: allChars.length, sampleNames: allChars.slice(0, 5).map(c => c.name || c.display_name || '?') };

    // Query 10: EventParticipation
    const eventParts = ownerEmail
      ? await base44.entities.EventParticipation.filter({ character_id: charId, owner_email: ownerEmail }, "-participation_date", 30).catch(() => [])
      : [];
    results.eventParticipation = { raw: eventParts.length };

    // ── Combined messages ──────────────────────────────────────────────
    const allMsgIds = new Set(msgs.map(m => m.id));
    const allMsgs = [...msgs, ...rcvMsgs.filter(m => !allMsgIds.has(m.id))];
    results.combinedMessages = { raw: allMsgs.length };

    // ── Conversation-scoped messages ────────────────────────────────────
    const validConvoIds = new Set(convos.map(c => c.id));
    const scopedMsgs = validConvoIds.size > 0
      ? allMsgs.filter(m => validConvoIds.has(m.conversation_id))
      : allMsgs;
    results.scopedMessages = { raw: scopedMsgs.length, convoCount: validConvoIds.size, scopedMsgIds: scopedMsgs.slice(0, 5).map(m => ({ id: m.id, conv_id: m.conversation_id, sender_type: m.sender_type, channel: m.channel })) };

    // ── 3-day filter ────────────────────────────────────────────────────
    const msgs3d = scopedMsgs.filter(m => {
      const d = m.timestamp || m.created_date;
      return d && isAfter(parseISO(d), parseISO(cutoff3d));
    });
    const msgs3dFallback = msgs3d.length > 0 ? msgs3d
      : allMsgs.filter(m => { const d = m.timestamp || m.created_date; return d && isAfter(parseISO(d), parseISO(cutoff3d)); });
    results.msgs3d = { raw: msgs3d.length, fallback: msgs3dFallback.length };

    const narrs3d = narrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff3d)));
    const charNarrs3d = charNarrs.filter(n => n.timestamp && isAfter(parseISO(n.timestamp), parseISO(cutoff3d)));
    const txns3d = txns.filter(t => t.timestamp && isAfter(parseISO(t.timestamp), parseISO(cutoff3d)));
    const lifeEvents3d = lifeEvents.filter(le => { const ts = le.timestamp || le.created_date; return ts && isAfter(parseISO(ts), parseISO(cutoff3d)); });
    const locHist3d = locHistory.filter(h => h.arrival_time && isAfter(parseISO(h.arrival_time), parseISO(cutoff3d)));
    const eventParts3d = eventParts.filter(ep => ep.participation_date && isAfter(parseISO(ep.participation_date), parseISO(cutoff3d)));

    results.threeDayCounts = {
      messages: msgs3dFallback.length,
      narratives: narrs3d.length,
      charNarratives: charNarrs3d.length,
      transactions: txns3d.length,
      lifeEvents: lifeEvents3d.length,
      locationHistory: locHist3d.length,
      eventParticipation: eventParts3d.length,
    };

    // ── Message sentiment classification ────────────────────────────────
    let positiveCount = 0, conflictCount = 0, unclassified = 0;
    const buckets = {};
    msgs3dFallback.forEach(m => {
      let sentiment = m.emotional_state ? m.emotional_state.toLowerCase() : null;
      if (!sentiment && m.content) {
        // Simple keyword-based inference (matching CharacterDashboard patterns)
        const t = m.content.toLowerCase();
        if (/hunger|hungry|starving|food/i.test(t)) sentiment = 'hungry';
        else if (/exhaust|tired|fatigue|drained/i.test(t)) sentiment = 'exhausted';
        else if (/stress|overwhelm|pressure|burden/i.test(t)) sentiment = 'stressed';
        else if (/angry|furious|rage/i.test(t)) sentiment = 'angry';
        else if (/sad|lonely|isol|heartbreak|despair/i.test(t)) sentiment = 'sad';
        else if (/anxious|anxiety|worry|nervous|fear/i.test(t)) sentiment = 'anxious';
        else if (/love|affection|support|comfort|grateful|bond/i.test(t)) sentiment = 'affectionate';
        else if (/happy|joy|excit|celebrat|fun|laugh/i.test(t)) sentiment = 'happy';
        else if (/calm|peace|relax|settled/i.test(t)) sentiment = 'calm';
        else if (/reflect|ponder|contemplat|nostalgi/i.test(t)) sentiment = 'reflective';
      }
      const bucket = sentiment || 'unclassified';
      buckets[bucket] = (buckets[bucket] || 0) + 1;
      if (!sentiment) unclassified++;
      else if (/happy|joyful|excited|elated|euphoric|affectionate|loving|content|calm|peaceful|serene|hopeful|motivated|grateful|proud|encouraged|relieved|supported|comforted|connected|warm|playful|flirty|amused|lighthearted|cheerful/i.test(sentiment)) positiveCount++;
      else if (/angry|furious|rage|irritated|defensive|tense|hostile|stressed|overwhelmed|frustrated|bitter|sad|hurt|disappointed|devastated|heartbroken|despairing|anxious|worried|nervous|fearful|dread|guilty|ashamed|regretful|lonely|isolated|abandoned|neglected|exhausted|drained|jealous|envious|resentful|closed-off|withdrawn|hungry/i.test(sentiment)) conflictCount++;
    });

    results.socialActivity = {
      messagesFound: msgs3dFallback.length,
      positive: positiveCount,
      conflict: conflictCount,
      unclassified,
      topBuckets: Object.entries(buckets).sort(([,a],[,b]) => b - a).slice(0, 10).map(([k,v]) => `${k}:${v}`),
    };

    // ── Emotional graph raw events ───────────────────────────────────────
    let graphEventCount = 0;
    // LifeEvents
    lifeEvents3d.forEach(() => graphEventCount++);
    // Narratives (3d)
    narrs3d.forEach(() => graphEventCount++);
    // CharNarratives (3d)
    charNarrs3d.forEach(() => graphEventCount++);
    // Messages (3d)
    msgs3dFallback.forEach(() => graphEventCount++);
    // Financial (3d)
    txns3d.forEach(() => graphEventCount++);
    // Sleep/wake from character
    if (character.last_sleep_start) graphEventCount++;
    if (character.alarm_woke_at) graphEventCount++;

    results.graphEvents = {
      rawEventCount: graphEventCount,
      sources: {
        lifeEvents: lifeEvents3d.length,
        narratives: narrs3d.length,
        charNarratives: charNarrs3d.length,
        messages: msgs3dFallback.length,
        financial: txns3d.length,
        sleepWake: (character.last_sleep_start ? 1 : 0) + (character.alarm_woke_at ? 1 : 0),
      },
    };

    // ── Attachment-bearing messages ──────────────────────────────────────
    const attachmentMsgs = msgs3dFallback.filter(m => m.image_url);
    results.attachments = {
      raw: attachmentMsgs.length,
      sample: attachmentMsgs.slice(0, 3).map(m => ({ id: m.id, image_url: m.image_url ? m.image_url.substring(0, 60) + '...' : null, conv_id: m.conversation_id })),
    };

    // ── Character type and ownership ─────────────────────────────────────
    results.characterMeta = {
      id: character.id,
      name: character.name,
      character_type: character.character_type,
      status: character.status,
      owner_email: ownerEmail || 'MISSING',
      created_date: character.created_date,
      emotional_state: character.emotional_state,
      energy_value: character.energy_value,
    };

    return Response.json(results);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});