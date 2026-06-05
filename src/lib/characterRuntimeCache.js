/**
 * characterRuntimeCache.js
 *
 * GLOBAL character runtime cache shared across Chat, Text, WorldContacts, GroupChat.
 *
 * Architecture goal:
 *   - character_ready_ms < 3000 (cached)
 *   - usable_chat_ms    < 5000 (cached)
 *
 * Cache is keyed by `${ownerEmail}:${characterId}` to prevent cross-account leakage.
 * No created_by fallback. No hardcoded character names.
 *
 * Cache entries hold:
 *   - canonicalPrompt   : string (system prompt from buildCanonicalCharacterContext)
 *   - charRecord        : full Character DB record
 *   - recentMemories    : last retrieved memory pool (with the query text that produced them)
 *   - conversationId    : last known conversation ID for this character+channel
 *   - cachedAt          : timestamp
 *
 * TTL: 10 minutes for canonical prompt (memory-heavy), 5 minutes for recent memories.
 * charRecord and conversationId have no TTL — they are patched on change.
 *
 * Timing proof logs emitted by this module:
 *   [RUNTIME_CACHE] cache_hit | key | stage | age_ms
 *   [RUNTIME_CACHE] cache_miss | key | stage
 *   [RUNTIME_CACHE] prewarm_start | key
 *   [RUNTIME_CACHE] prewarm_complete | key | canonical_ms | total_ms
 *   [RUNTIME_CACHE] prewarm_failed | key | error
 */

const _cache = new Map(); // key → entry
// FAMILY AWARENESS FIX: Reduced from 10 min to 3 min so that family graph changes
// (new siblings, children, parents) propagate to all characters within one session.
// The live family graph block in Chat.jsx is the authoritative override on every send,
// but this shorter TTL ensures the base canonical prompt also reflects current family state.
const CANONICAL_TTL_MS = 3 * 60 * 1000; // 3 min
const MEMORY_TTL_MS    =  5 * 60 * 1000; // 5 min
const _prewarmInFlight = new Set(); // prevents duplicate concurrent prewarming

function _cacheKey(ownerEmail, characterId) {
  if (!ownerEmail || !characterId) return null;
  return `${ownerEmail}:${characterId}`;
}

function _getEntry(ownerEmail, characterId) {
  const key = _cacheKey(ownerEmail, characterId);
  if (!key) return null;
  return _cache.get(key) || null;
}

function _setEntry(ownerEmail, characterId, patch) {
  const key = _cacheKey(ownerEmail, characterId);
  if (!key) return;
  const existing = _cache.get(key) || {};
  _cache.set(key, { ...existing, ...patch });
}

// ── PUBLIC: get cached canonical prompt ──────────────────────────────────────
export function getCachedCanonicalPrompt(ownerEmail, characterId) {
  const entry = _getEntry(ownerEmail, characterId);
  if (!entry?.canonicalPrompt) {
    console.log(`[RUNTIME_CACHE] cache_miss | ${_cacheKey(ownerEmail, characterId)} | stage=canonical_prompt`);
    return null;
  }
  const age = Date.now() - (entry.canonicalPromptCachedAt || 0);
  if (age > CANONICAL_TTL_MS) {
    console.log(`[RUNTIME_CACHE] cache_expired | ${_cacheKey(ownerEmail, characterId)} | stage=canonical_prompt | age_ms=${age}`);
    _setEntry(ownerEmail, characterId, { canonicalPrompt: null, canonicalPromptCachedAt: null });
    return null;
  }
  console.log(`[RUNTIME_CACHE] cache_hit | ${_cacheKey(ownerEmail, characterId)} | stage=canonical_prompt | age_ms=${age}`);
  return entry.canonicalPrompt;
}

export function setCachedCanonicalPrompt(ownerEmail, characterId, prompt) {
  if (!ownerEmail || !characterId || !prompt) return;
  _setEntry(ownerEmail, characterId, { canonicalPrompt: prompt, canonicalPromptCachedAt: Date.now() });
}

