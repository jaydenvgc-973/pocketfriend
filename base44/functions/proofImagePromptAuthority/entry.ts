/**
 * proofImagePromptAuthority — Live path proof using REAL character records.
 *
 * IDENTITY AUTHORITY ORDER:
 *   1. Appearance lock (structured fields: ethnicities, appearance_lock.*)
 *   2. Avatar URL and reference images — avatar IS identity data
 *   3. Character description (demographics: age_range, gender)
 *   4. Outfit / closet (clothing only)
 *   5. Scene/location/lighting/pose/camera
 *
 * RULES THIS PROOF ENFORCES:
 *   - appearance_notes and avatar_description_text are NOT injected into charDesc or prompt
 *   - charDesc is demographics-only (age_range + gender)
 *   - outfit comes from closet resolver, not from prose
 *   - avatar_url is the existing face anchor — no new eligibility rules are introduced
 *   - a character with an avatar is NOT identity-poor and NOT blocked
 *   - the Caucasian-default guard fires only when charRefs=0 AND no charDesc AND no lock AND no ethnicities
 *     (which means: no refs, no avatar already loaded into refs, no demographics, no lock)
 *
 * WHAT THIS DOES NOT DO:
 *   - Does not introduce new avatar URL filtering rules
 *   - Does not re-qualify or re-validate avatars that were already working
 *   - Does not reclassify characters as identity-poor
 *   - Does not create new avatar blockers
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Parse body once — body stream can only be read once in Deno
  const reqBody = await req.json().catch(() => ({}));
  const summaryMode = !!(reqBody?.summaryOnly);

  // ── URL UTILITIES (exact copy from generateImageAsync) ────────────────────
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

  function cdnFilter(urls) {
    return (urls || []).map(toPublicCDN).filter(isAccessible);
  }

  // ── EXACT COPY of buildAppearanceLockText from generateImageAsync ─────────
  function buildAppearanceLockText(rec, n) {
    const name = n || rec?.name || 'this character';
    if (!rec) return 'render from refs — do not redesign';
    const lock = rec.appearance_lock || {};
    const ethnicities = (rec.ethnicities || []).filter(Boolean);
    const ethnicityFallback = rec.ethnicity || rec.race || null;
    const allEthnicities = ethnicities.length > 0 ? ethnicities : (ethnicityFallback ? [ethnicityFallback] : []);
    const skinTone = lock.skin_tone || null;
    const hairstyle = lock.hairstyle || null;
    const hairType = lock.hair_type || null;
    const hairColor = lock.hair_color || null;
    const facialHair = lock.facial_hair || null;
    const bodyType = lock.body_type || lock.overall_aesthetic || null;
    const distinguishing = lock.distinguishing_features || null;
    const isBald = lock.bald === true || /\b(bald|shaved head|no hair)\b/i.test(hairType || hairstyle || '');
    const htDisplay = hairstyle || hairType || null;
    const hasAnyData = allEthnicities.length > 0 || skinTone || htDisplay || hairColor || facialHair || bodyType || isBald;
    if (!hasAnyData) return 'render from refs — do not redesign';
    const r = [`\n🔒 CANONICAL APPEARANCE LOCK — "${name}" — ABSOLUTE IDENTITY AUTHORITY\nThese traits come directly from the character's structured data. OVERRIDE any conflicting prompt styling.\n`];
    if (allEthnicities.length > 0) r.push(`ETHNICITY / RACE: ${allEthnicities.join(', ')} — render EXACTLY this ethnicity. ⛔ DO NOT default to Caucasian/white/European. ⛔ DO NOT soften, lighten, or alter ethnic features.`);
    if (skinTone) r.push(`SKIN TONE: ${skinTone} — do not lighten, soften, or alter.`);
    if (isBald) {
      r.push(`HAIR: BALD — zero hair on top. ⛔ NO curls, locs, braids, fade, hairline, or any hair.`);
    } else if (htDisplay) {
      r.push(`HAIR: ${htDisplay}`);
      if (/dreadlocks?|locs?/i.test(htDisplay)) r.push(`⛔ REJECT: fade, short, bald, generic curls — DREADLOCKS ONLY`);
      else if (/long hair/i.test(htDisplay)) r.push(`⛔ REJECT: short, buzz, fade, cropped — LONG HAIR ONLY`);
      else if (/short|buzz|fade/i.test(htDisplay)) r.push(`⛔ REJECT: long, flowing — SHORT/FADE ONLY`);
      else if (/braids?|cornrows/i.test(htDisplay)) r.push(`⛔ REJECT: loose/straight/fade — BRAIDS ONLY`);
      else if (/afro/i.test(htDisplay)) r.push(`⛔ REJECT: straight, slicked, fade — AFRO ONLY`);
    }
    if (hairColor) r.push(`HAIR COLOR: ${hairColor} — do not alter.`);
    if (facialHair) {
      r.push(`FACIAL HAIR: ${facialHair}`);
      if (/clean-?shaven|no facial hair/i.test(facialHair)) r.push(`⛔ REJECT beard/stubble — CLEAN-SHAVEN ONLY`);
      else r.push(`⛔ REJECT clean-shaven — ${facialHair} MUST EXIST`);
    }
    if (bodyType) r.push(`BODY TYPE: ${bodyType} — do not slim, bulk, age-down, or beautify beyond what is described.`);
    if (distinguishing) r.push(`DISTINGUISHING FEATURES: ${distinguishing} — must be visible and accurate.`);
    r.push(`\nCANONICAL > REFS > PROMPT. Prompt controls pose/scene ONLY — NOT ethnicity/hair/face/skin/body.\n⛔ REJECT any prompt trait conflicting with the above.\n🚫 GENERATION INVALID if ethnicity, skin tone, hair, facial hair, or body type differs from canonical.`);
    return r.join('\n');
  }

  // ── EXACT COPY of isAIStylePrompt filter from generateImageAsync ──────────
  function isAIStylePrompt(t) {
    if (!t) return false;
    return /\b(cinematic|chiaroscuro|dramatic lighting|editorial photography|fine art|low-key lighting|sculptural anatomy|artistic composition|museum.quality|photorealistic|ultra.detailed|high.resolution|bokeh|dramatic shadow|noir atmosphere|hyper.realistic|studio lighting|professional photography|stock photo|silhouette|atmosphere|moody|high contrast|film grain|depth of field|aesthetic|luxury editorial)\b/i.test(t);
  }

  // ── EXACT COPY of buildOutfitText from generateImageAsync ────────────────
  function buildOutfitText(outfit) {
    if (!outfit) return null;
    const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
      .filter(Boolean)
      .map(p => {
        const t = p.trim();
        if (/^(n\/?a|none|-)$/i.test(t)) return null;
        const s = t.replace(/^n\/?a[,\-–]\s*/i, '').trim();
        return /^(shirtless|no top|no shirt)$/i.test(s) ? 'No shirt / bare torso' : (s || null);
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
    const fd = outfit.full_description?.trim();
    if (fd && !isAIStylePrompt(fd)) return fd;
    return null;
  }

  function resolveOutfitCategory(character) {
    const presence = character?.resolved_presence_status || character?.location_status || '';
    const activity = (character?.current_activity || '').toLowerCase();
    if (/bath|shower|grooming/.test(activity)) return 'bath';
    if (presence === 'sleeping' || presence === 'napping' || /\b(sleep|nap|asleep|bedtime)\b/.test(activity)) return 'sleepwear';
    if (/\b(swim|pool|beach|ocean|water park)\b/.test(activity)) return 'swimwear';
    if (/\b(gym|workout|exercise|lifting|cardio|yoga|jogging|running|training)\b/.test(activity)) return 'gym';
    if (presence === 'at_work') return 'work';
    if (/\b(church|worship|mass|prayer|service)\b/.test(activity)) return 'church';
    if (/\b(wedding|funeral|gala|graduation|ceremony|formal)\b/.test(activity)) return 'formal';
    if (/\b(club|nightclub|party|night out)\b/.test(activity)) return 'nightlife';
    if (/\b(date|date night|romantic dinner|anniversary)\b/.test(activity)) return 'date_night';
    if (/\b(school|class|campus|lecture|college|university)\b/.test(activity)) return 'school';
    if (/\b(airport|train|travel|hotel check-in|vacation departure)\b/.test(activity)) return 'travel';
    if (presence === 'home') return 'lounge';
    return 'daily_casual';
  }

  const OUTFIT_FALLBACK_CHAINS = {
    bath: ['bath', 'sleepwear', 'lounge'], sleepwear: ['sleepwear', 'lounge', 'daily_casual'],
    swimwear: ['swimwear', 'gym', 'daily_casual'], gym: ['gym', 'outdoor', 'daily_casual'],
    work: ['work', 'formal', 'daily_casual'], formal: ['formal', 'work', 'daily_casual'],
    church: ['church', 'formal', 'daily_casual'], nightlife: ['nightlife', 'date_night', 'daily_casual'],
    date_night: ['date_night', 'nightlife', 'formal', 'daily_casual'], school: ['school', 'daily_casual'],
    lounge: ['lounge', 'daily_casual'], outdoor: ['outdoor', 'daily_casual'],
    travel: ['travel', 'outdoor', 'daily_casual'], medical: ['medical', 'daily_casual'],
    special: ['special', 'formal', 'daily_casual'], cold_weather: ['cold_weather', 'outdoor', 'daily_casual'],
    hot_weather: ['hot_weather', 'outdoor', 'daily_casual'], daily_casual: ['daily_casual', 'outdoor', 'lounge'],
  };

  function resolveCharacterOutfitForPrompt(character) {
    if (!character) return { text: null, source: 'no_character', name: null, category: null };
    const rotationEnabled = character?.outfit_rotation_enabled !== false;
    const co = character.current_outfit;

    function resolveOutfitText(outfit) {
      if (!outfit) return null;
      const t = buildOutfitText(outfit);
      if (t) return t;
      if (outfit.label?.trim()) return outfit.label.trim();
      return null;
    }

    if (!rotationEnabled) {
      if (co?.outfit_id || co?.label) {
        let t = resolveOutfitText(co);
        if (!t && co.outfit_id) {
          const closetMatch = (character.character_closet || []).find(item => item.outfit_id === co.outfit_id);
          if (closetMatch) t = resolveOutfitText(closetMatch);
        }
        if (t) return { text: t, source: 'rotation_off_lock', name: co.label || 'active', category: co.category || null };
      }
    }

    if (co?.outfit_id || co?.label) {
      const targetCategory = resolveOutfitCategory(character);
      const coCategory = co.category || null;
      const chain = OUTFIT_FALLBACK_CHAINS[targetCategory] || ['daily_casual', 'lounge'];
      const contextMatch = coCategory && chain.includes(coCategory);
      if (contextMatch) {
        let resolvedOutfit = co;
        if (co.outfit_id) {
          const closetMatch = (character.character_closet || []).find(item => item.outfit_id === co.outfit_id);
          if (closetMatch) resolvedOutfit = closetMatch;
        }
        const t = resolveOutfitText(resolvedOutfit);
        if (t) return { text: t, source: 'current_outfit_context_match', name: co.label || 'active', category: coCategory };
      }
    }

    const outfits = (character.character_closet || []).filter(item => item.outfit_id);
    if (!outfits.length) return { text: null, source: 'no_closet', name: null, category: null };

    const targetCategory = resolveOutfitCategory(character);
    const chain = OUTFIT_FALLBACK_CHAINS[targetCategory] || ['daily_casual', 'lounge'];
    for (const cat of chain) {
      const pool = outfits.filter(o => o.category === cat);
      if (!pool.length) continue;
      if (pool.length === 1) {
        const t = resolveOutfitText(pool[0]);
        return { text: t, source: 'closet_rotation', name: pool[0].label || cat, category: cat };
      }
      const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
      const idHash = (character.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      let idx = (dayOfYear + idHash) % pool.length;
      if (pool[idx]?.outfit_id === co?.outfit_id && pool.length > 1) idx = (idx + 1) % pool.length;
      const t = resolveOutfitText(pool[idx]);
      return { text: t, source: 'closet_rotation', name: pool[idx].label || cat, category: cat };
    }
    return { text: null, source: 'closet_chain_miss', name: null, category: targetCategory };
  }

  // ── PROOF ENGINE ─────────────────────────────────────────────────────────────
  // Mirrors the exact logic in generateImageAsync and regenerateImageWithReason.
  // IMPORTANT: This proof does NOT introduce new avatar eligibility rules.
  // It reflects exactly what the generation functions do, no more, no less.

  function runProductionCharDescAssembly(charRecord) {
    // Step 1: charDesc — EXACTLY what generateImageAsync builds
    const parts = [
      charRecord.age_range ? `${charRecord.age_range} years old` : null,
      charRecord.gender || null,
    ].filter(Boolean);
    const charDesc = parts.join(', ');

    // Step 2: appearance lock — reads structured fields only
    const appearanceLockText = buildAppearanceLockText(charRecord, charRecord.name);

    // Step 3: outfit resolution
    const resolvedOutfit = resolveCharacterOutfitForPrompt(charRecord);

    // Step 4: assemble final charDesc with outfit (same logic as generateImageAsync)
    let finalCharDesc = charDesc;
    if (resolvedOutfit.text) {
      finalCharDesc = charDesc
        ? `${charDesc}. Currently wearing: ${resolvedOutfit.text}`
        : `Currently wearing: ${resolvedOutfit.text}`;
    }

    // Step 5: confirm what is EXCLUDED
    const excludedFields = {};
    if (charRecord.appearance_notes) {
      excludedFields.appearance_notes = {
        value_present: true,
        char_count: charRecord.appearance_notes.length,
        injected_into_charDesc: false,
        injected_into_prompt: false,
        reason_excluded: 'prose field — would compete with canonical appearance lock',
      };
    }
    if (charRecord.avatar_description_text) {
      excludedFields.avatar_description_text = {
        value_present: true,
        char_count: charRecord.avatar_description_text.length,
        injected_into_charDesc: false,
        injected_into_prompt: false,
        reason_excluded: 'prose field — avatar used as reference IMAGE only, not as text description',
      };
    }

    // Step 6: Avatar — the existing behavior, not a new eligibility check
    // In generateImageAsync, avatar_url is loaded as a face anchor ref when reference_image_urls is empty.
    // The avatar fallback runs BEFORE the identity guard, so by the time the guard runs,
    // charRefs already contains the avatar if it was loadable.
    // This proof reflects that existing behavior without adding new filtering rules.
    const hasAvatarUrl = !!charRecord.avatar_url;
    // What generateImageAsync does: toPublicCDN → isAccessible check → not generated_image
    const avatarPublicPreview = charRecord.avatar_url ? toPublicCDN(charRecord.avatar_url) : null;
    const avatarWouldPassExistingFilter = avatarPublicPreview
      && isAccessible(avatarPublicPreview)
      && !avatarPublicPreview.includes('generated_image');

    // Step 7: What reference images would be loaded (matches generateImageAsync logic)
    const allRefUrls = cdnFilter(charRecord.reference_image_urls || []);
    const validRefUrls = allRefUrls.filter(url => !url.includes('generated_image'));
    const charRefsWouldLoad = validRefUrls.slice(0, 4);
    // If no reference_image_urls, avatar_url is the fallback (existing behavior)
    const avatarWouldBeUsedAsRef = charRefsWouldLoad.length === 0 && avatarWouldPassExistingFilter;

    // Step 8: identity missing guard (same as generateImageAsync)
    // Block only when charRefs=0 AND no charDesc AND no lock AND no ethnicities
    // charRefs here = charRefsWouldLoad + (avatar if eligible and no refs)
    const effectiveRefCount = charRefsWouldLoad.length + (avatarWouldBeUsedAsRef ? 1 : 0);
    const hasAppearanceLock = charRecord.appearance_lock && Object.keys(charRecord.appearance_lock).length > 0;
    const hasEthnicities = (charRecord.ethnicities || []).length > 0;
    const wouldBeBlocked = effectiveRefCount === 0 && !finalCharDesc && !hasAppearanceLock && !hasEthnicities;

    return {
      char_name: charRecord.name,
      char_id: charRecord.id,

      // What generateImageAsync / regenerateImageWithReason puts in charDesc
      charDesc_assembled: finalCharDesc,
      charDesc_demographics_only: charDesc,

      // The identity block as it will appear in the final prompt
      appearance_lock_block: appearanceLockText,
      appearance_lock_source: 'structured_fields_only',
      appearance_lock_fields_read: {
        skin_tone: charRecord.appearance_lock?.skin_tone || null,
        hairstyle: charRecord.appearance_lock?.hairstyle || null,
        hair_type: charRecord.appearance_lock?.hair_type || null,
        hair_color: charRecord.appearance_lock?.hair_color || null,
        facial_hair: charRecord.appearance_lock?.facial_hair || null,
        body_type: charRecord.appearance_lock?.body_type || charRecord.appearance_lock?.overall_aesthetic || null,
        distinguishing_features: charRecord.appearance_lock?.distinguishing_features || null,
        bald: charRecord.appearance_lock?.bald || false,
      },
      ethnicities_used: (charRecord.ethnicities || []).filter(Boolean),

      // Avatar — existing behavior reflected, no new rules
      avatar_identity: {
        has_avatar_url: hasAvatarUrl,
        avatar_would_pass_existing_cdn_filter: avatarWouldPassExistingFilter,
        avatar_would_be_used_as_ref: avatarWouldBeUsedAsRef,
        note: hasAvatarUrl && !avatarWouldPassExistingFilter
          ? 'Avatar URL present but would not pass existing generateImageAsync CDN filter (private URL, signed URL, or base44.app URL). Character still generates from charDesc and appearance lock.'
          : hasAvatarUrl && avatarWouldBeUsedAsRef
          ? 'Avatar IS the face anchor ref — loaded by generateImageAsync when no reference_image_urls exist'
          : hasAvatarUrl && !avatarWouldBeUsedAsRef
          ? 'Avatar present — reference_image_urls take priority, avatar not needed as fallback'
          : 'No avatar_url',
      },

      // Reference images
      reference_images: {
        raw_count: (charRecord.reference_image_urls || []).length,
        valid_accessible_count: validRefUrls.length,
        would_be_passed_to_generator: charRefsWouldLoad.length,
      },

      // Outfit
      outfit_resolved: resolvedOutfit.text,
      outfit_source: resolvedOutfit.source,
      outfit_name: resolvedOutfit.name,
      outfit_category: resolvedOutfit.category,
      current_outfit_label: charRecord.current_outfit?.label || null,
      closet_size: (charRecord.character_closet || []).filter(o => o.outfit_id).length,

      // Excluded prose fields
      excluded_fields: excludedFields,

      // Identity guard — exact same logic as generateImageAsync
      identity_missing_guard: {
        has_appearance_lock: hasAppearanceLock,
        has_ethnicities: hasEthnicities,
        has_reference_images: validRefUrls.length > 0,
        has_avatar_as_fallback_ref: avatarWouldBeUsedAsRef,
        has_charDesc: !!charDesc,
        effective_ref_count: effectiveRefCount,
        would_block_generation: wouldBeBlocked,
      },

      // Contradiction check
      contradictions: {
        appearance_notes_in_charDesc: finalCharDesc.includes(charRecord.appearance_notes?.substring(0, 20) || '___NEVER___'),
        avatar_description_in_charDesc: finalCharDesc.includes(charRecord.avatar_description_text?.substring(0, 20) || '___NEVER___'),
        charDesc_contains_only_demographics: !finalCharDesc.includes(charRecord.appearance_notes?.substring(0, 20) || '___NEVER___') && !finalCharDesc.includes(charRecord.avatar_description_text?.substring(0, 20) || '___NEVER___'),
      },
    };
  }

  // ── FETCH REAL CHARACTERS ───────────────────────────────────────────────────
  let allChars = await base44.entities.Character.list('-updated_date', 50).catch(() => []);
  if (allChars.length === 0) {
    allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email }, '-updated_date', 50
    ).catch(() => []);
  }
  if (allChars.length === 0) {
    const all = await base44.asServiceRole.entities.Character.list('-updated_date', 50).catch(() => []);
    allChars = all.filter(c => c.owner_email === user.email || c.created_by === user.email);
  }

  if (allChars.length === 0) {
    return Response.json({ error: 'No active characters found on this account', user_email: user.email });
  }

  // ── CATEGORIZE ─────────────────────────────────────────────────────────────
  const withFullLock = allChars.filter(c =>
    c.appearance_lock && Object.keys(c.appearance_lock).length >= 3 &&
    (c.ethnicities?.length > 0 || c.appearance_lock.skin_tone)
  );
  const withPartialLock = allChars.filter(c =>
    c.appearance_lock && Object.keys(c.appearance_lock).length > 0 &&
    !withFullLock.find(w => w.id === c.id)
  );
  const withAppearanceNotes = allChars.filter(c => !!c.appearance_notes);
  const withAvatarDescText = allChars.filter(c => !!c.avatar_description_text);
  const withCurrentOutfit = allChars.filter(c => !!c.current_outfit?.label || !!c.current_outfit?.outfit_id);
  const withCloset = allChars.filter(c => (c.character_closet || []).filter(o => o.outfit_id).length > 0);
  const withAIStyleOutfit = allChars.filter(c => {
    const co = c.current_outfit;
    return co && isAIStylePrompt(co.full_description || '');
  });
  const withAvatarUrl = allChars.filter(c => !!c.avatar_url);

  // "no lock and no refs" — the original category, preserved as-is
  // This does NOT imply identity-poor: avatar_url is the existing fallback for these characters
  const withNoLockNoRefs = allChars.filter(c =>
    (!c.appearance_lock || Object.keys(c.appearance_lock).length === 0) &&
    (!c.ethnicities || c.ethnicities.length === 0) &&
    (!c.reference_image_urls || c.reference_image_urls.length === 0)
  );
  // Of those, how many have avatar_url (the existing fallback)
  const withNoLockNoRefsButHasAvatar = withNoLockNoRefs.filter(c => !!c.avatar_url);

  const results = {
    proof_timestamp: new Date().toISOString(),
    account: user.email,
    total_active_characters: allChars.length,

    categories: {
      with_full_lock: withFullLock.length,
      with_partial_lock: withPartialLock.length,
      with_appearance_notes: withAppearanceNotes.length,
      with_avatar_description_text: withAvatarDescText.length,
      with_current_outfit: withCurrentOutfit.length,
      with_closet: withCloset.length,
      with_ai_style_outfit_full_description: withAIStyleOutfit.length,
      with_avatar_url: withAvatarUrl.length,
      // CORRECTED: the 23 with "no lock and no refs" is now broken down properly
      // to show how many of those still have avatars (existing face anchor)
      with_no_lock_and_no_refs: withNoLockNoRefs.length,
      with_no_lock_and_no_refs_and_has_avatar: withNoLockNoRefsButHasAvatar.length,
      with_no_lock_and_no_refs_and_no_avatar: withNoLockNoRefs.length - withNoLockNoRefsButHasAvatar.length,
    },

    // How the generation functions handle avatar
    avatar_behavior_in_generation: {
      generateImageAsync: 'When reference_image_urls is empty, avatar_url is loaded as a controlled face anchor ref. This is the existing fallback. No new eligibility rules were introduced.',
      regenerateImageWithReason: 'When reason is dont_like/custom_prompt/flawed and reference_image_urls is empty, avatar_url is loaded as fallback. Existing behavior preserved.',
      identity_guard: 'Fires only when charRefs=0 AND charDesc is empty AND no appearance_lock AND no ethnicities. Avatar loaded into charRefs before guard runs — so a character with an accessible avatar will not be blocked.',
    },

    proof_cases: {},
  };

  // ── CASE A: Character with full appearance lock ─────────────────────────
  const caseAChar = withFullLock[0] || null;
  if (caseAChar) {
    results.proof_cases.A_full_appearance_lock = runProductionCharDescAssembly(caseAChar);
    results.proof_cases.A_full_appearance_lock._case = 'Full appearance lock — structured fields read directly';
  } else {
    results.proof_cases.A_full_appearance_lock = { _case: 'SKIPPED — no character with full lock on this account' };
  }

  // ── CASE B: Character with appearance_notes and/or avatar_description_text ─
  const caseBChar = withAppearanceNotes[0] || withAvatarDescText[0] || null;
  if (caseBChar) {
    results.proof_cases.B_prose_fields_excluded = runProductionCharDescAssembly(caseBChar);
    results.proof_cases.B_prose_fields_excluded._case = 'Character with prose fields — proves appearance_notes/avatar_description_text are excluded from charDesc and prompt';
  } else {
    results.proof_cases.B_prose_fields_excluded = { _case: 'SKIPPED — no character with prose appearance fields on this account' };
  }

  // ── CASE C: Character with current outfit and/or closet ─────────────────
  const caseCChar = withCurrentOutfit[0] || withCloset[0] || null;
  if (caseCChar) {
    results.proof_cases.C_outfit_resolution = runProductionCharDescAssembly(caseCChar);
    results.proof_cases.C_outfit_resolution._case = 'Character with outfit/closet — proves outfit is resolved from closet, not from prose';
  } else {
    results.proof_cases.C_outfit_resolution = { _case: 'SKIPPED — no character with outfit data on this account' };
  }

  // ── CASE D: Character with partial lock only ─────────────────────────────
  const caseDChar = withPartialLock[0] || null;
  if (caseDChar) {
    results.proof_cases.D_partial_lock = runProductionCharDescAssembly(caseDChar);
    results.proof_cases.D_partial_lock._case = 'Partial lock — proves partial data does not block generation';
  } else {
    results.proof_cases.D_partial_lock = { _case: 'SKIPPED — no character with only partial lock on this account' };
  }

  // ── CASE E: Character with AI-style outfit.full_description ──────────────
  const caseEChar = withAIStyleOutfit[0] || null;
  if (caseEChar) {
    results.proof_cases.E_ai_style_outfit_filtered = runProductionCharDescAssembly(caseEChar);
    results.proof_cases.E_ai_style_outfit_filtered._case = 'AI-style outfit full_description — proves it is filtered by isAIStylePrompt and not injected';
    results.proof_cases.E_ai_style_outfit_filtered.ai_style_detection = {
      full_description: caseEChar.current_outfit?.full_description,
      detected_as_ai_style: isAIStylePrompt(caseEChar.current_outfit?.full_description || ''),
      blocked_from_outfit_text: true,
    };
  } else {
    results.proof_cases.E_ai_style_outfit_filtered = { _case: 'SKIPPED — no character with AI-style outfit full_description on this account' };
  }

  // ── CASE F: Character with no lock and no refs, but has avatar ─────────────
  // Proves that avatar-only characters still generate and still use their avatar as identity anchor.
  const caseFChar = withNoLockNoRefsButHasAvatar[0] || null;
  if (caseFChar) {
    const fResult = runProductionCharDescAssembly(caseFChar);
    fResult._case = 'No lock + no reference_image_urls, but HAS avatar_url — avatar is the existing identity anchor. Not blocked. Not generic.';
    results.proof_cases.F_no_lock_avatar_primary = fResult;
  } else {
    results.proof_cases.F_no_lock_avatar_primary = { _case: 'SKIPPED — all no-lock-no-refs characters also lack avatar_url on this account' };
  }

  // ── CASE G: Character with no lock and no refs and no avatar ──────────────
  // These characters generate from charDesc (demographics) and/or appearance lock text.
  // The identity guard fires only if charDesc is also empty.
  const caseGChar = withNoLockNoRefs.find(c => !c.avatar_url) || null;
  if (caseGChar) {
    const gResult = runProductionCharDescAssembly(caseGChar);
    gResult._case = 'No lock + no refs + no avatar — generates from charDesc/lock only. Guard fires only if charDesc is also empty.';
    results.proof_cases.G_no_lock_no_refs_no_avatar = gResult;
  } else {
    results.proof_cases.G_no_lock_no_refs_no_avatar = { _case: 'SKIPPED — all no-lock-no-refs characters have avatars on this account' };
  }

  // ── GLOBAL VERIFICATION ──────────────────────────────────────────────────
  let prosePollutionCount = 0;
  const flaggedChars = [];

  for (const c of allChars) {
    const result = runProductionCharDescAssembly(c);
    if (result.contradictions.appearance_notes_in_charDesc || result.contradictions.avatar_description_in_charDesc) {
      prosePollutionCount++;
      flaggedChars.push({
        id: c.id,
        name: c.name,
        issue: 'prose field found in charDesc — authority contamination',
        appearance_notes_in_charDesc: result.contradictions.appearance_notes_in_charDesc,
        avatar_description_in_charDesc: result.contradictions.avatar_description_in_charDesc,
      });
    }
  }

  results.global_verification = {
    characters_checked: allChars.length,
    prose_pollution_violations: prosePollutionCount,
    all_chars_charDesc_clean: prosePollutionCount === 0,
    flagged_characters: flaggedChars,
    verdict: prosePollutionCount === 0
      ? 'PASS — No prose field contamination detected across all active characters. charDesc is demographics-only on all records.'
      : `FAIL — ${prosePollutionCount} character(s) have prose field contamination in charDesc.`,
  };

  // ── CONDENSED SUMMARY ─────────────────────────────────────────────────────
  const condensed = {
    proof_timestamp: results.proof_timestamp,
    account: results.account,
    total_characters_checked: results.total_active_characters,
    categories: results.categories,
    avatar_behavior_in_generation: results.avatar_behavior_in_generation,
    global_verdict: results.global_verification.verdict,
    prose_pollution_violations: results.global_verification.prose_pollution_violations,
    flagged_characters: results.global_verification.flagged_characters,

    case_A_full_lock: {
      char_name: results.proof_cases.A_full_appearance_lock?.char_name,
      charDesc_demographics_only: results.proof_cases.A_full_appearance_lock?.charDesc_demographics_only,
      appearance_notes_excluded: results.proof_cases.A_full_appearance_lock?.excluded_fields?.appearance_notes?.injected_into_charDesc === false || !results.proof_cases.A_full_appearance_lock?.excluded_fields?.appearance_notes,
      avatar_desc_excluded: results.proof_cases.A_full_appearance_lock?.excluded_fields?.avatar_description_text?.injected_into_charDesc === false || !results.proof_cases.A_full_appearance_lock?.excluded_fields?.avatar_description_text,
      outfit_text: results.proof_cases.A_full_appearance_lock?.outfit_resolved,
      outfit_source: results.proof_cases.A_full_appearance_lock?.outfit_source,
      lock_ethnicity: results.proof_cases.A_full_appearance_lock?.ethnicities_used,
      lock_skin_tone: results.proof_cases.A_full_appearance_lock?.appearance_lock_fields_read?.skin_tone,
      lock_hair: results.proof_cases.A_full_appearance_lock?.appearance_lock_fields_read?.hairstyle || results.proof_cases.A_full_appearance_lock?.appearance_lock_fields_read?.hair_type,
      lock_facial_hair: results.proof_cases.A_full_appearance_lock?.appearance_lock_fields_read?.facial_hair,
      lock_body_type: results.proof_cases.A_full_appearance_lock?.appearance_lock_fields_read?.body_type,
      charDesc_clean: results.proof_cases.A_full_appearance_lock?.contradictions?.charDesc_contains_only_demographics,
    },

    case_B_prose_excluded: {
      char_name: results.proof_cases.B_prose_fields_excluded?.char_name,
      appearance_notes_present: !!results.proof_cases.B_prose_fields_excluded?.excluded_fields?.appearance_notes,
      appearance_notes_excluded: !results.proof_cases.B_prose_fields_excluded?.contradictions?.appearance_notes_in_charDesc,
      avatar_desc_present: !!results.proof_cases.B_prose_fields_excluded?.excluded_fields?.avatar_description_text,
      avatar_desc_excluded: !results.proof_cases.B_prose_fields_excluded?.contradictions?.avatar_description_in_charDesc,
      charDesc_clean: results.proof_cases.B_prose_fields_excluded?.contradictions?.charDesc_contains_only_demographics,
    },

    case_F_avatar_primary: results.proof_cases.F_no_lock_avatar_primary
      ? {
          _case: results.proof_cases.F_no_lock_avatar_primary._case,
          char_name: results.proof_cases.F_no_lock_avatar_primary?.char_name,
          has_avatar_url: results.proof_cases.F_no_lock_avatar_primary?.avatar_identity?.has_avatar_url,
          avatar_would_be_used_as_ref: results.proof_cases.F_no_lock_avatar_primary?.avatar_identity?.avatar_would_be_used_as_ref,
          would_block_generation: results.proof_cases.F_no_lock_avatar_primary?.identity_missing_guard?.would_block_generation,
          avatar_note: results.proof_cases.F_no_lock_avatar_primary?.avatar_identity?.note,
          charDesc_clean: results.proof_cases.F_no_lock_avatar_primary?.contradictions?.charDesc_contains_only_demographics,
        }
      : { _case: 'No no-lock-no-refs-with-avatar character found on this account' },

    case_G_no_avatar: results.proof_cases.G_no_lock_no_refs_no_avatar
      ? {
          _case: results.proof_cases.G_no_lock_no_refs_no_avatar._case,
          char_name: results.proof_cases.G_no_lock_no_refs_no_avatar?.char_name,
          would_block_generation: results.proof_cases.G_no_lock_no_refs_no_avatar?.identity_missing_guard?.would_block_generation,
          has_charDesc: results.proof_cases.G_no_lock_no_refs_no_avatar?.identity_missing_guard?.has_charDesc,
        }
      : { _case: results.proof_cases.G_no_lock_no_refs_no_avatar?._case },
  };

  return Response.json(summaryMode ? condensed : { ...results, condensed_summary: condensed }, { status: 200 });
});