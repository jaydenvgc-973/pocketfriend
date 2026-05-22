/**
 * detectAndUpdateArrival
 *
 * Detects when a character confirms arrival at a destination
 * and immediately updates their resolved location.
 *
 * Triggers on: Character sends a message with arrival language
 * Searches: Most recent messages for explicit destination mention
 * Updates: resolved_current_location_id, resolved_presence_status, travel_status
 * Clears: travel_destination_*, traveling_to_*
 *
 * Arrival phrases:
 * - "standing at the door"
 * - "at the door"
 * - "i'm here"
 * - "i made it"
 * - "just arrived"
 * - "i'm outside"
 * - "walking in"
 * - "pulling up"
 * - "i'm in"
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ARRIVAL_PHRASES = [
  'standing at the door',
  'at the door',
  'i\'m here',
  'i made it',
  'just arrived',
  'i\'m outside',
  'walking in',
  'pulling up',
  'i\'m in',
  'i just got',
  'arrived at',
];

const DESTINATION_PATTERN = /(?:at|to|going to|heading to)\s+([^.!?\n]+?)(?:\.|!|\?|$|\n)/gi;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { message_id, character_id, conversation_id, message_text } = await req.json();
    
    if (!message_id || !character_id || !conversation_id || !message_text) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Step 1: Check if message contains arrival language
    const lowerText = message_text.toLowerCase();
    const hasArrivalPhrase = ARRIVAL_PHRASES.some(phrase => lowerText.includes(phrase));
    
    if (!hasArrivalPhrase) {
      return Response.json({ detected: false, reason: 'no_arrival_phrase' });
    }

    // Step 2: Get character and verify ownership
    const chars = await base44.asServiceRole.entities.Character.filter(
      { id: character_id, owner_email: user.email },
      null,
      1
    );
    const character = chars?.[0];
    if (!character) {
      return Response.json({ error: 'Character not found or not owned by user' }, { status: 404 });
    }

    // Step 3: Get conversation to extract destination context
    const convs = await base44.asServiceRole.entities.Conversation.filter(
      { id: conversation_id, owner_email: user.email },
      null,
      1
    );
    const conversation = convs?.[0];
    if (!conversation) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Step 4: Get all messages to find destination mention
    const messages = await base44.asServiceRole.entities.Message.filter(
      { conversation_id },
      '-timestamp',
      50
    );

    // Find destination from recent messages (look back up to 10 messages)
    let destinationName = null;
    for (let i = 0; i < Math.min(messages.length, 10); i++) {
      const msg = messages[i];
      const matches = [...msg.content.matchAll(DESTINATION_PATTERN)];
      if (matches.length > 0) {
        // Take the most recently mentioned destination
        destinationName = matches[matches.length - 1][1]?.trim();
        if (destinationName) break;
      }
    }

    if (!destinationName) {
      return Response.json({
        detected: true,
        arrival_phrase_found: true,
        destination_found: false,
        reason: 'arrival_confirmed_but_no_destination_in_conversation'
      });
    }

    // Step 5: Find location by name (within user scope)
    const locations = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: user.email },
      null,
      200
    );

    const destLocation = locations.find(loc =>
      loc.name?.toLowerCase() === destinationName.toLowerCase()
    );

    if (!destLocation) {
      return Response.json({
        detected: true,
        arrival_phrase_found: true,
        destination_found: false,
        destination_name: destinationName,
        reason: 'destination_name_not_found_in_locations'
      });
    }

    // Step 6: Update character to destination
    const nowIso = new Date().toISOString();
    const previousLocation = character.resolved_current_location_name || 'Unknown';

    await base44.asServiceRole.entities.Character.update(character_id, {
      resolved_current_location_id: destLocation.id,
      resolved_current_location_name: destLocation.name,
      resolved_presence_status: 'at_location',
      resolved_location_type: 'visit',
      resolved_source_reason: 'arrival_confirmed_in_chat',
      resolved_last_updated_at: nowIso,
      // Clear stale travel state
      travel_status: 'not_traveling',
      travel_destination_location_id: null,
      travel_destination_location_name: null,
      traveling_to_location_id: null,
      traveling_to_location_name: null,
    });

    // Step 7: Record this as a memory for context
    await base44.asServiceRole.entities.CharacterMemory.create({
      character_id,
      memory_type: 'event',
      memory_text: `${character.name} arrived at ${destLocation.name}. They confirmed: "${message_text}"`,
      memory_summary: `arrived_at::${destLocation.name}`,
      importance_score: 6,
      permanence: 'short_term',
    }).catch(() => {});

    return Response.json({
      success: true,
      detected: true,
      arrival_phrase_found: true,
      destination_found: true,
      proof: {
        character_name: character.name,
        character_id,
        previous_location: previousLocation,
        destination: destLocation.name,
        destination_id: destLocation.id,
        trigger_phrase: message_text,
        arrival_detected_phrase: ARRIVAL_PHRASES.find(p => lowerText.includes(p)),
        updated_at: nowIso,
        cleared_stale_travel_state: character.travel_status !== 'not_traveling' || !!character.travel_destination_location_id,
        message: `${character.name} confirmed arrival at ${destLocation.name} (previously at ${previousLocation}). Travel state cleared.`
      }
    });

  } catch (error) {
    console.error('[detectAndUpdateArrival]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});