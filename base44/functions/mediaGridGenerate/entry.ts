/**
 * mediaGridGenerate — Multi-person image generation with hard identity lock.
 * 
 * CRITICAL CONTRACT:
 * When multiple people are selected, EVERY selected person MUST be visually locked
 * to their stored reference images. No substitutes. No generic people. No placeholder humans.
 * 
 * If any selected person cannot be visually resolved, generation STOPS.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

function isAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      messageId,
      prompt,
      subjectType,
      characterId,
      characterName,
      characterRefImages,
      userRefImages,
      userName,
      locationId,
      locationName,
      zoneName,
      zoneImageUrls,
      multiPersonSelection,
    } = await req.json();

    if (!messageId || !prompt) {
      return Response.json({ error: 'messageId and prompt required' }, { status: 400 });
    }

    console.log(`[mediaGridGenerate] ▶ messageId=${messageId} | multiPerson=${!!multiPersonSelection}`);

    // ── MULTI-PERSON IDENTITY LOCK ─────────────────────────────────────────
    if (multiPersonSelection) {
      console.log(`[mediaGridGenerate] MULTI-PERSON MODE: validating ${multiPersonSelection.selectedCharacters.length} selected people`);

      const validation = {
        totalSelected: multiPersonSelection.selectedCharacters.length,
        withRefs: 0,
        missingRefs: [],
      };

      for (const person of multiPersonSelection.selectedCharacters) {
        if (!person.referenceImages || person.referenceImages.length === 0) {
          validation.missingRefs.push(`${person.role} (${person.id})`);
        } else {
          validation.withRefs++;
          console.log(`[mediaGridGenerate] ✓ ${person.role} (${person.id}): ${person.referenceImages.length} refs`);
        }
      }

      if (multiPersonSelection.includeUser && multiPersonSelection.userReferenceImages) {
        if (multiPersonSelection.userReferenceImages.length === 0) {
          validation.missingRefs.push('user');
        } else {
          validation.withRefs++;
          console.log(`[mediaGridGenerate] ✓ user: ${multiPersonSelection.userReferenceImages.length} refs`);
        }
      }

      console.log(`[mediaGridGenerate] Identity validation: ${validation.withRefs}/${validation.totalSelected} with refs`);

      if (validation.missingRefs.length > 0) {
        const errorMsg = `IDENTITY LOCK FAILED: Cannot generate image. Missing visual references for: ${validation.missingRefs.join(', ')}.`;
        console.error(`[mediaGridGenerate] ⛔ ${errorMsg}`);
        await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
        return Response.json({ success: false, error: errorMsg }, { status: 400 });
      }

      // ── BUILD MULTI-PERSON PROMPT ──────────────────────────────────────
      // Assemble all reference images with strict labeling
      const allRefs = [];
      let refIndex = 1;
      const refMap = {};

      for (const person of multiPersonSelection.selectedCharacters) {
        const refs = (person.referenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        refs.forEach(url => {
          allRefs.push(url);
          refMap[refIndex] = { role: person.role, id: person.id };
          refIndex++;
        });
      }

      if (multiPersonSelection.includeUser && multiPersonSelection.userReferenceImages) {
        const refs = (multiPersonSelection.userReferenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        refs.forEach(url => {
          allRefs.push(url);
          refMap[refIndex] = { role: 'user', id: 'user' };
          refIndex++;
        });
      }

      const identityRefs = [];
      const people = [];
      refIndex = 1;
      for (const person of multiPersonSelection.selectedCharacters) {
        const refs = (person.referenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        identityRefs.push(...refs);
        people.push({
          role: person.role,
          id: person.id,
          refStart: refIndex,
          refCount: refs.length,
        });
        refIndex += refs.length;
      }

      if (multiPersonSelection.includeUser && multiPersonSelection.userReferenceImages) {
        const refs = (multiPersonSelection.userReferenceImages || []).map(toPublicCDN).filter(isAccessible).slice(0, 3);
        identityRefs.push(...refs);
        people.push({
          role: 'user',
          id: 'user',
          refStart: refIndex,
          refCount: refs.length,
        });
      }

      const envRefs = (zoneImageUrls || []).map(toPublicCDN).filter(isAccessible).slice(0, 4);

      // Use generateImageAsync's unified rules for consistency across all paths
      // Multi-person images must still obey: camera flexibility, selfie rules, time-of-day lighting,
      // zone truth, reference balance (70-80% structure / 20-30% flexibility)
      const multiPersonPrompt = `
════════════════════════════════════════════════════════════
MULTI-PERSON IMAGE GENERATION — SHARED RULES + IDENTITY LOCK
════════════════════════════════════════════════════════════

CORE SCENE PROMPT:
${prompt}

════════════════════════════════════════════════════════════
REFERENCE IMAGE BALANCE (applies to ALL image generation)
════════════════════════════════════════════════════════════

${envRefs.length > 0 ? `ENVIRONMENT (70–80% structural truth, 20–30% dynamic flexibility):
  Images 1–${envRefs.length}: ROOM/ZONE STRUCTURE
  ✅ PRESERVE: walls, floor, furniture, fixtures, objects, architecture, layout
  ✓ REGENERATE: lighting (time-of-day), camera angle, framing, perspective
  ⛔ Do NOT treat as static background — recompose from new camera viewpoint
  ⛔ Do NOT invent replacement furniture
  ⛔ Zone structure stays TRUE while camera and lighting CHANGE

` : ''}
SELECTED PEOPLE (100% identity lock from reference photos):

${people.map(p => {
  const label = p.role === 'user' ? 'User' : p.role.replace(/_/g, ' ').toUpperCase();
  const startIdx = envRefs.length + p.refStart;
  const endIdx = envRefs.length + p.refStart + p.refCount - 1;
  return `${label} (${p.id}): Images ${startIdx}–${endIdx}
  ✅ MATCH EXACTLY: face structure, skin tone, hair, body type, age
  ⛔ Do NOT: substitute, distort, use generic person, invent new body`;
}).join('\n\n')}

════════════════════════════════════════════════════════════
UNIFIED COMPOSITION RULE (all paths)
════════════════════════════════════════════════════════════
The image is ONE COHESIVE SCENE. All people are naturally integrated inside the zone.
Do NOT:
  🚫 Paste or enlarge any person over a static background
  🚫 Disconnect person from room perspective
  🚫 Change zone structure or replace furniture
  🚫 Invent mirrors, counters, or other props
  🚫 Create floating objects

DO:
  ✓ Move camera closer/farther if needed
  ✓ Change camera angle for new viewpoint
  ✓ Apply time-of-day lighting and fresh shadows
  ✓ Reframe entire scene from new camera position
`;


      console.log(`[mediaGridGenerate] Multi-person prompt built for ${people.length} people with ${identityRefs.length} identity refs + ${envRefs.length} env refs`);

      const allReferences = [
        ...envRefs,
        ...identityRefs,
      ];

      if (allReferences.length === 0) {
        await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
        return Response.json({ success: false, error: 'No reference images available for any selected person.' }, { status: 400 });
      }

      try {
        const genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: multiPersonPrompt,
          existing_image_urls: allReferences,
        });

        if (!genRes?.url) {
          await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
          return Response.json({ success: false, error: 'No image URL returned from generator.' }, { status: 500 });
        }

        const generationContext = {
          prompt,
          subjectType: 'multi',
          selectedPeople: people.map(p => ({ role: p.role, id: p.id })),
          characterReferenceImages: identityRefs,
          locationName,
          zoneName,
          locationReferenceImages: envRefs,
          generatedAt: new Date().toISOString(),
        };

        await base44.asServiceRole.entities.Message.update(messageId, {
          image_url: genRes.url,
          generation_context: generationContext,
        });

        console.log(`[mediaGridGenerate] ✓ Multi-person SUCCESS: ${messageId}`);

        return Response.json({
          success: true,
          imageUrl: genRes.url,
          messageId,
          subjectType: 'multi',
          selectedPeopleCount: people.length,
        });
      } catch (genErr) {
        const msg = genErr?.message || '';
        if (/filter|guideline|block|violat/i.test(msg)) {
          await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
          return Response.json({ success: false, filtered: true, error: 'Image blocked by content filter. Try rephrasing.' });
        }
        throw genErr;
      }
    }

    // ── SINGLE-CHARACTER MODE (use shared generateImageAsync) ──────────────────
    console.log(`[mediaGridGenerate] Single-character mode: delegating to generateImageAsync`);

    // All image generation paths must use generateImageAsync for consistency
    // This ensures selfie rules, time-of-day lighting, camera flexibility, reference balance,
    // and zone truth rules are applied uniformly across Media Grid, Chat, Scene, and other paths
    const singleCharRes = await base44.asServiceRole.functions.invoke('generateImageAsync', {
      messageId,
      prompt,
      characterId,
      characterName,
      characterReferenceImages: (characterRefImages || []).map(toPublicCDN).filter(isAccessible),
      userReferenceImages: userRefImages ? (userRefImages || []).map(toPublicCDN).filter(isAccessible) : [],
      userWorldName: userName || null,
      subjectType: subjectType || 'character',
      characterEmotionalState: 'calm',
      // NO manualLocationId — generateImageAsync resolves from character record
    });

    if (!singleCharRes?.data?.success) {
      const errorMsg = singleCharRes?.data?.error || 'Image generation failed';
      await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
      return Response.json({ success: false, error: errorMsg }, { status: singleCharRes?.status || 500 });
    }

    console.log(`[mediaGridGenerate] ✓ Single-character SUCCESS via generateImageAsync: ${messageId}`);
    return Response.json({
      success: true,
      imageUrl: singleCharRes.data.imageUrl,
      messageId,
      subjectType: 'character',
    });

  } catch (error) {
    console.error('[mediaGridGenerate] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});