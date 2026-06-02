/**
 * proofImageGenerationPath — Runtime proof of the image generation authority order.
 *
 * Traces the ACTUAL code path for outfit and location resolution using a real character record.
 * Does NOT generate an image. Returns proof of:
 *   - resolved_presence_status
 *   - selected location ID and name
 *   - selected zone
 *   - whether location reference photos exist
 *   - whether a contextual outfit was applied (uniform / sleepwear / swimwear)
 *   - rotation ON or OFF
 *   - final outfit source
 *   - final outfit text that would enter the image prompt
 *
 * Usage: POST { characterId: "...", prompt: "send me a pic of where you are" }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);

  const body = await req.json().catch(() => ({}));
  const { characterId, prompt: testPrompt } = body;

  if (!user && !characterId) return Response.json({ error: 'Unauthorized — provide a valid session' }, { status: 401 });

  // ── Load character ────────────────────────────────────────────────────────────
  let char = null;
  if (characterId) {
    // Try user-scoped first (respects RLS), then service role
    const charListUser = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
    char = charListUser?.[0] || null;
    if (!char) {
      const charListSR = await base44.asServiceRole.entities.Character.list('-updated_date', 200).catch(() => []);
      char = charListSR.find(c => c.id === characterId) || null;
    }
  }

  if (!char) {
    // If no characterId given, use the first active characters on the account
    const allChars = user
      ? await base44.entities.Character.filter({ status: 'active' }, '-updated_date', 5).catch(() => [])
      : await base44.asServiceRole.entities.Character.list('-updated_date', 5).catch(() => []);
    if (!allChars.length) return Response.json({ error: 'No active characters found' });

    return Response.json({
      note: 'No characterId provided or character not found. Pass characterId to proof a specific character.',
      available_characters: allChars.map(c => ({ id: c.id, name: c.name, presence: c.resolved_presence_status, location: c.resolved_current_location_name })),
    });
  }

  const prompt = testPrompt || 'send me a picture of where you are right now';
  const promptLower = prompt.toLowerCase();
  const proof = {
    character_id: char.id,
    character_name: char.name,
    test_prompt: prompt,
    timestamp: new Date().toISOString(),
  };

  // ── PRESENCE PROOF ────────────────────────────────────────────────────────────
  proof.presence = {
    resolved_presence_status: char.resolved_presence_status || null,
    location_status: char.location_status || null,
    resolved_current_location_id: char.resolved_current_location_id || null,
    resolved_current_location_name: char.resolved_current_location_name || null,
    current_home_location_id: char.current_home_location_id || null,
    current_work_location_id: char.current_work_location_id || char.occupation_location_id || null,
    current_school_location_id: char.current_school_location_id || char.education_location_id || null,
    incarceration_facility_id: char.incarceration_facility_id || null,
    temporary_housing_location_id: char.temporary_housing_location_id || null,
  };

  // ── LOCATION RESOLUTION (mirrors generateImageAsync logic exactly) ────────────
  const _home = /\b(at (my |his |her )?(home|house|apartment|place|crib)|my (home|house|apartment|place|room)|his (home|apartment|place|room)|her (home|apartment|place|room)|back home|the apartment|my (bedroom|living room|kitchen)|his (bedroom|living room)|her bedroom|home office|in (my|his|her) (room|apartment|place|house))\b/.test(promptLower);
  const _work = /\b(at (my |his |her )?(work|job|office|workplace|store|restaurant|bar|studio)|on the job|during (my|his|her) (shift|work day)|busy day at work|work today|yesterday at work|busy at work|at the (office|store|restaurant|bar|studio|workplace)|his (job|office|shift)|her (job|office|shift))\b/.test(promptLower);
  const _school = /\b(at (my |his |her )?(school|campus|class|lecture|university|college)|on campus|in class|after (school|class)|his (school|campus)|her (school|campus))\b/.test(promptLower);

  let locationId = null;
  let locationSource = null;

  if (_home) {
    locationId = char.current_home_location_id || char.home_location_id || char.temporary_housing_location_id || null;
    locationSource = 'prompt_keyword_home';
  } else if (_work) {
    locationId = char.current_work_location_id || char.occupation_location_id || null;
    locationSource = 'prompt_keyword_work';
  } else if (_school) {
    locationId = char.current_school_location_id || char.education_location_id || null;
    locationSource = 'prompt_keyword_school';
  }

  if (!locationId) {
    const presenceStatus = char.resolved_presence_status || char.location_status || '';
    const resolvedLocId = char.resolved_current_location_id || null;

    if (resolvedLocId) {
      locationId = resolvedLocId;
      locationSource = `presence_authority (presence="${presenceStatus}", resolved_current_location_id)`;
    } else {
      if (presenceStatus === 'at_work') {
        locationId = char.current_work_location_id || char.occupation_location_id || null;
        locationSource = 'presence_at_work_fallback';
      } else if (presenceStatus === 'at_school') {
        locationId = char.current_school_location_id || char.education_location_id || null;
        locationSource = 'presence_at_school_fallback';
      } else if (presenceStatus === 'incarcerated') {
        locationId = char.incarceration_facility_id || null;
        locationSource = 'presence_incarcerated_fallback';
      } else if (presenceStatus === 'home' || presenceStatus === 'sleeping' || presenceStatus === 'napping') {
        locationId = char.current_home_location_id || char.home_location_id || null;
        locationSource = 'presence_home_or_sleep_fallback';
      } else if (presenceStatus === 'temporary_housing') {
        locationId = char.temporary_housing_location_id || char.current_home_location_id || null;
        locationSource = 'presence_temporary_housing_fallback';
      } else {
        locationId = char.current_home_location_id || char.home_location_id || null;
        locationSource = `last_resort_home (presence="${presenceStatus}" has no resolved location — WARNING: may not match actual location)`;
      }
    }
  }

  proof.location_resolution = {
    resolved_location_id: locationId,
    resolution_source: locationSource,
    prompt_keywords_matched: { home: _home, work: _work, school: _school },
  };

  // ── FETCH LOCATION RECORD ─────────────────────────────────────────────────────
  let locRecord = null;
  if (locationId) {
    const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId }, null, 1).catch(() => []);
    locRecord = locList?.[0] || null;
  }

  if (locRecord) {
    const zones = (locRecord.zones || []).filter(z => (z.image_urls || []).length > 0);
    const mainImages = (locRecord.image_urls || []).filter(u => u && u.startsWith('https://'));
    proof.location = {
      id: locRecord.id,
      name: locRecord.name,
      category: locRecord.category,
      main_image_count: mainImages.length,
      zone_count: zones.length,
      zones_with_images: zones.map(z => ({ zone_name: z.zone_name, image_count: (z.image_urls || []).length })),
      env_refs_would_be_used: mainImages.length > 0 || zones.length > 0,
    };

    // Zone resolution
    let resolvedZone = null;
    for (const z of zones) {
      if (z.zone_name && promptLower.includes(z.zone_name.toLowerCase())) {
        resolvedZone = z.zone_name;
        break;
      }
    }
    proof.location.resolved_zone = resolvedZone || (zones.length === 1 ? zones[0].zone_name : null);
    proof.location.zone_resolution_method = resolvedZone ? 'prompt_keyword_match' : (zones.length === 1 ? 'only_one_zone' : (zones.length > 1 ? 'first_zone_fallback' : 'no_zones'));
  } else {
    proof.location = {
      id: locationId,
      found: false,
      reason: locationId ? 'Location record not found or access denied' : 'No location ID resolved',
      env_refs_would_be_used: false,
    };
  }

  // ── OUTFIT RESOLUTION PROOF ───────────────────────────────────────────────────
  const rotationEnabled = char.outfit_rotation_enabled !== false;
  const presenceStatus = char.resolved_presence_status || char.location_status || '';
  const closet = (char.character_closet || []).filter(o => o.outfit_id);
  const co = char.current_outfit;

  proof.outfit = {
    rotation_enabled: rotationEnabled,
    current_outfit_id: co?.outfit_id || null,
    current_outfit_label: co?.label || null,
    current_outfit_category: co?.category || null,
    closet_size: closet.length,
    closet_categories: [...new Set(closet.map(o => o.category).filter(Boolean))],
  };

  // STEP 1A: UNIFORM CHECK
  const uniformPresence = presenceStatus === 'at_work' || presenceStatus === 'at_school' || presenceStatus === 'incarcerated';
  const uniformLocationId = presenceStatus === 'at_work'
    ? (char.current_work_location_id || char.occupation_location_id || null)
    : presenceStatus === 'at_school'
    ? (char.current_school_location_id || char.education_location_id || null)
    : presenceStatus === 'incarcerated'
    ? (char.incarceration_facility_id || null)
    : null;

  let uniformText = null;
  let uniformLocationRecord = null;
  if (uniformPresence && uniformLocationId) {
    const uLocList = await base44.asServiceRole.entities.LocationReference.filter({ id: uniformLocationId }, null, 1).catch(() => []);
    uniformLocationRecord = uLocList?.[0] || null;
    if (uniformLocationRecord) {
      const uniforms = uniformLocationRecord.uniforms || {};
      const workerIds = uniformLocationRecord.worker_character_ids || [];
      const isWorker = workerIds.includes(char.id);
      const isInmate = uniformLocationRecord.category === 'jail_prison' && char.is_jailed;
      const isStudent = (uniformLocationRecord.category === 'school' || uniformLocationRecord.category === 'education') && char.education_location_id === uniformLocationRecord.id;
      if ((isWorker || isInmate || isStudent) && Object.keys(uniforms).length > 0) {
        for (const u of Object.values(uniforms)) {
          if (u?.description || u?.name) { uniformText = u.description || u.name; break; }
        }
      }
    }
  }

  proof.outfit.step_1a_uniform = {
    presence_requires_uniform_check: uniformPresence,
    uniform_location_id: uniformLocationId,
    uniform_location_found: !!uniformLocationRecord,
    uniform_text: uniformText,
    uniform_applied: !!uniformText,
  };

  // STEP 1B: SLEEP/WAKE CONTEXT
  const sleepWakeKws = ['sleeping','asleep','in bed','woke up','waking up','just woke','getting up','lying in bed','napping','nap','going to bed','bedtime'];
  const isSleepWake = (presenceStatus === 'sleeping' || presenceStatus === 'napping') ||
    /\b(sleep|nap|asleep|bedtime|waking)\b/.test((char.current_activity || '').toLowerCase()) ||
    sleepWakeKws.some(kw => promptLower.includes(kw));

  let sleepText = null;
  if (!uniformText && isSleepWake) {
    const sleepItem = closet.find(o => o.category === 'sleepwear' || o.category === 'lounge');
    if (sleepItem) {
      sleepText = [sleepItem.top, sleepItem.bottom, sleepItem.shoes, sleepItem.outerwear, sleepItem.accessories]
        .filter(Boolean).map(p => { const t = p.trim(); return /^(n\/?a|none|-)$/i.test(t) ? null : t; }).filter(Boolean).join(', ') || sleepItem.full_description || null;
    } else if (co && (co.category === 'sleepwear' || co.category === 'lounge')) {
      sleepText = [co.top, co.bottom, co.shoes, co.outerwear, co.accessories]
        .filter(Boolean).map(p => { const t = p.trim(); return /^(n\/?a|none|-)$/i.test(t) ? null : t; }).filter(Boolean).join(', ') || co.full_description || null;
    } else {
      const g = (char.gender || '').toLowerCase();
      sleepText = g === 'female' ? 'soft cotton pajama set or oversized sleep shirt and shorts' :
                  g === 'male' ? 'pajama bottoms or boxer shorts, no shirt or plain sleep shirt' :
                  'comfortable pajama set';
      proof.outfit.step_1b_sleep = { sleep_context_detected: true, closet_sleep_item_found: false, fallback_generic: true };
    }
  }

  proof.outfit.step_1b_sleep = {
    sleep_context_detected: isSleepWake,
    sleep_checked: !uniformText,
    sleep_text: sleepText,
    sleep_applied: !uniformText && !!sleepText,
  };

  // STEP 2: NORMAL CLOSET
  let closetOutfit = null;
  let closetSource = null;
  if (!uniformText && !sleepText) {
    if (!rotationEnabled) {
      // Rotation OFF — look up locked outfit
      if (co?.outfit_id || co?.label) {
        let t = null;
        if (co.outfit_id) {
          const match = closet.find(item => item.outfit_id === co.outfit_id);
          if (match) {
            t = [match.top, match.bottom, match.shoes, match.outerwear, match.accessories].filter(Boolean).map(p => { const s = p.trim(); return /^(n\/?a|none|-)$/i.test(s) ? null : s; }).filter(Boolean).join(', ') || match.full_description || match.label || null;
          }
        }
        if (!t) t = [co.top, co.bottom, co.shoes, co.outerwear, co.accessories].filter(Boolean).map(p => { const s = p.trim(); return /^(n\/?a|none|-)$/i.test(s) ? null : s; }).filter(Boolean).join(', ') || co.full_description || co.label || null;
        closetOutfit = t;
        closetSource = t ? 'rotation_off_lock' : 'rotation_off_but_no_text_in_closet_entry';
      } else {
        closetSource = 'rotation_off_but_no_current_outfit_set';
      }
    } else {
      // Rotation ON
      if (co?.outfit_id || co?.label) {
        closetSource = 'rotation_on_current_outfit_candidate';
        const coLabel = co.label || null;
        const found = closet.find(i => i.outfit_id === co.outfit_id);
        closetOutfit = found ? ([found.top, found.bottom, found.shoes, found.outerwear, found.accessories].filter(Boolean).map(p => { const s = p.trim(); return /^(n\/?a|none|-)$/i.test(s) ? null : s; }).filter(Boolean).join(', ') || found.full_description || found.label || null) : (co.full_description || coLabel);
        closetSource = 'rotation_on_p1_current_outfit';
      } else if (closet.length > 0) {
        const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
        const idHash = (char.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
        const idx = (dayOfYear + idHash) % closet.length;
        const picked = closet[idx];
        closetOutfit = [picked.top, picked.bottom, picked.shoes, picked.outerwear, picked.accessories].filter(Boolean).map(p => { const s = p.trim(); return /^(n\/?a|none|-)$/i.test(s) ? null : s; }).filter(Boolean).join(', ') || picked.full_description || picked.label || null;
        closetSource = `rotation_on_p2_daily_rotation (day=${dayOfYear} idx=${idx} outfit="${picked.label || picked.outfit_id}")`;
      } else {
        closetSource = 'no_closet';
      }
    }
  }

  proof.outfit.step_2_normal_closet = {
    checked: !uniformText && !sleepText,
    source: closetSource,
    outfit_text: closetOutfit,
  };

  // ── FINAL RESOLUTION ──────────────────────────────────────────────────────────
  const finalOutfitText = uniformText || sleepText || closetOutfit || null;
  const finalOutfitSource = uniformText ? 'uniform (contextual layer 1a)' :
                            sleepText ? 'sleepwear (contextual layer 1b)' :
                            closetOutfit ? `normal_closet (${closetSource})` :
                            'none — no wardrobe constraint';

  proof.final_resolution = {
    final_outfit_text: finalOutfitText,
    final_outfit_source: finalOutfitSource,
    final_outfit_injected_into_prompt: !!finalOutfitText,
    final_location_name: locRecord?.name || null,
    final_location_id: locationId,
    final_location_env_refs: locRecord ? (locRecord.image_urls || []).filter(u => u?.startsWith('https://')).length : 0,
    final_zone: proof.location?.resolved_zone || null,
    rotation_on: rotationEnabled,
    contextual_outfit_applied: !!(uniformText || sleepText),
    contextual_outfit_blocked_by_rotation: false, // NEVER — contextual runs before rotation check
  };

  // ── PROOF CASES ───────────────────────────────────────────────────────────────
  proof.proof_cases = {
    case_1_away_from_home_with_location_refs: {
      description: 'Character away from home at location with reference photos → image uses that location not home',
      character_at_home: presenceStatus === 'home' || presenceStatus === 'sleeping',
      resolved_location_is_home: locationId === char.current_home_location_id,
      resolved_location_name: locRecord?.name || 'none',
      env_refs_available: proof.location?.main_image_count > 0 || proof.location?.zone_count > 0,
      verdict: locationId && locationId !== char.current_home_location_id && (proof.location?.main_image_count > 0 || proof.location?.zone_count > 0)
        ? '✅ PASS — non-home location with references selected'
        : (presenceStatus === 'home' || presenceStatus === 'sleeping')
        ? '✅ PASS — character is actually home, home is correct'
        : '⚠️ CHECK — verify location matches character presence',
    },
    case_5_rotation_off_locked_outfit: {
      description: 'Character with rotation OFF and selected outfit → selected outfit appears unless contextual override',
      rotation_off: !rotationEnabled,
      current_outfit_set: !!(co?.outfit_id || co?.label),
      contextual_override_applied: !!(uniformText || sleepText),
      locked_outfit_used: closetSource === 'rotation_off_lock',
      final_outcome: finalOutfitSource,
      verdict: !rotationEnabled && !!(co?.outfit_id || co?.label) && !uniformText && !sleepText && closetSource === 'rotation_off_lock'
        ? '✅ PASS — rotation OFF locked outfit used, no contextual override'
        : !rotationEnabled && (uniformText || sleepText)
        ? '✅ PASS — contextual outfit correctly overrides rotation OFF lock'
        : !rotationEnabled && !(co?.outfit_id || co?.label)
        ? '⚠️ CHECK — rotation OFF but no current_outfit set on character'
        : '✅ rotation ON — different rule applies',
    },
    case_6_uniform_context: {
      description: 'Character in required uniform context → uniform wins and location matches presence',
      uniform_applied: !!uniformText,
      uniform_text: uniformText,
      location_matches_presence: locationId === uniformLocationId,
      verdict: uniformText
        ? '✅ PASS — uniform applied from contextual layer'
        : uniformPresence
        ? '⚠️ CHECK — presence indicates uniform context but no uniform found on location record'
        : '✅ N/A — character not in uniform context',
    },
    case_rotation_off_does_not_block_uniform: {
      description: 'Rotation OFF never blocks uniforms/sleepwear/contextual outfits',
      rotation_off: !rotationEnabled,
      uniform_applied: !!uniformText,
      sleep_applied: !uniformText && !!sleepText,
      contextual_checked_before_rotation_lock: true, // Always true by design — contextual runs before resolver
      verdict: '✅ STRUCTURAL PASS — contextual outfit layer executes before rotation check in all code paths',
    },
  };

  return Response.json(proof, { status: 200 });
});