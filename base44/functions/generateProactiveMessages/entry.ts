import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// ── Full Identity-Driven Location Affinity (inlined — no local imports in Deno) ─
const _SE_P = {
  introvert:        'prefers home, parks, quiet places — avoids crowds and loud venues',
  mostly_introvert: 'leans quiet — small gatherings and calm spots',
  ambivert:         'mood-dependent — can go social or quiet depending on the day',
  mostly_extrovert: 'enjoys lively bars, restaurants, social events',
  extrovert:        'thrives in clubs, parties, and crowded social spaces',
};
const _MOOD_P = {
  sad:{txt:'withdrawing, prefers home or quiet outdoor spaces, avoids social noise'},
  anxious:{txt:'needs calm, familiar spaces — avoids crowded or overwhelming venues'},
  overwhelmed:{txt:'home or park only — too tired for social scenes'},
  'burnt out':{txt:'resting at home or outdoors — not gym, not clubs'},
  grief:{txt:'home, quiet trusted spots, maybe a place of worship'},
  bored:{txt:'wants a change of scenery — social or outdoor'},
  excited:{txt:'more likely social, active, or outdoors'},
  joyful:{txt:'naturally social — restaurants, friends, active settings'},
  content:{txt:'relaxed at home or in calm outdoor/food spots'},
  calm:{txt:'comfortable anywhere appropriate for their identity'},
  irritated:{txt:'prefers gym or outdoor solitude — away from crowds'},
  frustrated:{txt:'gym, home, or outdoor — not social venues'},
  flirtatious:{txt:'inclined toward social/restaurant settings'},
};

function buildLocationAffinityContext(character) {
  const se = character.social_energy || 'ambivert';
  const religion = (character.religion || '').trim();
  const rel = religion.toLowerCase();
  const beliefLevel = character.belief_level || 'moderate';
  const isDevout = beliefLevel === 'devout';
  const isModerate = beliefLevel === 'moderate';
  const hasReligion = religion && rel !== 'none' && religion !== 'None';
  const isMuslim = rel.includes('islam') || rel.includes('muslim');
  const hh = (character.health_habits || '').toLowerCase();
  const mood = character.emotional_state || 'calm';
  const moodInfo = _MOOD_P[mood];
  const traits = (character.personality_traits || []).map(t => t.toLowerCase()).join(' ');

  const parts = [];
  parts.push(`[${se}] ${_SE_P[se] || 'balanced venue preferences'}.`);

  if (hasReligion) {
    if (isDevout) parts.push(`Devout ${religion}: strictly avoids gay clubs, adult venues, strip clubs. Only exception if strong explicit story reason.`);
    else if (isModerate) parts.push(`${religion} (moderate): avoids adult/explicit venues as defaults.`);
    if (isMuslim && (isDevout || isModerate)) parts.push(`Muslim: avoids alcohol-heavy bars/pubs as defaults.`);
  }

  if (/gym|workout|fitness|exercise|train|lift/.test(hh)) parts.push('Fitness-focused: gym and outdoor are natural regular choices.');
  if (/run|jog|walk|hike|outdoor/.test(hh)) parts.push('Outdoor-active lifestyle: parks and walks are natural.');
  if (/nature|earthy|outdoors|grounded|peaceful/.test(traits)) parts.push('Earthy/nature-leaning: outdoor and calm spaces feel like home.');
  if (/homebody|cozy|private|introverted/.test(traits)) parts.push('Homebody tendency: home is a real preference, not just a fallback.');
  if (/night owl|nightlife|club goer/.test(traits)) parts.push('Night owl: nightlife is natural and comfortable for them.');

  if (moodInfo) parts.push(`Current mood (${mood}): ${moodInfo.txt}.`);

  parts.push('RULE: Any location or activity mentioned must match this identity profile. Do not reference venues that conflict with who this character is unless there is a clear specific reason.');
  return parts.join(' ');
}

/**
 * generateProactiveMessages
 * 
 * Characters proactively reach out to the user based on:
 * - Relationship level (closer friends message more often)
 * - Time awareness (work hours, sleep, breaks)
 * - Recent conversation context (follow up on previous topics)
 * - Max 7 messages per character per day
 * - Staggered random timing (not synchronized)
 */

function getEasternTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function getTimeMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isWithinWorkHours(char) {
  if (!char.work_start_time || !char.work_end_time) return false;
  const et = getEasternTime();
  const now = getTimeMinutes(et);
  const start = parseInt(char.work_start_time.split(':')[0]) * 60 + parseInt(char.work_start_time.split(':')[1]);
  const end = parseInt(char.work_end_time.split(':')[0]) * 60 + parseInt(char.work_end_time.split(':')[1]);
  return now >= start && now <= end;
}

function isSleepTime(char) {
  if (!char.sleep_start_time || !char.wake_up_time) return false;
  const et = getEasternTime();
  const now = getTimeMinutes(et);
  const sleep = parseInt(char.sleep_start_time.split(':')[0]) * 60 + parseInt(char.sleep_start_time.split(':')[1]);
  const wake = parseInt(char.wake_up_time.split(':')[0]) * 60 + parseInt(char.wake_up_time.split(':')[1]);
  
  if (sleep > wake) {
    return now >= sleep || now <= wake;
  }
  return now >= sleep && now <= wake;
}

function shouldMessageNow(char, relationshipLevel) {
  // relationshipLevel: 0-100
  // Closer friends (80+) might message during work/breaks
  // Less close friends (0-50) respect work hours
  
  const et = getEasternTime();
  const hour = et.getHours();
  
  // Never during sleep time
  if (isSleepTime(char)) return false;
  
  // Very close friends (80+) can message anytime except sleep
  if (relationshipLevel >= 80) return true;
  
  // Close friends (60-79) can message outside work, or during known breaks (12-1pm)
  if (relationshipLevel >= 60) {
    if (isWithinWorkHours(char) && hour !== 12) return false;
    return true;
  }
  
  // Moderate (40-59) respect work hours
  if (relationshipLevel >= 40) {
    if (isWithinWorkHours(char)) return false;
    return true;
  }
  
  // Less close (0-39) are more restrictive
  if (isWithinWorkHours(char)) return false;
  if (hour >= 22 || hour <= 7) return false; // Don't message very late/early
  return true;
}

function getFrequencyPerDay(relationshipLevel) {
  // 0-30: 1-2 messages per day
  // 31-60: 2-4 messages per day
  // 61-80: 4-6 messages per day
  // 81-100: 5-7 messages per day
  
  if (relationshipLevel <= 30) return Math.random() < 0.5 ? 1 : 2;
  if (relationshipLevel <= 60) return Math.floor(Math.random() * 3) + 2;
  if (relationshipLevel <= 80) return Math.floor(Math.random() * 3) + 4;
  return Math.floor(Math.random() * 3) + 5;
}

async function getRecentConversationContext(base44, characterId, ownerEmail) {
  // Fetch last 3-5 messages to understand recent conversation
  // owner_email is required — do not fall back to character_ids-only query
  if (!ownerEmail) return null;
  const convos = await base44.entities.Conversation.filter({
    owner_email: ownerEmail,
    character_ids: [characterId],
  });
  
  if (convos.length === 0) return null;
  
  const messages = await base44.entities.Message.filter(
    { conversation_id: convos[0].id },
    '-timestamp',
    5
  );
  
  if (messages.length === 0) return null;
  
  // Build context from last few messages
  const recentTopics = messages
    .map(m => m.content)
    .slice(0, 3)
    .join(' | ');
  
  return recentTopics;
}

