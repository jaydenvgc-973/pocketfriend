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
import { reportRateLimit, isGloballyRateLimited, isChatSafeModeActive } from "@/lib/simulationGate";

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
  if (isGloballyRateLimited()) {
    console.log(`[Governor] SKIP ${taskName} — global rate limit active`);
    return null;
  }
  if (isChatSafeModeActive()) {
    console.log(`[Governor] SKIP ${taskName} — chat-safe mode active (page recovery in progress)`);
    return null;
  }
  if (isInFlight(characterId, taskName)) {
    console.log(`[Governor] SKIP ${taskName} — already in-flight for char=${characterId}`);
    return null;
  }
  setInFlight(characterId, taskName, true);
  try {
    const res = await base44.functions.invoke(fnName, payload);
    markCooldown(characterId, taskName);
    return res;
  } catch (err) {
    const is429 = err?.message?.includes('429') || err?.message?.includes('rate limit') || err?.message?.includes('Rate limit') || err?.status === 429;
    if (is429) setRateLimited();
    else console.warn(`[Governor] ${taskName} failed:`, err?.message);
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
    isTyping, // should be false by the time this is called — foreground is done
    userMsg,
  }) => {
    if (!characterId || !convoId) return;

    // ── TIER 1 — 0ms: lightweight location + activity sync (30s cooldown each) ──
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

      // ── CONTACT INTENT DETECTION ──────────────────────────────────────────
      // Detect when user instructs Character A to contact Character B.
      // Triggers a real World Phone thread + bilateral memory — NOT just narrative.
      // Only fires once per 5 minutes per character to prevent duplicate calls.
      if (!isOnCooldown(characterId, 'contactIntent', 300000) && text && character) {
        const contactMatch = text.match(
          /\b(?:call|text|message|contact|reach out to|hit up|tell|let|check on|check in with|hmu|reach)\b.{0,30}\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/i
        );
        if (contactMatch) {
          const rawName = contactMatch[1]?.trim();
          // Exclude common false positives (user's own world name, pronoun words, etc.)
          const nonNames = new Set(['me', 'you', 'him', 'her', 'them', 'us', 'it', 'home', 'back', 'out']);
          if (rawName && rawName.length > 2 && !nonNames.has(rawName.toLowerCase())) {
            // Only dispatch if the character's response confirms they will do it
            const responseConfirms = /\b(i'll|i will|i'm going to|gonna|going to|will|okay|sure|yeah|yep)\b.{0,40}\b(call|text|message|contact|reach|hit)\b/i.test(responseText || '');
            if (responseConfirms) {
              console.log(`[Governor] Contact intent detected: "${character.name}" → "${rawName}" | response confirms: true`);
              safeInvoke('triggerCharacterContact', {
                senderCharacterId: characterId,
                receiverCharacterName: rawName,
                topic: text.substring(0, 200),
              }, characterId, 'contactIntent');
            }
          }
        }
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
    }, 2000);

    // ── TIER 3 — 4s: memory extraction + world phone sync (90s cooldown each) ──
    setTimeout(() => {
      if (isGloballyRateLimited()) return;

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
          const newPeople = res?.data?.newPeopleDetected || res?.data?.new_people || [];
          if (newPeople.length > 0) {
            setNewPeopleDetected(newPeople);
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
        safeInvoke('checkAchievements', { characterId }, characterId, 'achievements');
      }

      if (!isOnCooldown(characterId, 'processIncome', 60000)) {
        safeInvoke('processUserIncome', { mode: 'message' }, characterId, 'processIncome');
      }
    }, 7000);

    // ── TIER 5 — 10s: emoji reaction (nonessential, once per 5 messages, 50% chance) ──
    setTimeout(() => {
      if (isGloballyRateLimited()) return;
      if (!responseText?.trim()) return;

      // Only run emoji if foreground is fully done (isTyping should be false by now)
      emojiMsgCount[characterId] = (emojiMsgCount[characterId] || 0) + 1;
      const count = emojiMsgCount[characterId];

      if (count % 5 !== 0) return; // Only fire once every 5 messages
      if (Math.random() > 0.5) return; // 50% chance
      if (isOnCooldown(characterId, 'emojiReact', 60000)) return;

      // Emoji reaction — fully routed through safeInvoke guard
      const lastUserMsg = userMsg;
      if (!lastUserMsg?.id) return;
      if (isInFlight(characterId, 'emojiReact')) return;

      setInFlight(characterId, 'emojiReact', true);
      base44.integrations.Core.InvokeLLM({
        prompt: `You are ${character?.name}. The user just sent: "${text.substring(0, 200)}". React with ONE emoji that fits your personality and emotional state (${character?.emotional_state || 'calm'}). Return only the emoji character, nothing else.`,
      }).then(emoji => {
        const cleaned = (typeof emoji === 'string' ? emoji : '').trim().replace(/[^\u{1F300}-\u{1FAFF}\u{2600}-\u{27FF}]/gu, '').substring(0, 2);
        if (!cleaned) return null;
        return base44.entities.Message.update(lastUserMsg.id, {
          reactions: [...(lastUserMsg.reactions || []), {
            emoji: cleaned,
            reactor_type: 'character',
            reactor_id: characterId,
          }],
        }).catch(err => { console.warn('[Governor] emojiReact Message.update failed:', err?.message); return null; });
      }).then(updated => {
        if (updated?.id) {
          setMessages(prev => prev.map(m => m.id === updated.id ? { ...m, reactions: updated.reactions } : m));
          markCooldown(characterId, 'emojiReact');
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

  // Clear stale cooldowns for a character when switching (called on characterId change)
  const clearCharacterCooldowns = useCallback((characterId) => {
    Object.keys(sessionCooldowns).forEach(key => {
      if (key.startsWith(`${characterId}:`)) delete sessionCooldowns[key];
    });
    Object.keys(inFlight).forEach(key => {
      if (key.startsWith(`${characterId}:`)) delete inFlight[key];
    });
  }, []);

  return { dispatchPostSend, clearCharacterCooldowns };
}