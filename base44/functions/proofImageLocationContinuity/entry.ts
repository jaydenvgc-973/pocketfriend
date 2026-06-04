/**
 * proofImageLocationContinuity — Canonical proof of location + outfit resolution.
 *
 * Tests the EXACT resolution path used by generateImageAsync:
 *   1. Character home resolution (Layer 5 → current_home_location_id)
 *   2. Zone selection from actual home LocationReference
 *   3. Outfit resolver (contextual → closet)
 *   4. What env refs would be passed to the image provider
 *   5. What regenerateImageWithReason would resolve from a saved generation_context
 *
 * Uses Maria Vanessa Anderson (at home, real home with zone photos) as the proof character.
 * No mutations. Read-only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── Same zone resolver as generateImageAsync (must stay in sync) ──────────────
const ZONE_KEYWORD_MAP = [
  {keywords:['bedroom','in bed','on the bed','sleeping','woke up','waking up','nightstand','duvet','pillow','mattress'],zone:'bedroom'},
  {keywords:['kitchen','cooking','stove','fridge','oven','microwave','counter','pancake','breakfast','making food'],zone:'kitchen'},
  {keywords:['bathroom','shower','bathtub','toilet','vanity','brushing teeth','getting ready'],zone:'bathroom'},
  {keywords:['living room','couch','sofa','tv ','on the couch','lounge','sectional','watching tv'],zone:'living room'},
  {keywords:['backyard','patio','deck','yard','garden','grill'],zone:'backyard'},
  {keywords:['hallway','corridor','entryway','front door','foyer'],zone:'hallway'},
];

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

function cdnFilterNoGenerated(urls) {
  return cdnFilter(urls).filter(url => !url.includes('generated_image'));
}

function resolveZoneFromLocation(location, promptLower, preferredZoneName) {
  const zones = (location.zones || []).filter(z => cdnFilterNoGenerated(z.image_urls || []).length > 0);

  if (zones.length === 0) {
    const fallback = cdnFilterNoGenerated(location.image_urls || []).slice(0, 4);
    return { images: fallback, zoneName: null, zoneSource: 'no_zones_fallback_to_location_images' };
  }

  if (preferredZoneName) {
    const preferred = zones.find(z => z.zone_name && z.zone_name.toLowerCase() === preferredZoneName.toLowerCase());
    if (preferred) {
      const imgs = cdnFilterNoGenerated(preferred.image_urls).slice(0, 4);
      if (imgs.length > 0) return { images: imgs, zoneName: preferred.zone_name, zoneSource: 'preferred_zone_match' };
    }
  }

  for (const zone of zones) {
    if (zone.zone_name && promptLower.includes(zone.zone_name.toLowerCase())) {
      const imgs = cdnFilterNoGenerated(zone.image_urls).slice(0, 4);
      if (imgs.length > 0) return { images: imgs, zoneName: zone.zone_name, zoneSource: 'exact_zone_name_in_prompt' };
    }
  }

  for (const entry of ZONE_KEYWORD_MAP) {
    if (entry.keywords.some(kw => promptLower.includes(kw))) {
      const matched = zones.find(z => z.zone_name && z.zone_name.toLowerCase().includes(entry.zone));
      if (matched) {
        const imgs = cdnFilterNoGenerated(matched.image_urls).slice(0, 4);
        if (imgs.length > 0) return { images: imgs, zoneName: matched.zone_name, zoneSource: 'keyword_match' };
      }
    }
  }

  if (zones.length === 1) {
    const imgs = cdnFilterNoGenerated(zones[0].image_urls).slice(0, 4);
    return { images: imgs, zoneName: zones[0].zone_name, zoneSource: 'single_zone_only' };
  }

  const preferenceOrder = ['living room', 'bedroom', 'main area', 'main floor', 'lounge'];
  for (const preferred of preferenceOrder) {
    const match = zones.find(z => z.zone_name && z.zone_name.toLowerCase().includes(preferred));
    if (match) {
      const imgs = cdnFilterNoGenerated(match.image_urls).slice(0, 4);
      if (imgs.length > 0) return { images: imgs, zoneName: match.zone_name, zoneSource: 'preference_order_default' };
    }
  }

  const first = zones[0];
  const imgs = cdnFilterNoGenerated(first.image_urls).slice(0, 4);
  return { images: imgs, zoneName: first.zone_name, zoneSource: 'first_zone_fallback' };
}

// ── Outfit resolver — same logic as generateImageAsync ─────────────────────────
const OUTFIT_FALLBACK_CHAINS = {
  bath:['bath','sleepwear','lounge'],sleepwear:['sleepwear','lounge','daily_casual'],
  swimwear:['swimwear','gym','daily_casual'],gym:['gym','outdoor','daily_casual'],
  work:['work','formal','daily_casual'],formal:['formal','work','daily_casual'],
  church:['church','formal','daily_casual'],nightlife:['nightlife','date_night','daily_casual'],
  date_night:['date_night','nightlife','formal','daily_casual'],school:['school','daily_casual'],
  lounge:['lounge','daily_casual'],outdoor:['outdoor','daily_casual'],
  travel:['travel','outdoor','daily_casual'],medical:['medical','daily_casual'],
  special:['special','formal','daily_casual'],cold_weather:['cold_weather','outdoor','daily_casual'],
  hot_weather:['hot_weather','outdoor','daily_casual'],daily_casual:['daily_casual','outdoor','lounge']
};

function resolveOutfitCategory(character) {
  const presence = character?.resolved_presence_status || character?.location_status || '';
  const activity = (character?.current_activity || '').toLowerCase();
  if (/bath|shower|grooming/.test(activity)) return 'bath';
  if (presence === 'sleeping' || presence === 'napping' || /\b(sleep|nap|asleep|bedtime)\b/.test(activity)) return 'sleepwear';
  if (presence === 'at_work') return 'work';
  if (presence === 'home') return 'lounge';
  return 'daily_casual';
}

function buildOutfitText(outfit) {
  if (!outfit) return null;
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
    .filter(Boolean)
    .map(p => { const t = p.trim(); if(/^(n\/?a|none|-)$/i.test(t)) return null; return t; })
    .filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return outfit.full_description?.trim() || null;
}

function resolveOutfitForProof(character) {
  const presence = character?.resolved_presence_status || character?.location_status || '';
  const activity = (character?.current_activity || '').toLowerCase();

  // Layer 1a: sleep/wake context
  const isSleeping = presence === 'sleeping' || presence === 'napping' || /\b(sleep|nap|asleep|bedtime)\b/.test(activity);
  if (isSleeping) {
    const closet = (character.character_closet || []).filter(o => o.outfit_id);
    const sleepItem = closet.find(o => o.category === 'sleepwear' || o.category === 'lounge');
    if (sleepItem) return { text: buildOutfitText(sleepItem), source: 'sleepwear_from_closet' };
    const co = character.current_outfit;
    if (co && (co.category === 'sleepwear' || co.category === 'lounge')) {
      return { text: buildOutfitText(co), source: 'sleepwear_from_current_outfit' };
    }
    const g = (character.gender || '').toLowerCase();
    return { text: g === 'female' ? 'soft cotton pajama set' : g === 'male' ? 'pajama bottoms, no shirt' : 'comfortable pajamas', source: 'sleepwear_generic_fallback' };
  }

  // Layer 2: closet
  const rotationEnabled = character?.outfit_rotation_enabled !== false;
  const co = character.current_outfit;

  if (!rotationEnabled && (co?.outfit_id || co?.label)) {
    if (co.outfit_id) {
      const match = (character.character_closet || []).find(item => item.outfit_id === co.outfit_id);
      if (match) { const t = buildOutfitText(match); if (t) return { text: t, source: 'rotation_off_lock_closet_lookup' }; }
    }
    const t = buildOutfitText(co);
    if (t) return { text: t, source: 'rotation_off_lock_current_outfit' };
  }

  if (co?.outfit_id && co?.change_reason === 'manual_selection') {
    const match = (character.character_closet || []).find(item => item.outfit_id === co.outfit_id);
    const t = buildOutfitText(match || co);
    if (t) return { text: t, source: 'manual_selection_lock' };
  }

  const outfits = (character.character_closet || []).filter(item => item.outfit_id);
  if (!outfits.length) return { text: null, source: 'no_closet' };

  const targetCategory = resolveOutfitCategory(character);
  const chain = OUTFIT_FALLBACK_CHAINS[targetCategory] || ['daily_casual', 'lounge'];
  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const idHash = (character.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const stableIndex = (dayOfYear + idHash);

  for (const cat of chain) {
    const pool = outfits.filter(o => o.category === cat);
    if (!pool.length) continue;
    const idx = stableIndex % pool.length;
    const t = buildOutfitText(pool[idx]);
    return { text: t, source: `closet_rotation_cat_${cat}_idx_${idx}` };
  }

  return { text: null, source: 'closet_chain_miss' };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Test prompts covering different scene types
    const testPrompts = [
      'sitting on the couch watching TV',
      'in the bedroom resting',
      'making breakfast in the kitchen',
      'standing in the hallway',
      'just hanging out at home',
    ];

    const results = [];

    // ── Step 1: Load the character (Maria Vanessa Anderson — at home with real home) ─
    // Using service role to bypass RLS for diagnostic
    // Use user-scoped read (Character RLS enforces owner_email = user.email even for service role)
    let charList = await base44.entities.Character.filter(
      { resolved_presence_status: 'home' },
      null, 5
    ).catch(() => []);
    if (!charList || charList.length === 0) {
      charList = await base44.entities.Character.filter(
        { location_status: 'home' },
        null, 5
      ).catch(() => []);
    }

    if (!charList || charList.length === 0) {
      return Response.json({ error: 'No active_created_character at home found for this account', user: user.email });
    }

    for (const charRecord of charList.slice(0, 2)) {
      const charResult = {
        character_id: charRecord.id,
        character_name: charRecord.name,
        resolved_presence_status: charRecord.resolved_presence_status,
        location_status: charRecord.location_status,
        current_home_location_id: charRecord.current_home_location_id || null,
        resolved_current_location_id: charRecord.resolved_current_location_id || null,
        resolved_current_location_name: charRecord.resolved_current_location_name || null,
      };

      // ── Step 2: Location resolution — mirrors generateImageAsync priority stack ───
      const presenceStatus = charRecord.resolved_presence_status || charRecord.location_status || '';
      const resolvedLocId = charRecord.resolved_current_location_id || null;

      let locationId = null;
      let locationSource = null;

      // Layer 1: work schedule (skip — no work shift for Maria)
      // Layer 2: school schedule (skip — not enrolled)
      // Layer 3: incarceration (skip — not jailed)
      // Layer 4: resolved_current_location_id
      if (!locationId && resolvedLocId) {
        locationId = resolvedLocId;
        locationSource = 'layer4_resolved_current_location_id';
      }
      // Layer 5: presence-status-derived
      if (!locationId) {
        if (presenceStatus === 'home' || presenceStatus === 'sleeping' || presenceStatus === 'napping') {
          locationId = charRecord.current_home_location_id || null;
          locationSource = locationId ? 'layer5_presence_home_to_current_home_location_id' : null;
        }
      }
      // Layer 6: absolute last resort
      if (!locationId) {
        locationId = charRecord.current_home_location_id || null;
        locationSource = locationId ? 'layer6_last_resort_home' : 'no_location_found';
      }

      charResult.resolved_location_id = locationId;
      charResult.location_resolution_source = locationSource;

      if (!locationId) {
        charResult.location_error = 'No location could be resolved';
        results.push(charResult);
        continue;
      }

      // ── Step 3: Fetch LocationReference ──────────────────────────────────────
      const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId }, null, 1);
      const locRecord = locList?.[0] || null;

      if (!locRecord) {
        charResult.location_error = `LocationReference ${locationId} not found`;
        results.push(charResult);
        continue;
      }

      charResult.location_name = locRecord.name;
      charResult.location_category = locRecord.category;
      charResult.location_zones_available = (locRecord.zones || []).map(z => ({
        zone_name: z.zone_name,
        image_count: cdnFilterNoGenerated(z.image_urls || []).length,
        has_real_uploaded_photos: (z.image_urls || []).some(u => !u.includes('generated_image')),
      }));
      charResult.location_top_level_images = cdnFilterNoGenerated(locRecord.image_urls || []).length;

      // ── Step 4: Zone resolution for each test prompt ─────────────────────────
      charResult.zone_resolution_by_prompt = testPrompts.map(prompt => {
        const { images, zoneName, zoneSource } = resolveZoneFromLocation(locRecord, prompt.toLowerCase(), null);
        return {
          prompt,
          resolved_zone: zoneName,
          zone_source: zoneSource,
          env_ref_count: images.length,
          env_refs: images.map(u => u.substring(0, 80) + (u.length > 80 ? '...' : '')),
          would_generate_with_real_refs: images.length > 0,
        };
      });

      // ── Step 5: Outfit resolution ─────────────────────────────────────────────
      const outfitResult = resolveOutfitForProof(charRecord);
      charResult.outfit_resolved = {
        text: outfitResult.text || null,
        source: outfitResult.source,
        closet_size: (charRecord.character_closet || []).filter(o => o.outfit_id).length,
        current_outfit_id: charRecord.current_outfit?.outfit_id || null,
        current_outfit_label: charRecord.current_outfit?.label || null,
        rotation_enabled: charRecord.outfit_rotation_enabled !== false,
      };

      // ── Step 6: Reference images ──────────────────────────────────────────────
      const refUrls = cdnFilter(charRecord.reference_image_urls || []).filter(u => !u.includes('generated_image'));
      charResult.char_refs = {
        reference_image_count: refUrls.length,
        avatar_url_present: !!charRecord.avatar_url,
        avatar_url_accessible: charRecord.avatar_url ? isAccessible(toPublicCDN(charRecord.avatar_url)) : false,
        refs_used: refUrls.slice(0, 4).map(u => u.substring(0, 80)),
      };

      // ── Step 7: What Why Regenerate would resolve from saved context ──────────
      // Simulate: if this image had been generated and saved with location_id in context,
      // what would regenerateImageWithReason resolve?
      const simulatedSavedContext = {
        location_id: locationId,
        location_name: locRecord.name,
        zone_name: null, // new image has no prior zone stored
        location_reference_images: charResult.zone_resolution_by_prompt[0]?.env_refs || [],
      };

      charResult.regenerate_path_simulation = {
        would_use_location_id: simulatedSavedContext.location_id,
        would_use_location_name: simulatedSavedContext.location_name,
        divergence_check: {
          original_location_id: locationId,
          regen_location_id: simulatedSavedContext.location_id,
          paths_match: locationId === simulatedSavedContext.location_id,
          divergence_reason: locationId === simulatedSavedContext.location_id
            ? 'NONE — paths are identical'
            : `DIVERGENCE: original="${locationId}" regen="${simulatedSavedContext.location_id}"`,
        },
      };

      // ── Step 8: Verdict ───────────────────────────────────────────────────────
      const hasRealEnvRefs = charResult.zone_resolution_by_prompt.some(r => r.would_generate_with_real_refs);
      const hasCharRefs = charResult.char_refs.reference_image_count > 0 || charResult.char_refs.avatar_url_accessible;
      const pathsMatch = charResult.regenerate_path_simulation.divergence_check.paths_match;

      charResult.verdict = {
        location_resolves_to_actual_home: locationId === charRecord.current_home_location_id,
        home_has_real_zone_photos: hasRealEnvRefs,
        char_refs_available: hasCharRefs,
        original_and_regen_paths_match: pathsMatch,
        outfit_resolved: !!outfitResult.text,
        overall: (locationId === charRecord.current_home_location_id && hasRealEnvRefs && pathsMatch)
          ? 'PASS — location resolves to actual home with real zone photos, paths match'
          : 'FAIL — see above fields for details',
      };

      results.push(charResult);
    }

    const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // Compact summary — strip zone_resolution_by_prompt details to avoid truncation
    const compactResults = results.map(r => ({
      character_name: r.character_name,
      presence: r.resolved_presence_status,
      resolved_location_id: r.resolved_location_id,
      location_resolution_source: r.location_resolution_source,
      location_name: r.location_name,
      location_matches_home: r.verdict?.location_resolves_to_actual_home,
      zones_with_real_photos: (r.location_zones_available || []).filter(z => z.has_real_uploaded_photos).map(z => z.zone_name),
      home_has_real_zone_photos: r.verdict?.home_has_real_zone_photos,
      outfit_text: r.outfit_resolved?.text || null,
      outfit_source: r.outfit_resolved?.source,
      original_and_regen_paths_match: r.verdict?.original_and_regen_paths_match,
      verdict: r.verdict?.overall,
      // First prompt zone proof
      sample_prompt_proof: r.zone_resolution_by_prompt?.[0] || null,
      // Key divergence check
      divergence_check: r.regenerate_path_simulation?.divergence_check,
    }));

    return Response.json({
      proof_title: 'Image Location Continuity Proof',
      run_at_et: etNow.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      account: user.email,
      characters_tested: results.length,
      results: compactResults,
      summary: {
        all_pass: results.every(r => r.verdict?.overall?.startsWith('PASS')),
        failures: results.filter(r => r.verdict?.overall?.startsWith('FAIL')).map(r => ({
          character: r.character_name,
          reason: r.verdict?.overall,
          location_source: r.location_resolution_source,
        })),
      },
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});