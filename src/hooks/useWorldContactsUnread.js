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
  const [previewByContact, setPreviewByContact] = useState({});
  const debounceTimerRef = useRef(null);
  const isFetchingRef = useRef(false);
  // Ref mirrors unreadByContact so event handlers always read current values
  // without stale-closure captures from useEffect registration time.
  const unreadByContactRef = useRef({});
  // Settle timer: set during thread:read to suppress subscription events while
  // mark-read writes are still in flight. Prevents badge oscillation.
  const settleTimerRef = useRef(null);

  const cacheKey = characterId ? `world_contacts_unread:${characterId}` : null;
  const cooldownKey = characterId ? `wc_unread_fetch:${characterId}` : null;

  const applyData = useCallback((byContact, total, previewMap = {}) => {
    const map = byContact || {};
    unreadByContactRef.current = map; // keep ref in sync with state
    setUnreadByContact(map);
    setGlobalUnreadCount(total || 0);
    setPreviewByContact(previewMap || {});
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
        if (d) { applyData(d.byContact, d.total, d.previewMap || {}); return; }
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
        // Always write zero result to bust any stale cache that had positive counts
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

        // bilateral type: match by other participant
        if (convo.type === 'bilateral') {
          const otherIds = [...(convo.participant_character_ids || []), ...(convo.character_ids || [])]
            .filter(id => id !== characterId);
          const otherId = otherIds[0];
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
        // Always write zero result to bust any stale cache
        if (ownerEmail && cacheKey) lfcWrite(ownerEmail, cacheKey, { byContact, total: 0 });
        return;
      }

      // Step 3: Fetch unread messages per-conversation using canonical fetcher.
      const validConvoIds = Object.keys(convoToContactKey);
      const perConvoMessages = await fetchUnreadMessagesForConversations(validConvoIds, base44);

      let total = 0;
      // previewByContact: last unread message preview per contact key
      const previewMap = {};
      for (const [convoId, msgs] of perConvoMessages) {
        const contactKey = convoToContactKey[convoId];
        if (!contactKey || !(contactKey in byContact)) continue;

        // Sort by created_date ascending so last message is latest
        const sorted = [...msgs].sort((a, b) => {
          const ta = a.created_date || a.timestamp || '';
          const tb = b.created_date || b.timestamp || '';
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        });

        for (const msg of sorted) {
          // Use canonical filter — direction + receiver guards included
          if (!isCountableUnread(msg, characterId)) continue;
          byContact[contactKey] = (byContact[contactKey] || 0) + 1;
          total++;
          // Keep the latest unread message preview for this contact
          const preview = (msg.content || '').trim();
          if (preview) previewMap[contactKey] = preview.length > 60 ? preview.substring(0, 60) + '…' : preview;
        }
      }

      applyData(byContact, total, previewMap);

      // Write to LFC for instant next-mount
      if (ownerEmail && cacheKey) {
        lfcWrite(ownerEmail, cacheKey, { byContact, total, previewMap });
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

    // Seed from LFC immediately (zero-latency first paint) — ONLY if the cache is VERY fresh.
    // We use a 30-second seed window (not the full 2-min stale threshold) because:
    // - The 2-min window could re-serve stale positive counts after cleanup/mark-read.
    // - Only paint from cache if it was written less than 30s ago (navigation-safe,
    //   prevents post-cleanup badge restoration on mount).
    const SEED_MAX_AGE_MS = 30 * 1000;
    if (ownerEmail && cacheKey) {
      const cached = lfcRead(ownerEmail, cacheKey);
      if (cached?.data && cached.loaded_at && (Date.now() - cached.loaded_at < SEED_MAX_AGE_MS)) {
        applyData(cached.data.byContact, cached.data.total, cached.data.previewMap || {});
      }
    }

    // On mount: respect fresh cache (avoids redundant DB round-trip if data is < 2min old).
    // Force only when cache is absent or stale — the cooldown already gates re-subscription bounces.
    // Previously this was always force=true, which bypassed ALL caching on every popup open,
    // firing Conversation.filter + N×Message.filter unconditionally — unnecessary when cache is fresh.
    const mountCached = ownerEmail && cacheKey ? lfcRead(ownerEmail, cacheKey) : null;
    const mountIsStale = !mountCached || lfcIsStale(mountCached, 'unread');
    loadUnreadCounts(mountIsStale);

    // Subscription: debounced 5s, force=true bypasses cache + cooldown.
    // CRITICAL: Only react to 'create' events — new incoming messages.
    // 'update' events are fired when is_read:true is written (mark-read batch).
    // Reacting to update events causes a re-fetch 5s after the settle window,
    // which can restore old counts if the settle timer didn't run long enough.
    // The settle timer + live fetch already handles post-mark-read reconciliation.
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.type !== 'create') return; // ignore update/delete — settle timer handles those
      if (settleTimerRef.current) return; // suppress during settle window
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        loadUnreadCounts(true);
      }, SUB_DEBOUNCE_MS);
    });

    // thread:read: bust LFC cache, suppress subscription events for 2.5s settle window,
    // then do ONE definitive live fetch. The settle window prevents badge oscillation from
    // the is_read:true subscription events that fire while mark-read writes are in flight.
    //
    // CRITICAL FIX: Only zero the specific contact whose thread was opened (detail.contactId).
    // Previously this zeroed ALL contacts optimistically, wiping unread badges for characters
    // whose threads the user had NOT opened. Now we only clear the one contact that was read.
    // If contactId is not provided (legacy dispatch), fall back to zeroing all (old behavior).
    const handleThreadRead = (e) => {
      const detail = e.detail || {};
      if (detail.characterId !== characterId) return;

      // CHANNEL GUARD: thread:read from a direct/text chat (channel='direct' or channel='phone')
      // must NOT affect green-channel (world_phone) unread counts.
      // Only act on events that could affect World Phone threads.
      const isDirectChannel = detail.channel === 'direct' || detail.channel === 'phone' || detail.channel === 'text';
      if (isDirectChannel) {
        // A direct chat was opened — green badges are unaffected. Do nothing.
        return;
      }

      // 1. Clear LFC cache so next render doesn't re-serve stale count
      if (ownerEmail && cacheKey) lfcDelete(ownerEmail, cacheKey);
      // 2. Cancel pending debounce and any existing settle timer
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);

      // 3. Surgical clear: ONLY zero the specific contact whose thread was opened.
      //    If contactId is missing on a green-channel event, do NOT zero all contacts —
      //    instead just bust the cache and let the live fetch resolve the true state.
      const readContactId = detail.contactId || null;
      if (readContactId) {
        // Optimistic clear: zero this contact, decrement global by its prior count.
        // Both updaters use functional form so they read the latest state, not stale closure.
        // Use ref for pre-clear count — avoids stale closure from effect registration time.
        const priorCount = unreadByContactRef.current[readContactId] || 0;
        unreadByContactRef.current = { ...unreadByContactRef.current, [readContactId]: 0 };
        setUnreadByContact(prev => {
          const next = { ...prev };
          if (readContactId in next) next[readContactId] = 0;
          return next;
        });
        setGlobalUnreadCount(prev => Math.max(0, prev - priorCount));
        setPreviewByContact(prev => {
          const next = { ...prev };
          delete next[readContactId];
          return next;
        });
      }
      // else: no contactId on green event — cache was busted above, live fetch will correct.

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

  return { unreadByContact, globalUnreadCount, previewByContact };
}