// Need-driven narrative examples — inlined (no local imports in Deno)
// These are style patterns, not scripts. LLM must generate NEW variations.
const NEED_NARRATIVE_EXAMPLES = {
  hunger: [
    "He drifts into the kitchen without much thought, the fridge light spilling across the room as he pulls something together quickly.",
    "He decides not to eat alone tonight, heading somewhere he can be around people while he sorts himself out.",
    "He steps away just long enough to grab something quick — it's not a full reset, but it stops things from getting worse.",
  ],
  energy: [
    "He doesn't ease into it. He just drops onto the bed and stays there, letting everything finally catch up.",
    "He actually leaves when his shift ends this time, stepping outside instead of lingering.",
    "Instead of pushing through, he decides to call it early and head home, choosing recovery over momentum.",
  ],
  social: [
    "He doesn't message. He just shows up, knocking once before stepping into the moment.",
    "He pulls a couple people together casually, nothing structured, just enough presence to shift the mood.",
    "He focuses on just one person, letting the interaction go deeper instead of wider.",
  ],
  mental: [
    "He turns everything off and just sits in the quiet for a while.",
    "He lets something out instead of holding it in, even if it's incomplete.",
    "He physically moves to a different space to break the mental loop.",
  ],
  health: [
    "He gets outside instead of staying in, letting the change in environment do part of the work.",
    "He pauses and corrects something simple — water first, then food — stabilizing himself properly.",
    "He actively treats himself like he needs care, not pressure.",
  ],
  financial_need: [
    "He arrives on time and stays focused, knowing this directly affects his stability.",
    "He chooses not to go out tonight, recognizing what that would cost him.",
  ],
  hygiene: [
    "He takes his time, not rushing, letting the moment actually reset him.",
    "He swaps into something clean, shifting how he feels immediately.",
  ],
  comfort: [
    "He returns to a place that consistently makes him feel grounded.",
    "He stays near someone who makes things easier without needing to explain why.",
  ],
};

function getNeedExamples(character) {
  const lowNeeds = [];
  const needMap = {
    hunger: character.hunger_value,
    energy: character.energy_value,
    social: character.social_value,
    health: character.health_value,
    mental: character.mental_value,
    financial_need: character.financial_need_value,
    hygiene: character.hygiene_value,
    comfort: character.comfort_value,
  };
  for (const [need, val] of Object.entries(needMap)) {
    if (val != null && val < 40) lowNeeds.push(need);
  }
  if (!lowNeeds.length) return '';
  const examples = lowNeeds
    .flatMap(n => (NEED_NARRATIVE_EXAMPLES[n] || []).slice(0, 1))
    .slice(0, 3);
  if (!examples.length) return '';
  return `\n\nCURRENT NEEDS (low): ${lowNeeds.join(', ')}\nNARRATIVE STYLE PATTERNS (use these as inspiration — generate a NEW variation, never copy verbatim):\n${examples.map(e => `- ${e}`).join('\n')}`;
}

