/**
 * Memory Unity Layer
 * Unified recall system across chat, texting, and location interactions
 * All character interactions create a single continuous memory thread
 */

/**
 * Build unified memory context for a character across all interaction modes
 * Used before generating responses to ensure continuity
 * 
 * @param {Array} messages - All messages in current conversation
 * @param {Array} memories - Character's Memory entities
 * @param {Array} lifeEvents - LifeEvent entities for this character
 * @param {Object} relationshipState - Current RelationshipState for this character
 * @returns {Object} Unified memory context
 */
export function buildUnifiedMemoryContext(messages = [], memories = [], lifeEvents = [], relationshipState = {}) {
  return {
    conversationHistory: extractConversationSummary(messages),
    keyMemories: prioritizeMemories(memories),
    emotionalHistory: extractEmotionalThreads(messages, lifeEvents),
    relationshipStatus: buildRelationshipNarrative(relationshipState),
    significantEvents: extractSignificantMoments(lifeEvents),
  };
}

/**
 * Extract summary of conversation for memory injection
 * Keeps last 5 meaningful exchanges, emotional markers
 */
function extractConversationSummary(messages) {
  if (!messages || messages.length === 0) return null;

  const meaningful = messages.filter(m => 
    m.content && m.content.length > 10 && !m.content.startsWith("[")
  );

  const recent = meaningful.slice(-5).map(m => ({
    role: m.sender_type === 'character' ? 'character' : 'user',
    content: m.content.substring(0, 100),
    emotionalState: m.emotional_state,
    timestamp: m.timestamp,
  }));

  return {
    lastExchanges: recent,
    totalMessages: messages.length,
    conversationTone: inferConversationTone(messages),
    unresolvedTopics: extractUnresolvedTopics(messages),
  };
}

/**
 * Infer overall tone from message patterns
 */
function inferConversationTone(messages) {
  if (messages.length === 0) return 'neutral';
  
  const recent = messages.slice(-10);
  const emotionalStates = recent
    .filter(m => m.emotional_state)
    .map(m => m.emotional_state);
  
  if (emotionalStates.some(s => ['angry', 'frustrated', 'defensive'].includes(s))) return 'tense';
  if (emotionalStates.some(s => ['flirtatious', 'affection', 'love'].includes(s))) return 'intimate';
  if (emotionalStates.some(s => ['joyful', 'excited', 'happiness'].includes(s))) return 'positive';
  if (emotionalStates.some(s => ['sad', 'reflective', 'vulnerable'].includes(s))) return 'reflective';
  return 'neutral';
}

/**
 * Find topics mentioned but not fully resolved
 */
function extractUnresolvedTopics(messages) {
  const topics = [];
  
  // Simple keyword detection for unresolved topics
  const keywords = ['but', 'though', 'however', 'actually', 'wait', 'hmm', 'still', 'never'];
  
  messages.slice(-20).forEach(msg => {
    if (msg.content && keywords.some(k => msg.content.toLowerCase().includes(k))) {
      topics.push({
        snippet: msg.content.substring(0, 80),
        from: msg.sender_type,
      });
    }
  });
  
  return topics;
}

/**
 * Prioritize memories by recency and emotional weight
 */
function prioritizeMemories(memories = []) {
  if (!memories || memories.length === 0) return [];
  
  return memories
    .sort((a, b) => {
      const weightA = getMemoryWeight(a);
      const weightB = getMemoryWeight(b);
      if (weightB !== weightA) return weightB - weightA;
      return new Date(b.timestamp) - new Date(a.timestamp);
    })
    .slice(0, 10)
    .map(m => ({
      title: m.title,
      impact: m.emotional_impact,
      lesson: m.lesson_learned,
      timestamp: m.timestamp,
      sourceContext: m.source_context,
    }));
}

/**
 * Calculate memory weight (recency + emotional impact)
 */
function getMemoryWeight(memory) {
  const impactWeight = {
    'positive': 3,
    'neutral': 1,
    'joyful': 4,
    'negative': 2,
    'sad': 2,
    'stressful': 2,
    'exciting': 3,
  };
  
  const daysSinceMemory = (Date.now() - new Date(memory.timestamp)) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.max(0.5, 1 - (daysSinceMemory / 30)); // Decay over 30 days
  
  return (impactWeight[memory.emotional_impact] || 1) * recencyFactor;
}

/**
 * Extract emotional thread over time
 */
function extractEmotionalThreads(messages = [], lifeEvents = []) {
  const emotionalStates = messages
    .filter(m => m.emotional_state)
    .slice(-15)
    .map(m => ({
      state: m.emotional_state,
      timestamp: m.timestamp,
    }));

  const eventImpacts = lifeEvents
    .filter(e => e.emotional_impact)
    .slice(-5)
    .map(e => ({
      event: e.title,
      impact: e.emotional_impact,
      timestamp: e.timestamp,
    }));

  return {
    currentState: emotionalStates[emotionalStates.length - 1]?.state || 'neutral',
    recentStates: emotionalStates,
    eventImpacts,
    trend: inferEmotionalTrend(emotionalStates),
  };
}

/**
 * Infer if emotional state is improving, declining, or stable
 */
