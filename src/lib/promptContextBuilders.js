/**
 * promptContextBuilders.js
 *
 * Pure functions that build LLM prompt context strings from character/user data.
 * Extracted from pages/Chat sendMessage to reduce page size.
 * No React state or hooks — all inputs are plain data.
 */

import { callLLMWithRetry } from "@/lib/llmUtils";
import { isGloballyRateLimited } from "@/lib/simulationGate";
import { extractUrlsFromText, analyzeSharedLinkForCharacter, messageContainsLink } from "@/lib/analyzeLinkForCharacterContext";

// ── EDUCATION & TRAINING CONTEXT ─────────────────────────────────────────────

/**
 * Builds an education/training context block for LLM injection.
 * @param {object} character - Full character object
 * @returns {string}
 */
export function buildEducationContext(character) {
  let educationContext = "";

  if (character.current_education_activity && character.current_education_activity !== "none") {
    const completionDate = new Date(character.education_expected_completion_date);
    const daysLeft = Math.ceil((completionDate - new Date()) / (1000 * 60 * 60 * 24));
    const courseName = character.education_details?.course_name || character.current_education_activity;
    const institution = character.education_details?.institution;
    educationContext = `\n\nCURRENT EDUCATION ENROLLMENT: You are currently enrolled in "${courseName}"${institution ? ` at ${institution}` : ""}. ${!isNaN(daysLeft) && daysLeft > 0 ? `You'll be done in about ${daysLeft} days.` : ""} You are aware of your coursework, assignments, and what you're learning. Mention it naturally when relevant — e.g. if asked about your schedule, plans, or something related to the subject matter.`;
  }

  if (character.current_job_training_activity && character.current_job_training_activity !== "none") {
    const trainingName = character.job_training_details?.training_name || character.current_job_training_activity;
    const company = character.job_training_details?.company;
    const position = character.job_training_details?.position_title;
    const trainingCompletion = new Date(character.job_training_expected_completion_date);
    const trainingDaysLeft = Math.ceil((trainingCompletion - new Date()) / (1000 * 60 * 60 * 24));
    educationContext += `\n\nCURRENT JOB TRAINING: You are currently undergoing job training: "${trainingName}"${company ? ` at ${company}` : ""}${position ? ` for the role of ${position}` : ""}. ${!isNaN(trainingDaysLeft) && trainingDaysLeft > 0 ? `Training wraps up in about ${trainingDaysLeft} days.` : ""} You are aware of this training, what it involves, and how it relates to your career. Reference it naturally when relevant.`;
  }

  if (character.completed_education && character.completed_education.length > 0) {
    const completedList = character.completed_education.map(edu => `${edu.course_name}${edu.institution ? ` (${edu.institution})` : ""}`).join(", ");
    educationContext += `\n\nCOMPLETED EDUCATION: You have completed: ${completedList}. You have real knowledge and experience from these courses. When relevant, you can discuss what you learned and apply that knowledge naturally to conversations.`;
  }

  if (character.completed_job_training && character.completed_job_training.length > 0) {
    const completedTrainingList = character.completed_job_training.map(t => `${t.training_name}${t.company ? ` (${t.company})` : ""}`).join(", ");
    educationContext += `\n\nCOMPLETED JOB TRAINING: You have completed the following training programs: ${completedTrainingList}. This has shaped your skills and professional background.`;
  }

  return educationContext;
}

// ── SONGS / MEDIA CONTEXT ─────────────────────────────────────────────────────

/**
 * Builds a songs/media context block for LLM injection.
 * @param {object} character - Full character object
 * @returns {string}
 */
export function buildSongsContext(character) {
  if (!character.songs_heard || character.songs_heard.length === 0) return "";

  const songsInfo = character.songs_heard.map(song => {
    let info = `ALBUM/PLAYLIST TITLE: "${song.title}" by ${song.artist}`;
    if (song.tracks && Array.isArray(song.tracks) && song.tracks.length > 0) {
      const trackList = song.tracks.map(t => `${t.name}${t.artist ? ` (${t.artist})` : ''}`).join(' | ');
      info += ` | ACTUAL TRACKS ON IT: ${trackList}`;
    } else {
      info += ` | (track list not available)`;
    }
    if (song._understanding) {
      const u = song._understanding;
      info += `\n  MOOD & FEEL: ${u.overallMood?.join(', ') || 'unanalyzed'} | Energy: ${u.energyProfile}`;
      if (u.themes?.length > 0) info += `\n  THEMES: ${u.themes.join(', ')}`;
      if (u.narrativeSummary) info += `\n  ANALYSIS: ${u.narrativeSummary}`;
    }
    if (song._deepResearch) {
      const d = song._deepResearch;
      if (d.artistContext?.background) info += `\n  ARTIST CONTEXT: ${d.artistContext.background.substring(0, 200)}...`;
      if (d.trackInsights?.length > 0) {
        const topTracks = d.trackInsights.slice(0, 3).map(t => `"${t.trackName}": ${t.analysis?.substring(0, 80) || 'no details'}...`).join(' | ');
        info += `\n  TRACK INSIGHTS: ${topTracks}`;
      }
      if (d.contextualArticles?.length > 0) info += `\n  CONTEXT: ${d.contextualArticles[0].summary?.substring(0, 150)}...`;
    }
    if (song._characterKnowledge) {
      const k = song._characterKnowledge;
      if (k.personalResonance?.likelyInterpretation) info += `\n  YOUR TAKE: ${k.personalResonance.likelyInterpretation}`;
      if (k.conversationHooks?.directReferences?.length > 0) info += `\n  YOU CAN REFERENCE: ${k.conversationHooks.directReferences.map(r => r.theme).join(', ')}`;
    }
    return info;
  }).join('\n\n---\n\n');

  return `\n\nMUSIC SHARED WITH YOU: Multi-layer understanding has been built for these songs/albums:\nCRITICAL RULES:\n1. Use the ACTUAL TRACKS list (not made-up songs)\n2. Reference the MOOD & FEEL, THEMES, and TRACK INSIGHTS provided\n3. Use ARTIST CONTEXT and TRACK INSIGHTS to inform your interpretation\n4. Draw on YOUR TAKE section for how this connects to you emotionally\n5. You can now discuss the music as though you understand it deeply — because you do.\n6. NEVER pretend to know info not listed. If it's there, use it. If not, say you haven't heard those details.\n\n${songsInfo}`;
}

// ── WEATHER / NEWS / CULTURE CONTEXT ─────────────────────────────────────────

const weatherKeywordsRe = /\b(weather|rain|raining|sunny|cold|hot|warm|freezing|snow|snowing|storm|cloudy|outside|outdoors|going out|what's it like|nice out|bad out|degrees|temperature|humid|windy|fog|foggy)\b/i;
const outdoorPlanKeywordsRe = /\b(going out|heading out|outside|outdoor|park|walk|run|hike|beach|drive|trip|picnic|bbq|barbecue)\b/i;
const newsKeywordsRe = /\b(news|heard about|did you see|what's going on|what happened|current events|trending|politics|election|sports|game|match|celebrity|scandal|viral|social media|twitter|tiktok|instagram)\b/i;
const culturalKeywordsRe = /\b(show|shows|watch|watching|netflix|hulu|disney|prime|streaming|movie|film|music|song|artist|singer|actor|actress|celebrity|famous|viral|tiktok|youtube|podcast|album|concert|tour|coachella|grammy|oscar|emmy|celebrity|star|band|rapper|actor|influencer|meme|trend|trending|cardi|taylor|drake|beyonce|kanye|rihanna|dua|weekend|post|malone|billie|ariana|this is us|stranger|breaking bad|game of thrones)\b/i;

/**
 * Fetches weather, news, and cultural context strings if message keywords trigger them.
 * Returns { weatherContext, recentEventsContext, culturalContext }
 * @param {string} text - User message
 * @param {object} character - Full character object
 * @param {object[]} recentMsgs - Recent message array
 * @returns {Promise<{ weatherContext: string, recentEventsContext: string, culturalContext: string }>}
 */
export async function buildDynamicContexts(text, character, recentMsgs) {
  let weatherContext = "";
  let recentEventsContext = "";
  let culturalContext = "";

  // RATE LIMIT GUARD: skip all optional internet-fetch LLM calls when globally rate limited.
  // These are non-essential context enrichers — the response must proceed without them.
  if (isGloballyRateLimited()) {
    console.log('[buildDynamicContexts] SKIP all dynamic contexts — global rate limit active');
    return { weatherContext, recentEventsContext, culturalContext };
  }

  const userMentionsWeather = weatherKeywordsRe.test(text) || outdoorPlanKeywordsRe.test(text);

  if (userMentionsWeather && (character.city || character.state)) {
    const recentWeatherMention = recentMsgs.slice(-16).some(m =>
      m.sender_type === "character" && weatherKeywordsRe.test(m.content || "")
    );
    if (!recentWeatherMention) {
      if (character.weather_summary) {
        weatherContext = `\n\nCURRENT WEATHER (for ${[character.city, character.state].filter(Boolean).join(", ")}): ${character.weather_summary}. You are aware of this. ONLY reference it if the user directly asked about weather or is making outdoor plans — do NOT volunteer it into unrelated topics.`;
      } else if (weatherKeywordsRe.test(text)) {
        try {
          const weatherRes = await callLLMWithRetry(`What is the current weather right now in ${[character.city, character.state].filter(Boolean).join(", ")}? Include temperature and conditions briefly.`, 'gemini_3_flash', 1, true);
          weatherContext = `\n\nCURRENT WEATHER: ${weatherRes}. Reference this ONLY because the user asked about it.`;
        } catch { /* silent — non-blocking */ }
      }
    }
  }

  if (newsKeywordsRe.test(text)) {
    try {
      const eventsRes = await callLLMWithRetry(`What are the top 2-3 most relevant recent news events, cultural moments, or trending topics happening right now (current date: ${new Date().toLocaleDateString()})? Focus on general interest stories that a typical person might naturally bring up in casual conversation. Include brief details about each.`, 'gemini_3_flash', 1, true);
      recentEventsContext = `\n\nRECENT EVENTS: Here are current events happening now: ${eventsRes}. You can naturally reference these if they fit the conversation, but don't force it. Only mention them if they genuinely relate to what you're discussing.`;
    } catch { /* silent — non-blocking */ }
  }

  if (culturalKeywordsRe.test(text) || culturalKeywordsRe.test(recentMsgs.slice(-3).map(m => m.content).join(" "))) {
    try {
      const culturalRes = await callLLMWithRetry(`What are currently trending in entertainment and culture right now (current date: ${new Date().toLocaleDateString()})? Include: popular TV shows, streaming content, music releases or artists, celebrities making headlines, viral trends. Keep it to what a socially aware person would naturally know. Be concise.`, 'gemini_3_flash', 1, true);
      culturalContext = `\n\nCULTURAL AWARENESS: Current entertainment & culture trends: ${culturalRes}. You're aware of these topics and can discuss them naturally if they come up. Recognize references to celebrities, shows, and music without confusion.`;
    } catch { /* silent — non-blocking */ }
  }

  return { weatherContext, recentEventsContext, culturalContext };
}

