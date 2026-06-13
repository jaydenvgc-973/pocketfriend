import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let characters = [];
    try {
      characters = await base44.entities.Character.filter({
        owner_email: user.email, status: 'active',
      }, null, 300);
    } catch {
      characters = await base44.asServiceRole.entities.Character.filter({
        status: 'active',
      }, null, 300).then(all => all.filter(c => c.owner_email === user.email));
    }

    // Find by "Ethan" regardless of case or extra spaces
    const ethan = characters.find(c =>
      (c.name || '').toLowerCase().replace(/\s+/g, ' ').trim().includes('ethan')
    );
    if (!ethan) {
      // Fallback: return all character names for debugging
      return Response.json({
        error: 'Ethan not found',
        character_count: characters.length,
        character_names: characters.map(c => c.name).filter(Boolean).slice(0, 50),
      });
    }

    const locations = await base44.asServiceRole.entities.LocationReference.filter({
      owner_email: user.email,
    }, null, 500).catch(() => []);

    const workplaces = locations.filter(l => (l.worker_character_ids || []).includes(ethan.id));

    const storyEvents = await base44.asServiceRole.entities.StoryEvent.filter({
      owner_email: user.email,
    }, '-event_date', 50).catch(() => []);

    const gradEvents = storyEvents.filter(e =>
      (e.participant_character_ids || []).includes(ethan.id)
    );

    const lifeEvents = await base44.asServiceRole.entities.LifeEvent.filter({
      character_id: ethan.id,
    }, '-timestamp', 30).catch(() => []);

    const locHistory = await base44.asServiceRole.entities.LocationHistory.filter({
      character_id: ethan.id, owner_email: user.email,
    }, '-arrival_time', 30).catch(() => []);

    const travelSessions = await base44.asServiceRole.entities.TravelSession.filter({
      character_id: ethan.id, owner_email: user.email,
    }, '-created_at', 20).catch(() => []);

    return Response.json({
      character_id: ethan.id,
      name: ethan.name,
      occupation_location_id: ethan.occupation_location_id || null,
      current_work_location_id: ethan.current_work_location_id || null,
      work_start_time: ethan.work_start_time || null,
      work_end_time: ethan.work_end_time || null,
      work_days: ethan.work_days || null,
      presence_stay_lock: ethan.presence_stay_lock || false,
      student_status: ethan.student_status || null,
      education_enrollments: ethan.education_enrollments || [],
      completed_education: ethan.completed_education || [],
      resolved_presence_status: ethan.resolved_presence_status || null,
      resolved_current_location_id: ethan.resolved_current_location_id || null,
      resolved_source_reason: ethan.resolved_source_reason || null,
      workplaces_with_ethan: workplaces.map(w => ({
        id: w.id, name: w.name, category: w.category,
        shift: w.worker_shifts?.[ethan.id] || null,
        job_title: w.worker_job_titles?.[ethan.id] || null,
      })),
      graduation_events: gradEvents.map(e => ({
        title: e.title, event_date: e.event_date,
        start_time: e.start_time, end_time: e.end_time, status: e.status,
      })),
      recent_life_events: lifeEvents.slice(0, 10).map(e => ({
        title: e.title, event_type: e.event_type, timestamp: e.timestamp,
      })),
      recent_location_history: locHistory.slice(0, 10).map(h => ({
        location_name: h.location_name, event_type: h.event_type,
        arrival_time: h.arrival_time, travel_reason: h.travel_reason,
      })),
      recent_travel: travelSessions.slice(0, 5).map(t => ({
        destination: t.destination_location_name, route_status: t.route_status,
        created_at: t.created_at, travel_reason: t.travel_reason,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});