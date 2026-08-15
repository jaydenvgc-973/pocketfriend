import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const { story_event_id, owner_email, character_ids, user_context } = payload;

    if (!story_event_id) return Response.json({ error: 'story_event_id required' }, { status: 400 });
    const effectiveOwnerEmail = owner_email || user?.email;
    if (!effectiveOwnerEmail) return Response.json({ error: 'owner_email required' }, { status: 401 });

    // Load Story Event — must be complete
    const events = await base44.asServiceRole.entities.StoryEvent.filter({ id: story_event_id }, null, 1);
    if (!events[0]) return Response.json({ error: 'Story Event not found' }, { status: 404 });
    const event = events[0];
    if (event.status !== 'complete') {
      return Response.json({ error: 'Story Event must be complete before public impact processing' }, { status: 400 });
    }

    const participantIds = character_ids || event.participant_character_ids || [];
    const participantNames = event.participant_character_names || [];
    const focusNames = event.focus_character_names || [];
    if (participantIds.length === 0) return Response.json({ error: 'No participants to process' }, { status: 400 });

    // Load characters
    const characters = await base44.asServiceRole.entities.Character.filter({ owner_email: effectiveOwnerEmail });
    const charMap = {};
    for (const c of characters) charMap[c.id] = c;

    // Load existing PublicProfiles
    const profiles = await base44.asServiceRole.entities.PublicProfile.filter({ owner_email: effectiveOwnerEmail });
    const profileMap = {};
    for (const p of profiles) profileMap[p.character_id] = p;

    // Idempotency: skip participants whose public_record already has this story_event_id
    const toProcess = participantIds.filter(id => {
      const p = profileMap[id];
      if (!p) return true;
      return !(p.public_record || []).some(r => r.story_event_id === story_event_id);
    });
    if (toProcess.length === 0) {
      return Response.json({ success: true, message: 'All participants already have public impact for this event', results: [] });
    }

    // Build LLM analysis context
    const eventContext = {
      title: event.title,
      plot: event.plot,
      narrative: event.generated_narrative,
      venue: event.venue_name,
      event_date: event.event_date,
      participants: toProcess.map(id => ({
        id,
        name: participantNames[participantIds.indexOf(id)] || charMap[id]?.name || 'Unknown',
        is_focus: focusNames.includes(participantNames[participantIds.indexOf(id)]),
      })),
      user_context: user_context || null,
    };

    const llmPrompt = `You are a public relations analyst. Analyze the following completed story event and determine what PROPORTIONAL public consequences are justified for each participant.

CRITICAL PRINCIPLES — VIOLATING THESE IS A SYSTEM FAILURE:
- Most events should produce MINIMAL or NO public impact. Fame is NOT inevitable.
- Impact must be evidence-based — use what ACTUALLY happened in the event narrative, not the event category name.
- A character attending an event does NOT automatically make them respected or famous.
- Impact must be PROPORTIONAL to the event's actual public significance.
- Different participants may have different impact levels based on their role.
- "Unknown" characters should generally remain unknown unless the event genuinely warrants otherwise.
- Do NOT inflate metrics. A community event = neighborhood or community scope, NOT national.
- attention_delta: 0-3 for minor events, 3-8 for notable local events, 8-15 for significant public events, 15+ only for major campaigns/performances with broad reach.
- respect_delta: 0-2 for minor involvement, 2-5 for meaningful contribution, 5+ only for significant leadership/achievement.
- notoriety_delta: 0 for most events, only >0 for genuinely controversial or remarkable circumstances.
- infamy_delta: 0 for most events, only >0 for genuinely negative public history.
- recognition_level_change: null for most events. Only change when sustained/repeated exposure genuinely warrants advancement. Do NOT advance from "unknown" to "locally_known" from a single community event — use "familiar_face" at most.
- known_for_additions: empty for most events. Only add when the event genuinely establishes a public association.
- world_perception_updates: ONLY for characters where accumulated evidence now warrants a meaningful public perception paragraph. Most characters should NOT get one.

For each participant, return:
{
  "character_id": "...",
  "public_category": "community_participation|campaign|performance|public_appearance|public_activism|fashion_show|photo_campaign|charity_event|award|publication|interview|public_incident|other",
  "exposure_scope": "neighborhood|community|local|regional|professional|industry|cultural|national|international|specialized",
  "impact_tier": "headliner|feature|secondary|minor_mention",
  "attention_delta": 0,
  "respect_delta": 0,
  "notoriety_delta": 0,
  "infamy_delta": 0,
  "recognition_level_change": null,
  "known_for_additions": [],
  "impact_summary": "One sentence describing the public consequence for this character."
}

Event to analyze:
${JSON.stringify(eventContext, null, 2)}`;

    const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: llmPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          participants: {
            type: "array",
            items: {
              type: "object",
              properties: {
                character_id: { type: "string" },
                public_category: { type: "string" },
                exposure_scope: { type: "string" },
                impact_tier: { type: "string" },
                attention_delta: { type: "number" },
                respect_delta: { type: "number" },
                notoriety_delta: { type: "number" },
                infamy_delta: { type: "number" },
                recognition_level_change: { type: "string" },
                known_for_additions: { type: "array", items: { type: "string" } },
                impact_summary: { type: "string" }
              }
            }
          },
          world_perception_updates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                character_id: { type: "string" },
                perception_text: { type: "string" }
              }
            }
          }
        }
      }
    });

    const analysis = llmResult;
    const results = [];
    const nowIso = new Date().toISOString();

    for (const pAnalysis of analysis.participants || []) {
      const charId = pAnalysis.character_id;
      const char = charMap[charId];
      if (!char) continue;

      // Get or create PublicProfile
      let profile = profileMap[charId];
      if (!profile) {
        profile = await base44.asServiceRole.entities.PublicProfile.create({
          character_id: charId,
          character_name: char.name || char.display_name || 'Character',
          owner_email: effectiveOwnerEmail,
          recognition_level: 'unknown', recognition_scope: 'none',
          current_attention: 0, respect_level: 0, notoriety_level: 0, infamy_level: 0,
          known_for: [], public_record: [], locks: {},
          world_perception_insufficient: true,
          last_attention_decay_at: nowIso,
        });
        profileMap[charId] = profile;
      }

      const locks = profile.locks || {};
      const update = {};

      if (!locks.current_attention) {
        update.current_attention = Math.min(100, Math.max(0, (profile.current_attention || 0) + (pAnalysis.attention_delta || 0)));
        update.attention_scope = pAnalysis.exposure_scope || profile.attention_scope || 'none';
      }
      if (!locks.respect) {
        update.respect_level = Math.min(100, Math.max(0, (profile.respect_level || 0) + (pAnalysis.respect_delta || 0)));
      }
      if (!locks.notoriety) {
        update.notoriety_level = Math.min(100, Math.max(0, (profile.notoriety_level || 0) + (pAnalysis.notoriety_delta || 0)));
      }
      if (!locks.infamy) {
        update.infamy_level = Math.min(100, Math.max(0, (profile.infamy_level || 0) + (pAnalysis.infamy_delta || 0)));
      }
      if (!locks.recognition && pAnalysis.recognition_level_change && pAnalysis.recognition_level_change !== 'null' && pAnalysis.recognition_level_change !== '') {
        update.recognition_level = pAnalysis.recognition_level_change;
        update.recognition_scope = pAnalysis.exposure_scope || profile.recognition_scope || 'none';
      }
      if (pAnalysis.known_for_additions && pAnalysis.known_for_additions.length > 0) {
        const existing = profile.known_for || [];
        update.known_for = [...new Set([...existing, ...pAnalysis.known_for_additions])].slice(0, 10);
      }

      // Public record entry
      const recordEntry = {
        story_event_id,
        event_title: event.title,
        event_date: event.event_date,
        public_category: pAnalysis.public_category,
        exposure_scope: pAnalysis.exposure_scope,
        impact_tier: pAnalysis.impact_tier,
        role_description: focusNames.includes(char.name) ? 'Focus participant' : 'Participant',
        impact_summary: pAnalysis.impact_summary,
        designated_at: nowIso,
      };
      update.public_record = [...(profile.public_record || []), recordEntry];

      // World perception
      const perceptionUpdate = (analysis.world_perception_updates || []).find(w => w.character_id === charId);
      if (perceptionUpdate && !locks.public_image) {
        update.world_perception = perceptionUpdate.perception_text;
        update.world_perception_updated_at = nowIso;
        update.world_perception_insufficient = false;
      }

      update.last_public_impact_at = nowIso;
      await base44.asServiceRole.entities.PublicProfile.update(profile.id, update);

      results.push({
        character_id: charId,
        character_name: char.name,
        impact_tier: pAnalysis.impact_tier,
        attention_delta: pAnalysis.attention_delta,
        respect_delta: pAnalysis.respect_delta,
        recognition_level_change: pAnalysis.recognition_level_change,
        impact_summary: pAnalysis.impact_summary,
      });
    }

    return Response.json({ success: true, results, event_id: story_event_id });
  } catch (error) {
    console.error('processPublicImpact error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});