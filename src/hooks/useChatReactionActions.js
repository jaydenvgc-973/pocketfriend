import { base44 } from "@/api/base44Client";

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
      }).catch(() => {});

      if (["❤️", "👍", "😂", "😢"].includes(emoji) && Math.random() < 0.45 && conversationId) {
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
          } catch { /* silent */ }
        }, 1500 + Math.random() * 2000);
      }
    }
  };

  return { handleReact };
}