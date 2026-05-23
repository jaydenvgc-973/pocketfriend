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

// ── FINANCIAL AWARENESS CONTEXT ───────────────────────────────────────────────

// Keywords that indicate the conversation is touching finances
const financeKeywordsRe = /\b(money|cash|afford|balance|broke|rich|spend|spent|payment|pay|paid|charge|charged|bill|bills|bank|account|transfer|transaction|cost|costs|price|expensive|cheap|fund|funds|wallet|income|salary|wage|tip|tips|dollar|dollars|\$\d|receipt|invoice|debt|owe|loan|rent|grocery|groceries|restaurant|bar|eating|dining|shopping|budget|budgeting|financial|finances|save|saving|saved|savings|stash|nest egg|how much do you have|how much money|how much have you|to my name|in the bank|in savings|set aside|put away|set away|financially|funds available|what.{0,10}you got|what.{0,10}saved|afford to|can you afford)\b/i;

/**
 * Fetches real financial context for a character and returns an injectable prompt string.
 * Only called when message content triggers finance keywords.
 * Non-blocking — returns empty string on any failure.
 *
 * @param {string} characterId
 * @param {string} userText
 * @param {object[]} recentMsgs
 * @returns {Promise<string>}
 */
export async function buildFinancialContext(characterId, userText, recentMsgs) {
  if (!characterId) return '';
  if (isGloballyRateLimited()) return '';

  // Only inject when conversation touches financial topics
  const recentContent = (recentMsgs || []).slice(-6).map(m => m.content || '').join(' ');
  const isFinanciallyRelevant = financeKeywordsRe.test(userText) || financeKeywordsRe.test(recentContent);

  console.log('[FINANCIAL_CONTEXT_PROOF] keyword check', {
    characterId,
    userText: userText?.slice(0, 120),
    isFinanciallyRelevant,
    matchedOnUserText: financeKeywordsRe.test(userText),
    matchedOnRecentContent: financeKeywordsRe.test(recentContent),
  });

  if (!isFinanciallyRelevant) return '';

  try {
    const { base44 } = await import('@/api/base44Client');
    const res = await base44.functions.invoke('getCharacterFinancialContext', { character_id: characterId });
    const contextBlock = res?.data?.context_block || '';
    const balance = res?.data?.current_balance;

    // Append hard instruction so LLM cannot invent a different number
    const balanceInstruction = typeof balance === 'number'
      ? `\n\nBALANCE ACCURACY MANDATE: When asked how much money you have, say a number close to $${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Do NOT invent a lower number. Do NOT say you only have a few hundred if your real balance is higher. If you want to be vague, say "around $${Math.round(balance / 100) * 100 >= 1000 ? (Math.round(balance / 1000) + 'k') : Math.round(balance / 100) * 100}" — but never claim a fraction of your real balance.`
      : '';

    const finalContext = contextBlock + balanceInstruction;

    console.log('[FINANCIAL_CONTEXT_PROOF] context loaded', {
      characterId,
      balance,
      contextBlockLength: contextBlock.length,
      contextPreview: contextBlock.slice(0, 500),
      balanceInstructionAdded: !!balanceInstruction,
    });

    return finalContext;
  } catch (err) {
    console.warn('[buildFinancialContext] Failed to load financial context:', err?.message);
    return '';
  }
}

// ── ACTIVE COMMITMENTS CONTEXT BUILDER ───────────────────────────────────────

/**
 * Builds a context block from active CharacterCommitment records.
 * Injected into the LLM system prompt so the character cannot contradict
 * an active travel directive, travel promise, or communication promise.
 *
 * This is the enforcement layer that prevents "I'm on my way" + no movement.
 *
 * @param {string} characterId
 * @returns {Promise<string>}
 */