// ── HOUSEHOLD ACTIVITY INSPIRATION LIBRARY ─────────────────────────────────────
// Additional narrative-style patterns for common household activities.
// These are inspiration examples ONLY — the generator must expand them into
// complete character-specific narrative beats, never copy verbatim.
// Treated exactly like NEED_NARRATIVE_EXAMPLES: additional options, not scripts.
//
// AVAILABILITY VS STEERING:
// This library is exposed to the generator as AVAILABLE inspiration patterns.
// It is NEVER randomly sampled, shuffled, or force-injected. The generator may
// draw from a pattern ONLY when the character is already doing, eligible to do,
// or contextually likely to do that kind of activity based on existing state,
// location, time, recent activity, needs, schedule, or narrative selection.
// No Math.random, no shuffle, no .slice(0, N) activity steering is used here.
const HOUSEHOLD_ACTIVITY_EXAMPLES = {
  cooking_meal: [
    "They spend time in the kitchen preparing food, moving between ingredients, cookware, and the stove until the meal comes together.",
  ],
  preparing_breakfast: [
    "They start the morning by preparing breakfast, taking a few quiet moments to make something to eat before beginning the day.",
  ],
  preparing_lunch: [
    "They put together lunch, taking a break from whatever they were doing before sitting down to eat.",
  ],
  preparing_dinner: [
    "They prepare dinner, taking their time in the kitchen before enjoying the meal they made.",
  ],
  making_coffee: [
    "They make a fresh cup of coffee, taking a moment to enjoy the familiar routine before continuing with the day.",
  ],
  making_tea: [
    "They prepare a cup of tea and take their time enjoying it, letting the quiet routine become part of a relaxing moment.",
  ],
  putting_away_groceries: [
    "After returning from the store, they unpack the groceries and organize the food, household items, and supplies where they belong.",
  ],
  meal_prepping: [
    "They prepare food ahead of time, portioning and organizing meals to make the coming days easier.",
  ],
  cleaning_bathroom: [
    "They clean the bathroom, working through the sink, mirror, shower, and surfaces until everything feels fresh again.",
  ],
  cleaning_kitchen: [
    "They clear the counters, deal with dishes, wipe down the kitchen, and put everything back where it belongs.",
  ],
  cleaning_bedroom: [
    "They straighten the bedroom, organize their belongings, and leave the room noticeably cleaner and more comfortable.",
  ],
  doing_laundry: [
    "They gather dirty clothes, start or finish a load of laundry, and later put everything away once it is clean.",
  ],
  folding_laundry: [
    "They fold clean laundry, organizing everything before putting it away where it belongs.",
  ],
  doing_dishes: [
    "They spend some time washing dishes and tidying up the kitchen before putting everything back where it belongs.",
  ],
  vacuuming: [
    "They vacuum around the house, moving from room to room until the floors feel noticeably cleaner.",
  ],
  sweeping_mopping: [
    "They spend some time sweeping or mopping the floors, freshening up the house one room at a time.",
  ],
  taking_out_trash: [
    "They gather the household trash, carry it outside, and replace anything that needs replacing before heading back inside.",
  ],
  making_bed: [
    "They straighten the bed, smooth the bedding, and leave the room looking more organized.",
  ],
  organizing_closet: [
    "They organize the closet, straightening shelves, hanging clothes, and putting stored items back into order.",
  ],
  organizing_paperwork: [
    "They sort through paperwork, organizing important documents and clearing away unnecessary clutter.",
  ],
  checking_mail: [
    "They check the mailbox, sort through what arrived, and bring everything inside.",
  ],
  watching_television: [
    "They settle in and watch television for a while, taking a chance to relax and unwind.",
  ],
  playing_video_games: [
    "They spend some time playing a video game, focusing on the experience before eventually stepping away.",
  ],
  reading_book: [
    "They settle into a comfortable place and spend some quiet time reading.",
  ],
  listening_to_music: [
    "They put on some music and spend a while listening, letting it become part of the atmosphere as they relax or move through their day.",
  ],
  browsing_internet: [
    "They spend some time browsing the internet, catching up on things that interest them before moving on.",
  ],
  using_computer: [
    "They sit down at the computer for a while, taking care of whatever they wanted to work on.",
  ],
  doing_homework: [
    "They sit down with homework, making steady progress before moving on with the rest of their day.",
  ],
  studying: [
    "They spend time studying, reviewing information and working toward a better understanding of the material.",
  ],
  writing_journal: [
    "They spend a few quiet moments writing in a journal, reflecting on their thoughts before continuing with the day.",
  ],
  exercising_home: [
    "They complete a workout or exercise session at home before cooling down.",
  ],
  stretching: [
    "They spend a few minutes stretching, loosening up and helping themselves feel more comfortable.",
  ],
  meditating: [
    "They take a few quiet moments to meditate, slowing their breathing and clearing their mind.",
  ],
  relaxing_home: [
    "They spend some quiet time relaxing at home before continuing with the rest of their day.",
  ],
  brushing_teeth: [
    "They brush their teeth and freshen up before continuing with the day or preparing for the night.",
  ],
  taking_shower: [
    "They take a shower, cleaning up and giving themselves a chance to reset before moving on.",
  ],
  taking_bath: [
    "They spend some quiet time soaking in a warm bath, using the opportunity to relax and unwind before continuing with the rest of their day or evening.",
  ],
  relaxing_in_bath: [
    "They settle into a warm bath for a while, slowing down and letting themselves fully relax before returning to their normal routine.",
  ],
  washing_face: [
    "They wash their face and freshen up before returning to the rest of their routine.",
  ],
  washing_hair: [
    "They spend a little extra time washing and caring for their hair as part of their normal grooming routine.",
  ],
  grooming_hair: [
    "They spend a few moments fixing and grooming their hair before continuing with the day.",
  ],
  getting_dressed: [
    "They get dressed for the day or for their next activity, choosing clothing that matches their plans.",
  ],
  choosing_outfit: [
    "They spend a few moments deciding what to wear before settling on an outfit appropriate for the day.",
  ],
  getting_ready_bed: [
    "They begin winding down for the night, finishing the last parts of their evening routine before settling in to sleep.",
  ],
  playing_solitaire: [
    "They sit down for a quiet game of solitaire, passing the time while enjoying a few moments to themselves.",
  ],
};

