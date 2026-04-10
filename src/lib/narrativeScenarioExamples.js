/**
 * NARRATIVE SCENARIO EXAMPLES
 * 
 * These are seed patterns — not scripts — for the AI to learn from and expand on.
 * Each scenario shows:
 *   - which need(s) it addresses
 *   - what location updates are required
 *   - what system updates should trigger
 *   - the narrative tone/style to emulate
 * 
 * RULE: AI must generate NEW variations using these as patterns.
 * Never repeat the same scenario verbatim.
 */

export const NARRATIVE_SCENARIOS = {

  hunger: [
    {
      id: 'hunger_late_kitchen',
      needs: ['hunger'],
      location_change: false,
      tone: 'quiet, intentional, settling',
      narrative: "He drifts into the kitchen without much thought, opening cabinets like he already knows he waited too long. The fridge light spills across the room as he pulls something together quickly, the quiet broken by small movements that feel more intentional than before. By the time he sits down, the tension in his body has already started to ease.",
    },
    {
      id: 'hunger_social_dinner',
      needs: ['hunger', 'social', 'mental'],
      location_change: true,
      location_hint: 'bar or restaurant',
      tone: 'social, grounding, ambient',
      narrative: "He decides not to eat alone, heading out instead, sliding into a seat like he belongs there tonight. The conversation picks up around him, the food arriving just in time, and somewhere between the first few bites and the noise around him, things start to level out.",
      systems_updated: ['location', 'hunger', 'social', 'mental'],
    },
    {
      id: 'hunger_work_break',
      needs: ['hunger'],
      location_change: false,
      tone: 'efficient, minimal, grounding',
      narrative: "He steps away from what he's doing just long enough to grab something quick, leaning against a nearby surface as he eats. It's not a full reset, but it stops things from getting worse.",
    },
    {
      id: 'hunger_grocery_run',
      needs: ['hunger'],
      location_change: true,
      location_hint: 'grocery store',
      tone: 'practical, preventive, purposeful',
      narrative: "He realizes there's nothing left at home and heads out, picking up what he needs so this doesn't keep happening. It's less about now and more about preventing the next drop.",
      systems_updated: ['location', 'hunger'],
    },
    {
      id: 'hunger_comfort_eating',
      needs: ['hunger', 'comfort'],
      location_change: false,
      tone: 'slow, deliberate, comforting',
      narrative: "He doesn't rush it this time. He sits down properly, eating slower, letting the moment stretch instead of treating it like a task.",
    },
  ],

  energy: [
    {
      id: 'energy_collapse_bed',
      needs: ['energy'],
      location_change: false,
      tone: 'heavy, sudden, surrendering',
      narrative: "He doesn't ease into it. He just drops onto the bed and stays there, letting everything finally catch up to him.",
    },
    {
      id: 'energy_leave_work_on_time',
      needs: ['energy'],
      location_change: true,
      location_hint: 'home',
      tone: 'deliberate, respectful of schedule, relieved',
      narrative: "He actually leaves when his shift ends this time, stepping outside instead of lingering. The shift in environment does more than he expected.",
      systems_updated: ['location', 'energy'],
      schedule_note: 'Only valid when shift has ended',
    },
    {
      id: 'energy_quiet_recharge',
      needs: ['energy', 'mental'],
      location_change: false,
      tone: 'still, low-stimulation, restorative',
      narrative: "He finds somewhere low-stimulation and just sits, letting the noise in his head slow down.",
    },
    {
      id: 'energy_light_gym',
      needs: ['energy', 'health'],
      location_change: true,
      location_hint: 'gym',
      tone: 'light, purposeful, awakening',
      narrative: "He heads to the gym, not pushing hard, just enough movement to wake himself up again.",
      systems_updated: ['location', 'energy', 'health'],
    },
    {
      id: 'energy_early_night',
      needs: ['energy'],
      location_change: true,
      location_hint: 'home',
      tone: 'decisive, self-aware, intentional',
      narrative: "Instead of pushing through, he decides to call it early and head home, choosing recovery over momentum.",
      systems_updated: ['location', 'energy'],
    },
  ],

  social: [
    {
      id: 'social_showing_up',
      needs: ['social'],
      location_change: true,
      tone: 'direct, present, spontaneous',
      narrative: "He doesn't message. He just shows up, knocking once before stepping into the moment.",
      systems_updated: ['location', 'social'],
    },
    {
      id: 'social_club_energy',
      needs: ['social', 'mental'],
      location_change: true,
      location_hint: 'nightclub or bar',
      tone: 'atmospheric, pulling out of isolation, ambient energy',
      narrative: "He heads out to the club, letting the atmosphere do the work for him, pulling him out of isolation without forcing it.",
      systems_updated: ['location', 'social', 'mental'],
    },
    {
      id: 'social_small_group',
      needs: ['social'],
      location_change: false,
      tone: 'casual, unstructured, mood-shifting',
      narrative: "He pulls a couple people together casually, nothing structured, just enough presence to shift the mood.",
    },
    {
      id: 'social_shared_space',
      needs: ['social'],
      location_change: false,
      tone: 'organic, passive, low-effort',
      narrative: "He lingers where people are instead of isolating, letting interaction happen naturally.",
    },
    {
      id: 'social_one_on_one',
      needs: ['social', 'mental'],
      location_change: false,
      tone: 'deep, focused, connecting',
      narrative: "He focuses on just one person, letting the interaction go deeper instead of wider.",
    },
  ],

  health: [
    {
      id: 'health_medical_visit',
      needs: ['health'],
      location_change: true,
      location_hint: 'medical center or hospital',
      tone: 'responsible, overdue, serious',
      narrative: "He checks in at the medical center, handling something he's been putting off.",
      systems_updated: ['location', 'health'],
    },
    {
      id: 'health_hydration',
      needs: ['health', 'hunger'],
      location_change: false,
      tone: 'corrective, simple, stabilizing',
      narrative: "He pauses and corrects something simple, water first, then food, stabilizing himself properly.",
    },
    {
      id: 'health_outdoor_movement',
      needs: ['health', 'mental'],
      location_change: true,
      location_hint: 'park or outdoors',
      tone: 'expansive, fresh, restorative',
      narrative: "He gets outside instead of staying in, letting the change in environment do part of the work.",
      systems_updated: ['location', 'health', 'mental'],
    },
    {
      id: 'health_avoid_harmful',
      needs: ['health'],
      location_change: false,
      tone: 'self-aware, redirecting, disciplined',
      narrative: "He stops himself from continuing something unhealthy, redirecting instead.",
    },
    {
      id: 'health_recovery_mode',
      needs: ['health', 'energy'],
      location_change: false,
      tone: 'compassionate, deliberate, slow',
      narrative: "He actively treats himself like he needs care, not pressure.",
    },
  ],

  mental: [
    {
      id: 'mental_silence',
      needs: ['mental'],
      location_change: false,
      tone: 'still, unplugged, decompressing',
      narrative: "He turns everything off and just sits in the quiet for a while.",
    },
    {
      id: 'mental_talking_it_out',
      needs: ['mental', 'social'],
      location_change: false,
      tone: 'vulnerable, incomplete, releasing',
      narrative: "He lets something out instead of holding it in, even if it's incomplete.",
    },
    {
      id: 'mental_creative_redirect',
      needs: ['mental'],
      location_change: false,
      tone: 'expressive, channeling, moving energy',
      narrative: "He shifts into something expressive, letting the energy move somewhere else.",
    },
    {
      id: 'mental_environment_change',
      needs: ['mental'],
      location_change: true,
      tone: 'breaking loops, fresh space, reset',
      narrative: "He physically moves to a different space to break the mental loop.",
      systems_updated: ['location', 'mental'],
    },
    {
      id: 'mental_boundary_setting',
      needs: ['mental'],
      location_change: false,
      tone: 'uncomfortable, necessary, protective',
      narrative: "He cuts something off that's draining him, even if it's uncomfortable.",
    },
  ],

  financial: [
    {
      id: 'financial_show_up_work',
      needs: ['financial_need'],
      location_change: true,
      location_hint: 'workplace',
      tone: 'grounded, focused, purposeful',
      narrative: "He arrives on time and stays focused, knowing this directly affects his stability.",
      systems_updated: ['location', 'financial_need'],
      schedule_note: 'Only valid when shift is active',
    },
    {
      id: 'financial_spending_control',
      needs: ['financial_need'],
      location_change: false,
      tone: 'disciplined, aware, preventive',
      narrative: "He chooses not to go out, recognizing the impact it would have.",
    },
    {
      id: 'financial_bill_payment',
      needs: ['financial_need'],
      location_change: false,
      tone: 'responsible, relief-seeking, corrective',
      narrative: "He handles something overdue instead of avoiding it.",
    },
    {
      id: 'financial_budget_reassess',
      needs: ['financial_need'],
      location_change: false,
      tone: 'reflective, recalibrating, practical',
      narrative: "He pauses to reassess instead of continuing blindly.",
    },
    {
      id: 'financial_extra_shift',
      needs: ['financial_need'],
      location_change: true,
      location_hint: 'workplace',
      tone: 'proactive, effort-driven, deliberate',
      narrative: "He accepts additional hours, knowing it directly impacts his stability.",
      systems_updated: ['location', 'financial_need'],
      schedule_note: 'Only valid if shift extension is logically possible',
    },
  ],

  hygiene: [
    {
      id: 'hygiene_full_shower',
      needs: ['hygiene'],
      location_change: false,
      tone: 'restorative, unhurried, resetting',
      narrative: "He takes his time, not rushing, letting the moment actually reset him.",
    },
    {
      id: 'hygiene_clothing_change',
      needs: ['hygiene', 'comfort'],
      location_change: false,
      tone: 'immediate, small shift, mood-lifting',
      narrative: "He swaps into something clean, shifting how he feels immediately.",
    },
    {
      id: 'hygiene_quick_refresh',
      needs: ['hygiene'],
      location_change: false,
      tone: 'efficient, minimal, functional',
      narrative: "He does just enough to feel put together again.",
    },
    {
      id: 'hygiene_laundry',
      needs: ['hygiene'],
      location_change: false,
      tone: 'practical, clearing out, long-overdue',
      narrative: "He clears out what's been piling up instead of ignoring it.",
    },
    {
      id: 'hygiene_grooming',
      needs: ['hygiene'],
      location_change: false,
      tone: 'self-care, precise, confidence-adjacent',
      narrative: "He fixes small details that improve his overall state.",
    },
  ],

  comfort: [
    {
      id: 'comfort_space_adjustment',
      needs: ['comfort'],
      location_change: false,
      tone: 'intentional, environmental, settling',
      narrative: "He shifts the environment around him until it actually feels right.",
    },
    {
      id: 'comfort_familiar_spot',
      needs: ['comfort', 'mental'],
      location_change: true,
      tone: 'returning, grounding, reliable',
      narrative: "He returns to a place that consistently makes him feel grounded.",
      systems_updated: ['location', 'comfort', 'mental'],
    },
    {
      id: 'comfort_physical_rest',
      needs: ['comfort', 'energy'],
      location_change: false,
      tone: 'surrendering, full, unhurried',
      narrative: "He leans fully into rest instead of half-doing it.",
    },
    {
      id: 'comfort_safe_company',
      needs: ['comfort', 'social'],
      location_change: false,
      tone: 'soft, proximity-based, easy',
      narrative: "He stays near someone who makes things easier.",
    },
    {
      id: 'comfort_routine_reset',
      needs: ['comfort'],
      location_change: false,
      tone: 'familiar, stabilizing, low-effort',
      narrative: "He leans into something familiar to stabilize himself.",
    },
  ],
};

