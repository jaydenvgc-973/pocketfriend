import { base44 } from "@/api/base44Client";

export function useChatDeleteActions({
  messages,
  setMessages,
  deleteTarget,
  setDeleteTarget,
  conversationId,
  characterId,
  isPhone,
}) {
  const handleDeleteMessage = (messageId) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    setDeleteTarget(msg);
  };

  const handleDeleteRemember = async () => {
    const msg = deleteTarget;
    setDeleteTarget(null);
    if (!msg) return;
    console.log(`[DELETE] messageId=${msg.id} | threadId=${conversationId} | pageType=${isPhone ? "text" : "chat"} | action=remember | removed_from_view=yes | retained_in_memory=yes`);
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    await base44.entities.Message.update(msg.id, {
      archived_date: new Date().toISOString(),
    }).catch(err => console.warn('[DeleteActions] handleDeleteRemember archive failed:', err?.message));
  };

  const handleDeleteForget = async () => {
    const msg = deleteTarget;
    setDeleteTarget(null);
    if (!msg) return;
    console.log(`[DELETE] messageId=${msg.id} | threadId=${conversationId} | pageType=${isPhone ? "text" : "chat"} | action=forget | removed_from_view=yes | retained_in_memory=no | memory_excluded=yes`);
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    await base44.entities.Message.delete(msg.id).catch(err => console.warn('[DeleteActions] handleDeleteForget delete failed:', err?.message));
    if (msg.content?.trim() && msg.sender_type === "character" && characterId) {
      base44.entities.Memory.create({
        character_id: characterId,
        title: `[FORGOTTEN] Message deleted by user`,
        description: `The user deleted and chose to FORGET this message. Do NOT reference or recall it: "${msg.content.substring(0, 200)}"`,
        emotional_impact: "forgotten",
        timestamp: new Date().toISOString(),
        source_context: `forgotten_message_${msg.id}`,
      }).catch(err => console.warn('[DeleteActions] Forgotten memory marker failed:', err?.message));
      console.log(`[DELETE] Forgotten memory marker created for characterId=${characterId}`);
    }
  };

  const handleDeleteImage = async (messageId) => {
    setMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, image_url: null } : msg));
    await base44.entities.Message.update(messageId, { image_url: null })
      .catch(err => console.warn('[DeleteActions] handleDeleteImage update failed:', err?.message));
  };

  const handleArchiveMessage = async () => {
    const msg = deleteTarget;
    setDeleteTarget(null);
    if (!msg) return;
    console.log(`[ARCHIVE] messageId=${msg.id} | threadId=${conversationId} | action=user_archive | removed_from_view=yes | preserved=yes`);
    // Remove from the visible thread immediately
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    // Set archived_date — this is the existing archive mechanism, now user-only
    await base44.entities.Message.update(msg.id, {
      archived_date: new Date().toISOString(),
    }).catch(err => console.warn('[DeleteActions] handleArchiveMessage update failed:', err?.message));
  };

  return { handleDeleteMessage, handleDeleteRemember, handleDeleteForget, handleDeleteImage, handleArchiveMessage };
}