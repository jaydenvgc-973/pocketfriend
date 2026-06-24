/**
 * buildWorldPhoneAwarenessBlock
 *
 * Extracted helper for Step 5b of buildCanonicalCharacterContext.
 *
 * Reads World Phone Message records for a character (last 48h, sent and received).
 * Returns:
 *   - awarenessBlock  : string to inject into the canonical prompt
 *   - latestWpMsgTs   : ISO timestamp of the most recent WP message (for freshness metadata)
 *   - incoming        : count
 *   - outgoing        : count
 *   - threads         : count
 *   - hasPendingReply : boolean
 *
 * READ-ONLY. No records are created, updated, or deleted.
 * Called by buildCanonicalCharacterContext for direct_chat and text contexts only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, characterName = '' } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId is required' }, { status: 400 });

    const sr = base44.asServiceRole;
    const cutoff48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

    const [wpSent, wpReceived] = await Promise.all([
      sr.entities.Message.filter(
        { sender_character_id: characterId, channel: 'world_phone' },
        '-timestamp',
        15
      ).catch(() => []),
      sr.entities.Message.filter(
        { receiver_character_id: characterId, channel: 'world_phone' },
        '-timestamp',
        15
      ).catch(() => []),
    ]);

    // Compute latestWpMsgTs from all fetched records (used for freshness metadata)
    const combined = [...wpSent, ...wpReceived].filter(Boolean);
    let latestWpMsgTs = null;
    if (combined.length > 0) {
      const tss = combined
        .map(m => m.timestamp || m.created_date)
        .filter(Boolean)
        .map(ts => new Date(ts).getTime());
      if (tss.length > 0) latestWpMsgTs = new Date(Math.max(...tss)).toISOString();
    }

    // Merge and deduplicate by id, restrict to 48h window
    const wpAllById = new Map();
    combined.forEach(m => { if (m.id) wpAllById.set(m.id, m); });
    const wpAll = [...wpAllById.values()]
      .filter(m => {
        const ts = m.timestamp || m.created_date;
        if (!ts) return false;
        if (m.canon_excluded) return false;
        return new Date(ts) >= new Date(cutoff48h);
      })
      .sort((a, b) => new Date(b.timestamp || b.created_date) - new Date(a.timestamp || a.created_date));

    if (wpAll.length === 0) {
      return Response.json({
        awarenessBlock: '',
        latestWpMsgTs,
        incoming: 0,
        outgoing: 0,
        threads: 0,
        hasPendingReply: false,
      });
    }

    const incoming = wpAll.filter(m => m.receiver_character_id === characterId);
    const outgoing = wpAll.filter(m => m.sender_character_id === characterId);

    const lastIncoming = incoming[0] || null;
    const lastOutgoing = outgoing[0] || null;
    const lastIncomingTs = lastIncoming ? new Date(lastIncoming.timestamp || lastIncoming.created_date).getTime() : 0;
    const lastOutgoingTs = lastOutgoing ? new Date(lastOutgoing.timestamp || lastOutgoing.created_date).getTime() : 0;
    const hasPendingReply = lastIncomingTs > lastOutgoingTs && lastIncoming !== null;

    // Build per-thread awareness
    const threadMap = new Map();
    wpAll.forEach(m => {
      const key = m.shared_conversation_key || m.conversation_id || 'unknown';
      if (!threadMap.has(key)) threadMap.set(key, []);
      threadMap.get(key).push(m);
    });

    const threadLines = [];
    threadMap.forEach((msgs) => {
      const sorted = msgs.sort((a, b) => new Date(b.timestamp || b.created_date) - new Date(a.timestamp || a.created_date));
      const latestMsg = sorted[0];
      const otherCharacterName = latestMsg.sender_character_id === characterId
        ? (latestMsg.receiver_character_id ? `(character id: ${latestMsg.receiver_character_id})` : 'unknown recipient')
        : (latestMsg.sender_character_name || latestMsg.played_as_character_name || `(character id: ${latestMsg.sender_character_id || 'unknown'})`);
      const direction = latestMsg.sender_character_id === characterId ? 'you sent' : 'you received';
      const tsStr = new Date(latestMsg.timestamp || latestMsg.created_date).toLocaleString('en-US', {
        timeZone: 'America/New_York', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
      const snippet = (latestMsg.content || '').substring(0, 120);
      threadLines.push(`• Thread with ${otherCharacterName}: [${direction} at ${tsStr}] "${snippet}"`);
    });

    const pendingNote = hasPendingReply
      ? `\n⚠️ PENDING REPLY: ${lastIncoming.sender_character_name || 'someone'} sent you a World Phone message you have not yet replied to. You are aware of this.`
      : '';

    const awarenessBlock = `\n════════════════════════════════════\nWORLD PHONE AWARENESS — YOUR CURRENT CHARACTER-TO-CHARACTER MESSAGE STATE\nSource: live Message records (last 48 hours). These are the ONLY messages verified to exist.\n════════════════════════════════════\nYou have ${incoming.length} incoming and ${outgoing.length} outgoing World Phone messages in the last 48 hours.\n${threadLines.join('\n')}${pendingNote}\n\nRULES — READ BEFORE GENERATING ANY RESPONSE:\n• You know about these messages because they are verified system records. You can say "I texted [name]" or "I heard from [name]" ONLY for messages listed above.\n• Do NOT invent messages not listed above. If no thread exists with a person, you have NOT contacted them recently.\n• World Phone messages are separate from your conversation here. Do not confuse channels.\n\n════════════════════════════════════\nCRITICAL — DELIVERY STATE PROHIBITION\nThis is a hard system rule. You must never violate it.\n════════════════════════════════════\nYou CANNOT make ANY of the following claims unless the message appears in the verified list above AND the system confirms it was delivered:\n• "It definitely sent."\n• "I'm looking at it now."\n• "I can see it in my contacts."\n• "It went through."\n• "It delivered."\n• "It should be there."\n• "I already sent it — it's there."\n• "I checked and it sent."\n• "The message is right here on my phone."\n• Any claim that you can VISUALLY VERIFY or CONFIRM the message exists on the other person's end.\n\nYou may say "I sent a message" if a verified outgoing record exists.\nYou may NOT say you can SEE the message, CONFIRM delivery, or that the other person RECEIVED it.\nDelivery confirmation requires a backend verification you do not have access to in conversation.\n\nIF CHALLENGED (user says the message is not there):\n• Do NOT double down with "it's definitely there."\n• Say: "I'm not seeing confirmation it went through — let me try again."\n• Do NOT claim you are looking at a message you cannot verify exists on the recipient's end.\n\nIF NO OUTGOING RECORD EXISTS for the person being discussed:\n• You did NOT successfully send that message.\n• Do NOT claim you sent it.\n• Do NOT claim you can see it.\n• Say honestly: "It doesn't look like that went through."\n════════════════════════════════════\n`;

    console.log(
      `[buildWorldPhoneAwarenessBlock] char=${characterName} (${characterId})` +
      ` | incoming=${incoming.length} | outgoing=${outgoing.length}` +
      ` | threads=${threadMap.size} | pending_reply=${hasPendingReply}` +
      ` | latestWpMsgTs=${latestWpMsgTs || 'none'}`
    );

    return Response.json({
      awarenessBlock,
      latestWpMsgTs,
      incoming: incoming.length,
      outgoing: outgoing.length,
      threads: threadMap.size,
      hasPendingReply,
    });

  } catch (error) {
    console.error(`[buildWorldPhoneAwarenessBlock] error: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});