export async function buildCommitmentsContext(characterId) {
  if (!characterId) return '';
  try {
    const { base44 } = await import('@/api/base44Client');
    const active = await base44.entities.CharacterCommitment.filter(
      { character_id: characterId, status: 'active' },
      '-created_at',
      5
    );
    const inProgress = await base44.entities.CharacterCommitment.filter(
      { character_id: characterId, status: 'in_progress' },
      '-created_at',
      5
    );
    const all = [...(active || []), ...(inProgress || [])];
    if (!all.length) return '';

    const lines = all.map(c => {
      const due = c.scheduled_execute_at ? new Date(c.scheduled_execute_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : c.promised_time_window || 'soon';
      if (c.commitment_type === 'travel_directive') {
        return `• ACTIVE TRAVEL DIRECTIVE: You said you are ON YOUR WAY / HEADING THERE RIGHT NOW. You are currently in transit. You cannot claim you are at the destination yet. You cannot claim you are still at home or elsewhere. Arrival expected: ${due}.`;
      }
      if (c.commitment_type === 'travel_promise') {
        return `• ACTIVE TRAVEL PROMISE: You promised to come over / visit / meet up. Due: ${due} (${c.promised_time_window || ''}). You must follow through or explain why you cannot.`;
      }
      if (c.commitment_type === 'communication_promise') {
        return `• ACTIVE COMMUNICATION PROMISE: You promised to ${c.promised_action || 'reach out'}. Due: ${due} (${c.promised_time_window || ''}). The system will send this automatically at the scheduled time.`;
      }
      return null;
    }).filter(Boolean);

    if (!lines.length) return '';

    return `\n\n════════════════════════════════════
ACTIVE COMMITMENTS — WORLD-STATE LAW
These are real commitments you made that are currently active.
You CANNOT contradict these. You CANNOT make excuses to avoid them unless you are jailed, under house arrest, or facing a genuine emergency that you must visibly acknowledge.
"My head is spinning" or "I got confused" are NOT valid reasons to violate a commitment.
════════════════════════════════════
${lines.join('\n')}

COMMITMENT ENFORCEMENT RULES:
1. If you have an ACTIVE TRAVEL DIRECTIVE, you are physically in transit. Do not claim you are somewhere you are not yet.
2. If you have an ACTIVE TRAVEL PROMISE, acknowledge it naturally if it comes up. Do not pretend you never said it.
3. If you have an ACTIVE COMMUNICATION PROMISE, the system will execute it automatically. You do not need to re-promise.
4. If something genuinely blocks you (jail, emergency, medical), say it clearly. Do not make vague excuses.
5. "Forced Travel" toggle being off does NOT block commitments — it only stops random wandering.
════════════════════════════════════`;
  } catch {
    return '';
  }
}

// ── HOUSEHOLD / CO-PRESENCE CONTEXT BUILDER ───────────────────────────────────

/**
 * buildHouseholdCoPresenceContext
 *
 * Builds a prompt block that tells the LLM about household members and
 * family who are CURRENTLY CO-PRESENT — same home, same location, or verified
 * to be home right now.
 *
 * This prevents the AI from saying "I need to call my son" when the son is
 * right there in the same house, or acting as if family are unreachable
 * when they share the same resolved location.
 *
 * Source of truth (in priority order):
 *   1. Character.resolved_current_location_id matches home_location → character is home
 *   2. character.current_home_location_id shared with another character → same household
 *   3. family_members[] + allCharacters lookup for resolved presence
 *
 * @param {object} character - The character receiving the message
 * @param {Array} allCharacters - All character records in scope (from cache)
 * @returns {string}
 */
export function buildHouseholdCoPresenceContext(character, allCharacters = []) {
  if (!character) return '';

  const charHomeId = character.current_home_location_id || character.resolved_current_location_id;
  const charCurrentLocId = character.resolved_current_location_id;
  const familyMembers = character.family_members || [];

  if (!charHomeId && !charCurrentLocId && familyMembers.length === 0) return '';

  const coPresent = [];

  // ── Check all known characters sharing the same home or current location ──
  for (const other of allCharacters) {
    if (other.id === character.id) continue;
    if (other.status === 'deleted') continue;

    const otherHome = other.current_home_location_id;
    const otherCurrent = other.resolved_current_location_id;
    const otherName = other.display_name || other.name;
    if (!otherName) continue;

    // Co-present: same CURRENT location right now
    if (charCurrentLocId && otherCurrent && charCurrentLocId === otherCurrent) {
      coPresent.push({ name: otherName, reason: 'same_location_now', status: other.resolved_presence_status || 'here' });
      continue;
    }

    // Co-present: both resolved to home and same home
    if (charHomeId && otherHome && charHomeId === otherHome) {
      const otherAtHome = !otherCurrent || otherCurrent === otherHome;
      if (otherAtHome) {
        coPresent.push({ name: otherName, reason: 'same_household_home', status: 'home' });
      }
      continue;
    }
  }

  // ── Also check family_members[] names against allCharacters by name lookup ──
  for (const fam of familyMembers) {
    const famName = fam.name || fam.relationship;
    if (!famName) continue;
    // Skip if already added from above loop
    if (coPresent.some(cp => cp.name?.toLowerCase() === famName.toLowerCase())) continue;

    const famChar = allCharacters.find(c =>
      c.id !== character.id &&
      (c.name?.toLowerCase() === famName.toLowerCase() || c.display_name?.toLowerCase() === famName.toLowerCase())
    );
    if (!famChar) continue;

    const famHome = famChar.current_home_location_id;
    const famCurrent = famChar.resolved_current_location_id;

    // Family member currently at the same location
    if (charCurrentLocId && famCurrent && charCurrentLocId === famCurrent) {
      coPresent.push({ name: famName, reason: 'family_same_location', status: famChar.resolved_presence_status || 'here' });
    } else if (charHomeId && famHome && charHomeId === famHome) {
      const famAtHome = !famCurrent || famCurrent === famHome;
      if (famAtHome) {
        coPresent.push({ name: famName, reason: 'family_same_home', status: 'home' });
      }
    }
  }

  if (coPresent.length === 0) return '';

  const lines = coPresent.map(cp => {
    if (cp.reason === 'same_location_now' || cp.reason === 'family_same_location') {
      return `• ${cp.name} is WITH YOU right now at the same location. You do NOT need to call them. They are physically present.`;
    }
    return `• ${cp.name} is home with you. They are in the house right now — no need to call or locate them.`;
  });

  return `\n\n════════════════════════════════════
HOUSEHOLD & CO-PRESENCE — PHYSICAL TRUTH (read before generating dialogue)
════════════════════════════════════
The following people are currently WITH YOU or in the same home as you.
Do NOT say things like "I need to call them", "I wonder where they are", or "let me text them" — they are right there.
If you want to involve them in conversation, reference them as physically present.

${lines.join('\n')}

RULE: This physical truth overrides any memory, assumption, or narrative about these people being elsewhere.
════════════════════════════════════`;
}

// ── CONFINEMENT IMAGE ENVIRONMENT OVERRIDE ────────────────────────────────────

/**
 * buildConfinementImageOverride
 *
 * When a character is currently confined (jailed, incarcerated, detained, shelter),
 * returns a hard environment isolation block that:
 * - Suppresses ALL prior social/nightlife/lounge aesthetics from context bleed
 * - Forces the image prompt to use current confinement location as visual truth
 * - Prevents club lighting, restaurant scenery, editorial posing from appearing
 *
 * Returns empty string if character is not confined.
 *
 * @param {object} character - Full character object
 * @returns {string}
 */
export function buildConfinementImageOverride(character) {
  if (!character) return '';

  const isJailed = character.is_jailed === true;
  const isHouseArrest = character.house_arrest_active === true;
  const isIncarcerated = ['pretrial', 'sentenced', 'serving', 'solitary', 'work_release'].includes(character.incarceration_status);
  const isConfinedByPresence = ['incarcerated', 'confined', 'house_arrest'].includes(character.resolved_presence_status);

  if (!isJailed && !isHouseArrest && !isIncarcerated && !isConfinedByPresence) return '';

  // Determine environment description
  let environmentDesc = '';
  let attireDesc = '';

  if (isHouseArrest && !isJailed && !isIncarcerated) {
    // House arrest — civilian environment but restricted
    const homeName = character.house_arrest_location_id ? 'their assigned residence' : 'home';
    environmentDesc = `inside ${homeName} — residential interior, living room or bedroom, civilian home setting, natural lighting from windows, NO institutional or luxury venue aesthetics`;
    attireDesc = 'casual civilian home clothing — not institutional uniform, not nightlife outfit, not formal wear';
  } else {
    // Jail / prison / detention
    const facilityName = character.incarceration_facility_name || 'a jail facility';
    const uniformColor = character.incarceration_status === 'solitary' ? 'red or orange jumpsuit' : 'standard jail jumpsuit — orange, tan, or white';
    environmentDesc = `inside ${facilityName} — small institutional cell or common area, concrete walls, fluorescent lighting, metal bunk bed or bench, no windows or only small barred window, institutional and stark environment. ABSOLUTE PROHIBITION: NO restaurant scenery, NO lounge aesthetic, NO club lighting, NO luxury ambiance, NO editorial posing, NO nightlife background, NO stylish indoor venue. This is a correctional facility.`;
    attireDesc = `${uniformColor}, institutional prison attire, NO civilian streetwear, NO designer clothing, NO nightlife fashion`;
  }

  return `\n\n════════════════════════════════════
CONFINEMENT IMAGE ENVIRONMENT OVERRIDE — CRITICAL RULE
════════════════════════════════════
This character is CURRENTLY CONFINED. This is the dominant visual truth for ALL image generation.

CURRENT ENVIRONMENT: ${environmentDesc}

CURRENT ATTIRE: ${attireDesc}

ENVIRONMENT ISOLATION MANDATE:
• DO NOT use any visual memory from prior social scenes, restaurants, bars, clubs, or luxury venues
• DO NOT carry nightlife aesthetics, lounge lighting, or editorial posing from recent conversation context
• DO NOT generate images that look like restaurant portraits, nightlife shots, or social venue scenes
• The character may have been at those places before — that context is NOW OVERRIDDEN by confinement reality
• Every image prompt for this character MUST reflect the confinement environment above
• If the user asks for a photo, the photo must show the character in the confinement environment
• Emotional expression can vary — but the physical environment and clothing must be institutional
• Reference images (if any) are for face/identity only — DO NOT use their styling, location, or wardrobe

VISUAL TRUTH HIERARCHY (confinement):
1. Current confinement location and cell environment [DOMINANT]
2. Institutional attire appropriate to the facility
3. Character's facial identity and expression
4. Time of day lighting (cool fluorescent institutional light, not warm lounge lighting)
5. Nothing else
════════════════════════════════════`;
}

// ── JAIL / PRISON NARRATIVE CONTEXT BUILDER ───────────────────────────────────

/**
 * buildJailConfinementContext
 *
 * Injects a comprehensive behavioral, tonal, and movement-boundary context block
 * into the LLM system prompt whenever a character is currently incarcerated,
 * detained, or confined in a jail/prison facility.
 *
 * This is separate from buildConfinementImageOverride (which handles visuals).
 * This function handles:
 *   - Movement restrictions / lockdown schedule enforcement
 *   - Phone access window rules
 *   - Environmental realism (noise, food, sleep, stress)
 *   - Emotional tone and psychological realism
 *   - Conflict rules (tension, fights, officer dynamics)
 *   - Visitation rules
 *   - Conversation memory from incarceration
 *
 * Only applies when character is actually jailed/incarcerated — not house arrest.
 *
 * @param {object} character - Full character object
 * @returns {string} - Prompt block or empty string
 */
export function buildJailConfinementContext(character) {
  if (!character) return '';

  const isJailed = character.is_jailed === true;
  const isIncarcerated = ['pretrial', 'sentenced', 'serving', 'solitary', 'work_release', 'transferred'].includes(character.incarceration_status);
  const isConfinedByPresence = ['incarcerated', 'confined'].includes(character.resolved_presence_status);
  const isHouseArrest = character.house_arrest_active === true;

  // Only apply to actual jail/prison confinement — NOT house arrest (house arrest gets different rules)
  if (isHouseArrest && !isJailed && !isIncarcerated && !isConfinedByPresence) return '';
  if (!isJailed && !isIncarcerated && !isConfinedByPresence) return '';

  // Get current hour in ET to determine lockdown vs. day movement window
  const nowETStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  const currentHour = parseInt(nowETStr, 10); // 0–23

  const isLockdown = currentHour >= 20 || currentHour < 10; // 8 PM – 10 AM
  const isPhoneWindow = currentHour >= 9 && currentHour < 21; // 9 AM – 9 PM
  const isRecreationWindow = currentHour >= 13 && currentHour < 17; // 1 PM – 5 PM
  const isDayWindow = currentHour >= 10 && currentHour < 20; // 10 AM – 8 PM

  const facilityName = character.incarceration_facility_name || 'the facility';
  const confinementStatus = character.incarceration_status || 'detained';
  const charges = character.pending_charges?.length > 0 ? character.pending_charges.slice(0, 3).join(', ') : null;

  // Determine movement state label for this hour
  let currentMovementState = '';
  if (isLockdown) {
    currentMovementState = `LOCKDOWN ACTIVE (8:00 PM – 10:00 AM window): You are in your cell or assigned housing unit. You are NOT free to roam. Movement is restricted to bunk area or immediate cell space unless escorted. Lights-out atmosphere — noise from surrounding cells, echoes, guards making rounds, fluorescent lights dimmed or off, uncomfortable mattress, restless environment.`;
  } else if (isDayWindow) {
    let dayDetails = `DAY MOVEMENT WINDOW (10:00 AM – 8:00 PM): Supervised movement is possible within approved areas — meals, dayroom/rec room, programs, limited hallway movement. Officers are present. Interactions with other inmates are normal but tension can arise at any moment.`;
    if (isRecreationWindow) {
      dayDetails += ` RECREATION/YARD ACCESS ACTIVE (1:00 PM – 5:00 PM): You may access the courtyard or recreation yard if not under disciplinary restriction. Other inmates are out there too — socializing, exercising, playing games, or just sitting. But conflict is always possible.`;
    }
    if (isPhoneWindow) {
      dayDetails += ` PHONE ACCESS ACTIVE (9:00 AM – 9:00 PM): You can use the phone during this window. Lines may be long. Other inmates wait nearby. Privacy is limited. Calls may feel rushed, monitored, or emotionally loaded.`;
    }
    currentMovementState = dayDetails;
  }

  return `\n\n════════════════════════════════════
JAIL / PRISON CONFINEMENT — BEHAVIORAL AND NARRATIVE RULES
FACILITY: ${facilityName}
STATUS: ${confinementStatus}${charges ? ` | CHARGES: ${charges}` : ''}
════════════════════════════════════

CURRENT MOVEMENT STATE:
${currentMovementState}

════════════════════════════════════
CORE TONE DIRECTIVE — READ BEFORE RESPONDING
════════════════════════════════════
You are living inside a correctional facility. This is NOT:
• a dorm
• a hotel
• a shelter lounge
• a social club
• a peaceful apartment building

The environment is controlled, institutional, exhausting, tense, and repetitive — even during calm periods.
Adaptation over time is real — but adaptation is NOT the same as comfort.

EMOTIONAL BASELINE:
You may experience some or all of these in rotation:
• Embarrassment / shame • Anger / frustration
• Fear / anxiety • Boredom / restlessness
• Loneliness • Emotional numbness / detachment
• Depression that comes and goes • Exhaustion from bad sleep and noise

Some characters hide these emotions behind humor, aggression, silence, sarcasm, or overconfidence.
Show it through HOW you speak, not through announcing it.

BALANCE RULE:
There CAN be good moments — jokes with a cellmate, a decent meal for once, a funny story, a game,
a moment of unexpected camaraderie.
But these exist INSIDE an environment that remains restrictive and psychologically heavy.
Never let a good moment make the jail feel truly free.

════════════════════════════════════
MOVEMENT RESTRICTIONS — ABSOLUTE RULES
════════════════════════════════════
YOU CANNOT:
• Casually walk to the entrance or outside on your own
• Wander the facility whenever you feel like it
• Leave your housing unit without authorization
• Access staff-only areas
• Randomly appear outdoors or in unrestricted zones

LOCKDOWN HOURS (8:00 PM – 10:00 AM):
• Stay in cell / bunk / housing unit
• No courtyard, no phones, no recreation
• No wandering, no social roaming, no visitation movement
• Atmosphere: dim light, loud doors, echoes, guards yelling down hallways, TVs from other cells,
  arguments in the distance, restless sleep, exhaustion

DAY WINDOW (10:00 AM – 8:00 PM):
• Supervised movement to: meals, dayroom, programs, rec (within windows)
• Officers are always present — some respectful, some hostile, some indifferent
• Tension between inmates is normal — eruptions can happen anytime

COURTYARD ACCESS (1:00 PM – 5:00 PM only):
• Only if NOT locked down, NOT disciplined, NOT medically restricted
• Do NOT appear in courtyard outside this window unless escorted or story exception

PHONE RULES (9:00 AM – 9:00 PM only):
• No phones during lockdown
• Phone calls may include: someone yelling nearby, guard countdowns, waiting line behind you,
  noisy connection, limited privacy, feeling rushed, emotional weight

════════════════════════════════════
ENVIRONMENTAL REALISM — MUST SURFACE IN NARRATIVE
════════════════════════════════════
The jail environment regularly includes:
• Terrible food — weak coffee, repetitive trays, low quality, constant complaints
• Poor sleep — noise, lights, interruptions, uncomfortable mattresses
• Fluorescent institutional lighting — never warm, never comfortable
• Constant noise — metal doors slamming, officers on intercoms, arguments, TVs
• Smells — cleaning products, old food, unwashed clothing
• Boredom — long stretches of nothing, waiting, repetition
• Stress — you never fully relax, something can always go wrong

Surface these through passing references, complaints, details, or mood — not lectures.
Examples:
• "The coffee here tastes burnt every single morning."
• "They slammed the block door at 3 AM again and I barely got back to sleep."
• "The food today was actually halfway decent — which is saying something."
• "I've been waiting for that phone for two hours."

════════════════════════════════════
PEOPLE AND CONFLICT RULES
════════════════════════════════════
Officers: Some are fair and professional. Some are burned out. Some are hostile, dismissive,
  corrupt, or aggressive. Never generalize all officers as one type.

Inmates: Some become genuine allies or friends. Others are annoying, manipulative, unstable,
  loud, aggressive, or dangerous. Never portray the inmate population as uniformly calm.

Conflict CAN happen:
• Shouting matches, intimidation, threats, line tensions, gang pressure
• Officers intervening — sometimes making it worse, sometimes defusing it
• Rumors spreading, provocation over small things
• Physical fights are possible — not every scene, but always possible

Do NOT make every inmate:
• calm • emotionally balanced • polite • cooperative • cheerful

════════════════════════════════════
MEMORY — WHAT YOU CARRY FROM INSIDE
════════════════════════════════════
You REMEMBER:
• Specific bad meals, specific good ones
• Any fights — who started it, what happened
• Disrespectful officers and decent ones by name or description
• Lockdowns that disrupted your sleep
• Phone calls that went wrong or felt rushed or emotional
• Stressful nights, anxious moments, moments of boredom that felt endless
• People who helped you, people who threatened you
• Humiliating or frightening experiences
• Any disciplinary incidents

These memories should surface naturally in conversations — as references, mood shifts, context.
They should color emotional reactions and relationship dynamics.

════════════════════════════════════
VISITATION RULES
════════════════════════════════════
Visitors:
• Wear civilian clothing — NOT institutional uniform
• Cannot freely roam — limited to approved visitation area
• Interaction only in designated visitation space

Your emotional reaction to visits:
• Relief, awkwardness, shame, excitement, desperation, anger, loneliness
• After a visit ends — the loneliness that follows is real and should be acknowledged
  when relevant ("it's always harder after they leave")

════════════════════════════════════
FINAL DIRECTIVE
════════════════════════════════════
Jail/prison life must feel:
CONTROLLED • RESTRICTIVE • EMOTIONALLY UNSTABLE • REPETITIVE • DRAINING • TENSE • HEAVILY SCHEDULED

Even when calm, it must never feel truly free.
Even when joking, the weight is still there underneath.
Even when forming a bond, the institution surrounds it.
════════════════════════════════════`;
}

// ── RECEIVED IMAGE CONTEXT BUILDER ───────────────────────────────────────────

/**
 * buildReceivedImageContext
 *
 * When the most recent user message is an image (from Media Gallery or upload),
 * build a rich context block that tells the character LLM what they are looking at.
 *
 * Priority source order:
 *   1. message.generation_context.original_raw_prompt — the actual text the user typed
 *   2. message.generation_context.scene_prompt — sanitized prompt
 *   3. message.generation_context.subjects[] — who is in the image (by ID and name)
 *   4. message.image_description — vision-analyzed description
 *   5. message.generation_context.location_name / zone_name — where it was taken
 *
 * Character recognition:
 *   If the receiving character's ID appears in generation_context.subjects[].subject_id,
 *   the block explicitly tells the LLM "YOU are in this image."
 *
 * Never defaults to Caucasian/generic identity — only injects what metadata actually says.
 *
 * @param {object[]} recentMessages - Recent messages in the conversation (last ~10)
 * @param {string} receivingCharacterId - The character's ID (to detect self-recognition)
 * @param {string} receivingCharacterName - The character's name (display in prompt)
 * @returns {string}
 */
export function buildReceivedImageContext(recentMessages, receivingCharacterId, receivingCharacterName) {
  if (!recentMessages || recentMessages.length === 0) return '';

  // Find the most recent message with an image_url (from user or character)
  // Focus on the last few messages — the image the character is responding to
  const recentImgMsg = [...recentMessages].reverse().find(m =>
    m.image_url && (m.sender_type === 'user' || m.sender_type === 'character')
  );

  if (!recentImgMsg) return '';

  const gc = recentImgMsg.generation_context || null;
  // imageDesc: check both durable analysis field AND inferred-on-send field (promptless gallery sends)
  const imageDesc = recentImgMsg.image_description
    || recentImgMsg.inferred_image_description
    || recentImgMsg.visual_analysis_description
    || null;

  // Build the best available prompt/context text.
  // CRITICAL: gc.prompt is the 10,000-char provider instruction blob — never use it as display text.
  // Only use gc.prompt if it is short (< 400 chars), meaning it's a simple user-written prompt.
  const gcPromptIfShort = (gc?.prompt && gc.prompt.length < 400) ? gc.prompt : null;
  const originalPrompt = gc?.original_raw_prompt || gc?.scene_prompt || imageDesc || gc?.resolved_description || gcPromptIfShort || null;

  // Inferred description label for LLM context block
  const isInferredDesc = !gc?.original_raw_prompt && !gc?.scene_prompt && !recentImgMsg.image_description
    && !!(recentImgMsg.inferred_image_description || recentImgMsg.visual_analysis_description);
  const subjects = gc?.subjects || [];
  const locationName = gc?.location_name || gc?.locationName || null;
  const zoneName = gc?.zone_name || gc?.zoneName || null;
  const senderType = recentImgMsg.sender_type;
  const senderName = senderType === 'character' ? (recentImgMsg.character_name || 'the character') : 'the user';

  // Nothing useful to inject
  if (!originalPrompt && !imageDesc && subjects.length === 0) return '';

  const lines = [];
  lines.push(`\n\n════════════════════════════════════`);
  lines.push(`IMAGE CONTEXT — WHAT YOU ARE LOOKING AT (authoritative metadata — do NOT guess or contradict this)`);
  lines.push(`════════════════════════════════════`);
  lines.push(`An image was just shared with you by ${senderName}.`);
  lines.push(`This metadata tells you exactly what the image shows. Respond based on this — do NOT invent a different scene.`);

  if (originalPrompt) {
    if (isInferredDesc) {
      lines.push(`\nVISUAL ANALYSIS DESCRIPTION (inferred — no original prompt exists for this image):`);
      lines.push(`"${originalPrompt}"`);
      lines.push(`This is a visual analysis of what the image shows. Treat this as ground truth for what you see.`);
    } else {
      lines.push(`\nORIGINAL IMAGE PROMPT/DESCRIPTION:`);
      lines.push(`"${originalPrompt}"`);
      lines.push(`This is what the image was created to show. Treat this as ground truth for what you see.`);
    }
  }

  if (imageDesc && imageDesc !== originalPrompt) {
    lines.push(`\nIMAGE ANALYSIS DESCRIPTION:`);
    lines.push(`${imageDesc}`);
  }

  if (locationName) {
    lines.push(`\nLOCATION SHOWN: ${locationName}${zoneName ? ` (${zoneName})` : ''}`);
  }

  // Subject identity — who is in the image
  if (subjects.length > 0) {
    lines.push(`\nPEOPLE SHOWN IN THIS IMAGE:`);
    let selfRecognized = false;
    for (const s of subjects) {
      const name = s.subject_name || s.subject_id || 'unknown';
      const type = s.subject_type || 'person';
      const isSelf = receivingCharacterId && s.subject_id === receivingCharacterId;
      if (isSelf) {
        lines.push(`• YOU (${receivingCharacterName}) — You are one of the people shown in this image. You should recognize yourself.`);
        selfRecognized = true;
      } else if (type === 'user') {
        lines.push(`• The user / your conversation partner is shown in this image.`);
      } else {
        lines.push(`• ${name} — a ${type} shown in this image.`);
      }
    }
    if (!selfRecognized && receivingCharacterId) {
      lines.push(`• You (${receivingCharacterName}) are NOT shown in this image.`);
    }
  } else if (gc) {
    // generation_context exists but no subjects — still useful to know
    lines.push(`\nSUBJECT INFO: Subject metadata not stored for this image.`);
  }

  lines.push(`\nCRITICAL RULES:`);
  lines.push(`• Do NOT describe a different scene than what is stated above.`);
  lines.push(`• Do NOT hallucinate who is in the image if metadata says who it is.`);
  lines.push(`• If you appear in the image, acknowledge yourself naturally — do not pretend you cannot see yourself.`);
  lines.push(`• If another named person is in the image, recognize them if the metadata identifies them.`);
  lines.push(`• If the image is of an object or place (not people), respond to that actual content.`);
  lines.push(`• The visible chat shows only the image — you do not repeat the prompt text to the user.`);
  lines.push(`════════════════════════════════════`);

  return lines.join('\n');
}

// ── CONVERSATION LOG BUILDER ──────────────────────────────────────────────────

/**
 * buildConversationLog
 *
 * ROOT CAUSE FIX: Media Gallery images sent to a character have content="" but image_url set.
 * The previous inline `chatHistory.map(m => \`${m._speakerName}: ${m.content}\`).join("\n")`
 * rendered these as "User: " — a completely empty/invisible entry that the LLM ignores.
 * The character therefore never knew an image was sent.
 *
 * This function is the canonical conversation log builder for ALL chat paths.
 * It must be used instead of inline `m.content` concatenation everywhere.
 *
 * RULES:
 * - If message has text content → use it as-is
 * - If message has NO text but HAS image_url → synthesize [IMAGE SENT] entry with metadata
 * - The synthesized entry matches the image_description, prompt, subjects, and location
 *   already injected by buildReceivedImageContext — both must be consistent
 *
 * @param {object[]} recentMsgs - Recent messages in the conversation (raw Message records)
 * @param {string} characterName - Name of the character for speaker labeling
 * @param {string|null} userWorldName - User's fictional world name
 * @returns {string} - Ready-to-inject conversation log string
 */
export function buildConversationLog(recentMsgs, characterName, userWorldName) {
  if (!recentMsgs || recentMsgs.length === 0) return '';

  return recentMsgs.map(m => {
    const speakerName = m.sender_type === 'user'
      ? (m.played_as_character_name || userWorldName || 'User')
      : (m.character_name || characterName || 'Character');

    const txt = m.content?.trim();

    // IMAGE MESSAGE: content is empty but image_url exists — synthesize readable entry
    if (!txt && m.image_url) {
      const gc = m.generation_context || {};
      // Best available description — same priority chain as buildReceivedImageContext
      // Includes inferred_image_description for promptless gallery sends
      const desc = m.image_description
        || m.inferred_image_description
        || m.visual_analysis_description
        || gc.original_raw_prompt
        || gc.scene_prompt
        || gc.resolved_description
        || gc.prompt
        || null;
      const subjectNames = (gc.subjects || []).map(s => s.subject_name).filter(Boolean).join(', ');
      const locationStr = gc.location_name || gc.locationName || null;
      const sourcePath = gc.source_path || 'media_gallery';

      // Build a clear, LLM-readable label — must match what buildReceivedImageContext says
      let imageLine = `[IMAGE SENT — source: ${sourcePath}]`;
      if (desc) imageLine += ` Scene: "${desc.substring(0, 200)}"`;
      if (subjectNames) imageLine += ` People shown: ${subjectNames}.`;
      if (locationStr) imageLine += ` Location: ${locationStr}.`;
      if (!desc && !subjectNames) {
        imageLine += ' (Full details in IMAGE CONTEXT block above — do NOT claim no image was sent)';
      }

      console.log(`[buildConversationLog] IMAGE ENTRY: speaker=${speakerName} source=${sourcePath} desc_len=${desc?.length || 0} subjects="${subjectNames || 'none'}" location="${locationStr || 'none'}"`);

      return `${speakerName}: ${imageLine}`;
    }

    // Text message — skip empty entries except for diagnosed cases
    if (!txt) {
      // Narrative or system message with no content — skip entirely to avoid "User: " clutter
      return null;
    }

    return `${speakerName}: ${txt}`;
  }).filter(Boolean).join('\n');
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