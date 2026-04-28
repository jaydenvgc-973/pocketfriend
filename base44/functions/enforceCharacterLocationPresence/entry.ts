import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { character_id, owner_email } = await req.json();

    // Verify ownership match
    if (owner_email !== user.email) {
      return Response.json({ error: 'Ownership mismatch' }, { status: 403 });
    }

    // Load character with owner_email filter
    const characters = await base44.asServiceRole.entities.Character.filter({
      id: character_id,
      owner_email
    });

    if (!characters || characters.length === 0) {
      return Response.json({
        status: 'error',
        message: 'Character not found or ownership mismatch',
        character_id
      }, { status: 404 });
    }

    const character = characters[0];

    // Load locations for this owner
    const locations = await base44.asServiceRole.entities.LocationReference.filter({
      owner_email
    });

    // Build locationMap
    const locationMap = {};
    for (const loc of locations) {
      locationMap[loc.id] = loc;
    }

    // Call the resolver function (which already exists and is battle-tested)
    // Pass character, locationMap, and current time (ET)
    const etTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    
    const resolved = await invokeResolver(character, locationMap, etTime, base44, owner_email);

    // Build stored state from character
    const stored = {
      resolved_current_location_id: character.resolved_current_location_id || null,
      resolved_current_location_name: character.resolved_current_location_name || null,
      resolved_location_type: character.resolved_location_type || null,
      resolved_presence_status: character.resolved_presence_status || null,
      resolved_source_reason: character.resolved_source_reason || null,
      resolved_zone: character.resolved_zone || null,
      home_resolution_failed: character.home_resolution_failed || false
    };

    // Deep compare
    const hasChanges = 
      resolved.resolved_current_location_id !== stored.resolved_current_location_id ||
      resolved.resolved_current_location_name !== stored.resolved_current_location_name ||
      resolved.resolved_location_type !== stored.resolved_location_type ||
      resolved.resolved_presence_status !== stored.resolved_presence_status ||
      resolved.resolved_source_reason !== stored.resolved_source_reason ||
      (resolved.resolved_zone || null) !== stored.resolved_zone ||
      (resolved.home_resolution_failed || false) !== stored.home_resolution_failed;

    if (!hasChanges) {
      return Response.json({
        status: 'no_change',
        character_id,
        message: 'Character location already matches resolver output'
      });
    }

    // ET timezone for timestamp
    const timestamp = etTime.toISOString();

    // Prepare update (ONLY allowed fields)
    const updateData = {
      resolved_current_location_id: resolved.resolved_current_location_id,
      resolved_current_location_name: resolved.resolved_current_location_name,
      resolved_location_type: resolved.resolved_location_type,
      resolved_presence_status: resolved.resolved_presence_status,
      resolved_source_reason: resolved.resolved_source_reason,
      resolved_zone: resolved.resolved_zone || null,
      resolved_last_updated_at: timestamp,
      home_resolution_failed: resolved.home_resolution_failed || false
    };

    // Write update
    await base44.asServiceRole.entities.Character.update(character_id, updateData);

    // Return result
    return Response.json({
      status: 'updated',
      character_id,
      owner_email,
      changes: {
        resolved_current_location_id: {
          from: stored.resolved_current_location_id,
          to: resolved.resolved_current_location_id
        },
        resolved_location_type: {
          from: stored.resolved_location_type,
          to: resolved.resolved_location_type
        },
        resolved_presence_status: {
          from: stored.resolved_presence_status,
          to: resolved.resolved_presence_status
        },
        resolved_source_reason: {
          from: stored.resolved_source_reason,
          to: resolved.resolved_source_reason
        }
      },
      timestamp
    });
  } catch (error) {
    console.error('enforceCharacterLocationPresence error:', error);
    return Response.json({
      status: 'error',
      message: error.message
    }, { status: 500 });
  }
});

/**
 * Call the existing resolver backend function
 * This delegates to the already-built and tested resolver logic
 */
async function invokeResolver(character, locationMap, etTime, base44, ownerEmail) {
  try {
    // Call the resolver function that already exists
    const result = await base44.asServiceRole.functions.invoke('getCharacterLocationRealTime', {
      character_id: character.id,
      owner_email: ownerEmail
    });
    return result;
  } catch (error) {
    console.error('Resolver invocation failed:', error);
    throw error;
  }
}