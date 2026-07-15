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
 *
 * AUTHORITATIVE LOCATION CONSUMER:
 *   The character's current location is NEVER read from a raw Character field or a
 *   cached page-load snapshot. It is resolved fresh through the same authoritative
 *   location/presence system used by work presence, profile, homepage, and the
 *   multi-job work-schedule enforcement: `enforceCharacterLocationPresence`.
 *   Calling it with no requested transition triggers its legacy recompute path, which
 *   evaluates every active job (primary + additional_occupation_locations), school,
 *   home, incarceration, house arrest, sleep, and other recognized states — and
 *   returns the committed resolved result. This tool only consumes that result; it
 *   does not derive, cache, or independently compute a competing location.
 */
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, MapPin, Navigation, ArrowRight } from "lucide-react";
import { base44 } from "@/api/base44Client";

/**
 * Resolve the character's authoritative current location through the existing
 * presence/location authority. Returns { locationId, locationName, presenceStatus }.
 * On `no_change` the stored fields already equal the recomputed truth, so the
 * (now-confirmed) Character fields are authoritative and safe to use.
 */
async function resolveAuthoritativeCharLocation(characterId, ownerEmail) {
  const res = await base44.functions.invoke('enforceCharacterLocationPresence', {
    character_id: characterId,
    owner_email: ownerEmail || undefined,
  });
  const data = res?.data || res;
  const committed = data?.committed_result;
  if (committed && committed.resolved_current_location_id) {
    return {
      locationId: committed.resolved_current_location_id,
      locationName: committed.resolved_current_location_name || null,
      presenceStatus: committed.resolved_presence_status || null,
    };
  }
  // no_change (or deferred) — the stored fields are the authoritative recomputed truth.
  // Read them from the authority's character load by re-fetching the Character record
  // so we never rely on a stale page-load snapshot passed in as a prop.
  const chars = await base44.entities.Character.filter({ id: characterId }, null, 1);
  const ch = chars?.[0];
  if (!ch) return null;
  return {
    locationId: ch.resolved_current_location_id || null,
    locationName: ch.resolved_current_location_name || null,
    presenceStatus: ch.resolved_presence_status || null,
  };
}

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
  // Authoritative resolved character location (consumed from the presence authority).
  const [resolvedCharLoc, setResolvedCharLoc] = useState(null);
  const [resolvingLoc, setResolvingLoc] = useState(false);

  // Resolve the character's authoritative current location whenever the tool opens,
  // so the displayed "Currently:" reflects truth (and re-establishes it if drifted).
  useEffect(() => {
    if (!isOpen || !characterId) { setResolvedCharLoc(null); return; }
    let cancelled = false;
    setResolvingLoc(true);
    resolveAuthoritativeCharLocation(characterId, character?.owner_email)
      .then(loc => { if (!cancelled) setResolvedCharLoc(loc); })
      .catch(err => { console.warn('[LocationShareTool] resolve failed:', err?.message); if (!cancelled) setResolvedCharLoc(null); })
      .finally(() => { if (!cancelled) setResolvingLoc(false); });
    return () => { cancelled = true; };
  }, [isOpen, characterId, character?.owner_email]);

  if (!isOpen) return null;

  const userLocId   = userSettings?.user_current_location_id   || null;
  const userLocName = userSettings?.user_current_location_name || null;
  const worldName   = userSettings?.fictional_world_name || currentUser?.full_name || 'You';
  // Character location is the authoritative resolved result — never a raw prop field.
  const charLocId   = resolvedCharLoc?.locationId || null;
  const charLocName = resolvedCharLoc?.locationName || null;
  const charPresence = resolvedCharLoc?.presenceStatus || character?.resolved_presence_status || null;

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
        // Re-resolve the character's authoritative location for the distance context
        // so the reply reflects the current resolved state, not the on-open snapshot.
        let replyCharLoc = resolvedCharLoc;
        try {
          const fresh = await resolveAuthoritativeCharLocation(characterId, character?.owner_email);
          if (fresh) { setResolvedCharLoc(fresh); replyCharLoc = fresh; }
        } catch (_) { /* use on-open resolved value */ }

        const charLocContext = replyCharLoc?.locationName ? `Your current location is: ${replyCharLoc.locationName}.` : 'Your current location is unknown.';
        const sameLocation = replyCharLoc?.locationId && replyCharLoc.locationId === userLocId;
        const distanceCtx = sameLocation
          ? "You are at the same location as the person sharing — you are already there!"
          : replyCharLoc?.locationName
          ? `You are currently at ${replyCharLoc.locationName}, which may be a different place.`
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
    if (!conversationId) {
      setResult({ type: 'error', text: 'No active conversation found. Send a message first.' });
      return;
    }

    setIsSending(true);
    setResult(null);
    try {
      // Resolve the character's authoritative current location fresh at send time —
      // never rely on the on-open snapshot, a previous chat message, image caption,
      // memory, or drawer state. This consumes the same resolver used by work
      // presence and the multi-job work-schedule correction.
      const fresh = await resolveAuthoritativeCharLocation(characterId, character?.owner_email);
      const loc = fresh || resolvedCharLoc;
      if (loc) setResolvedCharLoc(loc);

      const shareLocId = loc?.locationId || null;
      const shareLocName = loc?.locationName || null;
      const sharePresence = loc?.presenceStatus || null;

      if (!shareLocId || !shareLocName) {
        setResult({ type: 'error', text: "Character location is currently unknown." });
        return;
      }

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
          location_id: shareLocId,
          location_name: shareLocName,
          presence_status: sharePresence,
          location_category: null,
          character_avatar_url: character?.avatar_url || null,
          note: null,
          timestamp: new Date().toISOString(),
        },
      });
      if (onMessageCreated && msg?.id) onMessageCreated(msg);
      // Update conversation preview
      await base44.entities.Conversation.update(conversationId, {
        last_message_preview: `📍 ${shareLocName}`,
        last_message_date: new Date().toISOString(),
      }).catch(() => {});
      setResult({ type: 'success', text: `${character?.name}'s location (${shareLocName}) was added to the conversation.` });
    } catch (err) {
      setResult({ type: 'error', text: 'Failed to share character location. Please try again.' });
    } finally {
      setIsSending(false);
    }
  };

  const charDisplay = resolvingLoc && !resolvedCharLoc
    ? 'Resolving current location…'
    : charLocName
      ? `Currently: ${charLocName}`
      : 'Location unknown';

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
                {charDisplay}
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