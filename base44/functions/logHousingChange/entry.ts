import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      primaryCharacterId,
      movingCharacterIds,
      moveToLocationId,
      moveToLocationName,
      moveToLocationType,
      housingStatus,
      housingContext,
      reasonForMove,
      otherReasonNote,
      presenceTransitionTiming,
      sleepStateHandling,
      updateLivePresenceNow,
      applyRelationshipImpact,
      previousHomeLocationId,
      previousHomeLocationName,
      previousHousingStatus,
      isHomeless,
      isUnknown,
      ownerEmail,
      notes,
    } = await req.json();

    if (!primaryCharacterId) return Response.json({ error: 'Missing primaryCharacterId' }, { status: 400 });
    if (!movingCharacterIds || movingCharacterIds.length === 0) {
      return Response.json({ error: 'Missing movingCharacterIds' }, { status: 400 });
    }

    const userEmail = user.email;

    // Resolve location record if provided (for residents array update)
    let locationRecord = null;
    if (moveToLocationId) {
      try {
        const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: moveToLocationId });
        locationRecord = locs?.[0] || null;
      } catch { /* non-fatal */ }
    }

    const moveTimestamp = new Date().toISOString();
    const reasonLabel = reasonForMove === 'other' ? (otherReasonNote || 'Other') : (reasonForMove || 'unknown');
    const results = [];

    for (const charId of movingCharacterIds) {
      // Verify ownership by owner_email ONLY — no created_by fallback per system rules
      const chars = await base44.asServiceRole.entities.Character.filter({ id: charId, owner_email: userEmail });
      const character = chars?.[0];
      if (!character) {
        results.push({ charId, status: 'skipped', reason: 'not_found_or_not_owner' });
        continue;
      }

      const isPrimary = charId === primaryCharacterId;
      const isAsleep = character.resolved_presence_status === 'sleeping' ||
                       character.resolved_presence_status === 'napping';

      // Build the character update payload
      const update = {
        is_homeless: isHomeless || false,
        housing_context: housingContext || null,
      };

      // Set home/residence fields
      if (isHomeless || isUnknown) {
        update.current_home_location_id = null;
        update.temporary_housing_location_id = null;
      } else if (moveToLocationId) {
        const locCat = moveToLocationType;
        if (locCat === 'hotel' || locCat === 'shelter') {
          update.temporary_housing_location_id = moveToLocationId;
        } else {
          update.current_home_location_id = moveToLocationId;
          update.temporary_housing_location_id = null;
        }
      }

      // Determine live presence update
      let shouldMoveLivePresenceNow = false;

      if (presenceTransitionTiming === 'immediate') {
        if (isAsleep) {
          // Respect sleep handling
          if (sleepStateHandling === 'wake_and_relocate') {
            shouldMoveLivePresenceNow = true;
            // Clear sleep state
            update.last_sleep_start = null;
          } else if (sleepStateHandling === 'relocate_on_wake') {
            // Queue for wake event - set pending fields, don't move now
            update.pending_relocation_location_id = moveToLocationId || null;
            update.pending_relocation_location_name = moveToLocationName || null;
            update.pending_relocation_trigger = 'on_wake';
            shouldMoveLivePresenceNow = false;
          } else {
            // housing_only — no presence change
            shouldMoveLivePresenceNow = false;
          }
        } else {
          shouldMoveLivePresenceNow = true;
        }
      } else if (presenceTransitionTiming === 'on_wake') {
        update.pending_relocation_location_id = moveToLocationId || null;
        update.pending_relocation_location_name = moveToLocationName || null;
        update.pending_relocation_trigger = 'on_wake';
      } else if (presenceTransitionTiming === 'next_travel_cycle') {
        update.pending_relocation_location_id = moveToLocationId || null;
        update.pending_relocation_location_name = moveToLocationName || null;
        update.pending_relocation_trigger = 'next_travel_cycle';
      }
      // housing_only: no presence change, no pending fields

      if (shouldMoveLivePresenceNow) {
        if (isHomeless || isUnknown) {
          update.resolved_current_location_id = null;
          update.resolved_current_location_name = isHomeless ? 'No fixed residence' : null;
          update.resolved_presence_status = isHomeless ? 'home' : null;
          update.resolved_location_type = isHomeless ? 'home' : null;
        } else if (moveToLocationId) {
          update.resolved_current_location_id = moveToLocationId;
          update.resolved_current_location_name = moveToLocationName || null;
          update.resolved_presence_status = 'home';
          update.resolved_location_type = moveToLocationType === 'hotel' || moveToLocationType === 'shelter'
            ? 'temporary_housing' : 'home';
        }
        update.resolved_last_updated_at = moveTimestamp;
      }

      await base44.asServiceRole.entities.Character.update(charId, update);

      // Update location's residents array if moving to a real location
      if (moveToLocationId && locationRecord) {
        try {
          const existingResidents = locationRecord.residents || [];
          const alreadyResident = existingResidents.some(r => r.character_id === charId);
          if (!alreadyResident) {
            const newResidents = [
              ...existingResidents,
              {
                character_id: charId,
                character_name: character.name,
                avatar_url: character.avatar_url || null,
                moved_in_date: moveTimestamp,
              }
            ];
            await base44.asServiceRole.entities.LocationReference.update(moveToLocationId, {
              residents: newResidents,
            });
          }
        } catch { /* non-fatal */ }
      }

      // Remove from previous home location residents if applicable
      if (previousHomeLocationId && previousHomeLocationId !== moveToLocationId) {
        try {
          const prevLocs = await base44.asServiceRole.entities.LocationReference.filter({ id: previousHomeLocationId });
          const prevLoc = prevLocs?.[0];
          if (prevLoc && Array.isArray(prevLoc.residents)) {
            const updatedResidents = prevLoc.residents.filter(r => r.character_id !== charId);
            await base44.asServiceRole.entities.LocationReference.update(previousHomeLocationId, {
              residents: updatedResidents,
            });
          }
        } catch { /* non-fatal */ }
      }

      // Build life event description
      let eventTitle, eventDesc, valence, severity;
      if (isHomeless) {
        eventTitle = `${character.name} became homeless`;
        eventDesc = `${character.name} lost their housing and currently has no fixed residence. Reason: ${reasonLabel}.`;
        valence = 'negative';
        severity = 'significant';
      } else if (moveToLocationType === 'shelter') {
        eventTitle = `${character.name} moved into a shelter`;
        eventDesc = `${character.name} is now staying at ${moveToLocationName || 'an emergency shelter'}. Reason: ${reasonLabel}.`;
        valence = 'negative';
        severity = 'significant';
      } else if (moveToLocationType === 'hotel') {
        eventTitle = `${character.name} moved into a hotel`;
        eventDesc = `${character.name} is temporarily staying at ${moveToLocationName || 'a hotel'}. Reason: ${reasonLabel}.`;
        valence = 'neutral';
        severity = 'moderate';
      } else if (isUnknown) {
        eventTitle = `${character.name}'s housing situation is unknown`;
        eventDesc = `${character.name}'s current housing status is unconfirmed. Reason: ${reasonLabel}.`;
        valence = 'neutral';
        severity = 'minor';
      } else {
        eventTitle = `${character.name} moved to a new home`;
        eventDesc = `${character.name} moved to ${moveToLocationName || 'a new location'}. Reason: ${reasonLabel}.${notes ? ' ' + notes : ''}`;
        valence = 'positive';
        severity = 'moderate';
      }

      // Previous home context
      if (previousHomeLocationName) {
        eventDesc += ` Previously lived at: ${previousHomeLocationName}.`;
      }

      // Group move note
      if (movingCharacterIds.length > 1 && !isPrimary) {
        eventDesc += ` Moved together with ${character.name}.`;
      }

      await base44.asServiceRole.entities.LifeEvent.create({
        character_id: charId,
        character_name: character.name,
        event_type: 'location_change_event',
        valence,
        severity,
        title: eventTitle,
        description: eventDesc,
        emotional_impact: isHomeless
          ? 'Significant disruption to stability and sense of security.'
          : 'A change in living situation affects daily routine and social connections.',
        triggered_by: 'manual',
        timestamp: moveTimestamp,
        systems_updated: ['memory', 'location'],
        context_tags: [
          reasonForMove,
          moveToLocationType || 'home',
          movingCharacterIds.length > 1 ? 'group_move' : 'solo_move',
        ].filter(Boolean),
      });

      // Create a memory entry for this housing change
      await base44.asServiceRole.entities.Memory.create({
        character_id: charId,
        title: eventTitle,
        description: eventDesc,
        category: 'life_event',
        emotional_weight: isHomeless ? 'high' : 'medium',
        timestamp: moveTimestamp,
        owner_email: userEmail,
      }).catch(() => {/* non-fatal if Memory entity not available */});

      results.push({ charId, characterName: character.name, status: 'updated' });
    }

    // Apply relationship impact if selected and reason is emotionally driven
    if (applyRelationshipImpact) {
      const relationshipImpactReasons = new Set([
        'relationship_change', 'family_conflict', 'safety_concern',
        'moving_in_with_someone', 'moving_out_from_someone', 'breakup_separation',
      ]);
      if (relationshipImpactReasons.has(reasonForMove)) {
        // Fire relationship impact asynchronously for primary character
        base44.asServiceRole.functions.invoke('progressRelationship', {
          characterId: primaryCharacterId,
          eventType: 'housing_conflict',
          reasonForMove,
          intensity: 'moderate',
        }).catch(() => {/* non-fatal */});
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