import { base44 } from "@/api/base44Client";

/**
 * useChatLocationShare
 *
 * Handles the early-return location share branch inside sendMessage.
 * When the user explicitly asks the character to share their location AND the
 * character has a verified resolved location, this hook:
 *   1. Creates or reuses the conversation.
 *   2. Saves the user message.
 *   3. Generates and saves a short character text reply.
 *   4. Saves the location card message.
 *   5. Updates conversation preview.
 *   6. Returns { handled: true } so sendMessage can do an early return.
 *
 * Returns { handled: false } when the conditions are not met so sendMessage
 * continues its normal flow.
 *
 * Ownership: always uses currentUser.email — no created_by.
 */
export function useChatLocationShare({
  character,
  characterId,
  chatType,
  currentUser,
  conversationIdRef,
  conversationId,
  setConversationId,
  activeCharacter,
  setMessages,
  setIsTyping,
  setSendError,
  isMountedRef,
  queryClient,
}) {
  const LOCATION_SHARE_REGEX = [
    /\b(send|share|drop|give|show)\s+(me\s+)?(your\s+)?(location|loc|whereabouts|geotag|geo tag|pin|coordinates)\b/i,
    /\bdrop\s+(your\s+)?pin\b/i,
    /\bsend\s+loc\b/i,
    /\blocation\s+(tag|card|share|pin)\b/i,
    /\b(tag\s+your\s+location|share\s+your\s+location|send\s+your\s+location)\b/i,
  ];

  const tryHandleLocationShare = async (text) => {
    // ── Detection ─────────────────────────────────────────────────────────
    const locationShareRequest = LOCATION_SHARE_REGEX.some(re => re.test(text));

    const earlyCharLocationName = character.resolved_current_location_name || null;
    const earlyCharLocationId = character.resolved_current_location_id || null;

    console.log(
      `[LOCATION-SHARE] detected=${locationShareRequest} | locationName=${earlyCharLocationName} | locationId=${earlyCharLocationId} | text="${text.substring(0, 60)}"`
    );

    if (!locationShareRequest || !earlyCharLocationName || !earlyCharLocationId) {
      return { handled: false };
    }

    // ── Conversation create/reuse ──────────────────────────────────────────
    let convoId = conversationIdRef.current || conversationId;
    if (!convoId) {
      const convo = await base44.entities.Conversation.create({
        title: `${chatType} with ${character.name}`,
        type: chatType,
        character_ids: [characterId],
        owner_email: currentUser.email,
      });
      convoId = convo.id;
      setConversationId(convoId);
    }

    // ── Save user message ─────────────────────────────────────────────────
    const userMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "user",
      content: text,
      timestamp: new Date().toISOString(),
      ...(activeCharacter
        ? { played_as_character_id: activeCharacter.id, played_as_character_name: activeCharacter.name }
        : {}),
    });
    if (!userMsg?.id) {
      setSendError("Message failed to save. Try again.");
      return { handled: true };
    }
    setMessages(prev => prev.some(m => m.id === userMsg.id) ? prev : [...prev, userMsg]);

    if (isMountedRef.current) setIsTyping(true);

    // Small delay to feel natural
    await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));

    if (isMountedRef.current) setIsTyping(false);

    // ── Generate a short natural text reply ───────────────────────────────
    // Rate-limit check before firing LLM — location share reply is nonessential.
    let locationReplyText = "Here's where I'm at 📍";
    if (!window.__chatRateLimited) {
      try {
        const locationReplyRes = await base44.integrations.Core.InvokeLLM({
          prompt: `You are ${character.name}. ${character.personality_summary || ""} The user just asked you to share your location. Write a very short, casual 1-sentence text message acknowledging you're sharing it. Be natural — like a real text. No quotes, no labels.`,
        });
        locationReplyText = (typeof locationReplyRes === "string" ? locationReplyRes.trim() : "") || "Here's where I'm at 📍";
      } catch (err) {
        const is429 = err?.message?.includes('429') || err?.message?.includes('rate limit') || err?.message?.includes('Rate limit');
        if (is429) {
          console.warn('[LocationShare] 429 on reply LLM — using fallback text');
          window.__chatRateLimited = true;
          setTimeout(() => { window.__chatRateLimited = false; }, 60000);
        } else {
          console.warn('[LocationShare] Reply LLM failed:', err?.message);
        }
        // locationReplyText stays as fallback — do not block the location card
      }
    } else {
      console.log('[LocationShare] SKIP reply LLM — rate limit active, using fallback text');
    }

    // ── Save text reply ────────────────────────────────────────────────────
    const textMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "character",
      character_id: characterId,
      character_name: character.name,
      content: locationReplyText,
      emotional_state: character.emotional_state || "calm",
      is_read: true,
      timestamp: new Date().toISOString(),
    });
    if (textMsg?.id) {
      setMessages(prev => prev.some(m => m.id === textMsg.id) ? prev : [...prev, textMsg]);
    }

    // ── Fetch location record for category ────────────────────────────────
    const locs = await base44.entities.LocationReference.filter({ id: earlyCharLocationId }).catch(() => []);
    const loc = locs?.[0];

    // ── Save location card message ─────────────────────────────────────────
    const locCardMsg = await base44.entities.Message.create({
      conversation_id: convoId,
      sender_type: "character",
      character_id: characterId,
      character_name: character.name,
      content: "",
      emotional_state: character.emotional_state || "calm",
      is_read: true,
      timestamp: new Date().toISOString(),
      location_share: {
        location_id: earlyCharLocationId,
        location_name: earlyCharLocationName,
        presence_status: character.resolved_presence_status || character.location_status || null,
        location_category: loc?.category || null,
        character_avatar_url: character.avatar_url || null,
        note: null,
        timestamp: new Date().toISOString(),
      },
    });
    if (locCardMsg?.id) {
      setMessages(prev => prev.some(m => m.id === locCardMsg.id) ? prev : [...prev, locCardMsg]);
    }

    // ── Update conversation preview ────────────────────────────────────────
    await base44.entities.Conversation.update(convoId, {
      last_message_preview: locationReplyText.substring(0, 100),
      last_message_date: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ["conversations", characterId] });

    return { handled: true };
  };

  return { tryHandleLocationShare };
}