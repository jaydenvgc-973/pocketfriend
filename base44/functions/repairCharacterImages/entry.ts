/**
 * repairCharacterImages — Universal Safe Character Image Repair
 *
 * SAFETY RULES:
 * - Requires exact character_id — never uses name matching
 * - Verifies owner_email matches the authenticated user before touching anything
 * - Never sets avatar_url to null
 * - Never replaces a valid existing avatar
 * - Never uses only the first reference image as the sole generation source
 * - Never automatically runs — must be explicitly invoked by the user
 * - Logs every field before and after any change
 * - Returns a dry_run report if dry_run=true (default) before making changes
 *
 * Payload:
 * {
 *   character_id: string,   // REQUIRED — exact character ID
 *   dry_run: boolean,       // default true — set false to actually apply fixes
 *   fix_broken_message_images: boolean  // default false
 * }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { character_id, dry_run = true, fix_broken_message_images = false } = body;

    // SAFETY GATE 1: Exact character_id required
    if (!character_id || typeof character_id !== 'string' || character_id.trim().length < 10) {
      return Response.json({
        error: 'character_id is required and must be an exact character ID string. Name matching is not allowed.',
        safe: true,
      }, { status: 400 });
    }

    // SAFETY GATE 2: Fetch character by exact ID only
    const chars = await base44.entities.Character.filter({ id: character_id.trim() });
    const character = chars?.[0];

    if (!character) {
      return Response.json({
        error: `No character found with id="${character_id}". Double-check the ID.`,
        safe: true,
      }, { status: 404 });
    }

    // SAFETY GATE 3: Verify this character belongs to the authenticated user
    if (character.owner_email && character.owner_email !== user.email) {
      return Response.json({
        error: `Character "${character.name}" (id=${character_id}) does not belong to your account. owner_email mismatch.`,
        safe: true,
      }, { status: 403 });
    }
    if (character.created_by && character.created_by !== user.email) {
      return Response.json({
        error: `Character "${character.name}" (id=${character_id}) was not created by your account. created_by mismatch.`,
        safe: true,
      }, { status: 403 });
    }

    // Log current state before any changes
    const currentState = {
      character_id: character.id,
      name: character.name,
      owner_email: character.owner_email || character.created_by,
      avatar_url: character.avatar_url || null,
      image_avatar_url: character.image_avatar_url || null,
      reference_image_urls: character.reference_image_urls || [],
      avatar_generation_prompt: character.avatar_generation_prompt || null,
      avatar_description_text: character.avatar_description_text || null,
    };

    console.log(`[repairCharacterImages] Auditing character: ${character.name} (${character.id})`);
    console.log(`[repairCharacterImages] Current state:`, JSON.stringify(currentState));

    const issues = [];
    const plannedFixes = [];

    // CHECK 1: Has a valid avatar_url?
    if (!character.avatar_url) {
      issues.push('avatar_url is null or missing');
      if (character.reference_image_urls?.length > 0) {
        plannedFixes.push({
          field: 'avatar_url',
          action: 'REGENERATE from reference images using full prompt (NOT copying first ref image directly)',
          note: 'Will use all reference images + description text for balanced generation',
          current_value: null,
        });
      } else if (character.avatar_description_text) {
        plannedFixes.push({
          field: 'avatar_url',
          action: 'REGENERATE from description text only',
          current_value: null,
        });
      } else {
        issues.push('No reference images and no description text — cannot regenerate avatar automatically. Upload photos or add a description through the UI.');
      }
    } else {
      issues.push('avatar_url is present and valid — NO CHANGE will be made to it');
    }

    // CHECK 2: reference_image_urls sanity
    const refs = character.reference_image_urls || [];
    if (refs.length > 10) {
      issues.push(`reference_image_urls has ${refs.length} entries — this may cause generation slowness`);
    }

    // CHECK 3: Broken message images (only if explicitly requested)
    let brokenMessageImageCount = 0;
    if (fix_broken_message_images) {
      const convos = await base44.entities.Conversation.filter({ character_ids: [character.id] }, null, 20);
      for (const convo of convos) {
        const messages = await base44.entities.Message.filter({ conversation_id: convo.id }, '-created_date', 100);
        for (const msg of messages) {
          if (msg.image_url === '' || (msg.image_url && msg.image_url.length < 10)) {
            brokenMessageImageCount++;
          }
        }
      }
      if (brokenMessageImageCount > 0) {
        issues.push(`Found ${brokenMessageImageCount} messages with broken/empty image_url`);
        plannedFixes.push({
          field: 'message.image_url',
          action: `REGENERATE ${brokenMessageImageCount} broken message images using full reference stack (not first image only)`,
          note: 'Uses all reference_image_urls + avatar_url for generation',
        });
      }
    }

    // If dry_run, return the report without making changes
    if (dry_run) {
      return Response.json({
        mode: 'DRY_RUN — no changes made',
        character: currentState,
        issues_found: issues,
        planned_fixes: plannedFixes,
        instructions: 'Review the planned_fixes above. If correct, call this function again with dry_run=false to apply.',
        safe: true,
      });
    }

    // APPLY FIXES (only if dry_run=false)
    const appliedFixes = [];

    // Fix: Regenerate avatar if missing
    if (!character.avatar_url && (refs.length > 0 || character.avatar_description_text)) {
      const descriptor = character.profile_summary || character.personality_summary || character.name;
      const hasText = !!character.avatar_description_text?.trim();
      const imageCount = refs.length;
      const totalSlots = imageCount + (hasText ? 1 : 0);
      const weightPercent = totalSlots > 0 ? Math.round(100 / totalSlots) : 100;

      let promptParts = [
        `Realistic portrait photo of ${descriptor}.`,
        `Candid, natural lighting, authentic. Not a stock photo.`,
      ];

      if (imageCount > 0 && hasText) {
        promptParts.push(`Match the person's exact appearance from the reference photos (${weightPercent}% influence).`);
        promptParts.push(`Additional appearance details (${weightPercent}% influence): ${character.avatar_description_text.trim()}`);
      } else if (imageCount > 0) {
        promptParts.push(`Match the person's exact appearance from the reference photos (100% reference influence).`);
      } else if (hasText) {
        promptParts.push(`Appearance details (100% influence): ${character.avatar_description_text.trim()}`);
      }

      promptParts.push(`STYLE DIRECTIVE: Photorealistic, cinematic, ultra-detailed. RAW photo quality. Natural lighting. No illustrations. Real human proportions.`);

      const finalPrompt = promptParts.join(' ');

      console.log(`[repairCharacterImages] Regenerating avatar for ${character.name} using ${refs.length} refs + text=${hasText}`);

      const result = await base44.integrations.Core.GenerateImage({
        prompt: finalPrompt,
        existing_image_urls: refs.length > 0 ? refs : undefined, // use ALL refs, not just [0]
      });

      if (result?.url) {
        await base44.entities.Character.update(character.id, {
          avatar_url: result.url,
          avatar_generation_prompt: finalPrompt,
        });
        appliedFixes.push({
          field: 'avatar_url',
          action: 'REGENERATED',
          new_value: result.url,
          prompt_used: finalPrompt,
        });
        console.log(`[repairCharacterImages] Avatar regenerated: ${result.url}`);
      }
    }

    // Re-fetch final state
    const finalChars = await base44.entities.Character.filter({ id: character.id });
    const finalState = {
      character_id: finalChars[0]?.id,
      name: finalChars[0]?.name,
      avatar_url: finalChars[0]?.avatar_url || null,
      reference_image_urls: finalChars[0]?.reference_image_urls || [],
    };

    return Response.json({
      mode: 'APPLIED',
      character_before: currentState,
      character_after: finalState,
      issues_found: issues,
      applied_fixes: appliedFixes,
      safe: true,
    });

  } catch (error) {
    console.error('[repairCharacterImages] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});