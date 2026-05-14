import { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { lfcRead, lfcWrite, lfcIsStale } from '@/lib/localFirstCache.js';

/**
 * useWorldContactsUnread
 *
 * Calculates unread message counts for World Contacts conversations.
 *
 * PERFORMANCE RULES:
 * 1. Serve from LFC cache immediately — zero API calls on mount if cache is fresh.
 * 2. Fetch all NPC conversations in ONE batch query (not N sequential queries).
 * 3. Subscription-triggered reloads are debounced 8 seconds to prevent storm on active chat.
 * 4. Only re-fetch if LFC cache is stale (>2 min) OR a new message arrived.
 * 5. Never fire N×2 API calls per contact.
 */
export function useWorldContactsUnread(characterId, contacts = [], ownerEmail = null) {
  const [unreadByContact, setUnreadByContact] = useState({});
  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);
  const debounceTimerRef = useRef(null);
  const isFetchingRef = useRef(false);

  const cacheKey = characterId ? `world_contacts_unread:${characterId}` : null;

  const applyCache = useCallback((cached) => {
    if (!cached) return;
    setUnreadByContact(cached.byContact || {});
    setGlobalUnreadCount(cached.total || 0);
  }, []);

  const loadUnreadCounts = useCallback(async (force = false) => {
    if (!characterId || contacts.length === 0) {
      setUnreadByContact({});
      setGlobalUnreadCount(0);
      return;
    }
    if (isFetchingRef.current) return; // dedupe concurrent fetches
    if (!force && ownerEmail && cacheKey) {
      const cached = lfcRead(ownerEmail, cacheKey);
      if (cached && !lfcIsStale(cached, 'messages')) {
        applyCache(cached.data);
        return; // fresh cache — no server call needed
      }
    }

    isFetchingRef.current = true;
    try {
      // ONE batch query for all NPC conversations for this character
      const allConvos = await base44.entities.Conversation.filter(
        { type: 'npc', character_ids: [characterId] },
        '-updated_date',
        100
      );

      const byContact = {};
      let total = 0;
      const contactNames = new Set(contacts.map(c => c.person_name));

      for (const convo of allConvos) {
        // Match conversation to a contact by title convention
        const titleMatch = convo.title?.match(/^npc_chat__[^_]+__(.+)$/);
        const contactName = titleMatch?.[1];
        if (!contactName || !contactNames.has(contactName)) continue;

        try {
          const unreadMsgs = await base44.entities.Message.filter(
            { conversation_id: convo.id, sender_type: 'character', is_read: false },
            null,
            50
          );
          byContact[contactName] = unreadMsgs.length;
          total += unreadMsgs.length;
        } catch {
          byContact[contactName] = 0;
        }
      }

      // Fill zeros for contacts with no conversation
      for (const contact of contacts) {
        if (!(contact.person_name in byContact)) byContact[contact.person_name] = 0;
      }

      setUnreadByContact(byContact);
      setGlobalUnreadCount(total);

      // Write to LFC so next mount is instant
      if (ownerEmail && cacheKey) {
        lfcWrite(ownerEmail, cacheKey, { byContact, total });
      }
    } catch (err) {
      // Non-fatal — keep existing state, just log
      console.warn('[useWorldContactsUnread] fetch failed (non-fatal):', err?.message);
    } finally {
      isFetchingRef.current = false;
    }
  }, [characterId, contacts, ownerEmail, cacheKey, applyCache]);

  useEffect(() => {
    if (!characterId || contacts.length === 0) {
      setUnreadByContact({});
      setGlobalUnreadCount(0);
      return;
    }

    // Seed from LFC immediately — zero wait
    if (ownerEmail && cacheKey) {
      const cached = lfcRead(ownerEmail, cacheKey);
      if (cached) applyCache(cached.data);
    }

    // Load from server (respects cache freshness internally)
    loadUnreadCounts();

    // Debounced subscription — 8s to avoid storm on active chat
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.type !== 'create' && event.type !== 'update') return;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        loadUnreadCounts(true); // force=true to bypass cache on real-time event
      }, 8000);
    });

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [characterId, contacts.length, ownerEmail]); // eslint-disable-line

  return { unreadByContact, globalUnreadCount };
}