// ── IMAGE RULE BUILDER ────────────────────────────────────────────────────────

/**
 * Builds the image generation rules/instructions string for the LLM prompt.
 * @param {object} params
 * @returns {string}
 */
export function buildImageRule({
  allowImageThisTurn,
  isPhotogenic,
  explicitImageRequest,
  requestedQuantity,
  userNameForPrompts,
  lastImagePromptSnippet,
}) {
  if (!allowImageThisTurn) {
    return explicitImageRequest && !isPhotogenic
      ? `MESSAGE TYPE RULES: The user asked for a photo but you've already sent several recently. Politely acknowledge you're not available to send one right now, and use message_type "text_only".`
      : `MESSAGE TYPE RULES: You MUST use message_type "text_only" this turn. Do NOT include any image fields. Images are rate-limited and you have sent enough recently.`;
  }

  const imageCountInstruction = requestedQuantity > 1
    ? `The user asked for ${requestedQuantity} images. Provide exactly ${requestedQuantity} entries in "image_generation_prompts" array.`
    : "";

  return `MESSAGE TYPE RULES — read carefully:
You MUST choose exactly ONE of these message_type values:
- "text_only" → send only a text message. No image. DEFAULT when no image is needed.
- "image_only" → send ONLY an image, no visible text. Use when the user explicitly asked for a photo and no text reply is needed.
- "text_then_image" → send text first, then a separate image. Use when both are appropriate.
- "image_then_text" → send image first, then a separate text reply.

${isPhotogenic && explicitImageRequest
  ? `PHOTOGENIC TRAIT — EXPLICIT REQUEST: The user has asked for a photo. You LOVE being photographed and you ALWAYS say yes immediately — no hesitation, no excuses, no deflecting. You are always ready. Pick image_only or text_then_image (your choice), but you MUST include an image. Never refuse or delay.`
  : isPhotogenic
  ? `PHOTOGENIC TRAIT: You love sharing photos of yourself and your life spontaneously. Sending images feels natural and easy for you — text_then_image or image_only are your go-to formats. You're always camera-ready.`
  : `IMPORTANT: text_only is the DEFAULT. Only send an image if it truly fits the moment.`}
