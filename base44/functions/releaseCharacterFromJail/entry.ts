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
    };

    if (character.current_home_location_id) {
      releasePayload.resolved_current_location_id = character.current_home_location_id;
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

    return Response.json({ success: true, character_id, released_at: nowISO });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});