// ── PUBLIC: get cached Character record ──────────────────────────────────────
export function getCachedCharRecord(ownerEmail, characterId) {
  const entry = _getEntry(ownerEmail, characterId);
  if (entry?.charRecord) {
    console.log(`[RUNTIME_CACHE] cache_hit | ${_cacheKey(ownerEmail, characterId)} | stage=char_record`);
    return entry.charRecord;
  }
  return null;
}

export function setCachedCharRecord(ownerEmail, characterId, record) {
  if (!ownerEmail || !characterId || !record) return;
  _setEntry(ownerEmail, characterId, { charRecord: record });
}

// ── PUBLIC: get cached recent memories ───────────────────────────────────────
export function getCachedMemories(ownerEmail, characterId) {
  const entry = _getEntry(ownerEmail, characterId);
  if (!entry?.memories) return null;
  const age = Date.now() - (entry.memoriesCachedAt || 0);
  if (age > MEMORY_TTL_MS) return null;
  console.log(`[RUNTIME_CACHE] cache_hit | ${_cacheKey(ownerEmail, characterId)} | stage=memories | age_ms=${age}`);
  return entry.memories;
}

export function setCachedMemories(ownerEmail, characterId, memories) {
  if (!ownerEmail || !characterId) return;
  _setEntry(ownerEmail, characterId, { memories, memoriesCachedAt: Date.now() });
}

// ── PUBLIC: get/set last known conversation ID (per channel) ─────────────────
export function getCachedConversationId(ownerEmail, characterId, channel) {
  const entry = _getEntry(ownerEmail, characterId);
  const convoMap = entry?.conversationIds || {};
  const convoId = convoMap[channel] || null;
  if (convoId) console.log(`[RUNTIME_CACHE] cache_hit | ${_cacheKey(ownerEmail, characterId)} | stage=conversation_id | channel=${channel} | convo=${convoId}`);
  return convoId;
}

export function setCachedConversationId(ownerEmail, characterId, channel, conversationId) {
  if (!ownerEmail || !characterId || !channel || !conversationId) return;
  const entry = _getEntry(ownerEmail, characterId);
  const convoMap = { ...(entry?.conversationIds || {}), [channel]: conversationId };
  _setEntry(ownerEmail, characterId, { conversationIds: convoMap });
}

// ── PUBLIC: invalidate a specific character's cache ──────────────────────────
export function invalidateCharacterCache(ownerEmail, characterId) {
  const key = _cacheKey(ownerEmail, characterId);
  if (key) _cache.delete(key);
}

// ── PUBLIC: prewarm — fetches canonical prompt + char record in background ───
// Call this on page open / character list load so cache is hot before user taps.
// Safe to call multiple times — deduplicates concurrent prewarming per key.
export async function prewarmCharacterRuntime(ownerEmail, characterId, base44Instance) {
  const key = _cacheKey(ownerEmail, characterId);
  if (!key || !base44Instance) return;

  // Already in-flight or already cached → skip
  if (_prewarmInFlight.has(key)) return;
  const existing = _cache.get(key);
  const canonicalFresh = existing?.canonicalPrompt &&
    (Date.now() - (existing.canonicalPromptCachedAt || 0)) < CANONICAL_TTL_MS;
  if (canonicalFresh) return; // already hot

  _prewarmInFlight.add(key);
  const t0 = Date.now();
  console.log(`[RUNTIME_CACHE] prewarm_start | ${key}`);

  try {
    // Fetch char record + canonical prompt in parallel
    const [charResult, ctxResult] = await Promise.allSettled([
      base44Instance.entities.Character.filter({ id: characterId }),
      base44Instance.functions.invoke('buildCanonicalCharacterContext', {
        characterId,
        interactionContext: 'direct_chat',
        topKMemories: 14,
      }),
    ]);

    if (charResult.status === 'fulfilled' && charResult.value?.length > 0) {
      setCachedCharRecord(ownerEmail, characterId, charResult.value[0]);
    }

    const ctxData = ctxResult.status === 'fulfilled'
      ? (ctxResult.value?.data || ctxResult.value)
      : null;
    const canonical_ms = Date.now() - t0;

    if (ctxData?.systemPrompt) {
      setCachedCanonicalPrompt(ownerEmail, characterId, ctxData.systemPrompt);
      console.log(`[RUNTIME_CACHE] prewarm_complete | ${key} | canonical_ms=${canonical_ms} | total_ms=${Date.now() - t0}`);
    } else {
      console.warn(`[RUNTIME_CACHE] prewarm_no_prompt | ${key} | elapsed_ms=${Date.now() - t0}`);
    }
  } catch (err) {
    console.warn(`[RUNTIME_CACHE] prewarm_failed | ${key} | error=${err.message}`);
  } finally {
    _prewarmInFlight.delete(key);
  }
}