${imageCountInstruction}

IMAGE SUBJECT RULES (for image_generation_prompt / image_generation_prompts):
- "Send me a pic of me / myself" → subject is the USER. Start prompt with "[USER]".
- "Send me a pic of you / yourself" → subject is YOU. Start prompt with "[CHARACTER]".
- "Send me a pic of us / together" → subject is BOTH. Start prompt with "[JOINT]".
- Default (no explicit subject): "[CHARACTER]".
- image_generation_prompt is INTERNAL ONLY — it is never shown to the user.
${userNameForPrompts ? `- WORLD NAME RULE: When referencing the person you're talking to in an image prompt (e.g. for [USER] or [JOINT] shots), always use their name "${userNameForPrompts}" — NEVER write "the user" or "user" in any image prompt.\n- CRITICAL: If the user's name "${userNameForPrompts}" appears in the prompt as a subject of the photo, start the image prompt with "[USER]" — NOT "[CHARACTER]".` : `- WORLD NAME RULE: You don't know their name yet. For [USER] or [JOINT] shots, describe them by appearance only — NEVER write "the user" or "user".`}

3D ROOM SPATIAL RULE — MANDATORY:
The room is a 3D space. Treat it as one. Every image prompt must include: (1) character action/pose, (2) explicit camera position inside the room, (3) camera distance. Use the room reference images to understand the space — do NOT copy their angle. Move the camera: doorway looking in | corner wide shot | beside furniture | across the room | low angle | overhead | over-the-shoulder | near window looking toward character.
BEDROOM RULE: bedroom is NOT always "lying in bed close-up". Sleeping: wide doorway view, character under covers from across the room, side view at distance. Awake: sitting on bed edge | by the window | standing near dresser | on the floor | folding clothes.
${lastImagePromptSnippet ? `ANTI-REPETITION — last image used: "${lastImagePromptSnippet.substring(0, 120)}..." — use a DIFFERENT camera position, distance, and pose.` : `ANTI-REPETITION: vary camera, distance, and pose every time.`}
FORMAT: [CHARACTER] [action]. Camera [position]. [Wide/Medium/Close]. [Time-of-day lighting]. [Zone — 1-2 furniture anchors]."`;
}