/**
 * Get scenario examples for a given need type.
 * Returns array of scenario objects.
 */
export function getScenariosForNeed(needType) {
  return NARRATIVE_SCENARIOS[needType] || [];
}

/**
 * Get scenarios that address multiple needs (multi-need actions).
 * Returns scenarios where needs.length >= minNeeds.
 */
export function getMultiNeedScenarios(minNeeds = 2) {
  return Object.values(NARRATIVE_SCENARIOS)
    .flat()
    .filter(s => s.needs.length >= minNeeds);
}

/**
 * Get scenarios that require a location change.
 */
export function getLocationChangingScenarios() {
  return Object.values(NARRATIVE_SCENARIOS)
    .flat()
    .filter(s => s.location_change === true);
}

/**
 * Get a random example scenario for a given need — useful for LLM seeding.
 * Returns the narrative text to use as a style example.
 */
export function getExampleNarrative(needType) {
  const scenarios = getScenariosForNeed(needType);
  if (!scenarios.length) return null;
  const pick = scenarios[Math.floor(Math.random() * scenarios.length)];
  return pick.narrative;
}

/**
 * Build an LLM context string from relevant scenario examples.
 * Used to guide narrative generation without locking it to specific scripts.
 */
export function buildNarrativeExampleContext(needTypes = []) {
  const examples = needTypes.flatMap(n => getScenariosForNeed(n)).slice(0, 5);
  if (!examples.length) return '';

  return `NARRATIVE STYLE EXAMPLES (use these as patterns, not scripts — generate new variations):
${examples.map(e => `[${e.needs.join('+')}] ${e.narrative}`).join('\n\n')}

RULES:
- Generate a NEW scenario in the same style
- Match the character's personality and current environment
- Update all required systems (location, needs, memory)
- Never repeat these examples verbatim`;
}