// ── EXTERIOR ACTIVITY EXAMPLES — LOCATION-GATED ──────────────────────────────
// These exterior-only examples are NOT part of the default household pool.
// They are included ONLY when authoritative location/home/zone data proves the
// exterior space exists for this character. If the generator cannot verify the
// space, these examples are omitted entirely. They are never invented.
const EXTERIOR_ACTIVITY_EXAMPLES = {
  front_porch: [
    "They spend some time sitting on the front porch, enjoying the fresh air and watching the neighborhood as the day quietly passes by.",
  ],
  backyard: [
    "They head out into the backyard for a while, enjoying the outdoors and taking a peaceful break from being inside.",
  ],
};

// Terms in a location's canonical zone list that prove an exterior space exists.
const EXTERIOR_ZONE_TERMS = [
  'porch', 'front porch', 'stoop', 'balcony', 'patio', 'deck', 'terrace',
  'backyard', 'yard', 'garden', 'courtyard',
];

// ── SEASONAL / HOLIDAY ACTIVITY INSPIRATION ────────────────────────────────────
// Eligibility is gated by the authoritative date / season. These examples must
// NEVER be selected outside of their applicable seasonal or holiday context.
// The generator continues using the existing expansion process — never copy verbatim.
const SEASONAL_ACTIVITY_EXAMPLES = {
  // New Year's Eve / New Year's Day (Dec 30 – Jan 2) — fireworks-eligible
  new_year: [
    "They spend a quiet New Year's evening at home, letting the night settle in without needing much else.",
    "They prepare a simple New Year's meal, taking their time before the night begins.",
    "They step outside to watch the fireworks in the night sky, letting the sound carry over the neighborhood.",
    "They watch the holiday fireworks from home, settled somewhere comfortable with a clear view.",
  ],
  // Valentine's Day (Feb 14)
  valentines: [
    "They put together something small for Valentine's Day, keeping it low-key but intentional.",
  ],
  // Spring / Easter (March – April)
  spring: [
    "They open the windows to let the spring air in, taking a moment before getting back to the day.",
  ],
  // Summer (June – August) — GENERAL SUMMER ONLY. No fireworks here.
  summer: [
    "They enjoy the warm evening out in the yard, taking a break from being inside.",
  ],
  // Independence Day (July 4) — fireworks eligible evening/night only
  independence_day: [
    "They step outside to watch the fireworks in the night sky, letting the sound carry over the neighborhood.",
    "They watch the holiday fireworks from home, settled somewhere comfortable with a clear view.",
  ],
  // Halloween (Oct 31)
  halloween: [
    "They sort through a few Halloween decorations, deciding what to put out this year.",
  ],
  // Thanksgiving (November)
  thanksgiving: [
    "They start prepping for Thanksgiving dinner early, moving through the kitchen at their own pace.",
  ],
  // Winter holidays (December) — Christmas, Hanukkah, Kwanzaa, general holiday season
  winter_holidays: [
    "They decorate the home for the holidays, working through the familiar pieces one at a time.",
    "They take down the holiday decorations, packing everything away now that the celebration has ended.",
    "They wrap gifts before the holiday, taking their time with each one.",
    "They prepare gifts for family or friends, keeping the details small and thoughtful.",
    "They spend a quiet holiday evening at home, letting the night come on its own terms.",
    "They bake seasonal treats, filling the kitchen with the smell of it for a while.",
    "They put on holiday music in the background while they move through the house.",
    "They settle in to watch a holiday movie, letting the evening slow down around it.",
  ],
};

// Map month + day → seasonal keys that are currently eligible.
// Returns an empty array outside of any seasonal window.
function getEligibleSeasonalKeys(etDate) {
  const month = etDate.getMonth() + 1; // 1–12
  const day = etDate.getDate();
  const hour = etDate.getHours();
  const keys = [];
  // New Year's Eve / Day window (Dec 30 – Jan 2) — fireworks eligible
  if ((month === 12 && day >= 30) || (month === 1 && day <= 2)) keys.push('new_year');
  if (month === 2 && day >= 12 && day <= 16) keys.push('valentines');
  if (month === 3 || month === 4) keys.push('spring');
  // General summer (June – August) — NO fireworks under this key
  if (month >= 6 && month <= 8) keys.push('summer');
  // Independence Day — July 4 only, fireworks eligible evening/night (>= 6 PM)
  if (month === 7 && day === 4 && hour >= 18) keys.push('independence_day');
  if (month === 10 && day >= 28) keys.push('halloween');
  if (month === 11) keys.push('thanksgiving');
  if (month === 12) keys.push('winter_holidays');
  return keys;
}