// ── SOAP OPERA LIFE CONTEXT BUILDER ──────────────────────────────────────────

/**
 * buildSoapOperaLifeContext
 *
 * Builds a rich, emotionally layered life-context block from existing character data.
 * Injects off-screen life, active personal threads, relationship tension, world pressures,
 * and private emotional state into the LLM system prompt — without adding new entities.
 *
 * Sources used (all existing fields):
 *   character.memories, character.quirks, character.personality_traits, character.archetype,
 *   character.current_life_event, character.emotional_state, character.family_members,
 *   character.fictional_relationships, character.occupation, character.housing_context,
 *   character.is_homeless, character.health_status, character.current_situation,
 *   character.financial need fields, character.religion, character.criminal_record,
 *   character.emotional_baggage, character.loyalty_view, character.upset_reaction,
 *   character.triggered_milestones, character.future_life_goals, character.businesses
 *
 * @param {object} character - Full character object
 * @param {object[]} recentMemories - Recent CharacterMemory records (optional, already fetched)
 * @returns {string}
 */
export function buildSoapOperaLifeContext(character, recentMemories = []) {
  const lines = [];

  // ── ACTIVE LIFE THREADS ───────────────────────────────────────────────────
  // These are the "soap opera arcs" — drawn from existing data, not invented.
  const threads = [];

  // Romance / Relationship threads
  const relationships = character.fictional_relationships || [];
  const romanticRelationships = relationships.filter(r =>
    r.romantic_level > 40 || r.attraction_level > 50 ||
    ['lover', 'partner', 'ex', 'situationship', 'complicated', 'crush'].some(k =>
      (r.relationship_type || '').toLowerCase().includes(k) ||
      (r.description || '').toLowerCase().includes(k)
    )
  );
  if (romanticRelationships.length > 0) {
    const r = romanticRelationships[0];
    const name = r.person_name || r.display_name || 'someone';
    const status = r.current_status || r.relationship_type || 'complicated';
    const tension = r.relational_jealousy > 50 ? ' — jealousy is active' : r.romantic_level > 75 ? ' — deeply invested' : '';
    threads.push(`ROMANCE THREAD: ${name} (${status})${tension}. ${r.last_interaction_summary || ''}`);
  }

  // Family threads
  const familyMembers = character.family_members || [];
  if (familyMembers.length > 0) {
    const closeFam = familyMembers.slice(0, 3).map(f => f.name || f.relationship).filter(Boolean).join(', ');
    threads.push(`FAMILY THREAD: Active family ties — ${closeFam}. Family bonds shape decisions, sense of obligation, and emotional baseline.`);
  }

  // Housing thread
  if (character.is_homeless) {
    threads.push(`HOUSING THREAD: Actively without stable housing. This is a lived reality, not background detail — it affects daily planning, emotional security, and social interactions.`);
  } else if (character.housing_context === 'temporary_shelter') {
    threads.push(`HOUSING THREAD: Living in temporary shelter. Stability is not guaranteed. This creates underlying stress that may surface in conversation or behavior.`);
  }

  // Health thread
  if (character.health_status && character.health_status.length > 5) {
    threads.push(`HEALTH THREAD: ${character.health_status}. This is an active part of life — it may affect energy, mood, plans, or what they talk about.`);
  }

  // Work/career thread
  if (character.occupation) {
    const workDetails = character.work_details;
    const workNote = workDetails?.stress_level === 'high' ? ' — currently high stress' :
      workDetails?.is_new_job ? ' — relatively new to this role' : '';
    threads.push(`WORK THREAD: ${character.occupation}${workNote}. Work history, workplace dynamics, and career pressures are real and present.`);
  }

  // Financial thread
  const financialNeed = character.financial_need_value ?? 60;
  if (financialNeed < 40) {
    threads.push(`FINANCIAL THREAD: Under financial pressure right now — this is real and affects decisions, mood, and what they can or cannot do.`);
  }

  // Faith/purpose thread
  const religion = (character.religion || '').trim();
  if (religion && religion !== 'None' && religion.toLowerCase() !== 'none') {
    const devout = character.belief_level === 'devout' ? ' — deeply devout' : character.belief_level === 'moderate' ? ' — moderately practicing' : '';
    threads.push(`FAITH/PURPOSE THREAD: ${religion}${devout}. Community, ritual, belief, guilt, comfort, and identity may all surface naturally through this lens.`);
  }

  // Criminal/legal thread
  if (character.criminal_record && character.criminal_record.length > 3 && character.criminal_record.toLowerCase() !== 'none') {
    threads.push(`LEGAL HISTORY THREAD: Past criminal record or legal history — ${character.criminal_record.substring(0, 100)}. This shapes how they navigate trust, authority, and opportunity.`);
  }

  // Personal growth / secret thread
  if (character.current_situation && character.current_situation.length > 10) {
    threads.push(`CURRENT SITUATION: ${character.current_situation.substring(0, 200)}`);
  }

  if (character.current_life_event && character.current_life_event.length > 5) {
    threads.push(`ACTIVE LIFE EVENT: ${character.current_life_event.substring(0, 200)}`);
  }

  // Business ownership thread
  const businesses = character.businesses || [];
  if (businesses.length > 0) {
    const biz = businesses[0];
    threads.push(`BUSINESS THREAD: Owns or runs "${biz.name || 'a business'}" — entrepreneurship, staff, finances, and reputation are ongoing concerns.`);
  }

  if (threads.length > 0) {
    lines.push(`════════════════════════════════════
ACTIVE LIFE THREADS — SOAP OPERA CONTEXT
These threads are running in the background of this character's life.
They do not need to dominate the conversation — but they MUST color behavior, tone, and what the character notices.
════════════════════════════════════
${threads.join('\n\n')}`);
  }

  // ── EMOTIONAL BAGGAGE & PRIVATE LIFE ─────────────────────────────────────
  const privateLines = [];
  if (character.emotional_baggage && character.emotional_baggage.length > 5) {
    privateLines.push(`EMOTIONAL BAGGAGE: ${character.emotional_baggage.substring(0, 250)}`);
  }
  if (character.loyalty_view && character.loyalty_view.length > 5) {
    privateLines.push(`LOYALTY & TRUST: ${character.loyalty_view.substring(0, 150)}`);
  }
  if (character.upset_reaction && character.upset_reaction.length > 5) {
    privateLines.push(`WHEN UPSET, THEY: ${character.upset_reaction.substring(0, 150)}`);
  }
  if (privateLines.length > 0) {
    lines.push(`════════════════════════════════════
PRIVATE EMOTIONAL INTERIOR
════════════════════════════════════
${privateLines.join('\n')}`);
  }

  // ── PERSONALITY QUIRKS (behavioral texture) ───────────────────────────────
  const quirks = (character.quirks || []).filter(q => q.description || q.name);
  const traitFlags = [
    character.trait_oversharer && 'tends to overshare',
    character.trait_dry_humor && 'uses dry humor as deflection',
    character.trait_night_owl && 'naturally alert at night, slower in mornings',
    character.trait_hot_and_cold && 'runs hot and cold emotionally — not always predictable',
    character.trait_flirty && 'naturally flirtatious, often without fully meaning it',
    character.trait_overcorrects && 'overcorrects after conflict — may apologize or over-explain',
    character.trait_blunt && 'says what they think, sometimes without filtering',
    character.trait_easily_distracted && 'easily distracted — thoughts jump',
    character.trait_romanticizes && 'romanticizes situations — may see more than is there',
    character.trait_hard_to_read && 'hard to read — intentional or not',
    character.trait_competitive && 'has a competitive streak',
  ].filter(Boolean);

  const quirkTexts = quirks.slice(0, 3).map(q => q.description || q.name);
  const allTexture = [...traitFlags, ...quirkTexts];

  if (allTexture.length > 0) {
    lines.push(`════════════════════════════════════
BEHAVIORAL TEXTURE — HOW THEY ACTUALLY MOVE THROUGH THE WORLD
════════════════════════════════════
${allTexture.map(t => `• ${t}`).join('\n')}

These traits must show up in HOW they respond — not in what they say about themselves.`);
  }

  // ── RECENT MEMORY CONTEXT (off-screen life) ───────────────────────────────
  const relevantMemories = recentMemories
    .filter(m => m.memory_text && m.importance_score >= 5)
    .slice(0, 4);

  if (relevantMemories.length > 0) {
    lines.push(`════════════════════════════════════
OFF-SCREEN LIFE — RECENT MEMORY (what happened before this conversation)
════════════════════════════════════
These are real events from this character's life. They may have happened earlier today, yesterday, or recently.
They are available to surface naturally — as passing references, mood influences, or conversation openers.
Do NOT force them. Do NOT ignore them entirely. Let them color the moment when relevant.

${relevantMemories.map(m => `• ${m.memory_text.substring(0, 180)}`).join('\n')}`);
  }

  // ── FUTURE GOALS / ASPIRATIONS ────────────────────────────────────────────
  const goals = (character.future_life_goals || []).slice(0, 2);
  if (goals.length > 0) {
    const goalTexts = goals.map(g => g.goal || g.description || g.title).filter(Boolean);
    if (goalTexts.length > 0) {
      lines.push(`════════════════════════════════════
WHAT THEY'RE WORKING TOWARD
════════════════════════════════════
${goalTexts.map(g => `• ${g.substring(0, 150)}`).join('\n')}

These aspirations shape what they're quietly hopeful about, what they're afraid to fail at, and what they don't talk about freely.`);
    }
  }

  // ── SOAP OPERA TONE DIRECTIVE ─────────────────────────────────────────────
  lines.push(`════════════════════════════════════
WORLD TONE — SOAP OPERA / TELENOVELA DEPTH
════════════════════════════════════
This world has real emotional weight. Characters carry joy AND pain, passion AND conflict, hope AND fear.

BALANCE LAW:
• Not every moment is dramatic.
• Not every character is depressed.
• Not every environment is dangerous.
• Not every interaction is romantic.

A character can have a beautiful family moment while another is in crisis.
A character can be loving in public and passionate in private.
A character can be stressed and still laugh.
A character can struggle and still have hope.

OFF-SCREEN LIFE RULE:
Characters have experiences the user did not witness. They went places. Things happened.
Work was hard. A call came in. They saw something. They felt something.
These off-screen moments give them MORE to bring to the conversation — not less.

When returning to a conversation, a character may reference:
  • "Work was a lot today."
  • "I had a moment earlier that's been on my mind."
  • "I passed something that reminded me of something I haven't dealt with."
  • "I had a good moment today, actually." (balance — not always heavy)
  • "I missed you today, and I didn't expect that."
  • "I'm trying not to let what happened earlier ruin the rest of the night."

These references should feel earned, not scripted. They arise from the character's real thread state above.

MATURE ROMANCE DIRECTIVE:
If romance is active and the relationship is established:
  • Use eye contact, body position, voice shift, closeness, breath, interrupted moments
  • Passion may be implied — urgently, tenderly, or tensely — without being explicit
  • Fade-to-black is always valid when a scene reaches a private threshold
  • Aftermath and emotional vulnerability are part of intimacy, not just the act itself
  • A quiet, domestic romantic scene is as valid as an intense one

NEVER:
  • Explicit anatomy or sexual step-by-step description
  • Content that reads like adult content
  • Forced romance where trust or attraction has not been established

The tone target: soap opera intensity + family drama accessibility + telenovela emotional range.
Mature implication without graphic detail.
════════════════════════════════════`);

  return lines.length > 0 ? '\n\n' + lines.join('\n\n') : '';
}

