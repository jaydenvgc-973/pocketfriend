/**
 * CHARACTER REACTION ENGINE
 * 
 * Determines if a character should react to a message and which reaction to use.
 * Based on emotion triggers, not artificial quotas.
 */

import { REACTION_DEFINITIONS, PERSONALITY_REACTIONS, REACTION_TRIGGERS } from "@/lib/reactionDefinitions";

/**
 * Calculate reaction trigger strength based on message content and context
 */
function calculateTriggerStrength(message, character, relationshipLevel, currentMood) {
  let strength = 0; // 0-1 scale

  // Emotional content analysis
  if (message.content) {
    const content = message.content.toLowerCase();

    // Humor triggers
    if (content.includes("😂") || content.includes("haha") || content.includes("lol")) {
      strength += 0.3; // humor present
    }

    // Affection triggers
    if (content.includes("love") || content.includes("adore") || content.includes("❤️")) {
      strength += 0.4; // affection present
    }

    // Sadness triggers
    if (content.includes("sad") || content.includes("hurt") || content.includes("😢")) {
      strength += 0.4; // sadness present
    }

    // Anger triggers
    if (content.includes("angry") || content.includes("furious") || content.includes("😡")) {
      strength += 0.3; // anger present
    }

    // Surprise/drama triggers
    if (content.includes("!") || content.includes("what?") || content.includes("really")) {
      strength += 0.2; // surprise element
    }

    // Curiosity/gossip triggers
    if (content.includes("did you hear") || content.includes("did you see")) {
      strength += 0.2; // curiosity trigger
    }
  }

  // Image content gets boosted trigger strength
  if (message.image_url) {
    // Attractive/selfie images
    if (message.is_selfie || message.is_attractive) {
      strength += 0.5; // strong visual trigger
    } else if (message.is_funny_image) {
      strength += 0.3;
    }
  }

  // Relationship level affects sensitivity
  strength *= (0.5 + relationshipLevel); // 0.5 to 1.5 multiplier

  // Character mood affects reactivity
  if (currentMood === "happy" || currentMood === "excited") {
    strength *= 1.2; // more reactive when happy
  } else if (currentMood === "sad" || currentMood === "depressed") {
    strength *= 0.6; // less reactive when sad
  } else if (currentMood === "angry") {
    strength *= 1.1; // slightly more reactive to anger triggers
  }

  return Math.min(strength, 1); // cap at 1.0
}

/**
 * Determine if character should react based on emotional trigger strength
 */
function shouldCharacterReact(triggerStrength) {
  // Emotion-triggered, not quota-triggered
  // No artificial "once every X messages" rules
  
  if (triggerStrength < 0.3) {
    return false; // weak/no emotional response
  } else if (triggerStrength < 0.5) {
    return Math.random() < 0.3; // weak emotion, 30% chance
  } else if (triggerStrength < 0.7) {
    return Math.random() < 0.6; // medium emotion, 60% chance
  } else {
    return true; // strong emotion, should react
  }
}

/**
 * Select appropriate reaction emoji based on trigger content and character personality
 */
function selectReactionEmoji(message, character, triggerType) {
  const characterTraits = character.personality_traits || [];
  const availableReactions = [];

  // Determine which emotions the content triggers
  switch (triggerType) {
    case "humor":
      availableReactions.push("😂", "😭"); // humor: laugh or laugh-cry
      if (character.trait_sarcastic) availableReactions.push("😒");
      break;

    case "affection":
      availableReactions.push("❤️");
      if (character.romantic_level > 50 || character.attraction_level > 50) {
        availableReactions.push("😍");
      }
      break;

    case "sadness":
      availableReactions.push("😢");
      if (character.trait_compassionate) availableReactions.push("❤️");
      break;

    case "anger":
      availableReactions.push("😡");
      break;

    case "surprise":
      availableReactions.push("😮");
      if (character.trait_dramatic) availableReactions.push("😭");
      break;

    case "curiosity":
      availableReactions.push("👀");
      if (character.trait_easily_distracted) availableReactions.push("😮");
      break;

    case "attraction":
      availableReactions.push("🔥", "😍");
      if (message.image_url && character.attraction_level > 60) {
        availableReactions.push("👀");
      }
      break;

    case "approval":
      availableReactions.push("👍");
      if (character.friendship_level > 60) availableReactions.push("❤️");
      break;

    case "disapproval":
      availableReactions.push("👎");
      if (character.trait_sarcastic) availableReactions.push("😒");
      break;

    case "annoyance":
      availableReactions.push("😒");
      break;

    default:
      availableReactions.push("👍"); // safe fallback
  }

  // Filter by personality preferences
  const personalityReactions = new Set();
  characterTraits.forEach((trait) => {
    const reactions = PERSONALITY_REACTIONS[trait] || [];
    reactions.forEach(r => personalityReactions.add(r));
  });

  // Prefer reactions that match personality
  const preferredReactions = availableReactions.filter(r => personalityReactions.has(r));
  const selectedReactions = preferredReactions.length > 0 ? preferredReactions : availableReactions;

  // Random selection from options
  return selectedReactions[Math.floor(Math.random() * selectedReactions.length)];
}

