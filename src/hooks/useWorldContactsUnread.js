import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { lfcRead, lfcWrite, lfcIsStale, lfcDelete } from '@/lib/localFirstCache.js';
import { isOnCooldown, markCooldown } from '@/lib/backgroundThrottle';

/**
 * useWorldContactsUnread — CANONICAL unread resolver for World Contacts / World Phone.
 *
 * GLOBAL RULES:
 * 1. Serve from LFC cache immediately on mount — zero API calls if cache fresh.
 * 2. Fetch ALL unread messages PER-CONVERSATION (scoped by convoToContactKey), not globally.
 * 3. Never count: date dividers, timestamp rows, system rows, null sender_type, recovery signals.
 * 4. On thread:read event for world_phone: immediately bust LFC cache + force-reload.
 * 5. Subscription debounce: 5s (reduced from 10s so badges clear faster).
 * 6. Cooldown: 90s (reduced from 3min for faster recovery after read).
 *
 * OWNERSHIP: convoToContactKey is built from Conversation.filter({ character_ids: [characterId] })
 * which is ownership-scoped. Messages are then filtered by those convoIds only — no global bleed.
 */

const REFRESH_COOLDOWN_MS = 90 * 1000; // 90s between full server fetches (reduced from 3min)
const SUB_DEBOUNCE_MS = 5000;           // 5s debounce on subscription events (reduced from 10s)

/**
 * Canonical message validity check — shared filter used by ALL unread resolvers.
 * A message is countable as unread only if ALL of these are true:
 *  - sender_type === 'character' (not user, not system, not null)
 *  - is_read === false
 *  - content is not empty and not a date/timestamp label
 *  - recovery_signal !== true (recovery fallbacks are not real dialogue)
 */
function isCountableUnreadMessage(msg) {
  if (!msg) return false;
  // Must be a character sender
  if (msg.sender_type !== 'character') return false;
  // Must be unread
  if (msg.is_read !== false) return false;
  // Exclude recovery/fallback signals
  if (msg.recovery_signal === true) return false;
  // Exclude system/date/divider rows — these must never count as unread
  const t = (msg.type || '').toLowerCase();
  if (t === 'date' || t === 'divider' || t === 'system' || t === 'timestamp' || t === 'separator') return false;
  // Exclude messages with no content
  if (!msg.content || msg.content.trim() === '') return false;
  return true;
}

