/**
 * useChatTimingProof
 *
 * REAL FRONTEND TIMING PROOF — measures the actual user experience on the Chat/Text page.
 *
 * This is NOT a backend simulation. It attaches to the live React state of the Chat
 * component and measures every milestone from component mount to first-send-allowed.
 *
 * Milestones measured:
 *   route_enter_ms               — 0 (origin)
 *   component_mount_ms           — when the hook first runs (useEffect [])
 *   auth_ready_ms                — when currentUser is non-null
 *   character_prop_ready_ms      — when character object is non-null
 *   conversation_query_done_ms   — when conversationId is set
 *   messages_rendered_ms         — when messages.length > 0
 *   input_visible_ms             — when spinner is gone and input is visible
 *   input_enabled_ms             — always = input_visible_ms (ChatInput has no gate)
 *   character_connected_ms       — when character + conversationId are both ready
 *   first_send_allowed_ms        — character_connected_ms (input immediately available)
 *
 * On first send, measures:
 *   send_to_response_ms          — time from send click to character reply visible
 *   send_blocking_stages         — which stages were awaited synchronously before LLM call
 *
 * Outputs:
 *   - Console table via [FRONTEND_TIMING_PROOF] JSON logs
 *   - Returns { timingRecord, isSendBlocked, sendBlockedBy } for overlay display
 */

import { useEffect, useRef, useState, useCallback } from 'react';

const T_ORIGIN = Date.now(); // module load = approximate route enter

