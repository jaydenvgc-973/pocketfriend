import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { buildStyleMotifContext } from "@/lib/narrativeScenarioExamples";
import { buildExtendedNarrativeExampleContext } from "@/lib/narrativeScenarioExamplesExtended";
import { isDuplicateDevelopment } from "@/lib/dramaPremiseGate";
import { isRepeatedSerenity } from "@/lib/serenityPremiseGate";
import { buildTemporalState, buildTemporalContextBlock } from "@/lib/temporalStateEngine";

const COOLDOWN_SECONDS = 30;

const INTENT_OPTIONS = [
  { id: "action",     label: "Let Them Act", emoji: "🎬", description: "Natural context-driven action" },
  { id: "comfort",    label: "Comfort Me",   emoji: "🤍", description: "Warmth, closeness, care" },
  { id: "flirt",      label: "Flirt",        emoji: "✨", description: "Playful or romantic tension" },
  { id: "confront",   label: "Confront",     emoji: "⚡", description: "Tension or emotional confrontation" },
  { id: "spend_time", label: "Spend Time",   emoji: "🕰️", description: "Hang out, just be present" },
  { id: "check_in",   label: "Check In",     emoji: "💬", description: "See how you're doing" },
  { id: "drama",      label: "Insert Drama", emoji: "🎭", description: "Something unexpected happens" },
  { id: "serenity",   label: "Insert Serenity", emoji: "🌤️", description: "Something good or quietly pleasant" },
];

