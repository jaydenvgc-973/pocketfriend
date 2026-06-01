import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Globe, ArrowLeft, User, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useWorldContactsUnread } from "@/hooks/useWorldContactsUnread";
import { isCountableUnread } from "@/lib/canonicalUnreadResolver";
import { analyzeImageForCharacterContext } from "@/lib/analyzeImageForCharacterContext";
import { resolveCharacterContacts } from "@/lib/characterContactsResolver";
import { callLLMWithRetry } from "@/lib/llmUtils";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import { parseCharacterResponse } from "@/lib/chatResponseParser";
import { filterDashes } from "@/lib/dashFilter";
import { stripCharacterNamePrefix } from "@/lib/nameFilterUtils";
import {
  getCachedCanonicalPrompt,
  setCachedCanonicalPrompt,
  getCachedCharRecord,
  setCachedCharRecord,
  prewarmCharacterRuntime,
  reportCharacterReadyTiming,
  setCachedConversationId,
  getCachedConversationId,
} from "@/lib/characterRuntimeCache";

// ── DATE DIVIDER DETECTION ──────────────────────────────────────────────────
// Catches Message records that are true date/timestamp separators saved to the DB.
// CRITICAL: WorldContacts messages use role="sent"|"npc" — never sender_type.
// Any message with a real role MUST render as a bubble, never as a divider.
const DATE_DIVIDER_TYPES = new Set(['date', 'divider', 'timestamp', 'separator', 'system']);

function isDateDividerMessage(msg) {
  if (!msg) return false;
  // Must have a role to be a real message. WorldContacts messages use role="sent"|"npc".
  // If it has a valid role, it's a real message — never treat it as a date divider.
  if (msg.role === 'sent' || msg.role === 'npc' || msg.role === 'user') return false;
  // By explicit type field only (never infer from missing sender_type)
  if (DATE_DIVIDER_TYPES.has((msg.type || '').toLowerCase())) return true;
  // Only check content patterns for messages without a role (true system separators)
  const content = (msg.content || '').trim();
  if (!content) return false;
  if (/^[-–—\s]+$/.test(content)) return true; // dash-only row
  // Wrapped in dash lines: "—— ... ——"
  if (/^[-–—]{2,}/.test(content) && /[-–—]{2,}$/.test(content)) return true;
  return false;
}

function extractDateLabel(content) {
  // Strip leading/trailing dashes and whitespace to get the clean date string
  return (content || '').replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
}

// ── CANONICAL SHARED KEY ────────────────────────────────────────────────────
// ONE deterministic key for any two linked characters, regardless of direction.
// world_phone::[lower_id]::[higher_id]
// James→Ethan and Ethan→James both resolve to the SAME key.
function getCanonicalSharedKey(charIdA, charIdB) {
  if (!charIdA || !charIdB) return null;
  const sorted = [charIdA, charIdB].sort();
  return `world_phone::${sorted[0]}::${sorted[1]}`;
}

// Legacy title formats — used for fallback lookup only, never for new threads
function npcConvoTitle(ownerCharacterId, contactName, contactCharacterId) {
  if (contactCharacterId) return `npc_chat__${ownerCharacterId}__cid_${contactCharacterId}`;
  return `npc_chat__${ownerCharacterId}__${contactName}`;
}

