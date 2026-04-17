// Centralized prompt building for chat messages
// Reduces Chat.jsx file size and improves maintainability

export function buildChatSystemPrompt({
  systemPrompt,
  educationContext,
  songsContext,
  memoryContext,
  lifeEventContext,
  researchContext,
  weatherContext,
  recentEventsContext,
  culturalContext,
  timeContext,
  needsContext,
  modeInstruction,
  statusContext,
  sleepContext,
  awarenessContext,
  selfLocationContext,
  spatialContext,
  playAsInstruction,
  evidenceInstruction,
  toneContext,
  lengthInstruction,
  intensityInstruction,
  chatHistory,
  characterName,
  imageRule,
}) {
  const conversationLog = chatHistory.map(m => `${m._speakerName}: ${m.content}`).join("\n");

  return `${systemPrompt}${educationContext}${songsContext}${memoryContext}${lifeEventContext}${researchContext}${weatherContext}${recentEventsContext}${culturalContext}${timeContext}${needsContext}${modeInstruction}${statusContext}${sleepContext}${awarenessContext}${selfLocationContext}${spatialContext}${playAsInstruction}${evidenceInstruction}${toneContext}\n\n${lengthInstruction}\n${intensityInstruction}\n\nConversation so far:\n${conversationLog}\n\nWrite your next reply as ${characterName}. Do NOT start with your name or any label. Do NOT wrap up with a lesson or conclusion. Just say what you'd actually say — short, unpolished, real.\n- Do NOT end with a question every time. Real conversations aren't interrogations. Sometimes make a statement, vent something, or share what's on your mind and stop.\n- You have your own life. Bring it up naturally when it fits — something that happened at work, something on your mind, something you felt. You are not just asking about the user.\n- Do NOT reference or assume anything about the user's family unless they have told you directly in this conversation.\n- CRITICAL: Never repeat stories, anecdotes, or personal information you've already shared in this conversation. Check the conversation history carefully — if you've mentioned something before, do not bring it up again.\n- CULTURAL AWARENESS: When the user references celebrities, TV shows, music, entertainment, or cultural topics, you recognize them as real and familiar. You respond naturally without confusion or over-explanation.\n\nRespond ONLY with valid JSON in this exact format:\n{\n  "message_type": "text_only" | "image_only" | "text_then_image" | "image_then_text",\n  "text_content": "The visible character dialogue — ONLY include if message_type includes text. Never put image prompts here.",\n  "image_generation_prompt": "INTERNAL ONLY — vivid image description for generation. Never shown to user. Only include if message_type includes image.",\n  "image_generation_prompts": ["For multiple images only — array of internal image prompts"],\n  "scheduled_events": [\n    {\n      "description": "What will happen",\n      "trigger_time": "<ISO 8601 UTC datetime>"\n    }\n  ]\n}\nOnly include scheduled_events if a specific real-world action with a concrete time is committed to. Omit fields you don't use.\n\n${imageRule}`;
}