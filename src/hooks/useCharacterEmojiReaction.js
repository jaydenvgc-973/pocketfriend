import { base44 } from "@/api/base44Client";

// ── FREQUENCY GATE ──────────────────────────────────────────────────────────
// Characters do NOT react to every message. Two-layer gate:
//   1. Minimum gap: at least REACTION_MIN_GAP user messages must pass since the
//      character's last emoji reaction before a new one is even considered.
//   2. Probability roll: even after the gap is met, only ~18% chance per message.
// Net result: roughly 1 emoji reaction per 5–10 messages, not every message.
//
// A character's chosen emoji is permanent — they never change it once picked.

const REACTION_MIN_GAP = 5;
const REACTION_PROBABILITY = 0.18;

const counters = {};

/**
 * maybeReactToUserMessage
 *
 * Evaluates whether the character should autonomously react with an emoji to
 * the user's latest message. If the frequency gate passes AND a contextual
 * signal is detected, writes a single emoji reaction to the message.
 *
 * Non-blocking, fire-and-forget — never interrupts the chat flow.
 * Never overwrites an existing character reaction.
 *
 * @param {object} params - { character, characterId, userMsg, text, setMessages }
 */
export function maybeReactToUserMessage({ character, characterId, userMsg, text, setMessages }) {
  try {
    if (!character || !userMsg?.id || !text?.trim()) return;

    // ── Layer 1: Minimum message gap since last reaction ──
    const key = characterId;
    const ctr = counters[key] || { sinceLast: 0 };
    ctr.sinceLast = (ctr.sinceLast || 0) + 1;
    counters[key] = ctr;

    if (ctr.sinceLast < REACTION_MIN_GAP) return;

    // ── Layer 2: Probability roll — ~18% after gap is met ──
    if (Math.random() > REACTION_PROBABILITY) return;

    const content = text.toLowerCase();
    const traits = character.personality_traits || [];
    const traitsStr = traits.join(' ').toLowerCase();
    const personality = (character.personality_summary || '').toLowerCase();
    const emotionalState = (character.emotional_state || 'calm').toLowerCase();

    const hasTrait = (...keys) => keys.some(k => traitsStr.includes(k) || personality.includes(k));

    // Content signal detection
    const isFunny = /\b(lol|lmao|haha|ha ha|funny|hilarious|😂|😭|joke|jokes|jk|kidding|cracked|wild|dead|dying)\b/i.test(text);
    const isSad = /\b(sad|miss|hurt|pain|cry|crying|depressed|upset|heartbr|grief|loss|lost|alone|lonely|devastated)\b/i.test(text);
    const isAffectionate = /\b(love you|love u|miss you|miss u|care about|means a lot|thank you|thanks|appreciate|sweet|beautiful|gorgeous|amazing|wonderful)\b/i.test(text);
    const isSurprising = /\b(omg|oh my|what|wait|no way|seriously|really|wtf|wow|shocked|surprised|unbelievable|can't believe)\b/i.test(text);
    const isAngry = /\b(angry|pissed|furious|hate|disgusted|offensive|disrespect|rude|enough|done with|fed up)\b/i.test(text);
    const isFlirty = /\b(cute|hot|sexy|attractive|fine|gorgeous|beautiful|handsome|crush|feelings for)\b/i.test(text);
    const isAgreement = /\b(exactly|agree|right|true|facts|same|for real|absolutely|definitely|yes|yeah|yep|totally)\b/i.test(text);

    // Build weighted emoji candidates based on content + personality
    const candidates = [];

    if (isFunny) {
      if (hasTrait('playful', 'humor', 'dry_humor', 'funny', 'sarcastic')) candidates.push(...['😂', '😂', '😭']);
      else candidates.push('😂');
    }
    if (isSad && hasTrait('compassionate', 'empathetic', 'sensitive', 'caring')) {
      candidates.push('😢', '❤️');
    }
    if (isAffectionate) {
      if (hasTrait('romantic', 'flirty', 'affectionate')) candidates.push('😍', '❤️', '❤️');
      else candidates.push('❤️');
    }
    if (isSurprising) {
      if (hasTrait('dramatic', 'expressive')) candidates.push('😮', '😮');
      else candidates.push('😮');
    }
    if (isAngry && hasTrait('volatile', 'hot_tempered', 'blunt')) {
      candidates.push('😡');
    }
    if (isFlirty && hasTrait('romantic', 'flirty', 'attracted', 'uninhibited')) {
      candidates.push('🔥', '😍');
    }
    if (isAgreement) {
      candidates.push('👍');
    }
    if (emotionalState === 'joyful' || emotionalState === 'excited') candidates.push('😂', '❤️');
    if (emotionalState === 'sad') candidates.push('😢');
    if (emotionalState === 'irritated' || emotionalState === 'frustrated') candidates.push('😡', '😒');

    if (candidates.length === 0) return;

    const emoji = candidates[Math.floor(Math.random() * candidates.length)];
    if (!emoji) return;

    // Dedup guard — never overwrite an existing character reaction
    const existingReactions = userMsg.reactions || [];
    const alreadyReacted = existingReactions.some(r => r.reactor_type === 'character' && r.reactor_id === characterId);
    if (alreadyReacted) return;

    const updatedReactions = [...existingReactions, { emoji, reactor_type: 'character', reactor_id: characterId }];

    // Reset the gap counter — a reaction was just written
    counters[key] = { sinceLast: 0 };

    base44.entities.Message.update(userMsg.id, { reactions: updatedReactions })
      .then(() => {
        if (setMessages) {
          setMessages(prev => prev.map(m =>
            m.id === userMsg.id ? { ...m, reactions: updatedReactions } : m
          ));
        }
        console.log(`[CharacterReaction] ${character.name} reacted to user msg with ${emoji}`);
      })
      .catch(err => console.warn('[CharacterReaction] reaction write failed (non-blocking):', err?.message));
  } catch (reactionErr) {
    console.warn('[CharacterReaction] reaction evaluation failed (non-blocking):', reactionErr?.message);
  }
}