export default function WorldContactsPopup({ isOpen, onClose, character }) {
  const [selectedContact, setSelectedContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState(null);

  // Unread counts per contact — green badge source of truth
  const { unreadByContact, previewByContact } = useWorldContactsUnread(character?.id, contacts, ownerEmail);

  useEffect(() => {
    if (!isOpen) return;
    base44.auth.me().then(me => { if (me?.email) setOwnerEmail(me.email); }).catch(() => {});
  }, [isOpen]);

  // ── PANEL OPEN RECONCILIATION ────────────────────────────────────────────────
  // When the panel opens, sweep ALL green-channel conversations for this character
  // and mark any stale outgoing/orphaned unread messages as read. This prevents
  // old outgoing messages saved with is_read:false from creating false green dots.
  // This runs ONCE per panel open, non-blocking (fire-and-forget UI perspective).
  useEffect(() => {
    if (!isOpen || !character?.id || !ownerEmail) return;
    const sweep = async () => {
      try {
        const allConvos = await base44.entities.Conversation.filter(
          { owner_email: ownerEmail, character_ids: [character.id] },
          null, 150
        ).catch(() => []);
        const greenConvoIds = allConvos
          .filter(c => c.sync_status !== 'merged' &&
            (c.channel === 'world_phone' || c.type === 'npc' || c.type === 'bilateral'))
          .map(c => c.id);
        if (greenConvoIds.length === 0) return;

        const unreadBatches = await Promise.all(
          greenConvoIds.map(cId =>
            base44.entities.Message.filter({ conversation_id: cId, sender_type: 'character', is_read: false }, null, 50).catch(() => [])
          )
        );
        const staleToMark = unreadBatches.flat().filter(msg => {
          const senderId = msg.sender_character_id || msg.character_id;
          // Mark outgoing messages (sender is the viewed character)
          if (senderId === character.id) return true;
          // Mark recovery signals
          if (msg.recovery_signal === true) return true;
          // Mark date/divider content
          const content = (msg.content || '').trim();
          if (!content) return true;
          if (/^[-–—]{2,}/.test(content) && /[-–—]{2,}$/.test(content)) return true;
          if (/^[-–—\s]*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|yesterday)/i.test(content) && /\d{4}/.test(content)) return true;
          return false;
        });
        if (staleToMark.length > 0) {
          console.log(`[WorldContactsPopup] Reconciliation: marking ${staleToMark.length} stale unread messages as read for char=${character.id}`);
          await Promise.all(staleToMark.map(m => base44.entities.Message.update(m.id, { is_read: true }).catch(() => {})));
          // Invalidate LFC cache and dispatch thread:read so badges update
          window.dispatchEvent(new CustomEvent('thread:read', {
            detail: { characterId: character.id, channel: 'world_phone', conversationId: null }
          }));
        }
      } catch { /* non-fatal */ }
    };
    sweep();
  }, [isOpen, character?.id, ownerEmail]);

  // Per-mount caches for the selected contact session.
  const contactCharRecordRef = useRef(null);   // full Character DB record
  const canonicalPromptCacheRef = useRef(null); // canonical system prompt
  const bottomRef = useRef(null);
  const unsubscribeRef = useRef(null);
  // ── REPLY LOCK: prevents duplicate replies for the same source user message ──
  // Key: `${conversationId}:${sourceMessageId}` → true while generating or completed.
  // Survives retries and rapid taps. Cleared only when contact changes or popup closes.
  const replyLockRef = useRef(new Set());
  // ── SEND GUARD: prevents concurrent sends (rapid tap / double submit) ────────
  const isSendingRef = useRef(false);

  // ── LOAD CONTACTS via shared resolver (single source of truth) ───────────────
  // The resolver handles all sources + deduplication internally.
  // Do NOT merge contacts here — that created duplicate rows.
  useEffect(() => {
    if (!isOpen || !character?.id) return;
    setIsLoadingContacts(true);
    
    base44.auth.me()
      .then(async me => {
        const contactList = await resolveCharacterContacts(character, me?.email, me);
        setContacts(contactList);
        setIsLoadingContacts(false);
      })
      .catch(() => {
        // Fallback: fictional_relationships only — NEVER hide existing contacts
        const fallback = (character?.fictional_relationships || []).filter(r => r.person_name).map(r => ({
          ...r,
          _linkage: r.related_character_id ? 'linked' : 'name_only',
        }));
        setContacts(fallback);
        setIsLoadingContacts(false);
      });
  }, [isOpen, character?.id]);

  // Load or create a persistent conversation for the selected NPC
  const selectContact = async (contact) => {
    const t_page_open = Date.now();
    setSelectedContact(contact);
    setMessages([]);
    setConversationId(null);
    setInputText("");
    setIsLoadingHistory(true);

    // Clear per-contact mount caches — stale data from a previous contact must never bleed in
    // (module-level session cache is preserved across popup opens for speed)
    contactCharRecordRef.current = null;
    canonicalPromptCacheRef.current = null;
    replyLockRef.current.clear();
    isSendingRef.current = false;

    try {
      const me = await base44.auth.me().catch(() => null);
      const ownerEmail = me?.email || character?.owner_email || null;
      const contactId = contact.related_character_id;

      let t_character_fetch = null;
      // ── HARD GUARD: verify contactId resolves to exactly ONE Character record ──────
      if (contactId) {
        // Check global runtime cache first (survives popup reopen, scoped by ownerEmail)
        const cached = ownerEmail ? getCachedCharRecord(ownerEmail, contactId) : null;
        if (cached) {
          contactCharRecordRef.current = cached;
          t_character_fetch = Date.now();
          console.log(`[WorldContacts] char_record=CACHE_HIT | id=${cached.id} | name=${cached.name}`);
        } else {
          const charMatches = await base44.entities.Character.filter({ id: contactId }).catch(() => []);
          t_character_fetch = Date.now();
          if (charMatches.length === 0) {
            console.error(`[WORLD_CONTACT_FULL_CHARACTER_NOT_RESOLVED] contact_id=${contactId} | contact_name=${contact.person_name} | reason=no_db_record_found`);
          } else if (charMatches.length > 1) {
            console.error(`[WORLD_CONTACT_MULTIPLE_CHARACTER_MATCHES] contact_id=${contactId} | matches=${charMatches.length} | contact_name=${contact.person_name}`);
          } else {
            contactCharRecordRef.current = charMatches[0];
            if (ownerEmail) setCachedCharRecord(ownerEmail, contactId, charMatches[0]);
            console.log(`[WorldContacts] char_record=DB_FETCH | id=${charMatches[0].id} | name=${charMatches[0].name} | fetch_ms=${t_character_fetch - t_page_open}`);
          }
        }
      }
      const canonicalKey = getCanonicalSharedKey(character.id, contactId);
      const legacyBilateralKey = contactId
        ? `bilateral_${[character.id, contactId].sort().join('_')}_world_phone`
        : null;
      const stableTitle = npcConvoTitle(character.id, contact.person_name, contactId);
      const legacyTitle = npcConvoTitle(character.id, contact.person_name, null);
      const participantIds = contactId ? [character.id, contactId].sort() : [character.id];

      console.log(
        `[WorldPhone] Opening | current_char=${character.id} | contact_id=${contactId || 'none'} | canonical_key=${canonicalKey || 'none'}`
      );

      // ── STEP 1: Search by canonical shared key (most precise) ──────────────
      const [byCanonicalKey, byLegacyKey, byParticipant, byCharacterId] = await Promise.all([
        canonicalKey ? base44.entities.Conversation.filter({ shared_conversation_key: canonicalKey }, "-updated_date", 5).catch(() => []) : Promise.resolve([]),
        legacyBilateralKey ? base44.entities.Conversation.filter({ shared_conversation_key: legacyBilateralKey }, "-updated_date", 5).catch(() => []) : Promise.resolve([]),
        contactId ? base44.entities.Conversation.filter({ participant_character_ids: [character.id] }, "-updated_date", 100).catch(() => []) : Promise.resolve([]),
        base44.entities.Conversation.filter({ character_ids: [character.id] }, "-updated_date", 150).catch(() => []),
      ]);

      // Merge all candidates, deduplicated
      const seenIds = new Set();
      const allCandidates = [...byCanonicalKey, ...byLegacyKey, ...byParticipant, ...byCharacterId].filter(c => {
        if (seenIds.has(c.id)) return false;
        seenIds.add(c.id);
        return true;
      });

      // Ordered resolution: canonical key → legacy bilateral key → participant_character_ids both present → legacy title
      let found =
        allCandidates.find(c => c.shared_conversation_key === canonicalKey) ||
        allCandidates.find(c => c.shared_conversation_key === legacyBilateralKey) ||
        (contactId && allCandidates.find(c =>
          Array.isArray(c.participant_character_ids) &&
          [character.id, contactId].every(id => c.participant_character_ids.includes(id))
        )) ||
        (contactId && allCandidates.find(c =>
          Array.isArray(c.character_ids) &&
          [character.id, contactId].every(id => c.character_ids.includes(id))
        )) ||
        allCandidates.find(c => c.title === stableTitle) ||
        allCandidates.find(c => c.title === legacyTitle);

      // Duplicate detection
      const duplicates = contactId ? allCandidates.filter(c =>
        (c.shared_conversation_key === canonicalKey || c.shared_conversation_key === legacyBilateralKey) ||
        (Array.isArray(c.participant_character_ids) && [character.id, contactId].every(id => c.participant_character_ids.includes(id))) ||
        (Array.isArray(c.character_ids) && [character.id, contactId].every(id => c.character_ids.includes(id)))
      ) : [];

      console.log(
        `[WorldPhone] canonical_found=${!!found} | canonical_id=${found?.id || 'none'} | legacy_candidates=${allCandidates.length} | duplicate_threads=${duplicates.length}`
      );

      let t_conversation_lookup = Date.now();
      // Cache the found conversation ID for fast reconnect
      if (found && contactId && ownerEmail) {
        setCachedConversationId(ownerEmail, contactId, 'world_phone', found.id);
      }

      if (found) {
        // ── UPGRADE LEGACY THREAD: stamp canonical fields if missing ──────────
        const needsUpgrade = !found.shared_conversation_key ||
          found.shared_conversation_key !== canonicalKey ||
          !Array.isArray(found.participant_character_ids) ||
          (contactId && !found.participant_character_ids?.includes(contactId));

        if (needsUpgrade && canonicalKey && contactId) {
          const currentCharIds = Array.isArray(found.character_ids) ? found.character_ids : [character.id];
          const mergedCharIds = [...new Set([...currentCharIds, contactId])];
          base44.entities.Conversation.update(found.id, {
            shared_conversation_key: canonicalKey,
            participant_character_ids: participantIds,
            character_ids: mergedCharIds,
            channel: 'world_phone',
          }).catch(err => console.warn('[WorldPhone] Failed to upgrade legacy thread:', err.message));
          console.log(`[WorldPhone] Upgraded legacy thread to canonical | id=${found.id} | new_key=${canonicalKey}`);
        }

        setConversationId(found.id);
        const history = await base44.entities.Message.filter({ conversation_id: found.id }, "created_date");

        // Diagnostic: log per-message sender info
        console.log(`[WorldPhone] Loaded ${history.length} messages for convo ${found.id}`);
        history.forEach(m => {
          console.log(`  msg ${m.id.substring(0, 8)} | sender_char_id=${m.sender_character_id || 'none'} | char_id=${m.character_id || 'none'} | sender_type=${m.sender_type}`);
        });

        // DIRECTION RULE: sender_character_id === current character → "sent" (right)
        // Fallback: character_id === current character (legacy messages without sender_character_id)
        setMessages(history.map(m => ({
          id: m.id,
          dbId: m.id,
          role: (m.sender_character_id === character.id || (!m.sender_character_id && m.character_id === character.id))
            ? "sent" : "npc",
          content: m.content,
          image_url: m.image_url || null,
          message_type: m.message_type || null,
        })));

        // Mark incoming as read — uses canonical isCountableUnread (same as CharacterCard and
        // useWorldContactsUnread) so badge count and read-marking are always in sync.
        const unreadIncoming = history.filter(m => isCountableUnread(m, character.id));
        console.log(
          `[WorldContacts] selectContact marking read | convo=${found.id.substring(0,8)} | unread_incoming=${unreadIncoming.length}` +
          (unreadIncoming.length > 0 ? ` | msg_ids=[${unreadIncoming.map(m => m.id.substring(0,8)).join(',')}]` : '')
        );
        const markReadPromises = unreadIncoming.map(m =>
          base44.entities.Message.update(m.id, { is_read: true }).catch(() => {})
        );
        // Wait for ALL mark-read writes to complete BEFORE dispatching thread:read.
        // Pass contactId so the hook clears only THIS contact's badge, not all contacts.
        Promise.all(markReadPromises).then(() => {
          window.dispatchEvent(new CustomEvent('thread:read', {
            detail: {
              characterId: character.id,
              channel: 'world_phone',
              conversationId: found.id,
              contactId: contactId || null,
            }
          }));
        });

        subscribeToConversation(found.id);
      } else {
        console.log(
          `[WorldPhone] No thread found | will create canonical on first message | key=${canonicalKey || 'none'}`
        );
      }

      // ── PRE-FETCH canonical context — global runtime cache (ownerEmail-scoped) ──
      let t_canonical_prompt_load = null;
      let canonical_prompt_cache_hit = false;
      if (contactId) {
        const cached = ownerEmail ? getCachedCanonicalPrompt(ownerEmail, contactId) : null;
        if (cached) {
          canonicalPromptCacheRef.current = cached;
          t_canonical_prompt_load = Date.now();
          canonical_prompt_cache_hit = true;
          console.log(`[WorldContacts] canonical_prompt=CACHE_HIT | id=${contactId} — character_connected_immediately`);
        } else {
          // Not cached — prewarm in background (non-blocking)
          if (ownerEmail) {
            prewarmCharacterRuntime(ownerEmail, contactId, base44).then(() => {
              const p = getCachedCanonicalPrompt(ownerEmail, contactId);
              if (p) {
                canonicalPromptCacheRef.current = p;
                console.log(`[WorldContacts] canonical_prompt=PREWARM_COMPLETE | id=${contactId}`);
              }
            });
          } else {
            // Fallback: fire-and-forget fetch
            base44.functions.invoke("buildCanonicalCharacterContext", {
              characterId: contactId,
              interactionContext: "direct_chat",
              topKMemories: 14,
            }).then(ctxRes => {
              const ctxData = ctxRes?.data || ctxRes;
              if (ctxData?.systemPrompt) {
                canonicalPromptCacheRef.current = ctxData.systemPrompt;
                console.log(`[WorldContacts] canonical_prompt=ASYNC_LOADED | id=${contactId} | memories=${ctxData.memories?.length ?? 0}`);
              }
            }).catch(e => console.warn(`[WorldContacts] canonical context pre-fetch failed: ${e.message}`));
          }
        }
      }

      // ── TIMING PROOF: emit character_ready record once history + char are loaded ──
      const t_character_ready = Date.now();
      reportCharacterReadyTiming({
        ownerEmail,
        characterId: contactId,
        characterName: contact.person_name,
        characterType: contactCharRecordRef.current?.character_type || 'unknown',
        pageType: 'world_contacts',
        channel: 'world_phone',
        t_page_open,
        t_conversation_lookup,
        t_character_fetch,
        t_canonical_prompt_load: t_canonical_prompt_load || t_character_ready,
        t_memory_pool_load: null,
        t_relationship_context_load: null,
        t_message_history_load: t_conversation_lookup,
        t_subscription_connect: t_conversation_lookup,
        t_character_ready,
        t_full_context_complete: null, // async context loads after ready
        cache_used: canonical_prompt_cache_hit || !!(ownerEmail && getCachedCharRecord(ownerEmail, contactId)),
        memory_cache_hit: false,
        canonical_prompt_cache_hit,
        conversation_cache_hit: !!(ownerEmail && getCachedConversationId(ownerEmail, contactId, 'world_phone')),
        blocking_stage: canonical_prompt_cache_hit ? null : 'canonical_prompt_async',
      });

      // ── ENSURE BILATERAL AWARENESS: if B doesn't have A in their list, create a neutral link ──
      // Uses ensureBilateralCharacterAwareness — NEVER syncWorldPhoneMemory.
      // Opening a contact is NOT an interaction. It must not create memory, last_interaction_summary,
      // score progression, or any fake interaction artifact.
      // ensureBilateralCharacterAwareness only creates a neutral awareness entry (awareness_only=true)
      // if one is missing — existing entries are left completely unchanged.
      if (contactId && character.id && contactId !== character.id) {
        base44.functions.invoke('ensureBilateralCharacterAwareness', {
          characterAId: character.id,
          characterBId: contactId,
        }).then(res => {
          const d = res?.data;
          if (d) {
            console.log(
              `[WorldContacts] Bilateral awareness | A=${d.characterA?.name} (${d.characterA?.character_type}) | B=${d.characterB?.name} (${d.characterB?.character_type}) | entries_created=${d.entries_created} | memory_written=${d.memory_written} | score_progression=${d.score_progression}`
            );
          }
        }).catch(() => {}); // non-blocking, best-effort
      }

    } catch (err) {
      console.error('[WorldPhone] selectContact error:', err.message);
    }

    setIsLoadingHistory(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const handleBack = () => {
    if (unsubscribeRef.current) unsubscribeRef.current();
    setSelectedContact(null);
    setMessages([]);
    setConversationId(null);
    contactCharRecordRef.current = null;
    canonicalPromptCacheRef.current = null;
    replyLockRef.current.clear();
    isSendingRef.current = false;
  };

  const handleClose = () => {
    if (unsubscribeRef.current) unsubscribeRef.current();
    setSelectedContact(null);
    setMessages([]);
    setConversationId(null);
    setInputText("");
    contactCharRecordRef.current = null;
    canonicalPromptCacheRef.current = null;
    replyLockRef.current.clear();
    isSendingRef.current = false;
    onClose();
  };

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [messages, isTyping]);

  // ── RETRY FAILED SYNC ────────────────────────────────────────────────────────
  const retryWorldPhoneSync = async (convoId, contactId) => {
    if (!convoId || !contactId) return;
    // Reload failed/pending messages for this conversation
    const failedMsgs = await base44.entities.Message.filter(
      { conversation_id: convoId, sync_status: 'failed' },
      'created_date', 50
    ).catch(() => []);
    const pendingMsgs = await base44.entities.Message.filter(
      { conversation_id: convoId, sync_status: 'pending' },
      'created_date', 50
    ).catch(() => []);
    const toRetry = [...failedMsgs, ...pendingMsgs];
    if (toRetry.length === 0) return;

    const outgoing = toRetry.find(m => m.sender_character_id === character.id || m.typed_by_user);
    const response = toRetry.find(m => m.sender_character_id === contactId);
    if (!outgoing) return;

    base44.functions.invoke('syncBilateralCharacterConversation', {
      sender_character_id: character.id,
      receiver_character_id: contactId,
      conversation_id: convoId,
      message_id: outgoing.id,
      message_content: outgoing.content,
      response_content: response?.content || '',
      channel: 'world_phone',
      topic: outgoing.content?.substring(0, 100) || '',
      emotional_tone: 'calm',
      outcome: 'shared',
      timestamp: new Date().toISOString(),
    })
      .then(() => {
        const ids = [outgoing.id, response?.id, convoId].filter(Boolean);
        ids.forEach(id => {
          if (id === convoId) {
            base44.entities.Conversation.update(id, { sync_status: 'complete', sync_error: null }).catch(() => {});
          } else {
            base44.entities.Message.update(id, { sync_status: 'complete', sync_error: null }).catch(() => {});
          }
        });
        console.log('[WorldContactsPopup] Retry sync succeeded for convo', convoId);
      })
      .catch(err => {
        const errMsg = err.message || 'Retry sync error';
        [outgoing.id, response?.id].filter(Boolean).forEach(id => {
          base44.entities.Message.update(id, { sync_status: 'failed', sync_error: errMsg }).catch(() => {});
        });
        base44.entities.Conversation.update(convoId, { sync_status: 'failed', sync_error: errMsg }).catch(() => {});
        console.warn('[WorldContactsPopup] Retry sync failed (stored):', errMsg);
      });
  };

  // Ref to current conversationId — used inside subscription callback without stale closure.
  const conversationIdRef = useRef(null);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  // Ref to current selectedContact — used inside subscription callback without stale closure.
  const selectedContactRef = useRef(null);
  useEffect(() => { selectedContactRef.current = selectedContact; }, [selectedContact]);

  // ── SHARED SUBSCRIPTION HELPER ─────────────────────────────────────────────
  // Uses sender_character_id (not character_id) for direction — the single source of truth.
  // CRITICAL FIX: When an incoming NPC message arrives via subscription while the thread
  // is open, mark it read immediately. The user is already viewing this thread — the message
  // should never generate a new unread badge when they close the popup.
  const subscribeToConversation = (convoId) => {
    if (unsubscribeRef.current) unsubscribeRef.current();
    unsubscribeRef.current = base44.entities.Message.subscribe((event) => {
      if (event.data?.conversation_id !== convoId) return;
      if (event.type === "create") {
        const d = event.data;
        // DIRECTION: sender_character_id is authoritative; character_id is legacy fallback
        const isSent = d.sender_character_id === character.id ||
          (!d.sender_character_id && d.character_id === character.id);

        setMessages(prev => {
          if (prev.some(m => m.id === d.id)) return prev;
          return [...prev, {
            id: d.id,
            dbId: d.id,
            role: isSent ? "sent" : "npc",
            content: d.content,
            image_url: d.image_url || null,
            message_type: d.message_type || null,
          }];
        });

        // Mark incoming (NPC) messages read immediately — user is already viewing this thread.
        // This prevents: character replies while World Phone is open → user exits → badge appears.
        if (!isSent && isCountableUnread(d, character.id)) {
          base44.entities.Message.update(d.id, { is_read: true }).catch(() => {});
          // Dispatch scoped thread:read with the specific contactId so only this thread's
          // badge clears — not all contacts' badges.
          const contact = selectedContactRef.current;
          const contactId = contact?.related_character_id;
          window.dispatchEvent(new CustomEvent('thread:read', {
            detail: {
              characterId: character.id,
              channel: 'world_phone',
              conversationId: convoId,
              // Pass the specific contact key so the hook clears only this contact's badge
              contactId: contactId || null,
            }
          }));
        }
      }
    });
  };

  // ── ENSURE CONVERSATION: canonical-first, never create if one already exists ──
  // This is the single gate for thread creation. It re-checks the DB before creating
  // to prevent race conditions and duplicate threads from concurrent sends.
  const ensureConversation = async () => {
    if (conversationId) return conversationId;

    const contactId = selectedContact.related_character_id;
    const canonicalKey = getCanonicalSharedKey(character.id, contactId);
    const legacyBilateralKey = contactId
      ? `bilateral_${[character.id, contactId].sort().join('_')}_world_phone`
      : null;
    const participantIds = contactId ? [character.id, contactId].sort() : [character.id];
    const me = await base44.auth.me().catch(() => null);

    // Always re-check DB before creating — prevents duplicates from race conditions
    if (canonicalKey) {
      const [byCanonical, byLegacy] = await Promise.all([
        base44.entities.Conversation.filter({ shared_conversation_key: canonicalKey }, "-updated_date", 5).catch(() => []),
        legacyBilateralKey ? base44.entities.Conversation.filter({ shared_conversation_key: legacyBilateralKey }, "-updated_date", 5).catch(() => []) : Promise.resolve([]),
      ]);
      const existing = [...byCanonical, ...byLegacy][0];
      if (existing) {
        console.log(`[WorldPhone] ensureConversation: found existing | id=${existing.id} | key=${existing.shared_conversation_key}`);
        // Upgrade to canonical if using legacy key
        if (existing.shared_conversation_key !== canonicalKey) {
          base44.entities.Conversation.update(existing.id, {
            shared_conversation_key: canonicalKey,
            participant_character_ids: participantIds,
          }).catch(() => {});
        }
        setConversationId(existing.id);
        subscribeToConversation(existing.id);
        return existing.id;
      }
    }

    // Nothing found — create ONE canonical thread.
    // Stamp world_contact_mode and participant_character_types for active_created→active_created proof.
    const contactCharType = contactCharRecordRef.current?.character_type || null;
    const ownerCharType = character.character_type || null;
    const bothActiveCreated = ownerCharType === 'active_created_character' && contactCharType === 'active_created_character';
    const worldContactMode = bothActiveCreated ? 'active_created_to_active_created' : 'character_to_character';

    console.log(`[WorldPhone] ensureConversation: creating canonical thread | key=${canonicalKey} | mode=${worldContactMode}`);
    const convo = await base44.entities.Conversation.create({
      title: `world_phone::${participantIds.join('::')}`,
      // Use 'character_to_character' for active_created pairs; keep 'npc' for legacy/NPC-style contacts
      type: bothActiveCreated ? "direct" : "npc",
      character_ids: contactId ? [character.id, contactId] : [character.id],
      participant_character_ids: participantIds,
      ...(canonicalKey ? { shared_conversation_key: canonicalKey } : {}),
      owner_email: me?.email || character.owner_email,
      channel: "world_phone",
      sync_status: "pending",
      world_contact_mode: worldContactMode,
      participant_character_types: [ownerCharType, contactCharType].filter(Boolean),
    });
    setConversationId(convo.id);
    subscribeToConversation(convo.id);
    return convo.id;
  };

  const sendMessage = async (imageUrl = null) => {
    if (!inputText.trim() || isTyping) return;
    // ── SEND GUARD: block concurrent sends (rapid tap / double submit) ──────────
    if (isSendingRef.current) {
      console.warn('[WorldContacts] sendMessage blocked — previous send still in flight');
      return;
    }
    isSendingRef.current = true;
    const text = inputText.trim();
    setInputText("");
    setIsTyping(true);

    // ── CANONICAL IDENTITY: compute BEFORE ensureConversation ───────────────────
    // Must be computed first — canonical key is required before ANY message or thread creation.
    const contactId = selectedContact.related_character_id;
    const canonicalKeyForMsg = getCanonicalSharedKey(character.id, contactId);
    const participantIdsForMsg = contactId ? [character.id, contactId].sort() : [character.id];

    // ── HARD REJECTION: linked character-to-character World Phone requires canonical key ──
    if (!contactId || !canonicalKeyForMsg) {
      console.warn(
        `[WorldPhone] SEND REJECTED — cannot compute canonical key.` +
        ` contact_id=${contactId || 'MISSING'} | key=${canonicalKeyForMsg || 'MISSING'}`
      );
      setIsTyping(false);
      isSendingRef.current = false;
      return;
    }

    const convoId = await ensureConversation();

    const savedUserMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "character",
      character_id: character.id,
      character_name: character.name,
      sender_character_id: character.id,
      receiver_character_id: contactId,
      participant_character_ids: participantIdsForMsg,
      shared_conversation_key: canonicalKeyForMsg,
      content: text,
      image_url: imageUrl || undefined,
      timestamp: new Date().toISOString(),
      typed_by_user: true,
      user_operated: true,
      channel: "world_phone",
      sync_status: "pending",
    });

    console.log(`[WorldPhone] Sent message | from=${character.id} | to=${selectedContact.related_character_id} | msg_id=${savedUserMsg.id.substring(0, 8)}`);

    // ── REPLY LOCK: keyed by source message id — prevents duplicate replies ─────
    // If this source message already has a lock (generating or completed), do not run LLM again.
    const replyLockKey = `${convoId}:${savedUserMsg.id}`;
    if (replyLockRef.current.has(replyLockKey)) {
      console.warn(`[WorldPhone] REPLY LOCK HIT — reply already generated or in flight for msg ${savedUserMsg.id.substring(0, 8)}. Aborting duplicate generation.`);
      setIsTyping(false);
      isSendingRef.current = false;
      return;
    }
    replyLockRef.current.add(replyLockKey);

    // Render on right side (sent) immediately — subscription will also fire, dedup is handled
    const userMsg = { id: savedUserMsg.id, dbId: savedUserMsg.id, role: "sent", content: text, image_url: imageUrl || null };
    setMessages(prev => prev.some(m => m.id === savedUserMsg.id) ? prev : [...prev, userMsg]);

    // ── IMAGE UNDERSTANDING PIPELINE ──────────────────────────────────────
    // Analyze any attached image before the NPC LLM call.
    // Uses the shared module so World Contacts are not blind to image content.
    let imageAnalysisContext = "";
    if (imageUrl) {
      const analysis = await analyzeImageForCharacterContext({
        imageUrl,
        messageId: savedUserMsg.id,
        context: "user_uploaded",
      });
      imageAnalysisContext = analysis.imageAnalysisContext;
    }

    // ── CONTACT IDENTITY VERIFICATION ────────────────────────────────────────────
    // Only send to selectedContact — never fan out to all contacts.
    if (!selectedContact?.person_name) {
      setIsTyping(false);
      isSendingRef.current = false;
      return;
    }

    const allMsgs = [...messages, userMsg];

    // ── WORLD CONTACTS FULL CHARACTER PIPELINE ──────────────────────────────────
    // ARCHITECTURE: World Contacts is another doorway into the SAME character runtime.
    // Uses identical pipeline as Chat. No forks, no fallbacks, no simplification.

    // HARD GUARD: contactId must exist and must have been verified at selectContact time.
    if (!contactId) {
      console.error(`[WORLD_CONTACT_FULL_CHARACTER_NOT_RESOLVED] contact_id=MISSING | contact_name=${selectedContact.person_name} | reason=no_related_character_id | action=send_blocked`);
      setIsTyping(false);
      isSendingRef.current = false;
      return;
    }

    // STEP 1: Use cached full Character record (resolved at selectContact, not per-send).
    // If cache is empty for some reason, re-fetch now and cache it.
    let contactCharRecord = contactCharRecordRef.current;
    if (!contactCharRecord) {
      try {
        const chars = await base44.entities.Character.filter({ id: contactId });
        if (chars.length === 0) {
          console.error(`[WORLD_CONTACT_FULL_CHARACTER_NOT_RESOLVED] contact_id=${contactId} | contact_name=${selectedContact.person_name} | reason=Character.filter_returned_empty | action=send_blocked`);
          setIsTyping(false);
          isSendingRef.current = false;
          return;
        }
        contactCharRecord = chars[0];
        if (ownerEmail_send) setCachedCharRecord(ownerEmail_send, contactId, contactCharRecord);
        contactCharRecordRef.current = contactCharRecord;
      } catch (e) {
        console.error(`[WORLD_CONTACT_FULL_CHARACTER_NOT_RESOLVED] contact_id=${contactId} | error=${e.message} | action=send_blocked`);
        setIsTyping(false);
        isSendingRef.current = false;
        return;
      }
    }

    // STEP 2: Canonical context — check mount cache, then global runtime cache, then fetch.
    const me_send = await base44.auth.me().catch(() => null);
    const ownerEmail_send = me_send?.email || character?.owner_email || null;
    let canonicalPrompt = canonicalPromptCacheRef.current ||
      (ownerEmail_send ? getCachedCanonicalPrompt(ownerEmail_send, contactId) : null);
    if (canonicalPrompt && !canonicalPromptCacheRef.current) {
      canonicalPromptCacheRef.current = canonicalPrompt;
      console.log(`[WorldContacts] canonical_prompt=CACHE_HIT at send time | id=${contactId}`);
    }
    if (!canonicalPrompt) {
      try {
        const t0 = Date.now();
        const ctxRes = await base44.functions.invoke("buildCanonicalCharacterContext", {
          characterId: contactId,
          interactionContext: "direct_chat",
          topKMemories: 14,
        });
        const ctxData = ctxRes?.data || ctxRes;
        canonicalPrompt = ctxData?.systemPrompt || null;
        if (canonicalPrompt) {
          canonicalPromptCacheRef.current = canonicalPrompt;
          if (ownerEmail_send) setCachedCanonicalPrompt(ownerEmail_send, contactId, canonicalPrompt);
          console.log(`[WorldContacts] canonical_context_load_ms=${Date.now() - t0} | blocking_stage=canonical_prompt`);
        }
      } catch (e) {
        console.warn(`[WorldContacts] buildCanonicalCharacterContext failed for ${contactId}:`, e.message);
      }
    }

    if (!canonicalPrompt) {
      console.error(`[WORLD_CONTACT_CHARACTER_CONTEXT_MISMATCH] contact_id=${contactId} | contact_name=${selectedContact.person_name} | canonical_prompt=MISSING`);
      setIsTyping(false);
      isSendingRef.current = false;
      return;
    }

    // STEP 3: Retrieve active turn-specific memories — SAME call as Chat.
    let memoryContext = "";
    let memoryCountLoaded = 0;
    try {
      const memRes = await base44.functions.invoke("retrieveActiveMemory", {
        characterId: contactId,
        currentMessage: text,
        recentMessages: messages.slice(-6).map(m => ({
          role: m.role === "sent" ? "user" : "assistant",
          content: m.content,
        })),
        topK: 14,
      });
      const mems = memRes?.data?.memories || [];
      memoryCountLoaded = mems.length;
      if (mems.length > 0) {
        memoryContext = `\n\nLONG-TERM MEMORY BANK (${mems.length} most relevant memories — reference naturally when relevant):\n${mems.map(m => `- ${m.title}: ${m.description}`).join("\n")}`;
      }
    } catch { /* non-blocking */ }

    // STEP 4: Build system prompt — SAME as Chat.
    const systemPromptForContact = buildSystemPrompt(
      canonicalPrompt,
      contactCharRecord,
      { allowNarration: false, worldName: character.name }
    );

    // STEP 5: Full conversation history — last 50 messages (same as Chat).
    const conversationLog = allMsgs.slice(-50)
      .map(m => `${(m.role === "sent") ? character.name : selectedContact.person_name}: ${m.content}`)
      .join("\n");

    // STEP 6: Assemble full prompt — SAME structure as Chat's fullPrompt.
    // Hoisted so the catch block can pass it to triggerRecoveryBackground.

    // ── AUTHORITATIVE TIME CONTEXT ─────────────────────────────────────────────
    // Inject the app's canonical current time so the character never invents its own clock.
    // Characters in the same region as the app must use this time.
    // Only override if character's verified location proves a different timezone.
    const now = new Date();
    const appTimeStr = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    const appTimeBlock = `\n\nAUTHORITATIVE CURRENT TIME (DO NOT OVERRIDE):
The app's verified current time is: ${appTimeStr} (Eastern Time / America/New_York).
This is the canonical real-world time for this interaction.
You MUST use this time as your reference. Do NOT invent a different local time, timezone, or clock.
If the user or sender corrects you about the time, accept the correction unless your verified location proves otherwise.
Characters living in the same region must not claim it is a different hour than this.`;

    // ── SENDER IDENTITY CONTEXT ────────────────────────────────────────────────
    // World Phone is character-to-character. The sender is NOT the app user.
    // The contacted character (${selectedContact.person_name}) must understand who is messaging them.
    const contactRecord = contactCharRecordRef.current;
    const senderCharType = character.character_type || 'active_created_character';
    const senderIdentityBlock = `\n\nCRITICAL — SENDER IDENTITY (World Phone / Character-to-Character):
CHANNEL: World Phone
SENDER: ${character.name} (character ID: ${character.id}, type: ${senderCharType})
RECEIVER: ${selectedContact.person_name} (you)
SENDER IS THE APP USER: false
SENDER IS A CHARACTER IN YOUR WORLD: true

This message was sent by ${character.name} — NOT by the app user, NOT by any human operator.
You must respond to ${character.name} as you would in real life.
Recognize them by name and your real relationship with them.
Do NOT default to treating the sender as "the user" or as a stranger.
This is a character-to-character conversation. Respond to ${character.name} directly.
Replies stay in this World Phone thread and are addressed to ${character.name}.`;

    const fullPrompt = `${systemPromptForContact}${memoryContext}${appTimeBlock}${senderIdentityBlock}
${imageAnalysisContext}

CURRENT CHANNEL: World Phone / World Contacts
${character.name} is messaging you. This is a real exchange between two people who know each other.
Do NOT start with your name. Do NOT say "I'm an AI". Respond as you naturally would.

Conversation so far:
${conversationLog}

Respond ONLY with valid JSON in this exact format:
{
  "message_type": "text_only",
  "text_content": "Your reply as ${selectedContact.person_name}."
}`;

    // PROOF LOG — architecture verification, every field must be true
    console.log(`[SINGLE_CHARACTER_CONTEXT_CHECK] ${JSON.stringify({
      characterId: contactId,
      contactName: selectedContact.person_name,
      fullCharacterRecordResolved: !!contactCharRecord,
      characterRecordId: contactCharRecord?.id,
      canonicalContextLoaded: !!canonicalPrompt,
      canonicalContextCached: !!canonicalPromptCacheRef.current,
      sameResolverAsChat: true,
      memoryCountLoaded,
      emotionalStateLoaded: !!(contactCharRecord?.emotional_state),
      sameLLMCallerAsChat: true,
      sameResponseParserAsChat: true,
      sameMemoryPipeline: true,
      sameSystemPromptBuilder: true,
    })}`);

    // STEP 7: Call LLM — SAME caller as Chat.
    let npcText = "...";
    try {
      const t_llm = Date.now();
      const rawResponse = await callLLMWithRetry(fullPrompt);
      console.log(`[WorldContacts] llm_call_ms=${Date.now() - t_llm} | contact=${selectedContact.person_name}`);
      const parsed = parseCharacterResponse(rawResponse);
      npcText = parsed.text_content?.trim() || rawResponse?.trim() || "...";
      npcText = filterDashes(npcText);
      npcText = stripCharacterNamePrefix(npcText, selectedContact.person_name);
      if (!npcText || npcText.startsWith("{") || npcText.startsWith("```")) npcText = "...";
    } catch (e) {
      console.error(`[WorldContacts] LLM call failed: ${e.message}`);
      
      // ── CIRCUIT BREAKER: do NOT save generic fallback as a Message ────────────
      // Record durable fallback state and trigger background recovery with full prompt.
      // npcText left null — UI will show reconnecting state instead.
      npcText = null; // null = do NOT save anything
      const { handleFallbackResponse } = await import('@/lib/chatFallbackIntegration');
      await handleFallbackResponse({
        characterId: contactId,
        conversationId: convoId,
        currentUser: await base44.auth.me().catch(() => null),
        base44,
        character: contactCharRecordRef.current,
        setRecoveringState: (val) => setIsTyping(val),
        errorReason: e?.message?.includes('429') ? 'rate_limit' : e?.message?.includes('timeout') ? 'timeout' : 'llm_failure',
        errorStage: 'world_contacts_generation',
        originalPrompt: fullPrompt,         // REQUIRED: full prompt for recovery re-attempt
        sourceMessageId: savedUserMsg?.id,  // REQUIRED: user message for idempotency
        channel: 'world_phone',
      });
    }

    // SAFETY: If npcText is null, the circuit breaker blocked saving — abort silently.
    if (npcText === null) {
      setIsTyping(false);
      isSendingRef.current = false;
      return;
    }

    // SAFETY: Verify contact is not the user before creating message.
    const currentUser = await base44.auth.me().catch(() => null);
    const isUserContact = selectedContact.related_character_id === currentUser?.id ||
                         selectedContact.email === currentUser?.email ||
                         selectedContact.is_user === true;
    
    if (isUserContact) {
      console.warn(`[WorldContactsPopup] BLOCKED: Attempted to create message as user contact "${selectedContact.person_name}"`);
      setIsTyping(false);
      isSendingRef.current = false;
      return;
    }

    // ── DUPLICATE REPLY GUARD — check lock again before saving the reply ────────
    // In case the reply lock check at the top was bypassed by a race condition,
    // do a final idempotent check here. Same lock key, same behavior.
    if (replyLockRef.current.has(replyLockKey) && replyLockRef.current.get?.(replyLockKey) === 'saved') {
      console.warn(`[WorldPhone] REPLY ALREADY SAVED — aborting duplicate save for msg ${savedUserMsg.id.substring(0, 8)}`);
      setIsTyping(false);
      isSendingRef.current = false;
      return;
    }

    const generationAttemptId = `${convoId}:${savedUserMsg.id}:${Date.now()}`;
    const savedNpcMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "character",
      character_id: contactId,
      character_name: selectedContact.person_name,
      sender_character_id: contactId,
      receiver_character_id: character.id,
      participant_character_ids: participantIdsForMsg,
      shared_conversation_key: canonicalKeyForMsg,
      content: npcText,
      timestamp: new Date().toISOString(),
      channel: "world_phone",
      sync_status: "pending",
      // ── IDEMPOTENCY + DUPLICATE PREVENTION ────────────────────────────────────
      reply_to_message_id: savedUserMsg.id,
      source_message_id: savedUserMsg.id,
      generation_attempt_id: generationAttemptId,
      response_status: "complete",
      // ── TEXT RESPONSE CLASSIFICATION ─────────────────────────────────────────
      recovery_signal: false,     // real LLM response — eligible for memory/relationship
      memory_eligible: true,
      relationship_eligible: true,
    });

    // Mark lock as saved — prevents any concurrent path from re-saving
    replyLockRef.current.add(replyLockKey);

    console.log(`[WorldPhone] Response message | from=${selectedContact.related_character_id} | to=${character.id} | msg_id=${savedNpcMsg.id.substring(0, 8)}`);

    const npcMsg = { id: savedNpcMsg.id, dbId: savedNpcMsg.id, role: "npc", content: npcText };
    setMessages(prev => [...prev, npcMsg]);

    await base44.entities.Conversation.update(convoId, {
      last_message_preview: npcText.substring(0, 100),
      last_message_date: new Date().toISOString(),
    }).catch(() => {});

    setIsTyping(false);
    isSendingRef.current = false; // release send guard — reply complete

    // ── BILATERAL SYNC + MEMORY (non-blocking with full failure tracking) ──────────
    // UI is already updated. Sync runs in background. All three records are marked.
    if (selectedContact.related_character_id) {
      // ── VERIFICATION LOG: confirm all canonical identity fields before sync ──────
      console.log(
        `[WorldPhone] SEND VERIFICATION` +
        ` | conversation_id=${convoId}` +
        ` | canonical_key=${canonicalKeyForMsg}` +
        ` | participants=${participantIdsForMsg.join(',')}` +
        ` | sender_msg=${savedUserMsg.id}` +
        ` | receiver_msg=${savedNpcMsg.id}`
      );

      base44.functions.invoke('syncBilateralCharacterConversation', {
        sender_character_id: character.id,
        receiver_character_id: contactId,
        conversation_id: convoId,
        sender_message_id: savedUserMsg.id,
        receiver_message_id: savedNpcMsg.id,
        message_content: text,
        response_content: npcText,
        shared_conversation_key: canonicalKeyForMsg,
        participant_character_ids: participantIdsForMsg,
        channel: 'world_phone',
        topic: text.substring(0, 100),
        emotional_tone: 'calm',
        outcome: 'shared',
        timestamp: new Date().toISOString(),
      })
        .then(() => {
          console.log(`[WorldPhone] sync_status=complete | convo=${convoId} | sender_msg=${savedUserMsg.id} | receiver_msg=${savedNpcMsg.id}`);
          Promise.allSettled([
            base44.entities.Message.update(savedUserMsg.id, { sync_status: 'complete' }),
            base44.entities.Message.update(savedNpcMsg.id, { sync_status: 'complete' }),
            base44.entities.Conversation.update(convoId, { sync_status: 'complete' }),
          ]);
        })
        .catch(err => {
          const errMsg = err.message || 'Unknown sync error';
          console.warn(`[WorldPhone] sync_status=failed | convo=${convoId} | error=${errMsg}`);
          Promise.allSettled([
            base44.entities.Message.update(savedUserMsg.id, { sync_status: 'failed', sync_error: errMsg }),
            base44.entities.Message.update(savedNpcMsg.id, { sync_status: 'failed', sync_error: errMsg }),
            base44.entities.Conversation.update(convoId, { sync_status: 'failed', sync_error: errMsg }),
          ]);
        });
    }
    // ── BILATERAL MEMORY: write durable Memory records to BOTH characters ─────
    // FULL EXCHANGE: pass both sent message AND npc response so both sides remember
    // what was said AND what was replied. This matches Chat's extractMemoriesFromTurn
    // which captures the full turn (user message + character response).
    if (selectedContact.related_character_id) {
      const fullExchangeContent = `${character.name}: "${text}" | ${selectedContact.person_name}: "${npcText}"`;
      base44.functions.invoke('syncWorldPhoneMemory', {
        senderCharacterId: character.id,
        receiverCharacterId: selectedContact.related_character_id,
        messageContent: fullExchangeContent,
        context: 'world_phone',
        conversationId: convoId,
      }).then(() => {
        console.log(`[WORLD_CONTACT_BILATERAL_MEMORY_WRITTEN] sender=${character.id} | receiver=${selectedContact.related_character_id} | convo=${convoId}`);
      }).catch(err => {
        console.error(`[WORLD_CONTACT_MEMORY_WRITE_FAILED] sender=${character.id} | receiver=${selectedContact.related_character_id} | error=${err.message}`);
      });
    } else {
      console.error(`[WORLD_CONTACT_BILATERAL_MEMORY_MISSING] contact_name=${selectedContact.person_name} | reason=no_related_character_id | memory_not_written`);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="world-contacts-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
        onClick={handleClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-lg bg-card border border-border rounded-t-2xl flex flex-col"
          style={{ height: "80vh" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
            {selectedContact ? (
              <button onClick={handleBack} className="text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Globe className="w-4 h-4 text-primary" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground truncate">
                {selectedContact ? selectedContact.person_name : `${character?.name}'s World`}
              </h3>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {selectedContact
                  ? selectedContact.relationship_type || "known contact"
                  : `${contacts.length} known contact${contacts.length !== 1 ? "s" : ""}`}
                {conversationId && selectedContact?.related_character_id && (
                  <span className="text-[10px] text-amber-500">
                    {/* Sync status will be checked when conversation loads */}
                  </span>
                )}
              </p>
            </div>
            <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          {!selectedContact ? (
            /* Contact List */
            <div className="flex-1 overflow-y-auto py-2">
              {isLoadingContacts ? (
                <div className="flex items-center justify-center h-16">
                  <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                </div>
              ) : contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <Globe className="w-10 h-10 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No known contacts yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    As {character?.name} builds relationships, they'll appear here.
                  </p>
                </div>
              ) : (
                contacts.map((contact, i) => {
                  // Prefer stable related_character_id key; fallback to normalized person_name
                  const contactKey = contact.related_character_id || contact.person_name?.toLowerCase().trim();
                   const contactUnread = unreadByContact[contactKey] || 0;
                   const contactPreview = previewByContact[contactKey] || null;
                  return (
                  <motion.button
                    key={contact.related_character_id || `name:${contact.person_name}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => selectContact(contact)}
                    className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${
                      contactUnread > 0
                        ? 'bg-green-500/8 hover:bg-green-500/15 border-l-2 border-green-500/60'
                        : 'hover:bg-secondary/60'
                    }`}
                  >
                     {/* Avatar with green unread count badge */}
                    <div className="relative w-10 h-10 flex-shrink-0">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center overflow-hidden ${contactUnread > 0 ? 'ring-2 ring-green-500/60' : 'bg-primary/15'}`}>
                        {contact.avatar_url
                          ? <img src={contact.avatar_url} alt={contact.person_name} className="w-full h-full object-cover" />
                          : <span className="text-sm font-semibold text-primary">{contact.person_name?.[0]?.toUpperCase() || "?"}</span>
                        }
                      </div>
                      {contactUnread > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-green-500 text-white text-[9px] font-bold rounded-full border border-background flex items-center justify-center">
                          {contactUnread > 9 ? "9+" : contactUnread}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm ${contactUnread > 0 ? 'font-bold text-foreground' : 'font-medium text-foreground'}`}>
                          {contact.person_name}
                        </p>
                        {contactUnread > 0 && (
                          <span className="text-[9px] font-bold bg-green-500 text-white px-1.5 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0">
                            {contactUnread} new
                          </span>
                        )}
                      </div>
                      {contactUnread > 0 && contactPreview ? (
                        <p className="text-xs text-green-400 truncate font-medium mt-0.5">
                          {contact.person_name}: {contactPreview}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground truncate">
                          {contact.relationship_type || "known contact"}
                          {contact.current_status ? ` · ${contact.current_status}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1">
                      {contact.romantic_level > 30 && <span className="text-xs text-pink-400">❤</span>}
                      {contact.friendship_level > 70 && contact.romantic_level <= 30 && (
                        <span className="text-xs text-emerald-400">✦</span>
                      )}
                      {/* DIAGNOSTIC: show linkage state — name-only contacts are visibly flagged */}
                      {!contact.related_character_id && (
                        <span title="Not linked to a Character record — bilateral memory may be incomplete">
                          <AlertTriangle className="w-3 h-3 text-amber-400/70" />
                        </span>
                      )}
                    </div>
                  </motion.button>
                  );
                })
              )}
            </div>
          ) : (
            /* Chat View */
            <>
              {selectedContact.description && (
                <div className="px-4 py-2 bg-secondary/40 border-b border-border flex-shrink-0">
                  <p className="text-xs text-muted-foreground line-clamp-2">{selectedContact.description}</p>
                </div>
              )}
              {/* Linkage diagnostic banner — visible, non-destructive */}
              {!selectedContact.related_character_id && (
                <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 flex-shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                  <p className="text-[10px] text-amber-300/80">Not linked to a Character record — memory may not carry over to Chat/Scene</p>
                </div>
              )}
              {/* Sender identity confirmation banner — shown when this thread has unread messages */}
              {(() => {
                const cKey = selectedContact.related_character_id || selectedContact.person_name?.toLowerCase().trim();
                const unreadCount = unreadByContact[cKey] || 0;
                if (unreadCount === 0) return null;
                return (
                  <div className="px-4 py-1.5 bg-green-500/10 border-b border-green-500/20 flex items-center gap-2 flex-shrink-0">
                    <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 animate-pulse" />
                    <p className="text-[11px] text-green-400 font-medium">
                      {unreadCount} unread message{unreadCount !== 1 ? 's' : ''} from {selectedContact.person_name}
                    </p>
                  </div>
                );
              })()}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto py-4 space-y-2 px-4">
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex justify-center mt-8">
                    <div className="flex flex-col items-center gap-2 text-center px-4">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                        {selectedContact.avatar_url
                          ? <img src={selectedContact.avatar_url} alt={selectedContact.person_name} className="w-full h-full object-cover" />
                          : <User className="w-6 h-6 text-primary" />
                        }
                      </div>
                      <p className="text-sm font-medium text-foreground">{selectedContact.person_name}</p>
                      <p className="text-xs text-muted-foreground max-w-xs">
                        {selectedContact.history_summary ||
                          selectedContact.description ||
                          `A ${selectedContact.relationship_type || "contact"} of ${character?.name}.`}
                      </p>
                    </div>
                  </div>
                ) : null}

                <AnimatePresence>
                  {messages.map(msg => {
                    // Date dividers must render as centered separators, never as bubbles
                    if (isDateDividerMessage(msg)) {
                      return (
                        <div key={msg.id} className="flex items-center gap-3 my-3 px-2">
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {extractDateLabel(msg.content)}
                          </span>
                          <div className="flex-1 h-px bg-border" />
                        </div>
                      );
                    }

                    const isSent = msg.role === "user" || msg.role === "sent";
                    const hasImage = !!(msg.image_url || msg.message_type === "image");
                    return (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex flex-col ${isSent ? "items-end" : "items-start"}`}
                      >
                        {/* Sender name label — shown above NPC messages for unambiguous identity */}
                        {!isSent && (
                          <p className="text-[10px] text-muted-foreground font-medium mb-0.5 px-1">
                            {selectedContact.person_name}
                          </p>
                        )}
                        <div className={`max-w-[78%] rounded-2xl overflow-hidden text-sm ${
                          isSent
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-secondary text-foreground rounded-bl-sm"
                        }`}>
                          {hasImage && msg.image_url ? (
                            <div>
                              <img
                                src={msg.image_url}
                                alt={msg.content || "image"}
                                className="w-full max-w-xs object-cover rounded-t-2xl"
                                style={{ maxHeight: 220 }}
                                onError={(e) => { e.target.style.display = 'none'; }}
                              />
                              {msg.content && (
                                <p className="px-3 py-2 text-sm leading-relaxed">{msg.content}</p>
                              )}
                            </div>
                          ) : (
                            <p className="px-4 py-2.5 leading-relaxed">{msg.content}</p>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {isTyping && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-start">
                    <p className="text-[10px] text-muted-foreground font-medium mb-0.5 px-1">
                      {selectedContact.person_name}
                    </p>
                    <div className="bg-secondary rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot-1" />
                      <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot-2" />
                      <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot-3" />
                    </div>
                  </motion.div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="px-4 pb-4 pt-2 flex-shrink-0">
                <div className="flex items-end gap-2 bg-secondary rounded-2xl p-2">
                  <textarea
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message ${selectedContact.person_name}...`}
                    rows={1}
                    className="flex-1 bg-transparent text-foreground text-sm resize-none outline-none px-1 py-2 max-h-28 placeholder:text-muted-foreground"
                    style={{ minHeight: "40px" }}
                  />
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); sendMessage(); }}
                    disabled={!inputText.trim() || isTyping}
                    className="h-9 w-9 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 flex-shrink-0"
                  >
                    <Send className="w-4 h-4 text-primary-foreground" />
                  </motion.button>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}