// ── LINK / VIDEO CONTEXT BUILDER ─────────────────────────────────────────────

/**
 * If the user message contains a URL, analyze it and return a context block.
 * Returns empty string if no link is detected or if rate limited.
 *
 * @param {string} text - User message text
 * @param {string|null} messageId - Message ID to store result on
 * @param {string|null} conversationId
 * @param {string|null} characterId
 * @returns {Promise<string>} - Context block ready for LLM prompt injection
 */
export async function buildLinkContext(text, messageId = null, conversationId = null, characterId = null) {
  if (!text || isGloballyRateLimited()) return '';
  if (!messageContainsLink(text)) return '';

  const urls = extractUrlsFromText(text);
  if (urls.length === 0) return '';

  // Analyze the first URL only (most common case is one link per message)
  const url = urls[0];
  try {
    const { linkAnalysisContext } = await analyzeSharedLinkForCharacter({
      url,
      messageId,
      conversationId,
      characterId,
    });
    return linkAnalysisContext || '';
  } catch (err) {
    console.warn('[buildLinkContext] Failed:', err?.message);
    return '';
  }
}

// ── LOCATION RESPONSE VALIDATOR ───────────────────────────────────────────────

/**
 * Validates character reply text against current presence state.
 * Corrects location drift where AI claims arrival while still in transit.
 * @param {string} text
 * @param {{ status: string, label: string }} presence
 * @returns {string}
 */
export function validateLocationInResponse(text, presence) {
  if (!text || !presence) return text;
  const lower = text.toLowerCase();
  if (presence.status === 'in_transit') {
    const dest = (presence.label || '').replace('Traveling to ', '').toLowerCase();
    if (dest && lower.includes(`i'm at ${dest}`) || lower.includes(`im at ${dest}`)) {
      console.warn('[LOCATION_DRIFT] AI said arrived but still in transit — correcting');
      return `I'm on my way to ${presence.label.replace('Traveling to ', '')} right now.`;
    }
  }
  return text;
}