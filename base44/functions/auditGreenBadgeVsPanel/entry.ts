/**
 * auditGreenBadgeVsPanel
 *
 * Proves (or disproves) that every green badge count message is:
 * 1. Sent from a character that appears as a visible contact in the World Contacts panel
 * 2. Inside a conversation reachable by that contact's thread
 * 3. Actually displayable (not orphaned / merged / invisible)
 *
 * Payload:
 *   { character_id: string, invisible_only?: boolean }
 *   invisible_only=true → only show messages that badge-counts but panel cannot display
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let body = {};
    try { body = await req.json(); } catch (_) {}

    const ownerEmail = user.email;
    const characterId = body.character_id;
    const invisibleOnly = body.invisible_only === true;
    if (!characterId) return Response.json({ error: 'character_id required' }, { status: 400 });

    // ── 1. Fetch the viewed character record ───────────────────────────────
    const charMatches = await base44.entities.Character.filter({ id: characterId });
    if (charMatches.length === 0) return Response.json({ error: 'character not found' }, { status: 404 });
    const char = charMatches[0];

    // ── 2. Build the contact list exactly as resolveCharacterContacts does ─
    // Primary source: fictional_relationships
    // Secondary: family_members
    const fictionalRels = (char.fictional_relationships || []).filter(r => r.person_name);
    const familyMembers = (char.family_members || []).filter(r => r.name);

    const contactMap = new Map(); // related_character_id || norm_name → contact object

    for (const r of fictionalRels) {
      const key = r.related_character_id || r.person_name?.toLowerCase().trim();
      if (key) contactMap.set(key, {
        person_name: r.person_name,
        related_character_id: r.related_character_id || null,
        source: 'fictional_relationships',
      });
    }
    for (const f of familyMembers) {
      const key = f.related_character_id || f.name?.toLowerCase().trim();
      if (key && !contactMap.has(key)) contactMap.set(key, {
        person_name: f.name,
        related_character_id: f.related_character_id || null,
        source: 'family_members',
      });
    }

    // ── 3. Fetch all conversations scoped to this character ────────────────
    const allConvos = await base44.entities.Conversation.filter(
      { owner_email: ownerEmail, character_ids: [characterId] },
      '-updated_date', 200
    );

    // ── 4. Find all green-channel conversations ────────────────────────────
    const greenConvos = allConvos.filter(c => {
      if (c.sync_status === 'merged') return false;
      if (c.channel === 'world_phone') return true;
      if (c.type === 'npc') return true;
      if (c.type === 'bilateral') return true;
      return false;
    });

    // ── 5. Fetch unread messages for ALL green conversations ───────────────
    const unreadByConvo = new Map();
    if (greenConvos.length > 0) {
      const results = await Promise.all(
        greenConvos.map(c =>
          base44.entities.Message.filter(
            { conversation_id: c.id, sender_type: 'character', is_read: false },
            null, 100
          ).catch(() => [])
        )
      );
      greenConvos.forEach((c, i) => unreadByConvo.set(c.id, results[i] || []));
    }

    // ── 6. Canonical countability check ───────────────────────────────────
    function checkCountable(msg) {
      if (msg.sender_type !== 'character') return { countable: false, reason: 'sender_type_not_character' };
      if (msg.is_read !== false) return { countable: false, reason: 'already_read' };
      if (msg.recovery_signal === true) return { countable: false, reason: 'recovery_signal' };
      const t = (msg.type || '').toLowerCase();
      if (['date','divider','system','timestamp','separator'].includes(t)) return { countable: false, reason: `type_${t}` };
      if (!msg.content?.trim()) return { countable: false, reason: 'empty_content' };
      const senderId = msg.sender_character_id || msg.character_id;
      if (senderId === characterId) return { countable: false, reason: 'outgoing_from_viewed' };
      if (msg.receiver_character_id && msg.receiver_character_id !== characterId) return { countable: false, reason: 'receiver_mismatch' };
      return { countable: true, reason: null };
    }

    // ── 7. Collect all sender IDs we need names for ────────────────────────
    const senderIdSet = new Set();
    for (const [, msgs] of unreadByConvo) {
      for (const m of msgs) {
        const sid = m.sender_character_id || m.character_id;
        if (sid && sid !== characterId) senderIdSet.add(sid);
      }
    }
    const senderIds = [...senderIdSet];
    const senderNames = {};
    if (senderIds.length > 0) {
      const charResults = await Promise.all(
        senderIds.map(id => base44.entities.Character.filter({ id }).catch(() => []))
      );
      senderIds.forEach((id, i) => {
        if (charResults[i]?.[0]) senderNames[id] = charResults[i][0].name;
      });
    }

    // ── 8. Build proof table ───────────────────────────────────────────────
    const proofRows = [];
    let countedTotal = 0;
    let panelVisibleTotal = 0;
    let panelInvisibleTotal = 0;
    const perContactUnread = {};   // contact_name → count (only panel-visible)
    const invisibleReasons = {};   // reason why contact is not in panel

    for (const convo of greenConvos) {
      const msgs = unreadByConvo.get(convo.id) || [];

      // Determine which panel contact this conversation maps to
      let mappedContactKey = null;
      let mappedContactName = null;
      let contactInPanel = false;
      let notInPanelReason = null;

      if (convo.channel === 'world_phone' || convo.type === 'bilateral') {
        const otherIds = (convo.participant_character_ids || convo.character_ids || []).filter(id => id !== characterId);
        const otherId = otherIds[0];
        if (otherId) {
          if (contactMap.has(otherId)) {
            mappedContactKey = otherId;
            mappedContactName = contactMap.get(otherId).person_name;
            contactInPanel = true;
          } else {
            mappedContactName = senderNames[otherId] || `char(${otherId?.substring(0,8)})`;
            notInPanelReason = `sender_id=${otherId?.substring(0,8)} not in fictional_relationships or family_members`;
          }
        } else {
          notInPanelReason = 'no_other_participant_id_found';
          mappedContactName = '[unknown]';
        }
      } else if (convo.type === 'npc') {
        const titleMatch = convo.title?.match(/^npc_chat__[^_]+__(.+)$/);
        if (titleMatch?.[1]) {
          const contactName = titleMatch[1];
          const byName = [...contactMap.values()].find(c => c.person_name === contactName);
          if (byName) {
            mappedContactKey = byName.related_character_id || contactName.toLowerCase().trim();
            mappedContactName = byName.person_name;
            contactInPanel = true;
          } else {
            mappedContactName = contactName;
            notInPanelReason = `name="${contactName}" not found in contact list`;
          }
        } else {
          mappedContactName = `[unparseable title: ${convo.title?.substring(0,40)}]`;
          notInPanelReason = 'title_does_not_match_npc_pattern';
        }
      }

      for (const msg of msgs) {
        const { countable, reason } = checkCountable(msg);
        if (!countable) continue;

        countedTotal++;
        const senderId = msg.sender_character_id || msg.character_id;
        const senderName = senderNames[senderId] || `unknown(${senderId?.substring(0,8)})`;

        if (contactInPanel) {
          panelVisibleTotal++;
          const ck = mappedContactName;
          perContactUnread[ck] = (perContactUnread[ck] || 0) + 1;
        } else {
          panelInvisibleTotal++;
          const rk = notInPanelReason || 'unknown_reason';
          invisibleReasons[rk] = (invisibleReasons[rk] || 0) + 1;
        }

        const row = {
          message_id: msg.id,
          age_minutes: Math.round((Date.now() - new Date(msg.created_date).getTime()) / 60000),
          content_preview: msg.content?.substring(0, 80),
          sender_id: senderId,
          sender_name: senderName,
          conversation_id: convo.id,
          conversation_type: convo.type,
          conversation_channel: convo.channel,
          conversation_title: convo.title?.substring(0, 60),
          mapped_contact_name: mappedContactName,
          contact_in_panel: contactInPanel,
          not_in_panel_reason: notInPanelReason,
          panel_verdict: contactInPanel
            ? `✅ panel-visible as "${mappedContactName}"`
            : `❌ NOT visible — ${notInPanelReason}`,
        };

        if (!invisibleOnly || !contactInPanel) {
          proofRows.push(row);
        }
      }
    }

    const verdict = panelInvisibleTotal === 0
      ? `✅ SYNCHRONIZED — all ${countedTotal} counted green messages map to visible panel contacts`
      : `❌ DESYNCHRONIZED — ${panelInvisibleTotal}/${countedTotal} counted messages DO NOT map to any visible panel contact (badge shows messages user cannot see)`;

    return Response.json({
      character_name: char.name,
      character_id: characterId,
      timestamp: new Date().toISOString(),
      panel_contact_count: contactMap.size,
      green_conversations_scanned: greenConvos.length,
      total_counted_green_messages: countedTotal,
      panel_visible_count: panelVisibleTotal,
      panel_invisible_count: panelInvisibleTotal,
      verdict,
      per_contact_unread_in_panel: perContactUnread,
      invisible_reason_tally: invisibleReasons,
      proof_table: proofRows,
    });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});