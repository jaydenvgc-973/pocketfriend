import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { lfcRead, lfcWrite, lfcIsStale, lfcDelete } from '@/lib/localFirstCache.js';
import { isOnCooldown, markCooldown } from '@/lib/backgroundThrottle';
import {
  isCountableUnread,
  classifyConversationChannel,
  fetchUnreadMessagesForConversations,
} from '@/lib/canonicalUnreadResolver';

/**
 * useWorldContactsUnread — Canonical unread resolver for World Contacts / World Phone.
 *
 * Uses the single canonical unread resolver (lib/canonicalUnreadResolver.js).
 * All badge classification logic lives there — never inline here.
 *
 * RULES:
 * 1. Serve from LFC cache immediately on mount — zero API calls if fresh.
 * 2. Fetch unread PER-CONVERSATION (scoped by owner_email + character_ids) — no global bleed.
 * 3. On thread:read: immediately bust LFC cache + force-reload (fetch lock reset first).
 * 4. Subscription debounce: 5s.
 * 5. Cooldown: 90s between full server fetches.
 */

const REFRESH_COOLDOWN_MS = 90 * 1000;
const SUB_DEBOUNCE_MS = 5000;

// Re-export canonical filter so other files can import from one place
export { isCountableUnread as isCountableUnreadMessage };

