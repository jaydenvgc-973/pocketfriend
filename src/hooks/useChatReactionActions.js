import { base44 } from "@/api/base44Client";

// Per-session guard for reaction LLM calls — keyed by characterId
const reactionInFlight = {};
const reactionCooldowns = {};
const REACTION_COOLDOWN_MS = 60000; // 1 reaction reply per character per minute max

function isReactionRateLimited() {
  return !!(window.__chatRateLimited);
}

export function useChatReactionActions({
  messages,
  setMessages,
  conversationId,
  characterId,
  character,
  queryClient,
  setLastChangeReason,
}) {
  const handleReact = async (messageId, emoji) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;

    const currentReactions = msg.reactions || [];
    const existingUserReaction = currentReactions.find(r => r.reactor_type === "user");
    const isSameEmoji = existingUserReaction?.emoji === emoji;

    const nonUserReactions = currentReactions.filter(r => r.reactor_type !== "user");
    const updatedReactions = isSameEmoji
      ? nonUserReactions
      : [...nonUserReactions, { emoji, reactor_type: "user", reactor_id: "user" }];

    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: updatedReactions } : m));
    await base44.entities.Message.update(messageId, { reactions: updatedReactions });

    if (msg.sender_type === "character" && !isSameEmoji && character) {
      // ── Relationship update — gated by rate-limit flag ────────────────────
      if (!isReactionRateLimited()) {
        base44.functions.invoke("updateRelationshipLevels", {
          characterId,
          emojiReaction: emoji,
          emojiMeaning: { "❤️": "love/care/appreciation", "👍": "acknowledgment/approval", "😢": "sadness/empathy", "😡": "anger/disapproval", "😲": "shock/surprise", "😂": "humor/laughter" }[emoji] || "general reaction",
          reactedMessageContent: msg.content || "(image)",
          reactedMessageSenderType: msg.sender_type,
          recentMessages: messages.slice(-10),
        }).then(res => {
          if (res?.data?.reason) setLastChangeReason(res.data.reason);
          queryClient.invalidateQueries({ queryKey: ["character", characterId] });
        }).catch(err => {
          const is429 = err?.message?.includes('429') || err?.message?.includes('rate limit') || err?.message?.includes('Rate limit');
          if (is429) {
            console.warn('[ReactionActions] 429 on updateRelationshipLevels — setting rate-limit flag');
            window.__chatRateLimited = true;
            setTimeout(() => { window.__chatRateLimited = false; }, 60000);
          }
        });
      } else {
        console.log('[ReactionActions] SKIP updateRelationshipLevels — rate limit active');
      }

      // ── Emoji reaction reply — nonessential, heavily gated ───────────────
      // Conditions: specific positive emojis only, 45% chance, 1-per-character cooldown,
      // not in-flight, not rate-limited, deferred 6s (well after any active message response)
      const cooldownKey = `reaction:${characterId}`;
      const lastFired = reactionCooldowns[cooldownKey] || 0;
      const onCooldown = (Date.now() - lastFired) < REACTION_COOLDOWN_MS;

      if (
        ["❤️", "👍", "😂", "😢"].includes(emoji) &&
        Math.random() < 0.45 &&
        conversationId &&
        !onCooldown &&
        !reactionInFlight[characterId] &&
        !isReactionRateLimited()
      ) {
        reactionInFlight[characterId] = true;
        reactionCooldowns[cooldownKey] = Date.now();

        setTimeout(async () => {
          try {
            const emojiMeanings = { "❤️": "a ❤️ (love/appreciation)", "👍": "a 👍 (thumbs up/approval)", "😂": "a 😂 (laughing reaction)", "😢": "a 😢 (sad/touched reaction)" };
            const replyRes = await base44.integrations.Core.InvokeLLM({
              prompt: `You are ${character.name}. ${character.personality_summary || ""} You just sent this message: "${msg.content?.substring(0, 150) || "(image)"}". The person you're talking to reacted to YOUR message with ${emojiMeanings[emoji] || "an emoji reaction"}. Write a SHORT, natural, casual response — as yourself, reacting to RECEIVING that reaction from them. 1 sentence max, like a real text. Express how you feel about their reaction to what YOU said. Do NOT speak as the user or assume what they meant. Be yourself. No quotes, no labels.`,
            });
            const replyText = typeof replyRes === "string" ? replyRes.trim() : "";
            if (replyText && replyText.length > 2 && replyText.length < 200) {
              await base44.entities.Message.create({
                conversation_id: conversationId,
                sender_type: "character",
                character_id: characterId,
                character_name: character.name,
                content: replyText,
                emotional_state: character.emotional_state || "calm",
                timestamp: new Date().toISOString(),
                is_read: true,
              });
            }
          } catch (err) {
            const is429 = err?.message?.includes('429') || err?.message?.includes('rate limit') || err?.message?.includes('Rate limit');
            if (is429) {
              console.warn('[ReactionActions] 429 on reaction LLM reply — setting rate-limit flag');
              window.__chatRateLimited = true;
              setTimeout(() => { window.__chatRateLimited = false; }, 60000);
            } else {
              console.warn('[ReactionActions] Reaction reply failed:', err?.message);
            }
          } finally {
            reactionInFlight[characterId] = false;
          }
        }, 6000);
      } else if (onCooldown || reactionInFlight[characterId] || isReactionRateLimited()) {
        console.log(`[ReactionActions] SKIP reaction reply — cooldown=${onCooldown} inFlight=${!!reactionInFlight[characterId]} rateLimited=${isReactionRateLimited()}`);
      }
    }
  };

  return { handleReact };
}