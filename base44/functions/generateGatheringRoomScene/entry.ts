import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// ── GATHERING ROOM SCENE IMAGE GENERATOR ──────────────────────────────────────
// Generates a dynamic scene image reflecting the Gathering Room and its CURRENT
// valid active occupants. Uses each occupant's actual avatar/reference image as
// a visual identity reference via GenerateImage's existing_image_urls parameter,
// preserving likeness — the generated scene depicts the actual people in the room,
// not generic substitutes.
//
// CRITICAL RULES:
// - The scene cast is the currently valid active Gathering Room participants.
// - Each occupant's actual avatar_url is passed as a reference image.
// - Participant types (user/character/AI/NPC) are NEVER included in the prompt.
// - The image generator receives only: display names (for scene context), reference
//   images (for likeness), and the room atmosphere description.
// - No participant-type metadata is exposed to the generator or inferable from the result.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const gatheringRoomId = body.gathering_room_id;

    if (!gatheringRoomId) {
      return Response.json({ error: 'Missing gathering_room_id' }, { status: 400 });
    }

    const now = new Date();

    // ── 1. LOAD ROOM ──
    const rooms = await base44.asServiceRole.entities.GatheringRoom.filter(
      { id: gatheringRoomId }, null, 1
    );
    const room = rooms[0];
    if (!room) return Response.json({ error: 'Room not found' }, { status: 404 });

    // ── 2. LOAD VALID ACTIVE PARTICIPANTS (same validity rule as occupancy) ──
    const sessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, status: 'active' },
      'started_at', 50
    );
    const validSessionIds = new Set(
      sessions
        .filter(s => new Date(s.expires_at).getTime() > now.getTime())
        .map(s => s.id)
    );

    const allParticipants = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
      { gathering_room_id: gatheringRoomId },
      'joined_at', 50
    );
    const validParticipants = allParticipants.filter(p => validSessionIds.has(p.session_id));

    // ── 3. RE-RESOLVE USER AVATARS FROM USER ENTITY ──
    // User-type participants may have null avatar_url if created before the avatar fix.
    // Re-resolve from the User entity (same source as getGatheringRoomParticipants).
    const userParticipantIds = validParticipants
      .filter(p => p.participant_type === 'user')
      .map(p => p.participant_id);

    const userAvatarMap = {};
    for (const uid of userParticipantIds) {
      try {
        const users = await base44.asServiceRole.entities.User.filter({ id: uid }, null, 1);
        const u = users[0];
        if (u) {
          const avatar = u.generated_avatar_urls?.[0] || u.reference_image_urls?.[0] || null;
          if (avatar) userAvatarMap[uid] = avatar;
        }
      } catch (_) {}
    }

    // ── 4. BUILD SANITIZED CAST ──
    // Each cast member is just: name + reference image. No type, no ownership.
    const cast = validParticipants.map(p => {
      let avatarUrl = p.avatar_url;
      if (p.participant_type === 'user' && userAvatarMap[p.participant_id]) {
        avatarUrl = userAvatarMap[p.participant_id];
      }
      return {
        name: p.participant_name,
        reference_image: avatarUrl,
      };
    }).filter(c => c.reference_image); // only include members with a usable reference image

    const occupantCount = cast.length;

    // ── 5. BUILD SCENE PROMPT ──
    // Describe the room atmosphere and the number of people. Do NOT include names
    // or type labels in the prompt text. The reference images handle likeness.
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
      prompt += `The space has ${occupantCount} ${occupantCount === 1 ? 'person' : 'people'} present, `;
      prompt += `naturally gathered and engaged in casual social interaction. `;
      prompt += `Depict each person faithfully matching their provided reference photo — `;
      prompt += `same face, same build, same hair, same skin tone, same general appearance. `;
      prompt += `Do not substitute or invent different people. `;
      prompt += `The people shown must be the actual individuals from the reference images, `;
      prompt += `relaxed and socializing together in this shared space. `;
    } else {
      prompt += `The space is currently empty, with seating and social areas ready for guests. `;
    }

    prompt += `Photorealistic, cinematic composition, warm color palette, no text overlays, no captions.`;

    // ── 6. GENERATE IMAGE WITH REFERENCE IMAGES FOR LIKENESS ──
    // Pass each occupant's actual avatar as an existing_image_url so the generator
    // preserves their likeness. This is the same identity-preservation mechanism
    // used for established character imagery.
    const referenceImages = cast.map(c => c.reference_image);

    const generateParams = { prompt };
    if (referenceImages.length > 0) {
      generateParams.existing_image_urls = referenceImages;
    }

    const result = await base44.asServiceRole.integrations.Core.GenerateImage(generateParams);

    const imageUrl = result?.url || result?.file_url || null;
    if (!imageUrl) {
      return Response.json({ error: 'Image generation returned no URL' }, { status: 500 });
    }

    // ── 7. UPDATE ROOM SCENE IMAGE ──
    await base44.asServiceRole.entities.GatheringRoom.update(gatheringRoomId, {
      scene_image_url: imageUrl,
      scene_image_updated_at: now.toISOString(),
    });

    return Response.json({
      success: true,
      scene_image_url: imageUrl,
      occupant_count: occupantCount,
      cast_count: cast.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});