/**
 * Determine trigger type from message content and image
 */
function analyzeTriggerType(message, character) {
  if (message.is_selfie || message.is_attractive) {
    return "attraction";
  }

  const content = message.content?.toLowerCase() || "";

  if (content.includes("❤️") || content.includes("love") || content.includes("adore")) {
    return "affection";
  }
  if (content.includes("😂") || content.includes("haha") || content.includes("lol") || message.is_funny_image) {
    return "humor";
  }
  if (content.includes("😢") || content.includes("sad") || content.includes("hurt")) {
    return "sadness";
  }
  if (content.includes("😡") || content.includes("angry") || content.includes("hate")) {
    return "anger";
  }
  if (content.includes("!") || content.includes("what?") || content.includes("really?")) {
    return "surprise";
  }
  if (content.includes("did you") || content.includes("did you hear")) {
    return "curiosity";
  }
  if (content.includes("agree") || content.includes("yes") || content.includes("okay")) {
    return "approval";
  }
  if (content.includes("disagree") || content.includes("no way") || content.includes("bad idea")) {
    return "disapproval";
  }
  if (content.includes("ugh") || content.includes("sigh") || content.includes("seriously")) {
    return "annoyance";
  }

  return null;
}

/**
 * Main function: Decide if character should react and which emoji to use
 */
export function decideCharacterReaction(
  message,
  character,
  relationshipLevel = 0.5,
  currentMood = "neutral",
  existingCharacterReaction = null
) {
  // Don't overwrite existing reaction unless it's a different trigger
  if (existingCharacterReaction) {
    return null;
  }

  // Don't react to character's own messages
  if (message.sender_type === "character" && message.character_id === character.id) {
    return null;
  }

  // Don't react if character hasn't seen the message
  if (!message.read_by_characters?.includes(character.id)) {
    return null;
  }

  // Don't react if character is asleep/unavailable
  if (character.resolved_presence_status === "sleeping" || 
      character.resolved_presence_status === "napping" ||
      character.is_jailed ||
      character.house_arrest_active) {
    return null;
  }

  // Calculate emotional trigger strength
  const triggerStrength = calculateTriggerStrength(message, character, relationshipLevel, currentMood);

  // Decide if character should react based on emotion strength
  if (!shouldCharacterReact(triggerStrength)) {
    return null;
  }

  // Analyze what triggered the reaction
  const triggerType = analyzeTriggerType(message, character);
  if (!triggerType) {
    return null; // no clear emotional trigger
  }

  // Select appropriate emoji based on trigger and personality
  const emoji = selectReactionEmoji(message, character, triggerType);

  return emoji; // Return emoji or null
}

/**
 * Batch decision: For multiple messages, which ones should character react to?
 * Respects natural frequency (not artificial quotas)
 */
export function decideCharacterReactionsForConversation(
  messages,
  character,
  relationshipLevel = 0.5,
  currentMood = "neutral"
) {
  const reactions = {};

  messages.forEach((msg) => {
    const existingCharacterReaction = msg.reactions?.find(r => r.reactor_type === "character");
    const emoji = decideCharacterReaction(msg, character, relationshipLevel, currentMood, existingCharacterReaction);

    if (emoji) {
      reactions[msg.id] = emoji;
    }
  });

  return reactions;
}