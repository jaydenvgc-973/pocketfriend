import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      primaryCharacterId,
      movingCharacterIds,
      moveToLocationId,      // null for homeless/unknown/none
      moveToLocationName,    // display name or null
      moveToLocationType,    // category string or null
      housingStatus,         // homeless | unknown | no_location | sheltered | hotel_placement | stable_home | housed
      housingContext,        // homeless_unsheltered | unknown_housing | no_fixed_residence | temporary_shelter | stable_home | null
      isHomeless,            // boolean — explicitly homeless/no fixed residence
      isUnknown,             // boolean — rabbit hole / housing unknown
      isNoLocation,          // boolean — "No Location / None" selected
      reasonForMove,
      otherReasonNote,
      presenceTransitionTiming, // immediate | next_travel_cycle | on_wake | housing_only
      sleepStateHandling,       // wake_and_relocate | relocate_on_wake | housing_only
      applyRelationshipImpact,
      previousHomeLocationId,
      previousHomeLocationName,
      previousHousingStatus,
      ownerEmail,
      notes,
    } = await req.json();

    if (!primaryCharacterId) return Response.json({ error: 'Missing primaryCharacterId' }, { status: 400 });
    if (!movingCharacterIds || movingCharacterIds.length === 0) {
      return Response.json({ error: 'Missing movingCharacterIds' }, { status: 400 });
    }

    const userEmail = user.email;
    const moveTimestamp = new Date().toISOString();
    const reasonLabel = reasonForMove === 'other' ? (otherReasonNote || 'Other') : (reasonForMove || 'unknown');

    // Fetch the destination location record once (for resident array updates)
    let locationRecord = null;
    if (moveToLocationId) {
      try {
        const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: moveToLocationId });
        locationRecord = locs?.[0] || null;
      } catch { /* non-fatal */ }
    }

    // Determine whether this destination category supports permanent residency
    const RESIDENTIAL_CATS = new Set(['home', 'hotel', 'shelter']);
    const destinationIsResidential = moveToLocationType && RESIDENTIAL_CATS.has(moveToLocationType);
    const destinationIsTemporary = moveToLocationType === 'hotel' || moveToLocationType === 'shelter';

    const results = [];

    for (const charId of movingCharacterIds) {
      // Ownership check: owner_email only — no created_by fallback
      const chars = await base44.asServiceRole.entities.Character.filter({ id: charId, owner_email: userEmail });
      const character = chars?.[0];
      if (!character) {
        results.push({ charId, status: 'skipped', reason: 'not_found_or_not_owner' });
        continue;
      }

      const isPrimary = charId === primaryCharacterId;
      const isAsleep = character.resolved_presence_status === 'sleeping' ||
                       character.resolved_presence_status === 'napping';

      // ── FULL BACKFILL: All housing-related fields ──────────────────────────────
      const update = {
        // Core homeless/housing flags
        is_homeless: isHomeless || false,
        housing_context: housingContext || null,

        // Always clear stale pending relocation fields before potentially setting new ones
        pending_relocation: false,
        pending_relocation_location_id: null,
        pending_relocation_location_name: null,
        pending_relocation_trigger: null,
        pending_relocation_created_at: null,

        // Timestamps
        last_housing_change_at: moveTimestamp,
        resolved_source_reason: reasonLabel,
      };

      // ── HOME / RESIDENCE FIELD BACKFILL ──────────────────────────────────────
      if (isHomeless || isUnknown || isNoLocation) {
        // Clear ALL home/residence fields — no stale data left behind
        update.current_home_location_id = null;
        update.temporary_housing_location_id = null;
        // no_fixed_residence: true only for explicit homeless/no-location
        update.no_fixed_residence = isHomeless || isNoLocation ? true : false;
      } else if (moveToLocationId) {
        if (destinationIsTemporary) {
          // Temporary: write to temporary_housing, clear permanent home
          update.temporary_housing_location_id = moveToLocationId;
          // Do NOT clear current_home_location_id here — they still have a home, just staying elsewhere
        } else {
          // Permanent: write to home, clear temporary
          update.current_home_location_id = moveToLocationId;
          update.temporary_housing_location_id = null;
          update.no_fixed_residence = false;
        }
      }

      // ── LIVE PRESENCE: Determine whether to move now ──────────────────────────
      let shouldMoveLivePresenceNow = false;

      if (presenceTransitionTiming === 'immediate') {
        if (isAsleep) {
          if (sleepStateHandling === 'wake_and_relocate') {
            shouldMoveLivePresenceNow = true;
            update.last_sleep_start = null; // clear sleep state
          } else if (sleepStateHandling === 'relocate_on_wake') {
            // Queue it — housing truth written now, presence moves on wake
            update.pending_relocation = true;
            update.pending_relocation_location_id = moveToLocationId || null;
            update.pending_relocation_location_name = moveToLocationName || null;
            update.pending_relocation_trigger = 'on_wake';
            update.pending_relocation_created_at = moveTimestamp;
            shouldMoveLivePresenceNow = false;
          }
          // else housing_only: no presence change
        } else {
          shouldMoveLivePresenceNow = true;
        }
      } else if (presenceTransitionTiming === 'on_wake') {
        update.pending_relocation = true;
        update.pending_relocation_location_id = moveToLocationId || null;
        update.pending_relocation_location_name = moveToLocationName || null;
        update.pending_relocation_trigger = 'on_wake';
        update.pending_relocation_created_at = moveTimestamp;
      } else if (presenceTransitionTiming === 'next_travel_cycle') {
        update.pending_relocation = true;
        update.pending_relocation_location_id = moveToLocationId || null;
        update.pending_relocation_location_name = moveToLocationName || null;
        update.pending_relocation_trigger = 'next_travel_cycle';
        update.pending_relocation_created_at = moveTimestamp;
      }
      // housing_only: no presence fields changed

      if (shouldMoveLivePresenceNow) {
        if (isHomeless || isNoLocation) {
          // CRITICAL: homeless presence is NOT 'home'
          update.resolved_current_location_id = null;
          update.resolved_current_location_name = isHomeless ? 'No fixed residence' : null;
          update.resolved_presence_status = 'home'; // 'home' only if they have a location — homeless gets null
          update.resolved_location_type = null;
          // Override: homeless must NOT have presence_status = home
          update.resolved_presence_status = null;
          update.resolved_location_type = isHomeless ? 'temporary_housing' : null;
        } else if (isUnknown) {
          // Unknown: clear resolved location, no fake presence
          update.resolved_current_location_id = null;
          update.resolved_current_location_name = null;
          update.resolved_presence_status = null;
          update.resolved_location_type = 'rabbit_hole';
        } else if (moveToLocationId) {
          update.resolved_current_location_id = moveToLocationId;
          update.resolved_current_location_name = moveToLocationName || null;
          update.resolved_presence_status = 'home';
          update.resolved_location_type = destinationIsTemporary ? 'temporary_housing' : 'home';
        }
        update.resolved_last_updated_at = moveTimestamp;
      }

      await base44.asServiceRole.entities.Character.update(charId, update);

      // ── LOCATION RESIDENT ARRAYS ──────────────────────────────────────────────
      // Remove from old home residents
      const prevHomeId = character.current_home_location_id || previousHomeLocationId;
      if (prevHomeId && prevHomeId !== moveToLocationId) {
        try {
          const prevLocs = await base44.asServiceRole.entities.LocationReference.filter({ id: prevHomeId });
          const prevLoc = prevLocs?.[0];
          if (prevLoc && Array.isArray(prevLoc.residents)) {
            const updated = prevLoc.residents.filter(r => r.character_id !== charId);
            await base44.asServiceRole.entities.LocationReference.update(prevHomeId, { residents: updated });
          }
        } catch { /* non-fatal */ }
      }

      // Add to new location residents only if it supports residency (not public/outdoor/community)
      if (moveToLocationId && locationRecord && destinationIsResidential) {
        try {
          const existing = locationRecord.residents || [];
          const alreadyIn = existing.some(r => r.character_id === charId);
          if (!alreadyIn) {
            const updated = [
              ...existing,
              {
                character_id: charId,
                character_name: character.name,
                avatar_url: character.avatar_url || null,
                moved_in_date: moveTimestamp,
              },
            ];
            await base44.asServiceRole.entities.LocationReference.update(moveToLocationId, { residents: updated });
          }
        } catch { /* non-fatal */ }
      }

      // ── LIFE EVENT ────────────────────────────────────────────────────────────
      let eventTitle, eventDesc, valence, severity;
      if (isHomeless || isNoLocation) {
        eventTitle = `${character.name} has no fixed residence`;
        eventDesc = `${character.name} no longer has a fixed home. Reason: ${reasonLabel}.`;
        valence = 'negative';
        severity = 'significant';
      } else if (isUnknown) {
        eventTitle = `${character.name}'s housing situation is unknown`;
        eventDesc = `${character.name}'s current housing status is unconfirmed. Reason: ${reasonLabel}.`;
        valence = 'neutral';
        severity = 'minor';
      } else if (moveToLocationType === 'shelter') {
        eventTitle = `${character.name} moved into a shelter`;
        eventDesc = `${character.name} is now staying at ${moveToLocationName || 'an emergency shelter'}. Reason: ${reasonLabel}.`;
        valence = 'negative';
        severity = 'significant';
      } else if (moveToLocationType === 'hotel') {
        eventTitle = `${character.name} moved into temporary lodging`;
        eventDesc = `${character.name} is temporarily staying at ${moveToLocationName || 'a hotel'}. Reason: ${reasonLabel}.`;
        valence = 'neutral';
        severity = 'moderate';
      } else {
        eventTitle = `${character.name} moved to a new home`;
        eventDesc = `${character.name} moved to ${moveToLocationName || 'a new location'}. Reason: ${reasonLabel}.${notes ? ' ' + notes : ''}`;
        valence = 'positive';
        severity = 'moderate';
      }

      if (previousHomeLocationName) {
        eventDesc += ` Previously: ${previousHomeLocationName}.`;
      }
      if (movingCharacterIds.length > 1 && !isPrimary) {
        const primaryChar = movingCharacterIds[0];
        eventDesc += ` Part of a group move.`;
      }

      await base44.asServiceRole.entities.LifeEvent.create({
        character_id: charId,
        character_name: character.name,
        event_type: 'location_change_event',
        valence,
        severity,
        title: eventTitle,
        description: eventDesc,
        emotional_impact: (isHomeless || isNoLocation)
          ? 'Significant disruption to stability and sense of security.'
          : 'A change in living situation affects daily routine and social connections.',
        triggered_by: 'manual',
        timestamp: moveTimestamp,
        systems_updated: ['memory', 'location'],
        context_tags: [
          reasonForMove,
          moveToLocationType || (isHomeless ? 'homeless' : isUnknown ? 'unknown' : 'none'),
          movingCharacterIds.length > 1 ? 'group_move' : 'solo_move',
        ].filter(Boolean),
      });

      // Memory entry
      await base44.asServiceRole.entities.Memory.create({
        character_id: charId,
        title: eventTitle,
        description: eventDesc,
        category: 'life_event',
        emotional_weight: (isHomeless || isNoLocation) ? 'high' : 'medium',
        timestamp: moveTimestamp,
        owner_email: userEmail,
      }).catch(() => {});

      results.push({ charId, characterName: character.name, status: 'updated' });
    }

    // ── RELATIONSHIP IMPACT (non-fatal async) ─────────────────────────────────
    if (applyRelationshipImpact) {
      const RELATIONSHIP_REASONS = new Set([
        'relationship_change', 'family_conflict', 'safety_concern',
        'moving_in_with_someone', 'moving_out_from_someone', 'breakup_separation',
      ]);
      if (RELATIONSHIP_REASONS.has(reasonForMove)) {
        base44.asServiceRole.functions.invoke('progressRelationship', {
          characterId: primaryCharacterId,
          eventType: 'housing_conflict',
          reasonForMove,
          intensity: 'moderate',
        }).catch(() => {});
      }
    }

    return Response.json({
      success: true,
      results,
      totalProcessed: results.filter(r => r.status === 'updated').length,
      skipped: results.filter(r => r.status === 'skipped').length,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});