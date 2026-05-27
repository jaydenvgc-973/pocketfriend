/**
 * extendCharacterSentence
 *
 * Called by IncarcerationReleaseModal when the user clicks "Extend Stay".
 * Updates the sentence end date and resets jail_lifecycle_key to the new date
 * so the popup will re-appear when the new date arrives.
 *
 * The character remains jailed — no location or status change.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_id, new_release_date_iso, original_release_date_iso } = await req.json();
    if (!character_id || !new_release_date_iso) {
      return Response.json({ error: 'character_id and new_release_date_iso required' }, { status: 400 });
    }

    const chars = await base44.entities.Character.filter({ id: character_id, owner_email: user.email });
    if (!chars[0]) return Response.json({ error: 'Character not found or not owned by you' }, { status: 404 });
    const character = chars[0];

    if (!character.is_jailed) {
      return Response.json({ error: 'Character is not currently jailed' }, { status: 400 });
    }

    const newReleaseDate = new Date(new_release_date_iso);
    if (newReleaseDate <= new Date()) {
      return Response.json({ error: 'New release date must be in the future' }, { status: 400 });
    }

    const nowISO = new Date().toISOString();
    const originalKey = original_release_date_iso
      ? `${character_id}::${original_release_date_iso}`
      : null;

    // Write the new release date and mark the original sentence key as processed
    // so the popup does not re-appear for the old date.
    // The new sentence key will be picked up when the new date arrives.
    await base44.entities.Character.update(character_id, {
      jail_release_date: new_release_date_iso,
      jail_lifecycle_key: originalKey || `${character_id}::extended_${nowISO}`,
      // Recalculate sentence_days from jailed_at to new release date
      jail_sentence_days: character.jailed_at
        ? Math.ceil((newReleaseDate.getTime() - new Date(character.jailed_at).getTime()) / (24 * 60 * 60 * 1000))
        : character.jail_sentence_days,
    });

    // Log LifeEvent
    await base44.asServiceRole.entities.LifeEvent.create({
      character_id,
      character_name: character.name,
      event_type: 'major_life_event',
      valence: 'negative',
      severity: 'moderate',
      title: 'Sentence extended',
      description: `${character.name}'s incarceration was extended. New release date: ${new Date(new_release_date_iso).toLocaleDateString()}.`,
      emotional_impact: 'Disappointment and continued uncertainty',
      triggered_by: 'user_extended_sentence',
      timestamp: nowISO,
      context_tags: ['jail', 'extension', 'user_decision'],
    }).catch(() => {});

    return Response.json({
      success: true,
      character_id,
      new_release_date: new_release_date_iso,
      extended_at: nowISO,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});