export function useWorldContactsUnread(characterId, contacts = [], ownerEmail = null) {
  const [unreadByContact, setUnreadByContact] = useState({});
  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);
  const debounceTimerRef = useRef(null);
  const isFetchingRef = useRef(false);
  // Settle timer: set during thread:read to suppress subscription events while
  // mark-read writes are still in flight. Prevents badge oscillation.
  const settleTimerRef = useRef(null);

  const cacheKey = characterId ? `world_contacts_unread:${characterId}` : null;
  const cooldownKey = characterId ? `wc_unread_fetch:${characterId}` : null;

  const applyData = useCallback((byContact, total) => {
    setUnreadByContact(byContact || {});
    setGlobalUnreadCount(total || 0);
  }, []);

  const loadUnreadCounts = useCallback(async (force = false) => {
    if (!characterId || !ownerEmail || contacts.length === 0) {
      setUnreadByContact({});
      setGlobalUnreadCount(0);
      return;
    }

    // RACE FIX: On force (thread:read), always reset the fetch lock first.
    // Without this, a slow previous fetch blocks the force-reload entirely,
    // leaving the badge stuck even after the DB write committed.
    if (force) {
      isFetchingRef.current = false;
    }
    if (isFetchingRef.current) return;

    // LFC cache — only serve if fresh AND not forced
    if (!force && ownerEmail && cacheKey) {
      const cached = lfcRead(ownerEmail, cacheKey);
      if (cached && !lfcIsStale(cached, 'unread')) {
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
      // Step 1: Load conversations scoped by owner_email + character_ids.
      const allConvos = await base44.entities.Conversation.filter(
        { owner_email: ownerEmail, character_ids: [characterId] },
        '-updated_date',
        150
      );

      // Initialize all contacts to 0
      const byContact = Object.fromEntries(contacts.map(c => [
        c.related_character_id || c.person_name?.toLowerCase().trim(), 0
      ]));

      if (allConvos.length === 0) {
        applyData(byContact, 0);
        if (ownerEmail && cacheKey) lfcWrite(ownerEmail, cacheKey, { byContact, total: 0 });
        return;
      }

      // Step 2: Build convoId → stable contact key for GREEN-channel convos only.
      // Uses classifyConversationChannel for consistent classification.
      const convoToContactKey = {};

      for (const convo of allConvos) {
        // Only include green-channel conversations
        const channel = classifyConversationChannel(convo);
        if (channel !== 'green') continue;

        if (convo.channel === 'world_phone') {
          // World phone: match by other character ID
          const otherIds = (convo.character_ids || []).filter(id => id !== characterId);
          const participantOthers = (convo.participant_character_ids || []).filter(id => id !== characterId);
          const otherId = participantOthers[0] || otherIds[0];
          if (otherId) {
            const matchedContact = contacts.find(c => c.related_character_id === otherId);
            if (matchedContact) {
              const key = matchedContact.related_character_id || matchedContact.person_name?.toLowerCase().trim();
              if (key) convoToContactKey[convo.id] = key;
            }
          }
          continue;
        }

        // npc type: match by title pattern
        const titleMatch = convo.title?.match(/^npc_chat__[^_]+__(.+)$/);
        if (titleMatch?.[1]) {
          const contactName = titleMatch[1];
          const matchedContact = contacts.find(c => c.person_name === contactName);
          const key = matchedContact?.related_character_id || contactName.toLowerCase().trim();
          convoToContactKey[convo.id] = key;
        }
      }

      if (Object.keys(convoToContactKey).length === 0) {
        applyData(byContact, 0);
        if (ownerEmail && cacheKey) lfcWrite(ownerEmail, cacheKey, { byContact, total: 0 });
        return;
      }

      // Step 3: Fetch unread messages per-conversation using canonical fetcher.
      const validConvoIds = Object.keys(convoToContactKey);
      const perConvoMessages = await fetchUnreadMessagesForConversations(validConvoIds, base44);

      let total = 0;
      for (const [convoId, msgs] of perConvoMessages) {
        const contactKey = convoToContactKey[convoId];
        if (!contactKey || !(contactKey in byContact)) continue;

        for (const msg of msgs) {
          // Use canonical filter — direction + receiver guards included
          if (!isCountableUnread(msg, characterId)) continue;
          byContact[contactKey] = (byContact[contactKey] || 0) + 1;
          total++;
        }
      }

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
    if (!characterId || !ownerEmail || contacts.length === 0) {
      setUnreadByContact({});
      setGlobalUnreadCount(0);
      return;
    }

    // Seed from LFC immediately (zero-latency first paint) — ONLY if the cache is fresh.
    // A stale cache MUST NOT be applied as the initial state. It would be restored after
    // thread:read clears the badge, causing the green dot oscillation.
    // Use 'unread' threshold (2 min) — same as messages, consistent with write side.
    if (ownerEmail && cacheKey) {
      const cached = lfcRead(ownerEmail, cacheKey);
      if (cached?.data && !lfcIsStale(cached, 'unread')) {
        applyData(cached.data.byContact, cached.data.total);
      }
    }

    // Always force a live fetch on mount — never let cooldown suppress the initial DB read.
    // The cooldown is for re-subscription bounces, not for first-paint accuracy.
    loadUnreadCounts(true);

    // Subscription: debounced 5s, force=true bypasses cache + cooldown.
    // Suppressed during settle window (thread:read in flight) to prevent mark-read
    // write events from re-triggering a count while the DB batch is still committing.
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.type !== 'create' && event.type !== 'update') return;
      if (settleTimerRef.current) return; // suppress during settle window
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        loadUnreadCounts(true);
      }, SUB_DEBOUNCE_MS);
    });

    // thread:read: bust LFC cache, suppress subscription events for 2.5s settle window,
    // then do ONE definitive live fetch. The settle window prevents badge oscillation from
    // the is_read:true subscription events that fire while mark-read writes are in flight.
    const handleThreadRead = (e) => {
      const detail = e.detail || {};
      if (detail.characterId !== characterId) return;
      // 1. Clear LFC cache so next render doesn't re-serve stale count
      if (ownerEmail && cacheKey) lfcDelete(ownerEmail, cacheKey);
      // 2. Cancel pending debounce and any existing settle timer
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      // 3. Set optimistic zero immediately — user already opened the thread
      applyData(Object.fromEntries(contacts.map(c => [
        c.related_character_id || c.person_name?.toLowerCase().trim(), 0
      ])), 0);
      // 4. After writes settle, do ONE live fetch to confirm DB state
      isFetchingRef.current = false;
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        loadUnreadCounts(true);
      }, 2500);
    };
    window.addEventListener('thread:read', handleThreadRead);

    return () => {
      unsubscribe();
      window.removeEventListener('thread:read', handleThreadRead);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, [characterId, contacts.length, ownerEmail]); // eslint-disable-line

  return { unreadByContact, globalUnreadCount };
}