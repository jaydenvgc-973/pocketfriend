/**
 * Scene-specific memory injection
 * Enhances LLM prompts with unified memory context for natural, continuous interactions
 */

import { buildUnifiedMemoryContext, formatMemoryForLLM } from "@/lib/memoryUnity";

/**
 * Build enhanced system prompt for scene interactions
 * Injects memory, relationships, location context, and tone
 */
export function buildSceneSystemPrompt(
  locationName,
  locationCategory,
  characterName,
  characterData = {},
  unifiedMemoryContext = null,
  conversationType = "group" // group | one_on_one | quick | employee
) {
  const parts = [];

  parts.push(`You are ${characterName}, a character in a realistic social roleplay at ${locationName} (${locationCategory}).`);

  // Character identity
  if (characterData.personality_summary) {
    parts.push(`Your personality: ${characterData.personality_summary}`);
  }
  if (characterData.archetype) {
    parts.push(`Character archetype: ${characterData.archetype}`);
  }

  // Current emotional state
  if (characterData.emotional_state) {
    parts.push(`Your current mood: ${characterData.emotional_state}`);
  }

  // Memory context
  if (unifiedMemoryContext) {
    parts.push("\n=== MEMORY & RELATIONSHIP CONTEXT ===");
    parts.push(formatMemoryForLLM(unifiedMemoryContext, "the user"));
  }

  // Conversation type tone guidance
  parts.push("\n=== INTERACTION STYLE ===");
  const toneGuide = {
    group: "You're speaking to a group. Keep responses 1-2 sentences, natural group banter. May reference shared experiences or jest.",
    one_on_one: "You're in a private moment. Can be more vulnerable, honest, or intimate. Responses can be 2-3 sentences.",
    quick: "Brief, surface interaction. 1 sentence max. Professional but friendly.",
    employee: "You're in your role (bartender, server, trainer). Keep it brief and professional. 1-2 sentences.",
  };
  parts.push(toneGuide[conversationType] || toneGuide.group);

  // Important rules
  parts.push("\n=== CRITICAL RULES ===");
  parts.push("- Stay in character. Respond naturally as this person would.");
  parts.push("- Keep responses concise and authentic.");
  parts.push("- If you remember this person from past interactions, reference it naturally.");
  parts.push("- Only respond once. Do NOT generate responses from other characters.");

  return parts.join("\n");
}

/**
 * Inject memory callbacks into NPC dialogue
 * 30% chance NPC mentions a past interaction at this location
 */
export function maybeInjectMemoryCallback(npcResponse, locationMemories = []) {
  if (!locationMemories || locationMemories.length === 0) {
    return npcResponse;
  }

  // 30% chance to naturally weave in a memory
  if (Math.random() > 0.3) {
    return npcResponse;
  }

  const memory = locationMemories[Math.floor(Math.random() * locationMemories.length)];
  if (!memory) return npcResponse;

  // Append memory reference naturally
  const recalls = [
    ` Oh, like that time you were here and ${memory.description.toLowerCase().substring(0, 60)}...`,
    ` Reminds me of when you came in and ${memory.description.toLowerCase().substring(0, 60)}...`,
    ` You know, the last time you were here, ${memory.description.toLowerCase().substring(0, 60)}...`,
  ];

  const callback = recalls[Math.floor(Math.random() * recalls.length)];
  return npcResponse + callback;
}

/**
 * Build relationship-aware NPC intro
 * If character hasn't met this NPC, introduce them
 * If they have, reference the relationship
 */
export function buildNPCIntroContext(npcName, relationshipState = null, firstMeeting = false) {
  if (firstMeeting) {
    return `This is your first interaction with ${npcName}.`;
  }

  if (!relationshipState) {
    return `${npcName} is someone you know from here.`;
  }

  const { friendship_score = 50, trust_score = 50, romantic_score = 0 } = relationshipState;

  if (romantic_score > 60) {
    return `${npcName} is someone you're romantically interested in.`;
  }
  if (friendship_score > 75) {
    return `${npcName} is a close friend.`;
  }
  if (friendship_score > 50) {
    return `${npcName} is a friendly acquaintance.`;
  }
  if (trust_score < 40) {
    return `${npcName} is someone you're cautious around.`;
  }

  return `${npcName} is someone you know casually.`;
}

/**
 * Validate conversation continuity
 * Ensures NPC responses reference the right conversation type context
 */
export function validateConversationContinuity(response, conversationType, groupSize) {
  // If one-on-one, should not reference "the group" or "everyone"
  if (conversationType === "one_on_one") {
    if (response.includes("we all") || response.includes("everyone here")) {
      return false; // Invalid for private conversation
    }
  }

  // If group, can reference shared context
  if (conversationType === "group" && groupSize < 2) {
    return false; // Need at least 2 people for group conversation
  }

  return true;
}