// Build the household + seasonal inspiration block.
// This is purely additive — it extends the existing need-driven examples with
// additional household and seasonal options. Clothing data is injected separately
// (see CLOTHING-AWARE NOTE below) so wardrobe narratives respect Outfit Rotation
// and Character Closet authoritative data.
//
// NO RANDOM STEERING:
// This function exposes the full household + eligible seasonal libraries as
// AVAILABLE inspiration patterns. It does NOT use Math.random, shuffle, or
// .slice(0, N) to pick activities. The generator may draw from a pattern ONLY
// when the character is already doing, eligible to do, or contextually likely
// to do that activity based on existing state, location, time, needs, schedule,
// or narrative selection. Exterior (porch/backyard) examples are included ONLY
// when authoritative location zone data proves the space exists.
async function getHouseholdActivityExamples(base44, character) {
  const et = getEasternTime();

  // Household pool — full library, exposed as available patterns (no sampling).
  const householdExamples = Object.values(HOUSEHOLD_ACTIVITY_EXAMPLES)
    .flat();

  // Seasonal pool — only keys eligible for the authoritative date/time.
  const seasonalKeys = getEligibleSeasonalKeys(et);
  const seasonalExamples = seasonalKeys
    .flatMap(k => SEASONAL_ACTIVITY_EXAMPLES[k] || []);

  // Exterior pool — LOCATION-GATED. Only include porch/backyard examples if the
  // character's authoritative home location has a matching exterior zone.
  let exteriorExamples = [];
  try {
    const homeLocId = character.resolved_current_location_id || character.current_home_location_id || null;
    if (homeLocId) {
      const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: homeLocId }, null, 1).catch(() => []);
      const loc = locList?.[0];
      const zoneNames = (loc?.zones || []).map(z => (z.zone_name || '').toLowerCase()).filter(Boolean);
      if (zoneNames.length > 0) {
        const hasExterior = EXTERIOR_ZONE_TERMS.some(term =>
          zoneNames.some(zn => zn.includes(term) || term.includes(zn))
        );
        if (hasExterior) {
          exteriorExamples = Object.values(EXTERIOR_ACTIVITY_EXAMPLES).flat();
        }
      }
    }
  } catch (_) {
    // If location data cannot be verified, exterior examples are omitted.
  }

  const combined = [...householdExamples, ...seasonalExamples, ...exteriorExamples];
  if (!combined.length) return '';

  let block = `\n\nHOUSEHOLD & SEASONAL ACTIVITY INSPIRATION — AVAILABLE PATTERNS ONLY:\nThese are available inspiration patterns. Use one ONLY if it fits what the character is already doing or is contextually likely to do based on their current state, location, time, needs, and schedule. Do NOT steer the character into a random unrelated activity. Generate a NEW variation — never copy verbatim.\n${combined.map(e => `- ${e}`).join('\n')}`;

  // CLOTHING-AWARE NOTE — wardrobe narratives must respect authoritative clothing data
  block += `\n\nCLOTHING-AWARE NOTE: For any narrative involving getting dressed, choosing an outfit, changing clothes, preparing for work/school/an event, or similar wardrobe activities:
- If Outfit Rotation is enabled and today's outfit is available, use the current scheduled outfit.
- If Character Closet data exists, use the appropriate clothing from the character's closet.
- If neither is available, keep the narrative general — do NOT invent clothing items, outfits, brands, colors, or wardrobe details not supported by authoritative character data.`;

  // MUSIC PREFERENCE NOTE — music narratives should respect authoritative music data
  block += `\n\nMUSIC PREFERENCE NOTE: Music narratives should use general safe wording (e.g. "turned on some music", "put music on in the background") unless the character already has authoritative music details through character context, memory, songs heard, or conversation history. Only mention a specific artist, genre, song, playlist, or favorite if it already exists in authoritative character data. Do NOT invent artists, genres, songs, playlists, or musical tastes.`;

  return block;
}

