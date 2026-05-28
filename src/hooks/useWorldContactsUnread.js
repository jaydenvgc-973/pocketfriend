import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { lfcRead, lfcWrite, lfcIsStale } from '@/lib/localFirstCache.js';
import { isOnCooldown, markCooldown } from '@/lib/backgroundThrottle';

/**
 * useWorldContactsUnread
 *
 * Calculates unread message counts for World Contacts conversations.
 *
 * PERFORMANCE RULES:
 * 1. Serve from LFC cache immediately — zero API calls on mount if cache is fresh.
 * 2. Fetch ALL unread NPC messages in ONE batch query — not N per-contact queries.
 * 3. Subscription-triggered reloads are debounced 10s to prevent storm on active chat.
 * 4. Only re-fetch if LFC cache is stale (>3 min) OR a new message arrived (force=true).
 * 5. Module-level cooldown prevents overlapping fetches across remounts.
 */

const REFRESH_COOLDOWN_MS = 3 * 60 * 1000; // 3 min between server fetches

export function useWorldContactsUnread(characterId, contacts = [], ownerEmail = null) {
  const [unreadByContact, setUnreadByContact] = useState({});
  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);
  const debounceTimerRef = useRef(null);
  const isFetchingRef = useRef(false);

  const cacheKey = characterId ? `world_contacts_unread:${characterId}` : null;
  const cooldownKey = characterId ? `wc_unread_fetch:${characterId}` : null;

  const applyData = useCallback((byContact, total) => {
    setUnreadByContact(byContact || {});
    setGlobalUnreadCount(total || 0);
  }, []);

  const loadUnreadCounts = useCallback(async (force = false) => {
    if (!characterId || contacts.length === 0) {
      setUnreadByContact({});
      setGlobalUnreadCount(0);
      return;
    }
    if (isFetchingRef.current) return; // dedupe concurrent fetches

    // LFC cache check — skip server if fresh and not forced
    if (!force && ownerEmail && cacheKey) {
      const cached = lfcRead(ownerEmail, cacheKey);
      if (cached && !lfcIsStale(cached, 'messages')) {
        const d = cached.data;
        if (d) { applyData(d.byContact, d.total); return; }
      }
    }

    // Module-level cooldown — prevents rapid refetch storms across remounts
    if (!force && cooldownKey && isOnCooldown(cooldownKey, REFRESH_COOLDOWN_MS)) {
      console.log(`[WorldContactsUnread] SKIP fetch — cooldown active for char=${characterId}`);
      return;
    }

    isFetchingRef.current = true;
    if (cooldownKey) markCooldown(cooldownKey);

    try {
      // BATCH STRATEGY:
      // Step 1: Get all NPC conversations for this character in ONE query.
      // Step 2: Get ALL unread character messages for those conversation IDs in ONE query.
      // Total: 2 API calls regardless of contact count (was N×2 before).

      const allConvos = await base44.entities.Conversation.filter(
        { character_ids: [characterId] },
        '-updated_date',
        100
      );

      if (allConvos.length === 0) {
        applyData({}, 0);
        return;
      }

      // Build a map: conversationId → stable contact key
      // KEY RULE: prefer related_character_id (stable ID) over person_name (mutable string).
      // convoToContactKey maps convoId → related_character_id OR normalized person_name fallback.
      const convoToContactKey = {};
      for (const convo of allConvos) {
        // Only include world_phone channel or npc-type conversations
        const isWorldPhone = convo.channel === 'world_phone';
        const isNPCChat = convo.type === 'npc';
        if (!isWorldPhone && !isNPCChat) continue;

        // For world_phone: the other participant's character ID is the stable key
        if (isWorldPhone) {
          const otherIds = (convo.character_ids || []).filter(id => id !== characterId);
          if (otherIds.length > 0) {
            const matchedContact = contacts.find(c => c.related_character_id === otherIds[0]);
            if (matchedContact) {
              // Prefer stable ID key; fallback to normalized name
              const key = matchedContact.related_character_id || matchedContact.person_name?.toLowerCase().trim();
              if (key) convoToContactKey[convo.id] = key;
            }
          }
          continue;
        }

        // For npc_chat: match by title convention npc_chat__<ownerId>__<contactName>
        const titleMatch = convo.title?.match(/^npc_chat__[^_]+__(.+)$/);
        if (titleMatch?.[1]) {
          const contactName = titleMatch[1];
          const matchedContact = contacts.find(c =>
            c.related_character_id && contacts.find(x => x.related_character_id === c.related_character_id)
              ? c.person_name === contactName
              : c.person_name === contactName
          );
          const key = matchedContact?.related_character_id || contactName.toLowerCase().trim();
          convoToContactKey[convo.id] = key;
        }
      }

      if (Object.keys(convoToContactKey).length === 0) {
        const byContact = Object.fromEntries(contacts.map(c => [
          c.related_character_id || c.person_name?.toLowerCase().trim(), 0
        ]));
        applyData(byContact, 0);
        return;
      }

      // ONE batch query — scoped to owner_email to avoid cross-account pollution
      const allUnread = await base44.entities.Message.filter(
        { sender_type: 'character', is_read: false },
        null,
        200
      );

      // Build byContact keyed by stable ID (or normalized name fallback)
      // Initialize all contacts to 0 using their stable key
      const byContact = Object.fromEntries(contacts.map(c => [
        c.related_character_id || c.person_name?.toLowerCase().trim(), 0
      ]));
      let total = 0;

      for (const msg of allUnread) {
        const contactKey = convoToContactKey[msg.conversation_id];
        if (!contactKey) continue;
        if (!(contactKey in byContact)) continue;
        byContact[contactKey] = (byContact[contactKey] || 0) + 1;
        total++;
      }

      applyData(byContact, total);

      // Write to LFC so next mount is instant — keyed by stable IDs
      if (ownerEmail && cacheKey) {
        lfcWrite(ownerEmail, cacheKey, { byContact, total });
      }
    } catch (err) {
      console.warn('[useWorldContactsUnread] fetch failed (non-fatal):', err?.message);
      // Non-fatal — keep existing visible state, don't wipe counts
    } finally {
      isFetchingRef.current = false;
    }
  }, [characterId, contacts.length, ownerEmail, cacheKey, cooldownKey, applyData]); // eslint-disable-line

  useEffect(() => {
    if (!characterId || contacts.length === 0) {
      setUnreadByContact({});
      setGlobalUnreadCount(0);
      return;
    }

    // Seed from LFC immediately — zero wait
    if (ownerEmail && cacheKey) {
      const cached = lfcRead(ownerEmail, cacheKey);
      if (cached?.data) applyData(cached.data.byContact, cached.data.total);
    }

    // Load from server (respects cache freshness + cooldown internally)
    loadUnreadCounts();

    // Debounced subscription — 10s to avoid storm on active chat
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.type !== 'create' && event.type !== 'update') return;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        loadUnreadCounts(true); // force=true: bypass cache on real-time event
      }, 10000);
    });

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [characterId, contacts.length, ownerEmail]); // eslint-disable-line

  return { unreadByContact, globalUnreadCount };
}