/**
 * LocationShareTool
 *
 * App drawer tool for explicit location sharing between user and character.
 * Does NOT replace verbal/text location requests — this is an additional access point.
 *
 * Options:
 *   1. Send My Location → creates a user-side location_share message in the conversation
 *   2. Request Character's Location → creates a system prompt that makes the character
 *      respond with their verified location (sets share_location flag via message)
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, MapPin, Navigation, ArrowRight } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function LocationShareTool({
  isOpen,
  onClose,
  character,
  characterId,
  conversationId,
  userSettings,
  currentUser,
  onMessageCreated,
}) {
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState(null); // { type: 'success'|'error', text: string }

  if (!isOpen) return null;

  const userLocId   = userSettings?.user_current_location_id   || null;
  const userLocName = userSettings?.user_current_location_name || null;
  const charLocId   = character?.resolved_current_location_id  || null;
  const charLocName = character?.resolved_current_location_name || null;
  const worldName   = userSettings?.fictional_world_name || currentUser?.full_name || 'You';

  const handleSendMyLocation = async () => {
    if (!userLocId || !userLocName) {
      setResult({ type: 'error', text: 'Your current location is not set. Please select or update your location first.' });
      return;
    }
    if (!conversationId) {
      setResult({ type: 'error', text: 'No active conversation found. Send a message first.' });
      return;
    }

    setIsSending(true);
    setResult(null);
    try {
      // Create a user message with a location_share card
      const msg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'user',
        content: '',
        timestamp: new Date().toISOString(),
        location_share: {
          location_id: userLocId,
          location_name: userLocName,
          presence_status: userSettings?.user_presence_status || 'present',
          note: `${worldName} shared their location`,
          timestamp: new Date().toISOString(),
        },
      });
      if (onMessageCreated && msg?.id) onMessageCreated(msg);

      // ── CHARACTER RESPONSE TO RECEIVED USER LOCATION ──────────────────────
      // The character must acknowledge the shared location — not silently receive it.
      // Reaction depends on relationship, distance, reason, and personality.
      try {
        const charLocContext = charLocName ? `Your current location is: ${charLocName}.` : 'Your current location is unknown.';
        const sameLocation = charLocId && charLocId === userLocId;
        const distanceCtx = sameLocation
          ? "You are at the same location as the person sharing — you are already there!"
          : charLocName
          ? `You are currently at ${charLocName}, which may be a different place.`
          : '';
        const personalityCtx = [
          character?.personality_summary ? `Your personality: ${character.personality_summary}.` : '',
          character?.emotional_state ? `Your emotional state: ${character.emotional_state}.` : '',
          character?.friendship_level > 75 ? 'You are close to this person.' : character?.friendship_level > 40 ? 'Normal relationship.' : '',
        ].filter(Boolean).join(' ');

        const replyPrompt = `You are ${character?.name}. ${personalityCtx}

${worldName} just sent you their location: "${userLocName}". ${charLocContext} ${distanceCtx}

Write a short natural text message responding to receiving their location. React authentically:
- Acknowledge the location specifically (use the name).
- React based on whether you are nearby, far away, or at the same spot.
- If relationship is close, you may ask if they want company, offer to come, or express surprise.
- If reason is unclear, ask why they shared it.
- Keep it 1-2 sentences. Texting style.
- Do NOT start with your own name.
- Return ONLY the reply text.`;

        const replyRes = await base44.integrations.Core.InvokeLLM({ prompt: replyPrompt });
        const replyText = (typeof replyRes === 'string' ? replyRes.trim() : '') || `Oh nice, you're at ${userLocName}!`;

        const charReply = await base44.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: characterId,
          character_name: character?.name,
          content: replyText,
          emotional_state: character?.emotional_state || 'calm',
          is_read: false,
          timestamp: new Date(Date.now() + 1500).toISOString(),
          memory_eligible: true,
          relationship_eligible: true,
          recovery_signal: false,
        });
        if (onMessageCreated && charReply?.id) onMessageCreated(charReply);
        // Update conversation preview
        await base44.entities.Conversation.update(conversationId, {
          last_message_preview: replyText.substring(0, 100),
          last_message_date: new Date().toISOString(),
        }).catch(() => {});
      } catch (replyErr) {
        // Non-fatal — location card succeeded, reply is best-effort
        console.warn('[LocationShareTool] Character reply failed:', replyErr?.message);
      }

      setResult({ type: 'success', text: `Your location (${userLocName}) was shared with ${character?.name}.` });
    } catch (err) {
      setResult({ type: 'error', text: 'Failed to send location. Please try again.' });
    } finally {
      setIsSending(false);
    }
  };

  const handleRequestCharacterLocation = async () => {
    if (!charLocId || !charLocName) {
      setResult({ type: 'error', text: "Character location is currently unknown." });
      return;
    }
    if (!conversationId) {
      setResult({ type: 'error', text: 'No active conversation found. Send a message first.' });
      return;
    }

    setIsSending(true);
    setResult(null);
    try {
      // Create a character message with a verified location_share card directly
      const msg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: characterId,
        character_name: character?.name,
        content: '',
        is_read: true,
        timestamp: new Date().toISOString(),
        location_share: {
          location_id: charLocId,
          location_name: charLocName,
          presence_status: character?.resolved_presence_status || null,
          location_category: null,
          character_avatar_url: character?.avatar_url || null,
          note: null,
          timestamp: new Date().toISOString(),
        },
      });
      if (onMessageCreated && msg?.id) onMessageCreated(msg);
      // Update conversation preview
      await base44.entities.Conversation.update(conversationId, {
        last_message_preview: `📍 ${charLocName}`,
        last_message_date: new Date().toISOString(),
      }).catch(() => {});
      setResult({ type: 'success', text: `${character?.name}'s location (${charLocName}) was added to the conversation.` });
    } catch (err) {
      setResult({ type: 'error', text: 'Failed to share character location. Please try again.' });
    } finally {
      setIsSending(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="location-share-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-5 pb-8 space-y-4"
        >
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <MapPin className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Location Sharing</h3>
              <p className="text-xs text-muted-foreground">Share locations with {character?.name}</p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Result feedback */}
          {result && (
            <div className={`px-3 py-2.5 rounded-xl text-xs font-medium ${
              result.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-destructive/10 text-destructive border border-destructive/20'
            }`}>
              {result.text}
            </div>
          )}

          {/* Option 1: Send My Location */}
          <button
            onClick={handleSendMyLocation}
            disabled={isSending}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-secondary border border-border hover:bg-secondary/80 transition-colors text-left disabled:opacity-50"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
              <Navigation className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Send My Location</p>
              <p className="text-xs text-muted-foreground truncate">
                {userLocName
                  ? `Currently: ${userLocName}`
                  : 'Your location is not set — go to Travel to set it'}
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          </button>

          {/* Option 2: Request Character's Location */}
          <button
            onClick={handleRequestCharacterLocation}
            disabled={isSending}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-secondary border border-border hover:bg-secondary/80 transition-colors text-left disabled:opacity-50"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
              <MapPin className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Request {character?.name}'s Location</p>
              <p className="text-xs text-muted-foreground truncate">
                {charLocName
                  ? `Currently: ${charLocName}`
                  : 'Location unknown'}
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          </button>

          <p className="text-[10px] text-muted-foreground/50 text-center pt-1">
            Verbal location requests in chat are still fully supported
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}