export default function NarrativeActionButton({
  character,
  conversationId,
  recentMessages = [],
  onNarrativeCreated,
  externalTrigger,
  onExternalClose,
  userSettings = null,
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef(null);

  useEffect(() => {
    if (externalTrigger) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [externalTrigger]);

  useEffect(() => {
    return () => {
      setOpen(false);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(COOLDOWN_SECONDS);
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const triggerNarrative = async (intent) => {
    if (!character || !conversationId || loading || cooldown > 0) return;
    setOpen(false);
    onExternalClose?.();
    setLoading(true);

    try {
      // ── CONTEXT RETRIEVAL — THREE MOST RECENT ENTRIES ARE AUTHORITATIVE ──────
      // The three most recent chronological conversation entries (messages OR
      // narratives, regardless of which Action category generated them) establish
      // the immediate conversational context. The selected Action determines the
      // TYPE of narrative to generate, NOT which previous conversation to
      // continue from. Older history must never override the latest conversation.

      // Recent window — the current conversation slice
      const recentWindow = recentMessages.slice(-15);

      const recentContext = recentWindow.map(m =>
        `${m.sender_type === "user" ? "User" : character.name}: ${m.content || "(image)"}`
      ).join("\n");

      // THREE MOST RECENT CHRONOLOGICAL ENTRIES — the immediate conversation state.
      // These may be ordinary text messages, character responses, user messages,
      // or previously generated narratives. They are interpreted together in
      // their actual conversational order regardless of type or category.
      const threeMostRecent = recentWindow.slice(-3);

      const currentMomentBlock = threeMostRecent.length > 0
        ? `\n\n════════════════════════════════════
CURRENT MOMENT — THREE MOST RECENT ENTRIES (AUTHORITATIVE — CONTINUE FROM HERE)
These are the three most recent chronological conversation entries on this page.
They may be messages, character responses, or narratives from ANY Action category.
The new narrative MUST begin from the state these entries establish RIGHT NOW.

DO NOT continue from any older scene, narrative, or situation.
DO NOT retrieve an earlier same-category narrative and resume that scene.
DO NOT ignore these entries in favor of older history.
════════════════════════════════════
${threeMostRecent.map((m, i) => {
  const label = m.sender_type === "user" ? "User" : character.name;
  const typeTag = m.is_narrative ? " [narrative]" : "";
  return `ENTRY ${i + 1}${typeTag}: ${label}: "${(m.content || "(image)").substring(0, 250)}"`;
}).join("\n")}
════════════════════════════════════`
        : "";

      // Extract recent narrative blocks ONLY from the current conversation window.
      // Previously this pulled from the full recentMessages array, which could
      // include narratives from days ago — causing the LLM to resume an outdated
      // scene instead of the current conversation. Now restricted to recentWindow.
      const allRecentNarratives = recentWindow
        .filter(m => m.is_narrative && m.sender_type === "character" && m.content?.trim())
        .slice(-6);
      
      const recentActionNarratives = allRecentNarratives
        .slice(-3)
        .map(m => m.content)
        .join("\n---\n");
      
      const narrativeContinuityBlock = allRecentNarratives.length > 0
        ? `\n\n════════════════════════════════════
NARRATIVE CONTINUITY — BEATS FROM THE CURRENT CONVERSATION (read before generating)
These narrative beats already happened WITHIN the current conversation window.
DO NOT repeat or contradict them. Continue FROM the emotional/physical state
they left the scene in. If the CURRENT MOMENT entries above conflict with these
beats, the CURRENT MOMENT entries take priority — they are more recent.
════════════════════════════════════
${allRecentNarratives.map((m, i) => `BEAT ${i + 1}:\n"${m.content}"`).join("\n\n")}

CONTINUATION RULES:
• The above beats are ALREADY IN CANON. They happened.
• Do NOT restate, re-describe, or reset them.
• Continue from the CURRENT emotional/physical state they established.
• If the last beat established tension — maintain or escalate it, do not suddenly reset to calm.
• If the last beat established calm — do not suddenly inject unearned drama.
• If the last beat ended with a physical action — begin from AFTER that action resolves.
• These beats are from the CURRENT conversation only. Do NOT retrieve or resume
  scenes from older conversations, earlier days, or different locations.
════════════════════════════════════`
        : "";

      const actionMemory = recentActionNarratives 
        ? `\nRECENT ACTIONS TO AVOID REPEATING:\n${recentActionNarratives}\n\nDo NOT start with the same action or gesture as above. Choose a completely different approach.`
        : "";

      // ── USER PRESENCE TRUTH BLOCK ─────────────────────────────────────────
      // Determine if the user is physically co-present with the character or remote.
      const userLocationId = userSettings?.user_current_location_id || null;
      const userPresenceStatus = userSettings?.user_presence_status || 'away';
      const charLocationId = character.resolved_current_location_id || null;
      const userIsCoPresent = !!(
        userPresenceStatus === 'present' &&
        userLocationId &&
        charLocationId &&
        userLocationId === charLocationId
      );

      const userWorldName = userSettings?.fictional_world_name || 'the user';

      const userPresenceBlock = userIsCoPresent
        ? `\n\n════════════════════════════════════
USER PRESENCE — PHYSICALLY CO-PRESENT
════════════════════════════════════
"${userWorldName}" is currently AT THE SAME LOCATION as ${character.name}.
Physical co-presence IS confirmed. The following are ALLOWED:
• ${character.name} can look at, react to, or physically interact with ${userWorldName}
• Shared environmental experience (both in the same space)
• Eye contact, handing objects, physical proximity descriptions
════════════════════════════════════`
        : `\n\n════════════════════════════════════
USER PRESENCE — REMOTE / NOT CO-PRESENT
════════════════════════════════════
"${userWorldName}" is NOT physically present with ${character.name} right now.
This is a TEXT/PHONE interaction — the user is remote.

ABSOLUTE PROHIBITIONS — these are generation errors:
✗ "${character.name} glanced over at you"
✗ "You sat together" / "You stood beside him/her"
✗ "He/She watched you leave"
✗ "You could feel the tension between you"
✗ Any description implying the user is in the same physical space

ALLOWED — remote-only framing:
✓ ${character.name} thinking about the user / missing the user
✓ Referencing a previous visit or memory
✓ Emotional reaction to the text/call conversation
✓ Environmental details of WHERE ${character.name} IS without the user present
✓ What ${character.name} is doing in their space alone or with others who ARE there
════════════════════════════════════`;

      const last5 = recentMessages.slice(-5).map(m => m.content || "").join(" ").toLowerCase();

      const hasRomantic = /kiss|hold|closer|touch|pull|press|wrap|grip|lean|body|skin|breathe|heartbeat|forehead|cheek|waist|wrist|neck|lips|chest|hands/.test(last5);
      const hasFlirt = /flirt|tease|smile|wink|playful|tension|lingering|stare|gaze|electricity|charged|heat/.test(last5);
      const hasEmotional = /feel|hurt|cry|miss|scared|vulnerable|open|trust|honest|hard|difficult|breakdown|overwhelm|alone|together/.test(last5);

      const friendshipLevel = character.friendship_level ?? 75;
      const romanticLevel = character.romantic_level ?? 0;
      const attractionLevel = character.attraction_level ?? 0;
      const emotionalState = character.emotional_state || "calm";
      const location = character.resolved_current_location_name || character.city || "home";

      // ── TIME OF DAY — the existing temporal engine, not a new clock ──────────
      // Insert Drama and Insert Serenity must honour the real daypart exactly as
      // every other narrative path already does. buildTemporalState recalculates
      // from the live Eastern clock, so nothing here is cached or inferred from
      // the conversation, the event chosen, or the atmosphere being written.
      const lastThreadMsg = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;
      const temporalState = buildTemporalState(
        character,
        lastThreadMsg?.timestamp || lastThreadMsg?.created_date || null
      );

      const temporalBlock = `${buildTemporalContextBlock(temporalState)}

TIME-OF-DAY ACCURACY — OUTRANKS ATMOSPHERE, SUBJECT, AND MOOD
• The daypart above is the only truth about what time it is. The event you chose does not get to change it.
• NEVER name a daypart other than the current one. "For the rest of the afternoon" is a factual error at 10:15 PM; "for the rest of the evening" is correct.
• Do not default to a time of day out of habit, because the subject feels like a morning thing, or because you imagined soft light.
• Any duration or elapsed time must remain inside the real time. An event that begins at night must not run into the following afternoon, midday must not drift into sunset, and a morning must not become evening.
• When the real time makes a time reference awkward or unnecessary, leave it out. "They keep each other company for a while" needs no clock at all.
`;

      // Relationship type detection — these are HARD gates
      const isFamilial = (character.fictional_relationships || []).some(r =>
        ['parent','sibling','child','cousin','aunt','uncle','grandparent','family'].some(f =>
          (r.relationship_type || '').toLowerCase().includes(f)
        )
      );
      const isMentor = (character.fictional_relationships || []).some(r =>
        ['mentor','teacher','coach','supervisor','boss'].some(f =>
          (r.relationship_type || '').toLowerCase().includes(f)
        )
      );

      // Romantic content is only permitted when neither familial nor mentor, and attraction supports it
      const romanticOk = !isFamilial && !isMentor && attractionLevel >= 20 && (intent === 'flirt' || romanticLevel >= 30);

      // Context tier only meaningful for romantic-eligible relationships
      let contextTier = "low";
      if (romanticOk) {
        if (hasRomantic || (romanticLevel >= 60 && hasFlirt)) contextTier = "high";
        else if (hasFlirt || hasEmotional || romanticLevel >= 30) contextTier = "medium";
      }

      // Determine top-level intent classification
      const intentType = isFamilial ? 'FAMILIAL'
        : isMentor ? 'MENTORSHIP'
        : intent === 'confront' ? 'CONFLICT'
        : intent === 'drama' || intent === 'serenity' ? 'FRIENDSHIP'
        : romanticOk ? 'ROMANTIC'
        : 'FRIENDSHIP';

      // Hard boundary block — placed at the very top of the prompt for maximum enforcement
      let hardBoundary = "";
      if (isFamilial) {
        hardBoundary = `
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!! ABSOLUTE HARD BLOCK — FAMILIAL RELATIONSHIP      !!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
This character has a FAMILY relationship with the user.
This rule OVERRIDES every other instruction in this prompt, including intent, context tier, and conversation history.

PROHIBITED — no exceptions, no approximations, no "subtle" versions:
- Romantic content of ANY kind
- Kissing, romantic touching, sensual metaphor, romantic tension
- Physical closeness that reads as romantic
- Flirting, suggestive language, or charged atmosphere

ALLOWED:
- Non-romantic hugs, emotional comfort, protective gestures
- Sibling/parent/family-appropriate everyday interactions
- Warm, caring, platonic presence

If the chosen intent was "flirt" — generate a warm platonic moment instead.
Any violation of this boundary is a critical generation error.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
`;
      } else if (isMentor) {
        hardBoundary = `
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!! ABSOLUTE HARD BLOCK — MENTORSHIP RELATIONSHIP    !!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
This character is a mentor, teacher, coach, or authority figure.
This rule OVERRIDES every other instruction in this prompt.

PROHIBITED — no exceptions:
- Romantic content, kissing, flirtation, sensual touch
- Romantic tension or charged atmosphere of any kind

ALLOWED:
- Firm correction, grounded authority, controlled eye contact
- Professional closeness, encouragement, coaching presence

If the chosen intent was "flirt" — generate a grounded professional moment instead.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
`;
      }

      // ── CONFINEMENT COMMUNICATION BLOCK ──────────────────────────────────────
      const isConfined = !!(character.is_jailed || character.house_arrest_active ||
        ['incarcerated','house_arrest','confined'].includes(character.resolved_presence_status) ||
        ['incarcerated','house_arrest','confined'].includes(character.resolved_location_type));

      let confinementBlock = "";
      if (isConfined) {
        // Determine if we are inside the allowed communication window (9 AM – 9 PM ET)
        const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const etHour = nowET.getHours();
        const commAllowed = etHour >= 9 && etHour < 21;

        if (!commAllowed) {
          confinementBlock = `
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!! CONFINEMENT COMMUNICATION BLACKOUT — HARD BLOCK  !!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
${character.name} is currently INCARCERATED / CONFINED.
The current time is outside the allowed communication window (9:00 AM – 9:00 PM).
Communication is NOT permitted right now.

ABSOLUTE PROHIBITIONS — violation = critical generation error:
✗ Phone buzzing or ringing
✗ Receiving or reading a text message
✗ Sending a text, call, or message of any kind
✗ Checking social media or any app
✗ Any implication of live digital communication

THIS NARRATIVE MUST INSTEAD:
✓ Show ${character.name} in their cell or housing unit
✓ Internal reflection, memory, emotional state, anticipation
✓ Physical environment of the facility (sounds, light, fabric, air)
✓ Thinking about someone — NOT communicating with them
✓ Frustration, longing, or quiet resolve — without active contact

DO NOT place ${character.name} near entrances, parking lots, sidewalks, or public-facing areas.
Courtyard/recreation access only during approved daytime hours.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
`;
        } else {
          confinementBlock = `
════════════════════════════════════
CONFINEMENT RESTRICTIONS ACTIVE
════════════════════════════════════
${character.name} is INCARCERATED / CONFINED. Communication is currently within allowed hours (9 AM–9 PM) but institutional restrictions still apply.

RULES:
• Phone access is LIMITED — short calls/texts only, monitored
• ${character.name} is INSIDE the facility — no outdoor public areas, no civilian spaces
• Do NOT place them near entrances, parking lots, or public sidewalks
• Movement is restricted to sanctioned areas (cell, common room, courtyard if daytime)
• Narrative must maintain institutional reality (guards, restricted movement, facility environment)
════════════════════════════════════
`;
        }
      }

      // ── PROGRESSION + MOTIF ───────────────────────────────────────────────────
      // Silent imperatives that shape generation without exposing meta-logic.
      // The narrative IS the response — the next thing that happens.
      const progressionBlock = `
════════════════════════════════════════════════════════════
PROGRESSION
════════════════════════════════════════════════════════════
Continue from the established state. Do not restart, restate, or reset.
Carry forward the existing emotional momentum unless this action naturally changes it.
Fold this interaction into the current emotional/physical state — do not erase what came before.
Advance the moment. Do not rewrite the same beat with different adjectives.

CONTINUITY — THE SELECTED ACTION CHANGES DIRECTION, NOT REALITY:
• The selected Action changes the emotional or behavioral DIRECTION of the interaction.
• It does NOT restart the scene, change the location, erase the preceding interaction,
  reset the character's emotional condition, or authorize unrelated events.
• The character remains where they are, in the physical position and circumstances
  established by the CURRENT MOMENT entries, unless a believable progression explains
  movement or change.
• Time progresses naturally. Characters may move, change activities, react, and
  experience developments — but those developments must follow the established
  sequence and the amount of time that has reasonably elapsed.

REPEATED SELECTIONS DEVELOP THE INTERACTION:
• When an Action is selected repeatedly during an ongoing interaction, each narrative
  must account for what happened in the immediately preceding messages and narratives.
• Repeated selection may naturally develop or intensify the interaction depending on
  the current emotional momentum, character responses, and circumstances.
• This does NOT mean every repeated selection automatically increases intensity.
  Characters retain their personalities, emotional states, and ability to respond.
• Do NOT restart the interaction with introductory gestures each time.
• Do NOT mechanically escalate without considering context.

ONE CONTINUOUS CONTEXT ACROSS ALL CATEGORIES:
• All seven Action options share the same current conversation timeline.
• A narrative generated by one Action is immediate context for the next selected Action,
  regardless of category.
• Switching categories changes the TYPE of interaction while preserving narrative
  continuity — it does not create a separate reality.
════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════
`;

      // ── INSERT DRAMA — SPONTANEOUS DEVELOPMENT ─────────────────────────────────
      // Insert Drama is the one Action whose job is to change circumstances rather
      // than develop the current exchange. This block grants that single permission
      // (an unrelated event may occur) and then constrains the event so it cannot
      // contradict authoritative reality or invent history for another character.
      const dramaBlock = intent === 'drama' ? `
════════════════════════════════════════════════════════════
INSERT DRAMA — SPONTANEOUS DEVELOPMENT (SPECIAL RULE SET)
════════════════════════════════════════════════════════════
The selected Action is INSERT DRAMA. Something happens TO or AROUND ${character.name} that was not being discussed and was not planned.

THIS OVERRIDES THE "DO NOT AUTHORIZE UNRELATED EVENTS" LINE ABOVE — FOR THIS SELECTION ONLY.
Every other continuity rule still applies: the scene starts exactly where the character is, and nothing already established may be contradicted.

WHAT THIS SELECTION IS:
• ONE new development entering the character's life right now.
• It may grow directly out of what is happening OR arrive completely unrelated to the current conversation.
• You choose the situation yourself. Anything named anywhere in this prompt is an example of the KIND of thing that can happen, offered to show breadth — never a set of options to choose from.
• It does NOT need foreshadowing. The conversation does not have to be about the subject first.
• It is an EVENT that happened — not a mood, not a reflection, not a dramatic retelling of the current exchange.
• It must leave the situation OPEN. Introduce it, do not resolve it. No aftermath, no clean ending, no full account of the consequences.

WHAT THIS SELECTION IS NOT:
✗ A restatement, summary, or heightened description of what the conversation is already about
✗ The same category of event as the previous Action narrative in this conversation
✗ An event that contradicts the authoritative location, presence, health, confinement, work, school, or relationship facts above
✗ A resolution. Do not resolve the complication inside this narrative.
✗ An emergency every time. Most selections are not catastrophes.
✗ An argument, confrontation, or emergency by default. Those are three kinds of development among many and must not become the usual shape of this Action.

RANGE — WHAT THE SPREAD LOOKS LIKE (illustration, never a menu):
These categories exist only to show how wide the range is. They are not options to pick from, and the strongest outcome is usually something not described here.
• Disruption arriving from outside: a disturbance in the street or building, an argument between people the character does not know, a procession or vehicle breaking down, power failing mid-conversation, something falling during a meal, a delivery opened by mistake with something private inside, a neighbour accusing them of something they did not do.
• Workplace situations: a coworker breaking down in a meeting, a customer's scene, a message sent to the wrong thread, a shared space failing and turning people against each other, an important visitor arriving while everything is going wrong, two people discovering an awkward overlap.
• Messages and social conflict: a stranger claiming to know something about someone close to them, an old photograph arriving with an unresolved accusation attached, being added by mistake to a thread about themselves, an apology for something they do not remember, a message meant for someone else, someone from years ago appearing and demanding to be heard.
• Embarrassment: an alarm sounding as they leave a shop with something they own, a chair giving way, a call left unmuted, a stain noticed too late, a door that will not open, being seen in a state they would not have chosen.
• Strange or serious: police asking about a previous occupant, a storage space someone else has been emptying, someone collapsing nearby, a building-wide commotion with emergency services, an unfamiliar letter about something from their childhood, being told they appear in something they never attended.
Each category above is one way in, not a box. An invented development that fits none of them is preferred to a recombined one that fits one too exactly.

PLAUSIBILITY ANCHOR — authoritative state outranks any example:
• Location (including a rabbit hole or a specific zone) decides what is possible here. Do not relocate the character, do not place them inside a business they are not in, and do NOT announce their address or narrate the location name just because it is known.
• If the character is ASLEEP, the development may wake them (a call, a knock, a sound, something found on waking) but must not require them to already be active.
• If the character is HOSPITALIZED, INCARCERATED, or otherwise CONFINED, the development must fit that reality: staff, facility, other patients, medical results, institutional or legal news — never a free walk outside, a night out, or a burglary they personally discover.
• At work or at school: the development must fit that setting and their actual role.
• At home: household failures, visitors, deliveries, discoveries, calls, and messages are all plausible.
• The current daypart is fixed. A development that begins at night stays in the night — it cannot continue through the afternoon, and no other daypart may be named.
• Earlier activity is not indefinitely ongoing. If cooking happened hours ago, the food is not still on the stove now. Recency decides.

PEOPLE — FICTIONAL AND UNESTABLISHED ONLY:
• A new or previously undetailed person may be introduced by name inside this narrative: an estranged cousin, a former friend, a doctor, a neighbor, a landlord, a stranger, a store employee, a person from work the character has never mentioned.
• That person does NOT need to exist as a character in the application. Do not create, alter, or require any application character to hold this memory.
• ABSOLUTE: do not add, change, harm, kill, or contradict any EXISTING established character or relationship in this world, and do not invent shared history between the user and a person the user has never been described knowing.
• Deaths are permitted only for a person introduced by this narrative or an unnamed acquaintance who is NOT an established application character. Never kill, injure, or ruin an established character, and never invent the death of a real public figure.
• Do not plant a memory into another character. The development belongs to ${character.name}.

BODY-AWARE RULES:
• A FEMALE character may realize her own period is late, take a test, or fear a possible pregnancy.
• A MALE character may receive the news from his girlfriend or female partner and carries the emotional impact — the possible pregnancy belongs to her, not him.
• Non-binary or unspecified: do not presume their body. Let the news arrive from a partner or a clinician instead.
• A pregnancy scare is NEVER a confirmed pregnancy. Do not state or imply a confirmed pregnancy, a certain positive test, or an existing pregnancy record.
• Match anatomy, age, and established relationship facts. Do not invent a partner who does not exist.

ORIGINALITY AND NON-REPETITION — the most common failure of this Action:
Every situation mentioned anywhere in this prompt is an ILLUSTRATION of range, never a menu. They exist to show how wide and unpredictable real life is — not to be selected from, rotated through, or completed like a checklist. The strongest outcome is usually one that is not mentioned here at all. Invent.

STEP A — NAME THE PREMISE BEFORE YOU WRITE (silently, every time):
Reduce the event you are about to write to one plain sentence of underlying premise — "someone shows up unannounced", "a medical result changes something", "a machine fails", "money is wrong", "an official notice arrives", "a stranger accuses them", "a discovery makes them question something".
Reduce each development already present in the beats and conversation above the same way, then compare PREMISES, not wording.
• If your premise already appears among those beats → discard it and invent a different premise.
• THE AREA TEST — apply it as well: name the AREA OF LIFE the event comes from — health and medical care, money and banking, housing and tenancy, work and employment, family, legal and official, institutions and records, romance, friendship and social life, possessions and property, travel and transport, public space and neighbours, other people's conflicts, strangers and the street. If an earlier beat already came from that area, the area is spent: take another one, even when your premise sentence for it looks different.
• THE FAMILY TEST — the stories that repeat most are these: money trouble; medical trouble or medical news; an unexpected or estranged relative or old acquaintance appearing; theft, burglary or loss; a stranger accusing, confronting or mistaking them; something in the home or building breaking; an official, legal or institutional notice changing their situation; work or job trouble; an animal; a record of them being wrong; an argument or scene erupting between people around them; a public embarrassment; a building-wide disturbance. If a beat above already used one of these, that storyline is spent for now — choose something that is not any of them.
• COSMETIC VARIATION TEST: if one noun could be swapped to turn your event into an earlier beat, it is the same development. "A billing notice for a procedure she never had" and "a consent form for a surgery she already had" are ONE development, not two. "A stranger accuses her" and "another stranger accuses her" are one development, not two. Failing this test means rewrite, not reword.
• A new name, a new object, a new room, a different stranger, a different relative, or a different appliance is NOT a new development. If the underlying situation is the same, discard it.
• If the last development used the same broad category, choose a different category unless nothing else is plausible here.
• The most overused defaults are: a knock at the door, a call or text arriving, someone showing up unannounced, a confrontation, and an appliance, pipe, machine, or part of the building failing. Treat all of them as overused, not as options — and never use the same one twice in a conversation.

STEP B — VARY MORE THAN THE EVENT:
Change the CATEGORY of the situation, the SEVERITY, and the TONE.
• Severity is chosen deliberately: an eye-roll, an inconvenience, an awkward moment, a real problem, and a life change are all valid. Do not escalate to an emergency by default.
• Tone must vary across selections: frightening, embarrassing, funny, financially annoying, socially awkward, medically concerning, emotionally complicated, quietly strange, or so unusual that ${character.name} struggles to believe it.
• Consecutive developments must not all land as serious problems, and must not all land as jokes.
• Do not favour arguments, confrontations, or emergencies. They are the easiest to reach for and must not become this Action's usual shape: embarrassment, absurdity, awkwardness, mild inconvenience, a strange coincidence, and other people's very human behaviour are equally valid and must appear at least as often.
• Quiet, private, logistical, and mundane are first-class outcomes, at least as often as loud ones.
• YOUR DEFAULT INSTINCT WILL BE AN OBJECT FAILING OR A NOISE IN THE ROOM. Override it. Unless a physical failure is genuinely the most plausible thing here, choose a development whose cause is a PERSON, an INSTITUTION, MONEY, an OBLIGATION, or INFORMATION — someone does something, someone decides something about them, a record is wrong, a rule changes, a payment or arrangement breaks, something is learned that was not known.
• Final self-check before writing: if the event could be summarized as "something broke, fell, leaked, or made a sound", rewrite it unless nothing else fits this character in this place right now.

STEP C — CONTINUATION OR RECYCLING? Decide deliberately:
• CONTINUATION is allowed when an open thread is genuinely ADVANCED — new information, its next step, or a consequence that had not happened yet. A character who chipped a tooth sees a dentist; a character with a worrying result attends the follow-up.
• RECYCLING is forbidden: re-triggering the same premise with cosmetic changes — a second relative appearing, a second theft, another medical scare of the same shape, another stranger starting something.
• If this beat would not move an open thread forward, choose an unrelated development instead.

DO NOT FILTER FOR THE UNUSUAL: something may be strange, statistically unlikely, or entirely unforeseen and still be completely possible. Do not reject an event because it is bizarre or because nothing foreshadowed it. Unpredictability is required. Only implausibility against the established facts, location, and elapsed time is forbidden.

REALITY IS NEVER BROKEN — the boundary on the above:
• Every event has an ordinary physical, human, institutional, or accidental cause. Strange means unlikely and surprising, never impossible.
• No supernatural, paranormal, psychic, prophetic, haunting, or cursed events. No reality glitches, no objects moving on their own, no unexplained phenomena, no uncanny coincidences presented as more than coincidence.
• No catastrophic global events, no celebrity or public-figure involvement, no impossible timing, and no knowledge the character could not actually have.
• ${character.name}'s reaction stays proportionate and grounded: they may be shaken, baffled, amused, or annoyed by something genuinely strange, but they do not accept an impossible explanation as fact.

CRAFT:
• Third person, in the tense the scene already reads. 2-3 sentences — the event, then the reaction.
• One grounded concrete detail of the event itself — what arrived, what broke, what was said, what was seen.
• React through behavior, not announced feeling. The first beat is the event; the second is what ${character.name} does about it.
• No dialogue dumps. At most one short quoted line.
• No meta commentary about "drama", "plot", "storylines", or "the narrative".
• Never use the words "chaos" or "chaotic".
════════════════════════════════════════════════════════════
` : "";

      // ── INSERT SERENITY — SPONTANEOUS GOOD ──────────────────────────────────────
      // Insert Serenity is the same single permission Insert Drama grants, pointed the
      // other way: one pleasant development may enter the character's life now, related
      // to the conversation or entirely unrelated. It carries the same constraints on
      // authoritative reality and the same prohibition on writing history for another
      // character, so nothing here can contradict the world or create a memory elsewhere.
      const serenityBlock = intent === 'serenity' ? `
════════════════════════════════════════════════════════════
INSERT SERENITY — SPONTANEOUS GOOD (SPECIAL RULE SET)
════════════════════════════════════════════════════════════
The selected Action is INSERT SERENITY. Something good, kind, helpful, comforting, or simply pleasant happens TO or AROUND ${character.name} — it was not being discussed and was not planned.

THIS OVERRIDES THE "DO NOT AUTHORIZE UNRELATED EVENTS" LINE ABOVE — FOR THIS SELECTION ONLY.
Every other continuity rule still applies: the scene starts exactly where the character is, and nothing already established may be contradicted.

WHAT THIS SELECTION IS:
• ONE pleasant development entering the character's life right now — good news, kindness, relief, comfort, ease, or a quietly enjoyable ordinary moment.
• Serenity does not have to be extraordinary. Nothing going wrong is sometimes exactly what makes a moment good: a particularly good breakfast, an unbroken quiet hour, a task finally finished, laughing at something ridiculous, a comfortable night's sleep, an afternoon spent doing nothing important.
• Serenity is also not only small. Its range is the whole spectrum: the same Action that can produce a good breakfast can produce a reunion, a discovery, news that changes a life, or a moment of overwhelming happiness. Neither end is the default — both are first-class outcomes.
• It may grow directly out of what is happening OR arrive completely unrelated to the current conversation.
• You choose the situation yourself. Anything named anywhere in this prompt is an example of the KIND of thing that can happen, offered to show breadth — never a set of options to choose from.
• It does NOT need foreshadowing. The conversation does not have to be about the subject first.
• It is an EVENT or a genuine moment that happened — not a mood, not a reflection, not a warmer retelling of the current exchange.
• It may leave something open: an invitation, a new interest, a reconnection, an approval that affects what comes next. It does not have to be resolved inside this narrative.

WHAT THIS SELECTION IS NOT:
✗ A restatement, summary, or happier description of what the conversation is already about
✗ The same kind of pleasant development as an earlier Insert Serenity narrative in this conversation
✗ An event that contradicts the authoritative location, presence, health, confinement, work, school, or relationship facts above
✗ Extraordinary good fortune every time — a windfall, a promotion, a life-changing opportunity, or an old friend reappearing in every selection
✗ A problem invented so that it can then be relieved. Do not open a complication in order to resolve it inside the same beat.
✗ Romance or sexual content. Keep any physical contact ordinary and non-romantic.
✗ A reward, a moral payoff, or a lesson. Good things do not arrive because the character earned them.
✗ The same four shapes again and again: an apology, a compliment, a call from someone out of their past, a thoughtful gift. Each is legitimate once; as a habit they are this Action failing.

RANGE — WHAT THE SPREAD LOOKS LIKE (illustration, never a menu):
These categories exist only to show how wide the range is. They are not options to pick from, and the strongest outcome is usually something not described here.
• Small pleasures and pleasant surprises: flowers left outside the door with no note, a song starting in a shop and strangers joining in, a cat settling beside them, a double rainbow after rain, a dessert arriving with a handwritten thank-you, a note found inside a secondhand book.
• Positive workplace moments: someone bringing food for everyone and a tense afternoon turning easy, a customer returning only to thank them, a routine gathering becoming sincere, an anonymous note of appreciation, a broken machine suddenly working, a recording from an earlier day setting the room laughing.
• Meaningful connections: a teacher from childhood making contact after finding something they wrote, someone remembering a small detail from years ago, a person they once comforted reporting back that life turned out well, two people recognising each other in a queue, a stranger saying their laugh reminds them of someone they loved.
• Extraordinary developments: an anonymous donation made in their honour, a community event dedicated to someone who shaped them, a photograph nobody knew existed, a recording of a voice they believed was lost, someone returning years later to say what a kindness meant, former classmates gathering letters and memories.
• Remarkable coincidences: meeting someone who looks almost exactly like them, a musician nearby playing the one song that matters to them, a rare photograph found in an old archive, a stranger recognising an inherited object and telling its story, several people from different periods of their life recognising them in one evening, a time capsule opened with their own handwriting inside.
Each category above is one way in, not a box. An invented moment that fits none of them is preferred to a recombined one that fits one too exactly.

PLAUSIBILITY ANCHOR — authoritative state outranks any example:
• Location (including a rabbit hole or a specific zone) decides what is possible here. Do not relocate the character to make a pleasant moment happen, do not place them inside a business they are not in, and do NOT announce their address or narrate the location name just because it is known.
• If the character is ASLEEP, the good thing may be a genuinely restful, uninterrupted night or what greets them on waking — it must not require them to already be active.
• If the character is HOSPITALIZED or CONFINED, the moment must fit that reality: reassuring results, a kind nurse or cellmate, a letter, a visit, a small comfort available there.
• At work or at school: the moment must fit that setting and their actual role — a helpful coworker, an unexpected free period, something finished early.
• At home: a neighbor's meal, an easy morning, a forgotten thing found, a delivery that is exactly what was wanted.
• The current daypart is fixed. A moment that begins at night stays in the night — it cannot continue through the afternoon, and no other daypart may be named. A pleasantly "easy morning" may only appear if the real time is morning.
• Earlier activity is not indefinitely ongoing. If cooking happened hours ago, the food is not still on the stove now. Recency decides.

PEOPLE — FICTIONAL AND UNESTABLISHED ONLY:
• A helpful stranger, neighbor, coworker, store employee, or former acquaintance may be introduced inside this narrative. That person does NOT need to exist as a character in the application.
• ABSOLUTE: do not create, alter, harm, require, or contradict any EXISTING established character or relationship, and do not plant a memory into another character. An act of kindness does not require anyone else's memory to change.
• No deaths, injuries, or harm to anyone. This selection introduces nothing damaging.

EMOTIONAL VARIETY — do not flatten every good thing into celebration:
• Quiet contentment, relief, gratitude, comfort, amusement, peacefulness, affection, satisfaction, pleasant surprise, simple enjoyment, joy and celebration are all valid.
• Match the feeling to the size of the event. An unexpectedly peaceful afternoon is not a major emotional revelation.
• Consecutive selections must not all land as big joyful news, and must not all land as tiny pleasant nothings.

ORIGINALITY AND NON-REPETITION — the most common failure of this Action:
Every situation mentioned anywhere in this prompt is an ILLUSTRATION of range, never a menu. The strongest outcome is usually one that is not mentioned here at all. Invent.

STEP A — NAME THE PREMISE BEFORE YOU WRITE (silently, every time):
Reduce the moment you are about to write to one plain sentence of underlying premise — "money arrives unexpectedly", "a stranger is kind", "a frustration is gently helped", "an old friend reappears", "a task goes unusually easily", "food turns out wonderful", "rest finally comes", "someone says something appreciative", "a place or interest is discovered", "work is recognized".
Reduce each development already present in the beats and conversation above the same way, then compare PREMISES, not wording.
• If your premise already appears among those beats → discard it and invent a different premise.
• THE AREA TEST — name the AREA OF LIFE the moment comes from: money and finances, work and opportunity, health and body, home and comfort, food and everyday pleasure, friendship and social life, family, affection, rest and routine, learning and discovery, possessions and small finds, public life and strangers, community and public moments, memory and keepsakes, coincidence and unlikely recognition. If an earlier beat already came from that area, the area is spent: take another one, even when your premise sentence for it looks different.
• THE OVERUSED-FAMILY TEST — these are the stories that repeat most, and are spent once used in this conversation: unexpected money or a refund; a compliment from a stranger; an old friend or former acquaintance calling to reconnect; good news from work or an opportunity approved; someone paying for the character's drink or food; a neighbor bringing food over; finding something lost; a medical result coming back reassuring; an apology received; a thoughtful gift for no occasion; a stranger remarking on something about them. If a beat above already used one of them, choose something that is none of them.
• COSMETIC VARIATION TEST: if one noun or amount could be swapped to turn your moment into an earlier beat, it is the same development. "A stranger buys her coffee" and "a stranger buys her lunch" are ONE development, not two. Failing this test means rewrite, not reword. Changing the person, amount, location, or wording does not make it different.
• A new name, a new object, a new room, a different relative, or a different flavor of the same kindness is NOT a new development.
• VARY SCALE AND TONE deliberately: tiny (a song at the right moment, a perfect peach), ordinary (an easy morning, a finished task), meaningful (an apology received, a goal reached), and joyous (wonderful news, a celebration) are all valid. Choose a different size from the last one.

STEP B — CONTINUATION OR RECYCLING? Decide deliberately:
• CONTINUATION is allowed only when an open thread is genuinely ADVANCED — the next step of something already in motion (the invitation actually arrives, the new hobby is tried for the first time, the friend follows through).
• RECYCLING is forbidden: the same kind of pleasant thing again with different surface details.
• If this beat would not move an open thread forward, choose an unrelated pleasant development instead.

DO NOT FILTER FOR THE REMARKABLE — AND DO NOT FILTER FOR THE PLAIN: a good thing does not have to be surprising, statistically unlikely, or out of the ordinary, and it does not have to be small either. Ordinary pleasantness and extraordinary good fortune are equally valid outcomes. What matters is that the size and register change between selections instead of settling into one habit.

REALITY IS NEVER BROKEN — the boundary on the above:
• Every moment has an ordinary human, physical, institutional, or accidental cause. No supernatural, paranormal, prophetic, or mystical events; no omens, signs, or prayers answered as fact; no unexplained phenomena presented as more than coincidence.
• No catastrophic or global events, no celebrity or public-figure involvement, no impossible timing, and no knowledge the character could not actually have.
• ${character.name}'s reaction stays proportionate and grounded to who they are.

CRAFT:
• Third person, in the tense the scene already reads. 2-3 sentences — the moment, then the reaction to it.
• One grounded concrete detail of the moment itself — what arrived, what was said, what was tasted, what was seen.
• React through behavior, not announced feeling. The first beat is the moment; the second is what ${character.name} does with it.
• No dialogue dumps. At most one short quoted line.
• Restraint: do not explain why the good thing happened, and do not moralize about it.
• Never use the word "serenity" or the word "blessed" in the narrative itself.
• No meta commentary about "storylines", "the narrative", or "the story".
════════════════════════════════════════════════════════════
` : "";

      // Motif pool — only for romantic-eligible intents where escalation is permitted
      const motifBlock = (romanticOk && (intent === 'flirt' || intent === 'spend_time' || intent === 'comfort' || (intent === 'action' && contextTier !== 'low')))
        ? `
════════════════════════════════════════════════════════════
ROMANTIC STYLE MOTIF POOL (draw from naturally — do NOT label which technique is in use):
${buildStyleMotifContext()}
════════════════════════════════════════════════════════════
`
        : "";

      // Engine guidance + A–CN example library — additive, applies to ALL intents
      const engineGuidanceBlock = buildExtendedNarrativeExampleContext();

      // Intent action descriptions — each must produce RECOGNIZABLE behavior.
      // The selected Action changes the emotional/behavioral DIRECTION of the
      // interaction. It does NOT restart the scene, change the location, erase
      // the preceding interaction, or reset the character's emotional condition.
      const intentDescriptions = {
        action: contextTier === "high"
          ? "LET THEM ACT — the character independently chooses what to do based on personality, current mood, circumstances, and the ongoing conversation. Follow HIGH emotional momentum naturally. The character has agency — they may flirt, confront, comfort, withdraw, or continue an activity. Do NOT default to a generic neutral action."
          : contextTier === "medium"
          ? "LET THEM ACT — the character independently chooses what to do based on personality, current mood, circumstances, and the ongoing conversation. Follow MEDIUM emotional momentum. The character has agency — do NOT force a predetermined emotional category."
          : "LET THEM ACT — the character independently chooses what to do based on personality, current mood, circumstances, and the ongoing conversation. LOW emotional momentum — small gesture, light presence. The character has agency — do NOT default to a generic neutral action.",
        comfort: "COMFORT ME — generate a genuinely comforting narrative appropriate to the present situation. Comfort through tenderness, supportive dialogue, reassurance, affection, attentive behavior, or physical closeness where appropriate. Express comfort through actual character BEHAVIOR, not by claiming the character is comforting. Comfort is NOT flirtation. Do not escalate into romance.",
        flirt: romanticOk
          ? "FLIRT — generate recognizable flirtation. Playful dialogue, teasing, suggestive humor, meaningful glances, attraction, romantic tension, affectionate gestures. Intensity reflects the current conversation and relationship. Subtle, moderate, or intense — but it MUST actually be flirtatious."
          : "FLIRT — playful warm energy — fun and light but NOT physical. No kissing or romantic touch. Still recognizable flirtation through tone, teasing, and playful energy.",
        confront: "CONFRONT — introduce or develop meaningful confrontation related to the current circumstances. Disagreement, frustration, emotional challenges, difficult questions, interpersonal tension, resistance. NOT romance. NOT shouting automatically — expression depends on personality and situation. Actions: stepping into space, blocking movement, sharp tone, controlled aggression. Absolutely NO kissing, romantic touching, or sensual metaphor.",
        spend_time: "SPEND TIME — generate a narrative where the character meaningfully spends time with the user or engages in shared presence. Conversation, companionship, quiet moments, shared activities, attentiveness. Do NOT leave the current scene, begin an unrelated activity alone, or force a dramatic event. Develop the current interaction into a recognizable moment of companionship.",
        check_in: "CHECK IN — generate a meaningful check-in relating to the current conversation, circumstances, or emotional condition. The character demonstrates interest in how the user is doing, feeling, or coping. Gentle, casual, serious, affectionate, or concerned depending on personality and context. Do NOT ask a question that ignores information already provided in the conversation. Do NOT restart the same inquiry if already asked.",

        drama: "INSERT DRAMA — introduce ONE spontaneous, unexpected development that is happening to or around the character right now. It may grow out of the current conversation or be entirely unrelated to it. It must be an EVENT, not a restatement, summary, or dramatic retelling of what is already being discussed, and it needs no foreshadowing. It must be plausible for the authoritative location and circumstances, must not invent or alter any existing character, and must stay OPEN — a complication, discovery, question, or change that can continue into later conversations and decisions. Do not resolve it. Invent the premise yourself: it must not share its underlying situation, category, or severity with any earlier development already present in this conversation, and it must not be drawn from any example in this prompt.",

        serenity: "INSERT SERENITY — introduce ONE spontaneous, pleasant development that is happening to or around the character right now: good news, kindness, relief, comfort, ease, or a quietly enjoyable ordinary moment. It may grow out of the current conversation or be entirely unrelated to it. It must be an EVENT or a genuine moment that happened, not a restatement, summary, or happier retelling of what is already being discussed, and it needs no foreshadowing. It must be plausible for the authoritative location and circumstances, must not invent or alter any existing character, and may leave something open that can continue into later conversations. Serenity does not have to be extraordinary — ordinary pleasantness is as valid as good fortune. Invent the premise yourself: it must not share its underlying situation or area of life with any earlier development in this conversation, and it must not be drawn from any example in this prompt.",
      };

      // Context tier instruction
      const tierInstruction = (isFamilial || isMentor)
        ? "CONTEXT TIER: IGNORED — relationship type enforces non-romantic content regardless of conversation history."
        : intent === 'drama'
        ? "CONTEXT TIER: IGNORED — Insert Drama introduces circumstances surrounding the character, not intimacy. Keep any physical contact ordinary and non-romantic."
        : intent === 'serenity'
        ? "CONTEXT TIER: IGNORED — Insert Serenity introduces a pleasant development around the character, not intimacy. Keep any physical contact ordinary and non-romantic."
        : contextTier === "high"
          ? "CONTEXT TIER: HIGH — strong physical closeness, kissing, pulling closer allowed. Keep non-explicit but immersive."
          : contextTier === "medium"
          ? "CONTEXT TIER: MEDIUM — moderate physical closeness allowed. Let metaphor deepen the tone."
          : "CONTEXT TIER: LOW — do NOT jump to romantic or passionate actions. Use soft, grounding actions only.";

      // Intent type enforcement rules
      const intentEnforcement = {
        CONFLICT: "Generate tension and confrontation — NOT romance. Stepping into space, blocking movement, grabbing arm non-romantically, sharp tone, controlled aggression. NO kissing, romantic touch, or sensual metaphor.",
        FRIENDSHIP: "Emotional closeness is fine. Touch must NOT be romantic. Allowed: non-romantic hug, sitting close, shoulder contact, grabbing arm to stop them. Never: kissing, romantic body alignment, romantic face/waist touching.",
        ROMANTIC: `Romantic and physical escalation is allowed — attraction (${attractionLevel}/100) and relationship support it. Scale intensity to context tier.`,
        FAMILIAL: "See ABSOLUTE HARD BLOCK above. No exceptions whatsoever.",
        MENTORSHIP: "See ABSOLUTE HARD BLOCK above. No exceptions whatsoever.",
      };

      const prompt = `${hardBoundary}${confinementBlock}

You are writing a SHORT third-person narrative scene (2-4 sentences) for ${character.name}.

CHARACTER: ${character.name}
Personality: ${character.personality_summary || "unknown"}
Emotional state: ${emotionalState}
Location: ${location}
Relationship type: ${intentType}
Friendship: ${friendshipLevel}/100 | Romantic: ${romanticLevel}/100 | Attraction: ${attractionLevel}/100
${temporalBlock}
${userPresenceBlock}
${currentMomentBlock}
${narrativeContinuityBlock}
${progressionBlock}${dramaBlock}${serenityBlock}${motifBlock}

${engineGuidanceBlock}

RECENT CONVERSATION (current window — for reference only; the CURRENT MOMENT block above is authoritative):
${recentContext || "(no recent messages)"}${actionMemory}

════════════════════════════════════
MANDATORY ENGINE — EXECUTE BEFORE WRITING (all 4 steps required)
════════════════════════════════════
STEP 1 — CONFIRM INTERACTION TYPE: ${intent.toUpperCase()} (${intentType})

STEP 2 — SELECT ONE BEHAVIOR PATTERN (choose from the correct library, never repeat the same pattern twice):
${intent === 'flirt' || (intent === 'action' && contextTier !== 'low' && romanticOk) ? `
  FLIRT PATTERNS — select ONE:
  close without touching | playful challenge | accidental contact | low voice moment | testing the line | shared recognition | inside language | confidence shift | energy matching | subtle claim` : ''}
${intent === 'comfort' ? `
  COMFORT PATTERNS — select ONE:
  quiet presence | soft redirect | protective energy | validation without fixing | physical reassurance | seen without explaining | identity affirmation | after a long day | protective check-in | rebuilding after hurt` : ''}
${intent === 'check_in' ? `
  REASSURE or CHECK-IN PATTERNS — select ONE:
  emotional validation + grounding | reframing fear into manageable | tone softness and pacing | safety through presence | open-ended question with real attention behind it | non-verbal cue detection | emotional temperature reading` : ''}
${intent === 'confront' ? `
  CONFLICT PATTERNS — select ONE:
  emotional build-up before release | specific vs vague confrontation | who controls the floor | power dynamic shift | resolution path (explode / simmer / walk away)` : ''}
${intent === 'spend_time' ? `
  SPEND TIME PATTERNS — select ONE:
  shared activity together | comfortable silence with no urgency | background environment shaping the moment | time passing naturally | subtle bonding through small things` : ''}
${intent === 'drama' ? `
  INSERT DRAMA — THERE IS NO PATTERN MENU:
  Do not pick from a list of situations. First derive the underlying premise of every development already present in the beats above (STEP A of the Insert Drama block), then INVENT one development whose premise is none of them. If you notice the result is an earlier premise wearing new surface details, discard it and invent again. Originality is the requirement here, not compliance with an example.` : ''}
${intent === 'serenity' ? `
  INSERT SERENITY — THERE IS NO PATTERN MENU:
  Do not pick from a list of pleasant situations. First derive the underlying premise and area of life of every development already present in the beats above (STEP A of the Insert Serenity block), then INVENT one moment whose premise is none of them and whose area of life has not already been used. If the result is an earlier moment with a different stranger, amount, place, or flavor, discard it and invent again. Originality and variety of SIZE — from the wonderfully tiny to the genuinely joyful — are the requirements here.` : ''}
${intent === 'action' ? `
  LET THEM ACT PATTERNS — select ONE:
  environmental interaction with objects | micro-behaviors (glance, posture shift, physical tell) | time progression awareness | reaction to background stimuli | silent action that carries meaning` : ''}

STEP 3 — APPLY ONE VARIATION HOOK (required — scene without a hook is invalid):
${intent === 'drama' ? `
  Choose one: it lands at the worst possible moment | it arrives in front of other people | it is small but the timing makes it enormous | it is bigger than anything the conversation was about | they do not fully understand it yet | someone else knows before they do | it forces an immediate decision | it reveals something they were not supposed to find out` : intent === 'serenity' ? `
  Choose one: it arrives at a quiet moment nobody else is watching | it is smaller than they expected and that is the relief | it happens while they are alone with it | they only notice it later | someone they barely know witnesses it | it costs them nothing | it changes nothing else about the day | it arrives right after they had given up` : intent === 'flirt' ? `
  Choose one: interruption that breaks the moment | hesitation that changes direction | one person more aware than the other | escalation then deliberate pullback | signal that gets misread | external pressure at the wrong moment | timing emotionally off between them` : `
  Choose one: timing mismatch | emotional misread | expectation vs what actually happens | memory callback shaping the present | environment applying pressure | someone opens up more than intended | humor deflects before the real thing surfaces`}

STEP 4 — EMBED ONE ROOT THEME (weave naturally — never state it directly):
unspoken tension | timing mismatch | power imbalance shift | memory callback | environment pressure | internal vs external conflict | expectation vs reality | control vs vulnerability | guardedness giving way | micro-validation | chosen family energy | public vs private identity shift

════════════════════════════════════
${tierInstruction}

INTENT: Generate ${intentDescriptions[intent] || intentDescriptions.action}

INTENT TYPE — ${intentType}:
${intentEnforcement[intentType] || ""}

CONSENT CHECK: If the other person shows hesitation → reduce intensity. If clear resistance → block escalation entirely.

LGBTQ+ RULE: All patterns apply identically regardless of gender combination. No tone changes based on pairing. Pronouns from profile only.

STYLE RULES:
- Third person only ("${character.name} reaches...", "He looks up...")
- ONE continuous paragraph, clean punctuation, no em dashes mid-sentence
- State what the character is physically doing — metaphor intensifies action, does NOT replace it
- 2-4 sentences max. Tight. Cinematic. Real.
- No explicit content — suggestive and emotionally charged is fine
- One short quoted line of dialogue allowed if it fits naturally
- Include one grounded environmental detail. Rotate from: SURFACE, OBJECTS, FABRIC, SOUND, LIGHT, MOVEMENT, TEMPERATURE, CONSTRAINT.
- Do NOT repeat descriptive patterns from recent outputs. Vary the sensory entry point each time.
- Time of day is fixed by the temporal block above. Never state a different daypart, and never let a duration ("for the rest of...", "until the sun...", "by the time the light...") contradict it. If a time reference is not necessary, write the moment without one.

${(intent === 'drama' || intent === 'serenity')
  ? `Return JSON only, with exactly these three fields — no other text:
{ "premise": "one plain sentence naming the underlying development you chose (STEP A)", "area_of_life": "the area of life it comes from (THE AREA TEST)", "narrative": "the 2-3 sentence narrative" }
The premise and area must describe what you actually wrote.`
  : `Return ONLY the narrative text. No labels, no JSON, no extra commentary.`}`;

// Insert Drama and Insert Serenity are the Actions validated before saving: their
// failure mode is a repeated development wearing new surface details. Each prompt
// already tests against that, and the finished development is checked against the
// beats already in this conversation. One replacement attempt, then accept.
let result = "";

if (intent !== 'drama' && intent !== 'serenity') {
  const raw = await base44.integrations.Core.InvokeLLM({ prompt });
  result = typeof raw === "string" ? raw.trim() : "";
} else {
  const priorBeats = allRecentNarratives.map(m => m.content).join("\n---\n");

  const generateDrama = async (rejectionNote = "") => {
    const raw = await base44.integrations.Core.InvokeLLM({
      prompt: rejectionNote ? `${prompt}\n\n${rejectionNote}` : prompt,
      response_json_schema: {
        type: "object",
        properties: {
          premise: { type: "string" },
          area_of_life: { type: "string" },
          narrative: { type: "string" },
        },
        required: ["premise", "area_of_life", "narrative"],
      },
    });
    return {
      narrative: typeof raw?.narrative === "string" ? raw.narrative.trim() : "",
      premise: typeof raw?.premise === "string" ? raw.premise : "",
      area: typeof raw?.area_of_life === "string" ? raw.area_of_life : "",
    };
  };

  let attempt = await generateDrama();

  if (attempt.narrative && priorBeats) {
    const duplicate = intent === 'serenity'
      ? await isRepeatedSerenity({
          candidatePremise: attempt.premise,
          candidateArea: attempt.area,
          priorBeats,
        })
      : await isDuplicateDevelopment({
          candidatePremise: attempt.premise,
          candidateArea: attempt.area,
          priorBeats,
        });
    if (duplicate) {
      console.log(`[NarrativeButton] Insert ${intent === 'serenity' ? 'Serenity' : 'Drama'} repeated an existing development — regenerating:`, attempt.premise);
      const retry = await generateDrama(
        intent === 'serenity'
          ? `REPLACE THE MOMENT. "${attempt.premise}"${attempt.area ? ` (area of life: ${attempt.area})` : ""} repeats something that already happened in this conversation.
      HARD REQUIREMENT: do not write another version of that moment, and do not stay in its area of life. Different people, amounts, places, flavors or wording do not satisfy this — the KIND of pleasant development must change.
      Change the size as well: if the last one was a big good thing, make this an ordinary one, and the reverse.
      Write the different moment, plausibly for their actual circumstances.`
          : `REPLACE THE DEVELOPMENT. "${attempt.premise}"${attempt.area ? ` (area of life: ${attempt.area})` : ""} repeats a storyline that already happened in this conversation.
      HARD REQUIREMENT: do not write another version of that development, and do not stay in its concern family. If it was an administrative mix-up, do not write another mix-up, wrong record, wrong room, or someone arriving with the wrong information. Different names, objects, people or wording do not satisfy this — the KIND of development must change.
      It does not have to happen where they are. A development elsewhere that reaches them is valid: news about their home, someone they know, money, an obligation, or something that changes what happens next.
      Write the different development, plausibly for their actual circumstances.`
      );
      if (retry.narrative) attempt = retry;
    }
  }

  result = attempt.narrative;
}

if (!result || typeof result !== "string" || result.trim().length < 10) {
  throw new Error("Empty narrative returned");
}

      const narrativeMsg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: "character",
        character_id: character.id,
        character_name: character.name,
        content: result.trim(),
        is_narrative: true,
        is_read: true,
        timestamp: new Date().toISOString(),
      });

      await base44.entities.Conversation.update(conversationId, {
        last_message_preview: `✦ ${result.trim().substring(0, 80)}...`,
        last_message_date: new Date().toISOString(),
      }).catch(() => {});

      onNarrativeCreated?.(narrativeMsg);
      startCooldown();
    } catch (err) {
      console.error("[NarrativeButton] Failed:", err.message);
    } finally {
      setLoading(false);
      // Always reset external trigger so Action can be reopened
      onExternalClose?.();
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-[200] bg-black/40" onClick={() => { onExternalClose?.(); }} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-[100px] left-1/2 -translate-x-1/2 z-[201] bg-card border border-border rounded-2xl shadow-2xl p-2 w-[min(260px,90vw)] max-h-[calc(100vh-160px)] overflow-y-auto"
          >
            <p className="text-[10px] text-muted-foreground px-2 pb-1.5 uppercase tracking-wider font-medium">
              What should they do?
            </p>
            {loading ? (
              <p className="text-xs text-muted-foreground px-2 py-3 text-center">Generating…</p>
            ) : (
              INTENT_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => triggerNarrative(opt.id)}
                  disabled={cooldown > 0}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-secondary/70 transition-colors text-left group disabled:opacity-40"
                >
                  <span className="text-base leading-none">{opt.emoji}</span>
                  <div>
                    <p className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground">{opt.description}</p>
                  </div>
                </button>
              ))
            )}
            {cooldown > 0 && (
              <p className="text-[10px] text-muted-foreground text-center py-1">Cooldown: {cooldown}s</p>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}