// ── PUBLIC: timing proof reporter ───────────────────────────────────────────
// Call at "character ready" moment to emit a structured timing record.
export function reportCharacterReadyTiming(params) {
  const {
    ownerEmail,
    characterId,
    characterName,
    characterType,
    pageType,
    channel,
    t_page_open,
    t_conversation_lookup,
    t_character_fetch,
    t_canonical_prompt_load,
    t_memory_pool_load,
    t_relationship_context_load,
    t_message_history_load,
    t_subscription_connect,
    t_character_ready,
    t_full_context_complete,
    cache_used,
    memory_cache_hit,
    canonical_prompt_cache_hit,
    conversation_cache_hit,
    blocking_stage,
  } = params;

  const now = Date.now();
  const character_ready_ms = t_character_ready ? (t_character_ready - t_page_open) : null;
  const usable_chat_ms = t_message_history_load ? (t_message_history_load - t_page_open) : null;

  const record = {
    character_id: characterId,
    character_name: characterName,
    character_type: characterType,
    page_type: pageType,
    channel,
    page_open_ms: 0,
    conversation_lookup_ms: t_conversation_lookup ? (t_conversation_lookup - t_page_open) : null,
    character_fetch_ms: t_character_fetch ? (t_character_fetch - t_page_open) : null,
    canonical_prompt_load_ms: t_canonical_prompt_load ? (t_canonical_prompt_load - t_page_open) : null,
    memory_pool_load_ms: t_memory_pool_load ? (t_memory_pool_load - t_page_open) : null,
    relationship_context_load_ms: t_relationship_context_load ? (t_relationship_context_load - t_page_open) : null,
    message_history_load_ms: usable_chat_ms,
    subscription_connect_ms: t_subscription_connect ? (t_subscription_connect - t_page_open) : null,
    character_ready_ms,
    full_context_complete_ms: t_full_context_complete ? (t_full_context_complete - t_page_open) : null,
    cache_used,
    memory_cache_hit,
    canonical_prompt_cache_hit,
    conversation_cache_hit,
    blocking_stage: blocking_stage || null,
  };

  // Hard target checks
  const TARGET_CHARACTER_READY = 3000;
  const TARGET_USABLE_CHAT = 5000;
  const STALL_THRESHOLD = 10000;

  if (character_ready_ms !== null && character_ready_ms > STALL_THRESHOLD) {
    console.error(
      `[RUNTIME_CACHE] ⛔ STALL DETECTED | character_ready_ms=${character_ready_ms}ms EXCEEDS 10s threshold` +
      ` | blocking_stage=${blocking_stage || 'unknown'} | character=${characterName} (${characterId})`
    );
  } else if (character_ready_ms !== null && character_ready_ms > TARGET_CHARACTER_READY) {
    console.warn(
      `[RUNTIME_CACHE] ⚠ SLOW character_ready | character_ready_ms=${character_ready_ms}ms > 3s target` +
      ` | blocking_stage=${blocking_stage || 'none'} | character=${characterName}`
    );
  }

  if (usable_chat_ms !== null && usable_chat_ms > TARGET_USABLE_CHAT) {
    console.warn(
      `[RUNTIME_CACHE] ⚠ SLOW usable_chat | usable_chat_ms=${usable_chat_ms}ms > 5s target` +
      ` | character=${characterName}`
    );
  }

  console.log(`[CHAR_READY_TIMING] ${JSON.stringify(record)}`);
  return record;
}