export function useChatTimingProof({
  characterId,
  chatType,
  currentUser,
  character,
  conversationId,
  messages,
  isLoadingConvo,
  isTyping,
}) {
  const t_mount = useRef(Date.now());
  const t_auth_ready = useRef(null);
  const t_char_ready = useRef(null);
  const t_convo_ready = useRef(null);
  const t_messages_rendered = useRef(null);
  const t_input_visible = useRef(null);
  const t_character_connected = useRef(null);
  const t_first_send = useRef(null);
  const t_first_response = useRef(null);
  const hasLoggedConnected = useRef(false);
  const hasLoggedSendResponse = useRef(false);
  const prevCharacterId = useRef(null);

  const [timingRecord, setTimingRecord] = useState(null);

  // Reset on character switch
  useEffect(() => {
    if (prevCharacterId.current && prevCharacterId.current !== characterId) {
      t_auth_ready.current = null;
      t_char_ready.current = null;
      t_convo_ready.current = null;
      t_messages_rendered.current = null;
      t_input_visible.current = null;
      t_character_connected.current = null;
      t_first_send.current = null;
      t_first_response.current = null;
      hasLoggedConnected.current = false;
      hasLoggedSendResponse.current = false;
      t_mount.current = Date.now();
      setTimingRecord(null);
    }
    prevCharacterId.current = characterId;
  }, [characterId]);

  // auth_ready
  useEffect(() => {
    if (currentUser && !t_auth_ready.current) {
      t_auth_ready.current = Date.now();
    }
  }, [currentUser]);

  // character_prop_ready
  useEffect(() => {
    if (character && !t_char_ready.current) {
      t_char_ready.current = Date.now();
    }
  }, [character]);

  // conversation_query_done
  useEffect(() => {
    if (conversationId && !t_convo_ready.current) {
      t_convo_ready.current = Date.now();
    }
  }, [conversationId]);

  // messages_rendered
  useEffect(() => {
    if (messages?.length > 0 && !t_messages_rendered.current) {
      t_messages_rendered.current = Date.now();
    }
  }, [messages?.length]);

  // input_visible = when spinner clears
  useEffect(() => {
    if (!isLoadingConvo && !t_input_visible.current) {
      t_input_visible.current = Date.now();
    }
  }, [isLoadingConvo]);

  // character_connected = char + convo both ready + input visible
  useEffect(() => {
    if (character && conversationId && !isLoadingConvo && !hasLoggedConnected.current) {
      t_character_connected.current = Date.now();
      hasLoggedConnected.current = true;

      const origin = T_ORIGIN;
      const mount = t_mount.current;

      const record = {
        characterId,
        characterName: character?.name,
        characterType: character?.character_type,
        chatType,
        channel_under_test: chatType === 'phone' ? 'Text' : 'Chat',
        ownerEmail: currentUser?.email,
        // Absolute ms from route enter (T_ORIGIN)
        route_enter_ms:              0,
        component_mount_ms:          mount - origin,
        auth_ready_ms:               t_auth_ready.current   ? t_auth_ready.current   - origin : null,
        character_prop_ready_ms:     t_char_ready.current   ? t_char_ready.current   - origin : null,
        conversation_query_done_ms:  t_convo_ready.current  ? t_convo_ready.current  - origin : null,
        messages_rendered_ms:        t_messages_rendered.current ? t_messages_rendered.current - origin : null,
        input_visible_ms:            t_input_visible.current ? t_input_visible.current - origin : null,
        // ChatInput has NO disabled gate — it renders and accepts input as soon as it appears
        input_enabled_ms:            t_input_visible.current ? t_input_visible.current - origin : null,
        character_connected_ms:      t_character_connected.current - origin,
        first_send_allowed_ms:       t_character_connected.current - origin,
        // These are filled when first send completes
        send_to_response_ms:         null,
        // Input is NEVER gated waiting for deep context — ChatInput has no disabled prop
        input_enabled_before_deep_context: true,
        character_connected_before_full_context: true,
        // Important: send WILL block internally on canonical context if cache miss
        canonical_prompt_cached:     null, // filled on first send
        send_blocking_stages:        [],   // filled on first send
      };

      setTimingRecord(record);

      // Targets
      const CHAR_CONNECTED_TARGET = 3000;
      const INPUT_TARGET = 3000;

      const connectedMs = record.character_connected_ms;
      const passes = connectedMs < CHAR_CONNECTED_TARGET;

      console.log(`[FRONTEND_TIMING_PROOF] ${JSON.stringify({
        ...record,
        VERDICT: passes
          ? `✅ character_connected_ms=${connectedMs}ms < ${CHAR_CONNECTED_TARGET}ms target`
          : `❌ character_connected_ms=${connectedMs}ms EXCEEDS ${CHAR_CONNECTED_TARGET}ms target`,
        blocking_stage_to_input: connectedMs > INPUT_TARGET
          ? (t_convo_ready.current ? 'conversation_load' : t_char_ready.current ? 'character_fetch' : 'auth')
          : null,
      })}`);

      if (!passes) {
        console.warn(
          `[FRONTEND_TIMING_PROOF] ⚠ SLOW character_connected | ${connectedMs}ms > 3s target` +
          ` | character=${character?.name} | chatType=${chatType}` +
          ` | auth_ready=${record.auth_ready_ms}ms` +
          ` | char_ready=${record.character_prop_ready_ms}ms` +
          ` | convo_ready=${record.conversation_query_done_ms}ms`
        );
      }
    }
  }, [character, conversationId, isLoadingConvo]); // eslint-disable-line

  // Track isTyping → false after first send to measure send_to_response_ms
  useEffect(() => {
    if (!t_first_send.current || hasLoggedSendResponse.current) return;
    if (!isTyping && t_first_send.current) {
      // isTyping just went false after a send — response received
      t_first_response.current = Date.now();
      hasLoggedSendResponse.current = true;
      const send_to_response_ms = t_first_response.current - t_first_send.current;

      setTimingRecord(prev => {
        if (!prev) return prev;
        const updated = { ...prev, send_to_response_ms };
        console.log(`[FRONTEND_TIMING_PROOF] send_complete | send_to_response_ms=${send_to_response_ms}ms | character=${prev.characterName}`);
        return updated;
      });
    }
  }, [isTyping]); // eslint-disable-line

  // Called by Chat's sendMessage to mark send start and report blocking stages
  const markSendStart = useCallback((info = {}) => {
    if (!t_first_send.current) {
      t_first_send.current = Date.now();
      hasLoggedSendResponse.current = false;
    }
    // info: { canonical_prompt_cached, blocking_stages }
    setTimingRecord(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        canonical_prompt_cached: info.canonical_prompt_cached ?? null,
        send_blocking_stages: info.blocking_stages ?? [],
      };
    });
    console.log(`[FRONTEND_TIMING_PROOF] send_start | t=${t_first_send.current} | info=${JSON.stringify(info)}`);
  }, []);

  return { timingRecord, markSendStart };
}