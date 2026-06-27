import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();

    const title = body.title;
    const eventDate = body.event_date;
    const plot = body.plot;
    const focusIds = body.focus_character_ids || [];
    const participantIds = body.participant_character_ids || [];
    const userParticipant = body.user_participant || null;
    const additionalNotes = body.additional_notes || '';
    const startTime = body.start_time || null;
    const endTime = body.end_time || null;
    const allDay = body.all_day || false;
    const venueId = body.venue_id || null;
    const venueName = body.venue_name || null;
    const isRabbitHole = body.is_rabbit_hole || false;
    const rabbitHoleVenueName = body.rabbit_hole_venue_name || null;

    const hasAnyParticipant = participantIds.length > 0 || !!userParticipant;
    if (!title || !eventDate || !plot || !hasAnyParticipant) {
      return Response.json({ error: 'title, event_date, plot, and at least one participant are required' }, { status: 400 });
    }

    // Resolve character names from IDs
    const allCharacterIds = [...new Set([...focusIds, ...participantIds])];
    const nameById = {};
    for (const cid of allCharacterIds) {
      try {
        const chars = await base44.entities.Character.filter({ id: cid }, null, 1);
        if (chars[0]) nameById[cid] = chars[0].name || chars[0].display_name || cid;
      } catch (_) {
        nameById[cid] = cid;
      }
    }

    const focusNames = focusIds.map(id => nameById[id] || id);
    const participantNames = participantIds.map(id => nameById[id] || id);

    // Build user participant metadata for the StoryEvent record
    const userParticipantMetadata = userParticipant ? {
      user_id: userParticipant.user_id,
      display_name: userParticipant.display_name,
      is_focus: userParticipant.is_focus || false,
    } : null;

    const record = await base44.entities.StoryEvent.create({
      title: title.trim(),
      event_date: eventDate,
      start_time: startTime,
      end_time: endTime,
      all_day: allDay,
      venue_id: venueId,
      venue_name: venueName || rabbitHoleVenueName,
      is_rabbit_hole: isRabbitHole,
      rabbit_hole_venue_name: rabbitHoleVenueName,
      plot: plot.trim(),
      additional_notes: additionalNotes.trim(),
      focus_character_ids: focusIds,
      focus_character_names: focusNames,
      participant_character_ids: participantIds,
      participant_character_names: participantNames,
      user_participant: userParticipantMetadata,
      owner_email: user.email,
      status: 'generating',
    });

    return Response.json({ success: true, storyEventId: record.id, status: 'generating' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});