export { isCountableUnreadMessage };

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
    if (isFetchingRef.current) return;

    // LFC cache — only serve if fresh AND not forced
    if (!force && ownerEmail && cacheKey) {
      const cached = lfcRead(ownerEmail, cacheKey);
      if (cached && !lfcIsStale(cached, 'messages')) {
        const d = cached.data;
        if (d) { applyData(d.byContact, d.total); return; }
      }
    }

    // Module-level cooldown (skip on force)
    if (!force && cooldownKey && isOnCooldown(cooldownKey, REFRESH_COOLDOWN_MS)) {
      return;
    }

    isFetchingRef.current = true;
    if (cooldownKey) markCooldown(cooldownKey);

    try {
      // Step 1: Load conversations where this character is a participant (ownership-scoped)
      const allConvos = await base44.entities.Conversation.filter(
        { character_ids: [characterId] },
        '-updated_date',
        150
      );

      if (allConvos.length === 0) {
        const byContact = Object.fromEntries(contacts.map(c => [
          c.related_character_id || c.person_name?.toLowerCase().trim(), 0
        ]));
        applyData(byContact, 0);
        if (ownerEmail && cacheKey) lfcWrite(ownerEmail, cacheKey, { byContact, total: 0 });
        return;
      }

      // Step 2: Build convoId → stable contact key (world_phone or npc type only)
      const convoToContactKey = {};
      const worldPhoneConvoIds = new Set(); // track world_phone convos for per-convo fetch

      for (const convo of allConvos) {
        const isWorldPhone = convo.channel === 'world_phone';
        const isNPCChat = convo.type === 'npc';
        if (!isWorldPhone && !isNPCChat) continue;

        if (isWorldPhone) {
          const otherIds = (convo.character_ids || []).filter(id => id !== characterId);
          if (otherIds.length > 0) {
            // Try participant_character_ids first (bilateral canonical), then character_ids
            const participantOthers = (convo.participant_character_ids || []).filter(id => id !== characterId);
            const otherId = participantOthers[0] || otherIds[0];
            const matchedContact = contacts.find(c => c.related_character_id === otherId);
            if (matchedContact) {
              const key = matchedContact.related_character_id || matchedContact.person_name?.toLowerCase().trim();
              if (key) { convoToContactKey[convo.id] = key; worldPhoneConvoIds.add(convo.id); }
            }
          }
          continue;
        }

        // npc type: match by title
        const titleMatch = convo.title?.match(/^npc_chat__[^_]+__(.+)$/);
        if (titleMatch?.[1]) {
          const contactName = titleMatch[1];
          const matchedContact = contacts.find(c => c.person_name === contactName);
          const key = matchedContact?.related_character_id || contactName.toLowerCase().trim();
          convoToContactKey[convo.id] = key;
        }
      }

      // Initialize all contacts to 0
      const byContact = Object.fromEntries(contacts.map(c => [
        c.related_character_id || c.person_name?.toLowerCase().trim(), 0
      ]));

      if (Object.keys(convoToContactKey).length === 0) {
        applyData(byContact, 0);
        if (ownerEmail && cacheKey) lfcWrite(ownerEmail, cacheKey, { byContact, total: 0 });
        return;
      }

      // Step 3: Fetch unread messages SCOPED to the relevant conversation IDs.
      // CRITICAL FIX: Do NOT use a global { sender_type, is_read } query — that fetches
      // unread messages across ALL characters globally (up to 200 records), causing bleed.
      // Instead, fetch per-conversation to guarantee ownership scoping.
      // We batch-fetch per conversation to avoid N×1 queries while maintaining scope.
      const validConvoIds = Object.keys(convoToContactKey);
      const perConvoFetches = validConvoIds.map(convoId =>
        base44.entities.Message.filter(
          { conversation_id: convoId, sender_type: 'character', is_read: false },
          null,
          50
        ).catch(() => [])
      );
      const perConvoResults = await Promise.all(perConvoFetches);

      let total = 0;
      perConvoResults.forEach((msgs, idx) => {
        const convoId = validConvoIds[idx];
        const contactKey = convoToContactKey[convoId];
        if (!contactKey || !(contactKey in byContact)) return;
        for (const msg of msgs) {
          // Apply canonical message validity filter
          if (!isCountableUnreadMessage(msg)) continue;
          // DIRECTION GUARD: exclude outgoing messages sent BY the viewed character.
          // sender_character_id is authoritative; character_id is the legacy fallback.
          const senderId = msg.sender_character_id || msg.character_id;
          if (senderId === characterId) continue;
          // RECEIVER GUARD: if explicitly set, receiver must be the viewed character.
          if (msg.receiver_character_id && msg.receiver_character_id !== characterId) continue;
          byContact[contactKey] = (byContact[contactKey] || 0) + 1;
          total++;
        }
      });

      applyData(byContact, total);

      // Write to LFC for instant next-mount
      if (ownerEmail && cacheKey) {
        lfcWrite(ownerEmail, cacheKey, { byContact, total });
      }
    } catch (err) {
      console.warn('[useWorldContactsUnread] fetch failed (non-fatal):', err?.message);
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

    // Seed from LFC immediately
    if (ownerEmail && cacheKey) {
      const cached = lfcRead(ownerEmail, cacheKey);
      if (cached?.data) applyData(cached.data.byContact, cached.data.total);
    }

    loadUnreadCounts();

    // Subscription: debounced 5s, force=true bypasses cache + cooldown
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.type !== 'create' && event.type !== 'update') return;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        loadUnreadCounts(true);
      }, SUB_DEBOUNCE_MS);
    });

    // thread:read event: bust LFC cache immediately, then force-reload.
    // thread:read is dispatched AFTER all Message.update(is_read:true) writes resolve in
    // WorldContactsPopup — so the DB is already committed when we get this event.
    const handleThreadRead = (e) => {
      const detail = e.detail || {};
      if (detail.characterId !== characterId) return;
      // Clear LFC cache immediately so next render doesn't re-serve stale count
      if (ownerEmail && cacheKey) lfcDelete(ownerEmail, cacheKey);
      // Cancel any pending debounce
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      // Force a fresh server fetch — DB writes are already committed
      isFetchingRef.current = false; // reset fetch lock so force can run
      loadUnreadCounts(true);
    };
    window.addEventListener('thread:read', handleThreadRead);

    return () => {
      unsubscribe();
      window.removeEventListener('thread:read', handleThreadRead);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [characterId, contacts.length, ownerEmail]); // eslint-disable-line

  return { unreadByContact, globalUnreadCount };
}