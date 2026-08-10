import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// ── GATHERING ROOM SCENE IMAGE GENERATOR ──────────────────────────────────────
// Generates a dynamic scene image reflecting the Gathering Room and its current
// occupants. Called when room composition changes (admission, exit, expiration).
// Uses the existing GenerateImage integration — no separate image architecture.
//
// IMPORTANT: Participant types (user vs character) are NEVER included in the
// image prompt. Only display names are used. The image must not expose whether
// any participant is a user, character, AI, or human through labels, captions,
// or visual grouping.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const gatheringRoomId = body.gathering_room_id;

    if (!gatheringRoomId) {
      return Response.json({ error: 'Missing gathering_room_id' }, { status: 400 });
    }

    // ── 1. LOAD ROOM ──
    const rooms = await base44.asServiceRole.entities.GatheringRoom.filter(
      { id: gatheringRoomId }, null, 1
    );
    const room = rooms[0];
    if (!room) return Response.json({ error: 'Room not found' }, { status: 404 });

    // ── 2. LOAD CURRENT PARTICIPANTS ──
    const participants = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
      { gathering_room_id: gatheringRoomId },
      'joined_at', 20
    );

    // ── 3. BUILD SCENE PROMPT ──
    // Only use display names — NO participant types, NO user/character labels.
    const occupantNames = participants.map(p => p.participant_name);
    const occupantCount = participants.length;

    const vibeWords = {
      quiet: 'calm, quiet, peaceful atmosphere with soft lighting',
      social: 'warm, social, inviting atmosphere with ambient lighting',
      energetic: 'lively, energetic atmosphere with vibrant lighting',
      mixed: 'mixed atmosphere with varied lighting zones',
    };
    const vibeDesc = vibeWords[room.vibe] || vibeWords.social;

    let prompt = `A wide-angle interior scene of "${room.name}", a shared social gathering space. `;
    if (room.description) {
      prompt += `${room.description}. `;
    }
    prompt += `${vibeDesc}. `;

    if (occupantCount > 0) {
      prompt += `The space has ${occupantCount} ${occupantCount === 1 ? 'person' : 'people'} present. `;
      prompt += `Show ${occupantCount} ${occupantCount === 1 ? 'person' : 'people'} naturally gathered in the space, `;
      prompt += `engaged in casual social interaction. `;
      // Do NOT include names in the image prompt — the image generator can't render
      // specific named individuals. Just describe the number of people and the mood.
      // Character reference images could be used for owned characters, but cross-account
      // participants' images must NOT be used (privacy). So we generate a generic scene.
    } else {
      prompt += `The space is currently empty, with seating and social areas ready for guests. `;
    }

    prompt += `Photorealistic, cinematic composition, warm color palette, no text overlays.`;

    // ── 4. GENERATE IMAGE ──
    const result = await base44.asServiceRole.integrations.Core.GenerateImage({
      prompt,
    });

    const imageUrl = result?.url || result?.file_url || null;
    if (!imageUrl) {
      return Response.json({ error: 'Image generation returned no URL' }, { status: 500 });
    }

    // ── 5. UPDATE ROOM SCENE IMAGE ──
    await base44.asServiceRole.entities.GatheringRoom.update(gatheringRoomId, {
      scene_image_url: imageUrl,
      scene_image_updated_at: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      scene_image_url: imageUrl,
      occupant_count: occupantCount,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});