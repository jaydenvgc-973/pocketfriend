import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * resolveLocationAlias
 * 
 * Saves a user-confirmed alias mapping (phrase → saved location OR rabbit hole).
 * Also immediately updates the character's live presence to reflect the resolution.
 *
 * Body params:
 *   phrase           - spoken phrase (e.g. "dance hall")
 *   resolutionType   - "saved_location" | "rabbit_hole" | "ignored"
 *   locationId       - (if saved_location) ID of the LocationReference
 *   locationName     - (if saved_location) display name
 *   rabbitHoleLabel  - (if rabbit_hole) display label to use
 *   rabbitHoleSubtype - optional subtype
 *   characterId      - optional — if set, also updates this character's live presence
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      phrase,
      resolutionType,
      locationId,
      locationName,
      rabbitHoleLabel,
      rabbitHoleSubtype,
      characterId,
      feedback,
    } = await req.json();

    if (!phrase || !resolutionType) {
      return Response.json({ error: 'phrase and resolutionType required' }, { status: 400 });
    }

    // Normalize the phrase
    const normalizedPhrase = phrase.toLowerCase().trim()
      .replace(/['".,!?]/g, '')
      .replace(/\bthe\b\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Check if alias already exists for this user + phrase
    const existing = await base44.asServiceRole.entities.LocationAlias.filter({
      owner_email: user.email,
      phrase: normalizedPhrase,
      ...(characterId ? { character_id: characterId } : {}),
    });

    let aliasRecord;
    const aliasData = {
      owner_email: user.email,
      phrase: normalizedPhrase,
      phrase_raw: phrase,
      resolution_type: resolutionType,
      resolved_location_id: resolutionType === 'saved_location' ? locationId : null,
      resolved_location_name: resolutionType === 'saved_location' ? locationName : null,
      rabbit_hole_label: resolutionType === 'rabbit_hole' ? (rabbitHoleLabel || phrase) : null,
      rabbit_hole_subtype: rabbitHoleSubtype || null,
      character_id: characterId || null,
      confidence: 1.0,
      source: 'user_confirmed',
      use_count: 1,
    };

    if (existing.length > 0) {
      // Update existing alias
      await base44.asServiceRole.entities.LocationAlias.update(existing[0].id, {
        ...aliasData,
        use_count: (existing[0].use_count || 1) + 1,
      });
      aliasRecord = { id: existing[0].id, ...aliasData };
    } else {
      aliasRecord = await base44.asServiceRole.entities.LocationAlias.create(aliasData);
    }

    // If a characterId is provided, immediately update their live presence
    if (characterId) {
      let presenceUpdate = {};

      if (resolutionType === 'saved_location' && locationId) {
        // Resolve to a real saved location
        const loc = await base44.asServiceRole.entities.LocationReference.get(locationId).catch(() => null);
        presenceUpdate = {
          resolved_current_location_id: locationId,
          resolved_current_location_name: locationName || loc?.name || 'Location',
          resolved_location_type: 'visit',
          resolved_presence_status: 'visiting',
          resolved_source_reason: 'chat_alias_confirmed',
          location_status: 'at_location',
          last_location_update_time: new Date().toISOString(),
          // Clear any rabbit hole state
          is_rabbit_hole: false,
          rabbit_hole_label: null,
          rabbit_hole_subtype: null,
        };
      } else if (resolutionType === 'rabbit_hole') {
        const label = rabbitHoleLabel || phrase.replace(/\b\w/g, c => c.toUpperCase());
        presenceUpdate = {
          resolved_current_location_id: null,
          resolved_current_location_name: label,
          resolved_location_type: 'rabbit_hole',
          resolved_presence_status: 'rabbit_hole',
          resolved_source_reason: 'chat_rabbit_hole',
          location_status: 'at_location',
          is_rabbit_hole: true,
          rabbit_hole_label: label,
          rabbit_hole_subtype: rabbitHoleSubtype || null,
          rabbit_hole_started_at: new Date().toISOString(),
          last_location_update_time: new Date().toISOString(),
        };
      }

      if (Object.keys(presenceUpdate).length > 0) {
        await base44.asServiceRole.entities.Character.update(characterId, presenceUpdate);
        console.log(`[resolveLocationAlias] Updated character ${characterId} presence → ${resolutionType}: ${locationName || rabbitHoleLabel}`);
      }
    }

    // ── NONSENSE FEEDBACK: store a Memory so the AI learns from the bad detection ──
    if (resolutionType === 'nonsense' && characterId) {
      const feedbackNote = feedback || `User marked "${phrase}" as a nonsense location detection — the AI was pattern-matching sentence structure instead of applying actual logic.`;
      await base44.asServiceRole.entities.Memory.create({
        character_id: characterId,
        title: `[NONSENSE FEEDBACK] Bad location detection: "${phrase}"`,
        description: feedbackNote,
        emotional_impact: 'neutral',
        source_context: 'location_alias_nonsense_feedback',
        timestamp: new Date().toISOString(),
      }).catch(() => {});
      console.log(`[resolveLocationAlias] Stored nonsense feedback for "${phrase}" on character ${characterId}`);
    }

    return Response.json({
      success: true,
      aliasId: aliasRecord.id,
      resolution: resolutionType,
      phrase: normalizedPhrase,
    });
  } catch (error) {
    console.error('[resolveLocationAlias]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});