/**
 * useChatBackgroundTasks
 *
 * Execution governor for all post-send background work.
 *
 * Rules enforced:
 * 1. Chat response (foreground) always has priority — background tasks only run AFTER it completes.
 * 2. Each task has: priority tier, stagger delay, per-character cooldown, in-flight lock.
 * 3. Emoji reaction is nonessential — skipped while isTyping, capped to once per 5 messages.
 * 4. On 429 / rate-limit: all background work stops, no retries.
 * 5. No fire-and-forget storms — every call is tracked.
 */

import { useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { reportRateLimit, isGloballyRateLimited, isChatSafeModeActive, escalateChatRetry, resetChatRetry, getChatRetryState, isRetryPaused, areOptionalSystemsDisabled, getActiveContext } from "@/lib/simulationGate";
import { traceRequest, traceRateLimit as traceRL } from "@/lib/chatLoadTrace";
import { isForegroundActive, FOREGROUND_TASKS } from "@/lib/foregroundPriority";
import { getCharacterSleepState } from "@/lib/characterSleepState";
import { filterDetectedMentions } from "@/lib/entityDetectionFilter";

// Per-session cooldown state — keyed by `${characterId}:${taskName}`
const sessionCooldowns = {};
// In-flight guards — keyed by `${characterId}:${taskName}`
const inFlight = {};
// Per-character message count for emoji gating
const emojiMsgCount = {};
// Delegate to unified gate rate-limit so all simulation systems share the same flag.
function setRateLimited() {
  reportRateLimit(60000);
  console.warn("[Governor] Rate limit detected — all background tasks suspended for 60s");
}

function isOnCooldown(characterId, taskName, cooldownMs) {
  const key = `${characterId}:${taskName}`;
  const last = sessionCooldowns[key] || 0;
  return (Date.now() - last) < cooldownMs;
}

function markCooldown(characterId, taskName) {
  sessionCooldowns[`${characterId}:${taskName}`] = Date.now();
}

function isInFlight(characterId, taskName) {
  return !!inFlight[`${characterId}:${taskName}`];
}

function setInFlight(characterId, taskName, val) {
  inFlight[`${characterId}:${taskName}`] = val;
}

async function safeInvoke(fnName, payload, characterId, taskName) {
  const page = getActiveContext().page;
  const fg = isForegroundActive ? isForegroundActive() : false;
  if (fg) {
    traceRequest(fnName, { caller: `Governor:${taskName}`, page, status: 'BLOCKED', detail: 'foreground active' });
    console.log(`[Governor] YIELD ${taskName} — foreground task active`);
    return null;
  }
  if (isGloballyRateLimited()) {
    traceRequest(fnName, { caller: `Governor:${taskName}`, page, status: 'SKIPPED', detail: 'global rate limit' });
    console.log(`[Governor] SKIP ${taskName} — global rate limit active`);
    return null;
  }
  if (isChatSafeModeActive()) {
    traceRequest(fnName, { caller: `Governor:${taskName}`, page, status: 'SKIPPED', detail: 'chat-safe mode' });
    console.log(`[Governor] SKIP ${taskName} — chat-safe mode active (page recovery in progress)`);
    return null;
  }
  if (isRetryPaused()) {
    traceRequest(fnName, { caller: `Governor:${taskName}`, page, status: 'SKIPPED', detail: 'retry paused' });
    console.log(`[Governor] SKIP ${taskName} — escalating retry pause active until ${new Date(getChatRetryState().pauseUntil).toLocaleTimeString()}`);
    return null;
  }
  if (areOptionalSystemsDisabled()) {
    const essentialTasks = new Set(['activityUpdate', 'locationUpdate', 'memoryExtract']);
    if (!essentialTasks.has(taskName)) {
      traceRequest(fnName, { caller: `Governor:${taskName}`, page, status: 'SKIPPED', detail: 'optional systems disabled' });
      console.log(`[Governor] SKIP ${taskName} — optional systems disabled (level-3 retry active)`);
      return null;
    }
  }
  if (isInFlight(characterId, taskName)) {
    traceRequest(fnName, { caller: `Governor:${taskName}`, page, status: 'SKIPPED', detail: 'in-flight' });
    console.log(`[Governor] SKIP ${taskName} — already in-flight for char=${characterId}`);
    return null;
  }
  traceRequest(fnName, { caller: `Governor:${taskName}`, page, status: 'ALLOWED', detail: `charId=${characterId}` });
  setInFlight(characterId, taskName, true);
  try {
    const res = await base44.functions.invoke(fnName, payload);
    markCooldown(characterId, taskName);
    return res;
  } catch (err) {
    const is429 = err?.message?.includes('429') || err?.message?.includes('rate limit') || err?.message?.includes('Rate limit') || err?.status === 429;
    if (is429) {
      setRateLimited();
      traceRL(fnName, `Governor:${taskName} — 429`);
    } else {
      console.warn(`[Governor] ${taskName} failed:`, err?.message);
    }
    return null;
  } finally {
    setInFlight(characterId, taskName, false);
  }
}

export function useChatBackgroundTasks({
  queryClient,
  setNewPeopleDetected,
  setPendingAliasResolution,
  setLastChangeReason,
  setMessages,
  onAchievementRevisited,
}) {

  const dispatchPostSend = useCallback(({
    characterId,
    convoId,
    character,
    text,
    responseText,
    recentMsgs,
    activeCharacter,
    isPhone,
    currentUser,
    isTyping,
    userMsg,
    worldPhoneAlreadySent, // true when Chat.jsx pre-send worldPhoneIntent already fired
  }) => {
    if (!characterId || !convoId) return;

    // ── SLEEPING CHARACTER GUARD ──────────────────────────────────────────────
    // Sleeping characters skip travel, social, proactive, needs, and location loops.
    // Only memory extraction and essential tracking are allowed.
    if (character) {
      const ss = getCharacterSleepState(character);
      if (ss.isSleeping) {
        console.log(`[Governor] SLEEP GUARD active for "${character.name}" (source: ${ss.sleepStateSource}) — skipping travel/social/proactive/needs/location background tasks`);
        // Only allow memory extraction for sleeping characters — skip everything else
        setTimeout(() => {
          if (isGloballyRateLimited() || isRetryPaused()) return;
          if (!isOnCooldown(characterId, 'memoryExtract', 90000)) {
            safeInvoke('extractMemoriesFromTurn', {
              characterId, conversationId: convoId,
              userMessage: text, characterResponse: responseText,
              recentMessages: (recentMsgs || []).slice(-10),
              playAsCharacterId: activeCharacter?.id || null,
            }, characterId, 'memoryExtract');
          }
        }, 4000);
        return; // skip all other background tiers
      }
    }

    // ── TIER 1 — 0ms: lightweight location + activity sync (30s cooldown each) ──

    // ── COMMITMENT DETECTION (Tier 1, immediate) ──────────────────────────────
    // Detects travel directives, travel promises, and communication promises in the
    // character's response. Creates durable CharacterCommitment + ScheduledEvent records.
    // Independent of autonomous_travel_enabled ("Forced Travel") — that only controls
    // random needs-based wandering, never explicit commitments.
    // 3-min cooldown prevents re-firing on every message.
    if (responseText && !isOnCooldown(characterId, 'commitmentDetect', 180000)) {
      const commitmentQuickCheck = /\b(i'?m?\s*(on\s+my\s+way|heading|coming|leaving|walking\s+in|pulling\s+up|almost\s+there)|i'?ll?\s*(text|call|message|come|be\s+there|stop\s+by|swing\s+by|drop\s+by|meet\s+you|reach\s+out|check\s+in|let\s+you\s+know)|(talk|speak|chat)\s+(to\s+you\s+)?later)\b/i;
      if (commitmentQuickCheck.test(responseText)) {
        safeInvoke('detectAndScheduleCommitments', {
          characterId,
          characterName: character?.name || '',
          messageContent: responseText,
          conversationId: convoId,
          recipientType: 'user',
        }, characterId, 'commitmentDetect').then(res => {
          if (res?.data?.detected) {
            console.log(`[Governor] Commitment(s) scheduled for "${character?.name}": ${(res.data.commitment_types || []).join(', ')}`);
            if (res.data.commitment_types?.includes('travel_directive')) {
              queryClient.invalidateQueries({ queryKey: ['character', characterId] });
            }
          }
        });
      }
    }

    if (!isOnCooldown(characterId, 'activityUpdate', 30000)) {
      safeInvoke('updateCharacterActivityFromMessage', {
        characterId, message: text, responseText, conversationId: convoId,
      }, characterId, 'activityUpdate');
    }

    if (!isOnCooldown(characterId, 'locationUpdate', 30000)) {
      safeInvoke('updateCharacterLocationFromMessage', {
        characterId, message: text, responseText, conversationId: convoId,
      }, characterId, 'locationUpdate').then(res => {
        if (res?.data?.alias_detected) {
          setPendingAliasResolution({
            phrase: res.data.alias_phrase,
            sourceSentence: res.data.source_sentence,
            characterId,
            characterName: character?.name,
          });
        }
      });
    }

    // ── TIER 2 — 2s: approval check + conversation classification + contact intent ──
    setTimeout(() => {
      if (isGloballyRateLimited()) return;

      // Approval check dispatched as CustomEvent — no extra API call
      if (responseText && character) {
        const cachedChars = queryClient.getQueryData(["characters", currentUser?.email]) || [];
        window.dispatchEvent(new CustomEvent('chat:checkApprovals', {
          detail: { responseText, character, cachedChars, userText: text },
        }));
      }

      if (!isOnCooldown(characterId, 'classifyConvo', 60000)) {
        // Pass characterState so the classifier can see known people (fictional_relationships)
        // Without this, knownPeopleStr is always 'none listed' and social events are missed
        safeInvoke('classifyConversationEvent', {
          characterId,
          characterName: character?.name,
          conversationId: convoId,
          userMessage: text,
          characterReply: responseText,
          characterState: character ? {
            emotional_state: character.emotional_state,
            health_status: character.health_status,
            current_activity: character.current_activity,
            personality_summary: character.personality_summary,
            fictional_relationships: character.fictional_relationships || [],
          } : {},
        }, characterId, 'classifyConvo');
      }

      // ── CONTACT INTENT — LLM-BASED, RELIABLE ──────────────────────────────
      // Fires only when the user message contains contact-suggestive language.
      // Uses a targeted LLM call instead of a fragile regex. 5-minute cooldown.
      // Only creates a real contact event — never a narrative-only response.
      // Skip if the pre-send worldPhoneIntent path already created the World Phone message.
      if (!worldPhoneAlreadySent && !isOnCooldown(characterId, 'contactIntent', 300000) && text && character) {
        const contactTriggerWords = /\b(call|text|message|contact|reach out|hit up|check on|check in with|let .{0,15} know|tell .{0,15} (that|about|i))\b/i;
        if (contactTriggerWords.test(text)) {
          // Build known names from fictional_relationships for context
          const knownNames = (character.fictional_relationships || [])
            .map(r => r.person_name).filter(Boolean).join(', ');

          base44.integrations.Core.InvokeLLM({
            prompt: `A user told a character named "${character.name}" the following:
"${text}"

The character's known contacts: ${knownNames || 'none listed'}

Does this message explicitly instruct "${character.name}" to contact or reach out to a specific person?
If YES: return JSON { "contact_requested": true, "target_name": "<exact name from message>", "message_content": "<what they should say, verbatim from the user message if present, otherwise null>" }
If NO (casual mention, talking about a third party, no clear instruction): return JSON { "contact_requested": false }
Return ONLY valid JSON, nothing else.`,
            response_json_schema: {
              type: 'object',
              properties: {
                contact_requested: { type: 'boolean' },
                target_name: { type: 'string' },
                message_content: { type: 'string' },
              },
              required: ['contact_requested'],
            },
          }).then(result => {
            if (result?.contact_requested && result?.target_name) {
              console.log(`[Governor] Contact intent confirmed by LLM: "${character.name}" → "${result.target_name}"`);
              markCooldown(characterId, 'contactIntent');
              // Route to sendWorldPhoneMessage — the canonical World Phone path.
              // This creates a real, findable World Phone thread with all required fields.
              // Do NOT use triggerCharacterContact here — it uses legacy npc-type convos
              // without canonical shared_conversation_key or channel stamps.
              safeInvoke('sendWorldPhoneMessage', {
                sender_character_id: characterId,
                recipient_identifier: result.target_name,
                requested_message: result.message_content || text.substring(0, 300),
                source: 'user_instruction',
                current_conversation_id: convoId,
                owner_email: currentUser?.email,
              }, characterId, 'contactIntent_exec');
            }
          }).catch(() => {}); // non-blocking — never interrupts chat
        }
      }
    }, 2000);

    // ── TIER 3 — 4s: memory extraction + birthday capture + world phone sync ──
    setTimeout(() => {
      if (isGloballyRateLimited()) return;

      // ── BIRTHDAY DETECTION (once per 10 minutes per character) ──────────────
      // Scan each user message for birthday disclosures. Non-blocking. Cached aggressively.
      // On hit: writes to CharacterMemory (Life Journal) as a protected permanent fact.
      if (text && !isOnCooldown(characterId, 'birthdayCapture', 600000)) {
        const birthdayKeywordCheck = /\b(birthday|born|birth|bday|dob)\b/i;
        if (birthdayKeywordCheck.test(text)) {
          safeInvoke('captureUserBirthday', {
            characterId,
            text,
            source: 'chat',
          }, characterId, 'birthdayCapture').then(res => {
            if (res?.data?.found && res?.data?.stored) {
              console.log(`[Governor] Birthday captured: ${res.data.date} | updated=${res.data.updated} | source=chat`);
            }
          });
        }
      }

      if (!isOnCooldown(characterId, 'memoryExtract', 90000)) {
        // Include image_description from the user message if vision analysis completed.
        // This threads visual context into memory so the character can remember what was shared.
        const userMsgImageDesc = userMsg?.image_description || null;
        const enrichedUserMessage = userMsgImageDesc
          ? `${text} [Image shared — visual content: ${userMsgImageDesc}]`
          : text;
        safeInvoke('extractMemoriesFromTurn', {
          characterId, conversationId: convoId,
          userMessage: enrichedUserMessage, characterResponse: responseText,
          recentMessages: (recentMsgs || []).slice(-10),
          playAsCharacterId: activeCharacter?.id || null,
        }, characterId, 'memoryExtract').then(res => {
          // Backend returns `newPeopleDetected` (not `new_people`) — must match exactly
          const rawPeople = res?.data?.newPeopleDetected || res?.data?.new_people || [];
          if (rawPeople.length > 0) {
            // ── PRE-FILTER: check against known characters, user aliases, ignore list ──
            // Pull the current character list from React Query cache (no extra API call)
            const cachedChars = queryClient.getQueryData(["characters", currentUser?.email]) || [];
            const userSettings = queryClient.getQueryData(["userSettings", currentUser?.email]) || {};
            const { toShow } = filterDetectedMentions(rawPeople, {
              userSettings,
              existingCharacters: cachedChars,
              character,
            });
            if (toShow.length > 0) {
              setNewPeopleDetected(toShow);
            }
          }
        });
      }

      // syncWorldPhoneMemory requires senderCharacterId + receiverCharacterId + messageContent.
      // In regular Chat, the user is the sender and the character is the receiver — but this
      // bilateral sync is only meaningful when a character contacts ANOTHER character (not the user).
      // The extractMemoriesFromTurn above already handles the target character's memory.
      // This slot is intentionally left as a no-op to avoid the broken wrong-payload call.
      // Bilateral character↔character memory is handled by WorldContactsPopup and simulateCharacterInteraction.
    }, 4000);

    // ── TIER 4 — 7s: relationship levels + achievements + income (120s / 120s / 60s cooldown) ──
    setTimeout(() => {
      if (isGloballyRateLimited()) return;

      if (!isOnCooldown(characterId, 'relationships', 120000)) {
        safeInvoke('updateRelationshipLevels', {
          characterId, conversationId: convoId,
          recentMessages: (recentMsgs || []).slice(-10),
        }, characterId, 'relationships').then(res => {
          if (res?.data?.change_reason) {
            setLastChangeReason(res.data.change_reason);
            queryClient.invalidateQueries({ queryKey: ["character", characterId] });
          }
        });
      }

      if (!isOnCooldown(characterId, 'achievements', 120000)) {
        safeInvoke('checkAchievements', {
          characterId,
          characterName: character?.name || '',
          userMessage: text || '',
          characterState: character ? {
            emotional_state: character.emotional_state,
            personality_summary: character.personality_summary,
          } : {},
        }, characterId, 'achievements').then(res => {
          const revisited = res?.data?.revisited || [];
          if (revisited.length > 0 && onAchievementRevisited) {
            onAchievementRevisited(revisited);
          }
        });
      }

      if (!isOnCooldown(characterId, 'processIncome', 60000)) {
        safeInvoke('processUserIncome', { mode: 'message' }, characterId, 'processIncome');
      }
    }, 7000);

    // ── TIER 5 — 10s: emoji reaction (personality-gated, emotionally-contextual) ──
    // Fires on emotionally meaningful messages/images. NOT random decoration.
    // - High-emotion events: ~40% base chance
    // - Neutral/routine messages: skip entirely
    // - Image messages: evaluated separately via image prompt context
    // - Same emoji spam prevented: checks last 3 character reactions on that message
    // - Cooldown: 45s per character (not 60s — allows reactions to feel less rare)
    setTimeout(() => {
      if (isGloballyRateLimited()) return;
      if (isOnCooldown(characterId, 'emojiReact', 45000)) return;
      if (isInFlight(characterId, 'emojiReact')) return;

      // Determine what to react TO: user's text message or the most recent user image
      const lastUserMsg = userMsg;
      if (!lastUserMsg?.id) return;

      const hasUserImage = !!lastUserMsg.image_url;
      const hasUserText = !!(text?.trim());
      if (!hasUserImage && !hasUserText) return;

      // Personality + emotional traits from character
      const personality = character?.personality_summary?.substring(0, 150) || 'balanced';
      const emotionalState = character?.emotional_state || 'calm';
      const traitFlags = [
        character?.trait_flirty && 'flirtatious',
        character?.trait_dry_humor && 'dry humor',
        character?.trait_empathetic && 'empathetic',
        character?.trait_competitive && 'competitive',
        character?.trait_loyal && 'loyal',
        character?.trait_blunt && 'blunt',
        character?.trait_easily_distracted && 'easily distracted',
      ].filter(Boolean);
      const traitContext = traitFlags.length > 0 ? `Key traits: ${traitFlags.join(', ')}.` : '';

      // Build the message context for the LLM decision
      let msgContext = '';
      if (hasUserImage && lastUserMsg.image_description) {
        msgContext = `The user sent an image. Visual content: "${lastUserMsg.image_description.substring(0, 200)}".`;
      } else if (hasUserImage) {
        const gcPrompt = lastUserMsg.generation_context?.prompt || lastUserMsg.generation_context?.scene_prompt;
        msgContext = gcPrompt
          ? `The user sent an image. Image description: "${gcPrompt.substring(0, 200)}".`
          : `The user sent an image (no description available).`;
      } else {
        msgContext = `The user just sent this message: "${text.substring(0, 200)}".`;
      }

      setInFlight(characterId, 'emojiReact', true);
      base44.integrations.Core.InvokeLLM({
        prompt: `You are ${character?.name}. Personality: ${personality}. ${traitContext} Current mood: ${emotionalState}.

${msgContext}

DECISION: Should you react with an emoji to this message/image?

Rules for reacting:
- YES for: funny, romantic, shocking, sweet, supportive, insulting, scary, emotional, surprising, attractive, suspicious, or dramatic content.
- NO for: routine, neutral, informational, ordinary check-in messages with no emotional weight.
- React based on YOUR personality and relationship with this person.
- If YES: pick exactly ONE emoji from this EXACT list only — do not use any other emoji:
  ❤️ = affection, love, warmth, sweet/supportive moments
  😂 = funny, amusing, playful teasing
  😮 = shocking, surprising, unexpected, disbelief
  😢 = sad, sympathetic, emotional pain, hurt
  😡 = angry, offended, serious disapproval, disrespect
  👍 = agreement, approval, acknowledgment, support
  🔥 = attractive, hype, admiration of appearance/style, impressive
  😍 = romantic admiration, captivated affection, strong attraction
  👎 = disagreement, bad idea, disapproval, rejection
  😒 = annoyance, side-eye, sarcasm, unimpressed, mild irritation
  😭 = overwhelmed emotion, laughing too hard, dramatic reaction, can't handle it
  👀 = curiosity, noticing something, gossip/drama, suspicious or flirty moment
  😱 = fear, alarm, intense shock, disturbing news, threat
  💔 = heartbreak, grief, deep emotional pain, devastating loss
  🥺 = pleading, vulnerable appeal, touched/moved, soft vulnerability
  😊 = gentle happiness, warmth, shy affection, soft approval
  😅 = awkward laugh, nervousness, embarrassment, relieved chuckle
  🤔 = thinking, processing, skepticism, uncertainty, doubt

  Return JSON: { "should_react": true/false, "emoji": "single emoji from the list above or null" }`,
        response_json_schema: {
          type: 'object',
          properties: {
            should_react: { type: 'boolean' },
            emoji: { type: 'string' },
          },
          required: ['should_react'],
        },
      }).then(result => {
        if (!result?.should_react || !result?.emoji) {
          console.log(`[Governor] emojiReact SKIP — character decided no reaction for char=${characterId}`);
          return null;
        }
        // Extract a clean single emoji
        const cleaned = result.emoji.trim()
          .replace(/[\u200D\uFE0F]/g, '')
          .match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u)?.[0]?.substring(0, 2) || '';
        if (!cleaned) return null;

        // Enforce one-per-actor rule: replace any existing character reaction on this message
        const existingReactions = lastUserMsg.reactions || [];
        const nonCharacterReactions = existingReactions.filter(r => !(r.reactor_type === 'character' && r.reactor_id === characterId));
        const alreadySameEmoji = existingReactions.some(r => r.reactor_type === 'character' && r.reactor_id === characterId && r.emoji === cleaned);
        if (alreadySameEmoji) {
          console.log(`[Governor] emojiReact SKIP — identical reaction already applied by this character`);
          return null;
        }

        const updatedReactions = [...nonCharacterReactions, {
          emoji: cleaned,
          reactor_type: 'character',
          reactor_id: characterId,
        }];

        console.log(`[Governor] emojiReact FIRING: ${character?.name} → "${cleaned}" on msg=${lastUserMsg.id.substring(0, 8)} (replaced=${existingReactions.length !== nonCharacterReactions.length})`);
        return base44.entities.Message.update(lastUserMsg.id, {
          reactions: updatedReactions,
        }).catch(err => { console.warn('[Governor] emojiReact Message.update failed:', err?.message); return null; });
      }).then(updated => {
        if (updated?.id) {
          setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, reactions: updated.reactions } : m));
          markCooldown(characterId, 'emojiReact');
          console.log(`[Governor] emojiReact APPLIED — reactions now: ${JSON.stringify(updated.reactions?.slice(-2))}`);
        }
      }).catch(err => {
        const is429 = err?.message?.includes('429') || err?.message?.includes('rate limit');
        if (is429) setRateLimited();
        else console.warn('[Governor] emojiReact failed:', err?.message);
      }).finally(() => {
        setInFlight(characterId, 'emojiReact', false);
      });
    }, 10000);

  }, [queryClient, setNewPeopleDetected, setPendingAliasResolution, setLastChangeReason, setMessages]);

  // Log Chat/Text mount diagnostics — call this on Chat page mount
  const logChatMount = useCallback((characterId, characterName) => {
    const retryState = getChatRetryState();
    const safeModeActive = isChatSafeModeActive();
    const paused = isRetryPaused();
    const optDisabled = areOptionalSystemsDisabled();
    console.log(`[ChatMount] ══════════════════════════════════════════`);
    console.log(`[ChatMount] character_id:      ${characterId}`);
    console.log(`[ChatMount] character_name:    ${characterName}`);
    console.log(`[ChatMount] safe_mode_active:  ${safeModeActive}`);
    console.log(`[ChatMount] retry_level:       ${retryState.level}`);
    console.log(`[ChatMount] paused:            ${paused}`);
    console.log(`[ChatMount] pause_until:       ${paused ? new Date(retryState.pauseUntil).toLocaleTimeString() : 'n/a'}`);
    console.log(`[ChatMount] optional_disabled: ${optDisabled}`);
    console.log(`[ChatMount] ALLOWED:           load_character, load_conversation, load_messages, retrieve_memory, send_message, receive_message`);
    if (safeModeActive || paused) {
      console.log(`[ChatMount] PAUSED:            needs_simulation, travel_logic, location_enforcement, proactive_messages, group_chat, weather, achievements, auto_narratives, relationship_updates, noncritical_presence`);
    } else {
      console.log(`[ChatMount] PAUSED:            none (normal operation)`);
    }
    console.log(`[ChatMount] ══════════════════════════════════════════`);
  }, []);

  // Clear stale cooldowns for a character when switching (called on characterId change)
  const clearCharacterCooldowns = useCallback((characterId) => {
    Object.keys(sessionCooldowns).forEach(key => {
      if (key.startsWith(`${characterId}:`)) delete sessionCooldowns[key];
    });
    Object.keys(inFlight).forEach(key => {
      if (key.startsWith(`${characterId}:`)) delete inFlight[key];
    });
  }, []);

  return { dispatchPostSend, clearCharacterCooldowns, logChatMount };
}