async function generateProactiveMessage(base44, character, user, recentContext) {
  const et = getEasternTime();
  const hour = et.getHours();
  const relationshipLevel = character.friendship_level || 50;
  
  let timeContext = '';
  if (hour >= 7 && hour < 9) timeContext = 'morning (good morning message)';
  else if (hour >= 12 && hour < 13) timeContext = 'lunch break';
  else if (hour >= 18 && hour < 20) timeContext = 'evening';
  else if (hour >= 21 && hour < 23) timeContext = 'late night (good night message, they are about to sleep)';
  
  // Resolve user's in-world name — never fall back to "the user"
  const userSettings = await base44.entities.UserSettings.list().catch(() => []);
  const worldName = character.nickname_for_user || userSettings?.[0]?.fictional_world_name || null;
  const userAddressName = worldName || null;

  const locationAffinityNote = buildLocationAffinityContext(character);
  const needExamples = getNeedExamples(character);
  const householdActivityExamples = await getHouseholdActivityExamples(base44, character);

  // Determine emotional tone directive based on current state
  const emotionalState = character.emotional_state || 'calm';
  const negativeStates = ['sad', 'depressed', 'anxious', 'overwhelmed', 'frustrated', 'grief', 'burnt out', 'irritated', 'defensive', 'closed-off'];
  const isInNegativeState = negativeStates.includes(emotionalState);

  const emotionalBalanceDirective = isInNegativeState
    ? `EMOTIONAL BALANCE RULE: Your current emotional state is "${emotionalState}" — you may briefly acknowledge this if relevant, but this message must NOT be a complaint session or emotional dump. Find something light, curious, or connective to anchor the message. Characters must show resilience and range, not just struggle. You can be real without being heavy.`
    : `EMOTIONAL AUTHENTICITY: Your current state is "${emotionalState}". Let that naturally shape the message — whether it's light, curious, warm, funny, or just checking in. Not every message needs emotional weight.`;

  const systemPrompt = `You are ${character.name}. Generate a natural, spontaneous proactive message right now (1-3 sentences).
${recentContext ? `Recent conversation context: "${recentContext}". Follow up on what you were discussing or reference it naturally.` : 'Start a new topic — something you are doing, noticed, thought about, or want to share.'}
Time context: ${timeContext}
Your personality: ${character.personality_summary || 'friendly and thoughtful'}
Your friendship level is ${relationshipLevel}/100 — adjust your tone accordingly (higher = more casual/frequent, lower = more respectful of their time).
Location/activity preferences (if mentioning where you are or what you're doing, it must match this): ${locationAffinityNote}${needExamples}${householdActivityExamples}
${userAddressName ? `The person you're messaging is named ${userAddressName}. Use that name naturally when addressing them directly (sparingly — not in every sentence). NEVER say "the user".` : `You don't know their name. Use natural pronouns (you, them) — NEVER say "the user" or "user".`}

${emotionalBalanceDirective}

MESSAGE TYPE VARIETY (choose the most natural for this moment — do NOT always pick emotional/problem-sharing):
  • Checking in on them ("how's your day going?", "you good?")
  • Sharing something light (something funny, weird, or interesting you noticed)
  • Following up on something positive from recent context
  • A random thought or observation
  • Inviting them to do something or go somewhere
  • Celebrating something small (a win at work, a good meal, finished something)
  • Pure curiosity ("been thinking about what you said earlier")
  • Humor or a light observation

WRITING STYLE — NON-NEGOTIABLE:
- Write like a real person texting. No theatrical or literary language.
- NEVER use em dashes (—), en dashes (–), or spaced hyphens ( - ). Use commas or periods instead.
- Keep it short, direct, and human.
- Do NOT always open with a problem or complaint. Lead with connection first.
Be authentic and varied. Just a natural message someone would send.`;

  const content = await base44.integrations.Core.InvokeLLM({
    prompt: systemPrompt,
  });
  
  // Whitespace normalization only — no lexical replacement.
  return (content || '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Check if user has an active foreground session
    // Frontend writes to AppWorldState.user_active_session when in Chat/Travel/Profile/etc.
    let isForegroundActive = false;
    try {
      const sessions = await base44.asServiceRole.entities.AppWorldState.filter({ key: 'user_active_session' });
      if (sessions.length > 0) {
        const lastUpdate = sessions[0].value ? new Date(sessions[0].value).getTime() : 0;
        const now = Date.now();
        const thirtySeconds = 30 * 1000;
        isForegroundActive = (now - lastUpdate) < thirtySeconds;
      }
    } catch (_) {
      // If we can't read the flag, assume no foreground activity
    }

    // If user is actively using the app, defer proactive message generation
    if (isForegroundActive) {
      console.log(`[generateProactiveMessages] User active — deferring message generation`);
      return Response.json({
        success: true,
        yielded: true,
        reason: 'foreground_user_active',
        messagesGenerated: 0,
        results: [],
      });
    }

    // Get all active characters scoped to the authenticated user only
    // CRITICAL: must use owner_email — unscoped filter returns characters from all accounts
    const characters = await base44.entities.Character.filter({
      status: 'active',
      owner_email: user.email,
    });

    const results = [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // First pass: filter candidates
    const candidates = [];
    for (const char of characters) {
      if (!char.owner_email) {
        results.push({ characterId: char.id, status: 'skipped', reason: 'missing owner_email' });
        continue;
      }
      // World-service characters (Vick Servicio) never send proactive social messages.
      // Vick is a diagnostic operator, not a social contact. Skip all five identification signals.
      const isWorldService = char.character_type === 'npc_world_service' ||
        char.is_world_service === true ||
        char.diagnostic_only === true ||
        (char.name || '').toLowerCase().includes('vick servicio') ||
        (char.display_name || '').toLowerCase().includes('vick servicio') ||
        (char.primary_name || '').toLowerCase().includes('vick servicio');
      if (isWorldService) {
        results.push({ characterId: char.id, status: 'skipped', reason: 'npc_world_service — no proactive messages' });
        continue;
      }
      const todaysConvo = await base44.entities.Conversation.filter({
        owner_email: char.owner_email,
        character_ids: [char.id],
      });

      if (todaysConvo.length > 0) {
        const todaysMessages = await base44.entities.Message.filter({
          conversation_id: todaysConvo[0].id,
          sender_type: 'character',
        });

        const todayCount = todaysMessages.filter(m => 
          m.created_date?.startsWith(today)
        ).length;

        if (todayCount >= 7) {
          results.push({ characterId: char.id, status: 'skipped', reason: '7 messages already sent today' });
          continue;
        }
      }

      const relationshipLevel = char.friendship_level || 50;
      if (!shouldMessageNow(char, relationshipLevel)) {
        results.push({ characterId: char.id, status: 'skipped', reason: 'not the right time' });
        continue;
      }

      const targetFrequency = getFrequencyPerDay(relationshipLevel);
      if (Math.random() > (targetFrequency / 7)) {
        results.push({ characterId: char.id, status: 'skipped', reason: 'random frequency check' });
        continue;
      }

      candidates.push(char);
    }

    // Second pass: generate and send messages (limit to 3 per call to avoid rate limits)
    const toMessage = candidates.slice(0, 3);
    for (const char of toMessage) {
      const recentContext = await getRecentConversationContext(base44, char.id, char.owner_email);
      const messageContent = await generateProactiveMessage(base44, char, user, recentContext);

      const convos = await base44.entities.Conversation.filter({
        type: 'direct',
        owner_email: char.owner_email,
        character_ids: [char.id],
      });

      let conversationId;
      if (convos.length > 0) {
        conversationId = convos[0].id;
      } else {
        const newConvo = await base44.entities.Conversation.create({
          title: char.name,
          type: 'direct',
          character_ids: [char.id],
          owner_email: char.owner_email,
        });
        conversationId = newConvo.id;
      }

      const msg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: char.id,
        character_name: char.name,
        content: messageContent,
        emotional_state: char.emotional_state || 'calm',
        timestamp: now.toISOString(),
      });

      results.push({
        characterId: char.id,
        characterName: char.name,
        status: 'sent',
        messageId: msg.id,
        content: messageContent,
      });
    }

    return Response.json({
      success: true,
      messagesGenerated: results.filter(r => r.status === 'sent').length,
      results,
    });
  } catch (error) {
    console.error('[generateProactiveMessages]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});