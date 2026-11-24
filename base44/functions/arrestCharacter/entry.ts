/**
 * arrestCharacter
 *
 * Puts a character into police custody after an arrest that has actually happened in a
 * Scenes interaction (Pickpocket, Burglarize, Call the Cops).
 *
 * It creates no new system: it writes the SAME established custody fields a judicial
 * sentence writes, adds the person to the facility's OWN inmate roster (the one Places
 * maintains), and gives them a holding cell through the existing autoAssignFacilityUnit
 * assignment. Release, visitation, uniforms and confinement behaviour keep running
 * through the pathways that already read those fields.
 *
 * An arrest is NOT a conviction and NOT a sentence:
 *   • no verdict, no sentence length, no release date, no criminal record entry is written
 *   • the person's prior home is preserved on the facility's inmate record so the existing
 *     release pipeline returns them where they actually lived
 *   • they stay in custody pending the applicable court or release process
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

function easternDateOnly(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const characterId = body.character_id;
    const offense = String(body.offense || 'arrest').trim();
    const notes = String(body.notes || '').trim();
    let facilityId = body.facility_id || null;

    if (!characterId) return Response.json({ error: 'A character must be selected' }, { status: 400 });

    const character = await base44.asServiceRole.entities.Character.get(characterId)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    const owns = character.owner_email === user.email
      || (!character.owner_email && character.created_by === user.email);
    if (!owns && user.role !== 'admin') {
      return Response.json({ error: 'You can only place your own characters in custody.' }, { status: 403 });
    }

    // A sentence already handed down is never overwritten by an arrest.
    if (character.is_jailed === true && ['sentenced', 'serving', 'work_release'].includes(character.incarceration_status)) {
      return Response.json({ success: true, skipped: 'already_sentenced' });
    }

    // The facility is the police station / jail the app already has.
    if (!facilityId) {
      const facilities = await base44.entities.LocationReference
        .filter({ category: 'jail_prison' }, '-created_date', 5)
        .catch(() => []);
      facilityId = facilities?.[0]?.id || null;
    }
    if (!facilityId) {
      return Response.json({ error: 'No police station or jail is set up yet' }, { status: 400 });
    }

    const facility = await base44.asServiceRole.entities.LocationReference.get(facilityId)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!facility) return Response.json({ error: 'That facility was not found' }, { status: 404 });

    const now = new Date();
    const nowISO = now.toISOString();
    const priorHomeId = character.current_home_location_id || null;
    let priorHomeName = null;
    if (priorHomeId && priorHomeId !== facility.id) {
      const priorHome = await base44.asServiceRole.entities.LocationReference.get(priorHomeId).catch(() => null);
      priorHomeName = priorHome?.name || null;
    }

    // The established incarceration fields. Held pending proceedings — never sentenced.
    await base44.asServiceRole.entities.Character.update(character.id, {
      is_jailed: true,
      incarceration_facility_id: facility.id,
      incarceration_facility_name: facility.name,
      incarceration_status: 'pretrial',
      jail_sentence_days: null,
      jail_release_date: null,
      jailed_at: nowISO,
      pending_charges: offense ? [offense] : (character.pending_charges || []),
      // The facility is where they are held, so every system that reads location agrees.
      current_home_location_id: facility.id,
      resolved_current_location_id: facility.id,
      resolved_current_location_name: facility.name,
      resolved_location_type: 'incarcerated',
      resolved_presence_status: 'incarcerated',
      resolved_source_reason: 'arrest',
      resolved_last_updated_at: nowISO,
      house_arrest_active: false,
      house_arrest_location_id: null,
      house_arrest_end_date: null,
      presence_stay_lock: false,
      presence_stay_lock_reason: null,
      presence_stay_lock_authority: null,
      presence_stay_lock_location_id: null,
      presence_stay_lock_set_at: null,
      presence_stay_lock_expires_at: null,
      presence_stay_lock_release_condition: null,
      presence_stay_lock_created_by: null,
    });

    // The facility's own inmate roster — the same record the Places panel maintains.
    const inmates = Array.isArray(facility.inmates) ? [...facility.inmates] : [];
    const idx = inmates.findIndex((i) => i?.character_id === character.id);
    const inmateRecord = {
      character_id: character.id,
      character_name: character.name,
      charges: offense,
      booking_date: easternDateOnly(now),
      confinement_status: 'pretrial',
      confined_at: nowISO,
      notes: notes || 'Arrested and held pending proceedings',
      prior_home_location_id: priorHomeId || undefined,
      prior_home_location_name: priorHomeName || undefined,
    };
    if (idx >= 0) inmates[idx] = { ...inmates[idx], ...inmateRecord }; else inmates.push(inmateRecord);
    await base44.asServiceRole.entities.LocationReference.update(facility.id, { inmates });

    // The existing cell assignment: a holding cell with space, in the facility's own
    // sequence only when every cell is full. A cell they already hold is never replaced.
    const assigned = await base44.asServiceRole.functions.invoke('autoAssignFacilityUnit', {
      character_id: character.id,
      location_id: facility.id,
    }).then((r) => r?.data || null).catch((err) => {
      console.warn(`[arrestCharacter] cell assignment failed: ${err.message}`);
      return null;
    });

    await base44.asServiceRole.entities.LifeEvent.create({
      character_id: character.id,
      character_name: character.name,
      event_type: 'legal_or_social_consequence_event',
      valence: 'negative',
      severity: 'major',
      title: 'Arrested',
      description: `${character.name} was taken into police custody and booked at ${facility.name}.`,
      emotional_impact: 'The shock of being taken into custody',
      triggered_by: 'scene_arrest',
      timestamp: nowISO,
      context_tags: ['arrest', 'custody', 'scene'],
    }).catch(() => {});

    return Response.json({
      success: true,
      character_id: character.id,
      character_name: character.name,
      facility_id: facility.id,
      facility_name: facility.name,
      unit_id: assigned?.unit_id || null,
      unit_name: assigned?.unit_name || null,
      inmate: inmateRecord,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});