function inferEmotionalTrend(states) {
  if (states.length < 3) return 'unknown';
  
  const positiveStates = ['happy', 'joyful', 'content', 'excited', 'love', 'affection'];
  const negativeStates = ['sad', 'angry', 'frustrated', 'anxious', 'defensive'];
  
  const recent = states.slice(-5);
  const positiveCount = recent.filter(s => positiveStates.includes(s.state)).length;
  const negativeCount = recent.filter(s => negativeStates.includes(s.state)).length;
  
  if (positiveCount > negativeCount) return 'improving';
  if (negativeCount > positiveCount) return 'declining';
  return 'stable';
}

/**
 * Build relationship narrative from scores
 */
function buildRelationshipNarrative(relationshipState = {}) {
  if (!relationshipState || !relationshipState.id) return null;
  
  return {
    label: relationshipState.relationship_label,
    friendship: relationshipState.friendship_score || 50,
    trust: relationshipState.trust_score || 50,
    respect: relationshipState.respect_score || 50,
    romantic: relationshipState.romantic_score || 0,
    attraction: relationshipState.attraction_score || 0,
    family: relationshipState.family_score || 0,
    tension: relationshipState.tension_score || 0,
    lastInteraction: relationshipState.last_interaction_at,
    narrative: generateRelationshipNarrative(relationshipState),
  };
}

/**
 * Generate human-readable relationship summary
 */
function generateRelationshipNarrative(state = {}) {
  const scores = {
    friendship: state.friendship_score || 50,
    trust: state.trust_score || 50,
    respect: state.respect_score || 50,
    romantic: state.romantic_score || 0,
  };

  if (scores.romantic > 70) return 'deeply romantic';
  if (scores.romantic > 50) return 'flirty and interested';
  if (scores.friendship > 80 && scores.trust > 80) return 'close friend';
  if (scores.friendship > 70) return 'good friend';
  if (scores.friendship > 50) return 'friendly';
  if (scores.respect > 70) return 'respected but distant';
  if (scores.tension > 60) return 'complicated';
  return 'acquaintance';
}

/**
 * Extract significant life events affecting the relationship
 */
function extractSignificantMoments(lifeEvents = []) {
  if (!lifeEvents || lifeEvents.length === 0) return [];
  
  return lifeEvents
    .filter(e => ['major', 'significant'].includes(e.severity))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 5)
    .map(e => ({
      title: e.title,
      type: e.event_type,
      valence: e.valence,
      impact: e.emotional_impact,
      timestamp: e.timestamp,
    }));
}

/**
 * Format unified memory for LLM injection
 * Used in system prompts to maintain continuity
 */
export function formatMemoryForLLM(memoryContext, characterName) {
  if (!memoryContext) return '';

  const parts = [];

  // Relationship status
  if (memoryContext.relationshipStatus) {
    const rel = memoryContext.relationshipStatus;
    parts.push(`Your relationship with ${characterName}: ${rel.narrative}`);
    parts.push(`- Trust: ${rel.trust}/100, Respect: ${rel.respect}/100, Friendship: ${rel.friendship}/100`);
  }

  // Recent emotional thread
  if (memoryContext.emotionalHistory?.currentState) {
    const emo = memoryContext.emotionalHistory;
    parts.push(`Current emotional state: ${emo.currentState} (trend: ${emo.trend})`);
  }

  // Conversation tone
  if (memoryContext.conversationHistory?.conversationTone) {
    parts.push(`Recent conversation tone: ${memoryContext.conversationHistory.conversationTone}`);
  }

  // Recent exchanges
  if (memoryContext.conversationHistory?.lastExchanges?.length > 0) {
    parts.push('Recent exchanges:');
    memoryContext.conversationHistory.lastExchanges.forEach(ex => {
      const role = ex.role === 'character' ? characterName : 'User';
      parts.push(`- ${role}: "${ex.content}"`);
    });
  }

  // Key memories
  if (memoryContext.keyMemories?.length > 0) {
    parts.push('Key memories:');
    memoryContext.keyMemories.slice(0, 3).forEach(mem => {
      parts.push(`- ${mem.title} (${mem.impact})`);
    });
  }

  // Significant events
  if (memoryContext.significantEvents?.length > 0) {
    parts.push('Significant moments:');
    memoryContext.significantEvents.slice(0, 2).forEach(evt => {
      parts.push(`- ${evt.title} (${evt.valence})`);
    });
  }

  return parts.join('\n');
}

/**
 * Check if character should reference a past memory
 * Returns relevant memory if significant enough
 */
export function shouldReferenceMemory(memoryContext, randomChance = 0.3) {
  if (!memoryContext || !memoryContext.keyMemories || memoryContext.keyMemories.length === 0) {
    return null;
  }

  if (Math.random() > randomChance) return null;

  // Prioritize emotional memories
  const emotionalMemories = memoryContext.keyMemories.filter(m => 
    ['joyful', 'positive', 'negative', 'sad', 'stressful'].includes(m.impact)
  );

  const pool = emotionalMemories.length > 0 ? emotionalMemories : memoryContext.keyMemories;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Extract location-based memory references
 * When visiting a location, remind character of past interactions there
 */
export function getLocationMemories(memories = [], locationId, locationName) {
  if (!memories || !locationId) return [];

  return memories
    .filter(m => 
      m.source_context && (
        m.source_context.includes(locationId) ||
        m.source_context.includes(locationName)
      )
    )
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 3)
    .map(m => ({
      title: m.title,
      description: m.description,
      impact: m.emotional_impact,
    }));
}