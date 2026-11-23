/**
 * releaseCharacterFromJail
 *
 * Called by the IncarcerationReleaseModal when the user clicks "Release Now".
 * Clears jail state, restores home location, logs a LifeEvent, and writes
 * jail_lifecycle_key to prevent the popup from re-appearing for this sentence.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_id, release_date_iso } = await req.json();
    if (!character_id) return Response.json({ error: 'character_id required' }, { status: 400 });

    const chars = await base44.entities.Character.filter({ id: character_id, owner_email: user.email });
    if (!chars[0]) return Response.json({ error: 'Character not found or not owned by you' }, { status: 404 });
    const character = chars[0];

    if (!character.is_jailed) {
      return Response.json({ success: true, message: 'Character is already not jailed' });
    }

    const nowISO = new Date().toISOString();
    const releaseDateISO = release_date_iso || nowISO;
    const sentenceKey = `${character_id}::${releaseDateISO}`;

    // While incarcerated the facility IS the character's home, and the residence they had
    // before custody is kept on the facility's own inmate record. Release returns them to
    // that residence — never to the cell they are being let out of.
    const facility = character.incarceration_facility_id
      ? await base44.asServiceRole.entities.LocationReference.get(character.incarceration_facility_id).catch(() => null)
      : null;
    const inmateEntry = (facility?.inmates || []).find((i) => i?.character_id === character_id) || null;
    const priorHomeId = inmateEntry?.prior_home_location_id || null;
    const currentHomeIsFacility = facility && character.current_home_location_id === facility.id;
    const restoredHomeId = priorHomeId || (currentHomeIsFacility ? null : character.current_home_location_id) || null;

    const releasePayload = {
      is_jailed: false,
      incarceration_status: 'released',
      jail_release_date: releaseDateISO,
      resolved_presence_status: 'home',
      resolved_location_type: 'home',
      resolved_source_reason: 'sentence_complete_user_confirmed',
      resolved_last_updated_at: nowISO,
      jail_lifecycle_key: sentenceKey,
      incarceration_facility_id: null,
      house_arrest_active: false,
      house_arrest_location_id: null,
      house_arrest_end_date: null,
    };

    if (restoredHomeId) {
      const restoredHome = await base44.asServiceRole.entities.LocationReference.get(restoredHomeId).catch(() => null);
      releasePayload.current_home_location_id = restoredHomeId;
      releasePayload.resolved_current_location_id = restoredHomeId;
      releasePayload.resolved_current_location_name = restoredHome?.name || null;
    }

    await base44.entities.Character.update(character_id, releasePayload);

    // Log LifeEvent
    await base44.asServiceRole.entities.LifeEvent.create({
      character_id,
      character_name: character.name,
      event_type: 'major_life_event',
      valence: 'mixed',
      severity: 'major',
      title: 'Released from incarceration',
      description: `${character.name} completed their sentence (${character.jail_sentence_days || '?'} days) and was released.`,
      emotional_impact: 'Relief mixed with uncertainty about what comes next',
      triggered_by: 'user_confirmed_release',
      timestamp: nowISO,
      context_tags: ['jail', 'release', 'user_confirmed'],
    }).catch(() => {});

    // TEMPORARY CELL — the sentence is over, so the cell assignment ends with it.
    // The cell itself and any other inmate in it are untouched; the space simply
    // becomes available again. The stay status written above is the only trigger.
    // An established jail home never ends incarceration on its own, and this release is
    // the actual sentence ending — so the established release rule applies in full.
    try {
      if (facility) {
        const units = facility.residential_units || [];
        const cellsChanged = units.some(u => (u.occupant_character_ids || []).includes(character_id));
        // The inmate record keeps the stay as history; it no longer says they are held.
        const previousInmates = facility.inmates || [];
        const inmates = previousInmates.map((i) => (
          i?.character_id === character_id
            ? { ...i, confinement_status: 'released', actual_release_date: releaseDateISO.slice(0, 10) }
            : i
        ));
        const patch = {};
        if (cellsChanged) {
          patch.residential_units = units.map(u => ({
            ...u,
            occupant_character_ids: (u.occupant_character_ids || []).filter(id => id !== character_id),
          }));
        }
        if (previousInmates.some((i) => i?.character_id === character_id)) patch.inmates = inmates;
        if (Object.keys(patch).length > 0) {
          await base44.asServiceRole.entities.LocationReference.update(facility.id, patch);
        }
      }
    } catch (_cellError) {
      // The release itself stands. An unassigned-cell write failure leaves the cell
      // assignment inert (the character is no longer incarcerated), never the character jailed.
    }

    return Response.json({ success: true, character_id, released_at: nowISO });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});