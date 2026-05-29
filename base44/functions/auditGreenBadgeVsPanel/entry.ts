/**
 * auditGreenBadgeVsPanel
 *
 * Proves (or disproves) that every green badge count message is:
 * 1. Sent from a character that appears as a visible contact in the World Contacts panel
 * 2. Inside a conversation reachable by that contact's thread
 * 3. Actually displayable (not orphaned / merged / invisible)
 *
 * Mirrors the UPDATED resolveCharacterContacts logic (Source 4 now fetches shared NPCs by ID).
 *
 * Payload:
 *   { character_id: string, invisible_only?: boolean }
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Date-divider content pattern (mirrors canonicalUnreadResolver)
function isDateDividerContent(content) {
  if (!content?.trim()) return false;
  const c = content.trim();
  if (/^[-–—]{2,}/.test(c) && /[-–—]{2,}$/.test(c)) return true;
  if (/^[-–—\s]*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday)/i.test(c) &&
      /\d{4}/.test(c)) return true;
  return false;
}

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

    // ── 2. Fetch all conversations scoped to this character ────────────────
    const allConvos = await base44.entities.Conversation.filter(
      { owner_email: ownerEmail, character_ids: [characterId] },
      '-updated_date', 150
    );

    // ── 3. Build contact list mirroring updated resolveCharacterContacts ───
    const contactMap = new Map(); // key: character_id OR `name:${name}` → contact

    // Source 1: fictional_relationships
    for (const r of (char.fictional_relationships || [])) {
      if (!r.person_name) continue;
      const key = r.related_character_id || `name:${r.person_name}`;
      if (!contactMap.has(key)) contactMap.set(key, {
        person_name: r.person_name,
        related_character_id: r.related_character_id || null,
        source: 'fictional_relationships',
      });
    }

    // Source 3: people_in_world
    for (const p of (char.people_in_world || char.known_people || [])) {
      const name = p.name || p.person_name;
      if (!name) continue;
      const key = p.related_character_id || p.character_id || `name:${name}`;
      if (!contactMap.has(key)) contactMap.set(key, {
        person_name: name,
        related_character_id: p.related_character_id || p.character_id || null,
        source: 'people_in_world',
      });
    }

    // Source 4: conversation-linked characters (incl. shared/system NPCs not in owner scope)
    const allOwnerChars = await base44.entities.Character.filter(
      { owner_email: ownerEmail, status: 'active' }, null, 200
    ).catch(() => []);
    const charById = new Map(allOwnerChars.map(c => [c.id, c]));

    const allConvoLinkedIds = new Set(
      allConvos.flatMap(c => [
        ...(c.character_ids || []),
        ...(c.participant_character_ids || []),
      ]).filter(id => id !== characterId)
    );

    // Fetch any participant characters NOT in owner-scoped chars (e.g. shared NPCs)
    const missingIds = [...allConvoLinkedIds].filter(id => !charById.has(id));
    if (missingIds.length > 0) {
      const missingResults = await Promise.all(
        missingIds.map(id => base44.entities.Character.filter({ id }).catch(() => []))
      );
      missingResults.forEach(records => {
        if (records[0]) charById.set(records[0].id, records[0]);
      });
    }

    for (const id of allConvoLinkedIds) {
      if (contactMap.has(id)) continue; // already in list — hydrate only
      const lc = charById.get(id);
      if (!lc) continue;
      // Only add if they have a GREEN-channel conversation with this character
      const hasGreenConvo = allConvos.some(c => {
        const isGreen = c.channel === 'world_phone' || c.type === 'npc' || c.type === 'bilateral';
        if (!isGreen) return false;
        return (c.character_ids || []).includes(lc.id) ||
               (c.participant_character_ids || []).includes(lc.id);
      });
      if (!hasGreenConvo) continue;
      contactMap.set(id, {
        person_name: lc.name,
        related_character_id: lc.id,
        source: 'conversation_linked',
      });
    }

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

    // ── 6. Canonical countability check (mirrors canonicalUnreadResolver) ──
    function checkCountable(msg) {
      if (!msg.sender_type || msg.sender_type !== 'character') return { countable: false, reason: 'sender_type_not_character' };
      if (msg.is_read !== false) return { countable: false, reason: 'already_read' };
      if (msg.recovery_signal === true) return { countable: false, reason: 'recovery_signal' };
      const t = (msg.type || '').toLowerCase();
      if (['date','divider','system','timestamp','separator'].includes(t)) return { countable: false, reason: `type_${t}` };
      const content = (msg.content || '').trim();
      if (!content) return { countable: false, reason: 'empty_content' };
      if (isDateDividerContent(content)) return { countable: false, reason: 'date_divider_content' };
      const senderId = msg.sender_character_id || msg.character_id;
      if (senderId === characterId) return { countable: false, reason: 'outgoing_from_viewed' };
      if (msg.receiver_character_id && msg.receiver_character_id !== characterId) return { countable: false, reason: 'receiver_mismatch' };
      return { countable: true, reason: null };
    }

    // ── 7. Build proof table ───────────────────────────────────────────────
    const proofRows = [];
    let countedTotal = 0;
    let panelVisibleTotal = 0;
    let panelInvisibleTotal = 0;
    const perContactUnread = {};
    const invisibleReasons = {};

    for (const convo of greenConvos) {
      const msgs = unreadByConvo.get(convo.id) || [];

      let mappedContactKey = null;
      let mappedContactName = null;
      let contactInPanel = false;
      let notInPanelReason = null;

      if (convo.channel === 'world_phone' || convo.type === 'bilateral') {
        const otherIds = [...(convo.participant_character_ids || []), ...(convo.character_ids || [])]
          .filter(id => id !== characterId);
        const otherId = otherIds[0];
        if (otherId) {
          const entry = contactMap.get(otherId);
          if (entry) {
            mappedContactKey = otherId;
            mappedContactName = entry.person_name;
            contactInPanel = true;
          } else {
            const lc = charById.get(otherId);
            mappedContactName = lc?.name || `char(${otherId?.substring(0,8)})`;
            notInPanelReason = `char_id=${otherId?.substring(0,8)} not in contact list (check resolver SOURCE 4)`;
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
            mappedContactKey = byName.related_character_id || `name:${contactName}`;
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

        if (contactInPanel) {
          panelVisibleTotal++;
          perContactUnread[mappedContactName] = (perContactUnread[mappedContactName] || 0) + 1;
        } else {
          panelInvisibleTotal++;
          const rk = notInPanelReason || 'unknown_reason';
          invisibleReasons[rk] = (invisibleReasons[rk] || 0) + 1;
        }

        const row = {
          message_id: msg.id,
          age_minutes: Math.round((Date.now() - new Date(msg.created_date).getTime()) / 60000),
          content_preview: msg.content?.substring(0, 80),
          sender_id: msg.sender_character_id || msg.character_id,
          sender_name: charById.get(msg.sender_character_id || msg.character_id)?.name || 'unknown',
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
      : `❌ DESYNCHRONIZED — ${panelInvisibleTotal}/${countedTotal} counted messages DO NOT map to any visible panel contact`;

    return Response.json({
      character_name: char.name,
      character_id: characterId,
      timestamp: new Date().toISOString(),
      panel_contact_count: contactMap.size,
      panel_contacts_added_from_convos: [...contactMap.values()].filter(c => c.source === 'conversation_linked').map(c => c.person_name),
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