import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * MANDATORY MULTI-SOURCE LOCATION RESOLUTION
 * ─────────────────────────────────────────
 * Enforces authoritative location truth by checking character file first,
 * then LocationReference records, then manual selections.
 *
 * CRITICAL RULES:
 * - Character file is the SOURCE OF TRUTH for where the character lives/is
 * - LocationReference records provide zone structure and image authority
 * - Avatar background is NEVER used to infer room type (0% environment influence)
 * - Resolution order is strict and non-negotiable
 */

function isProviderAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/')) return false;
  if (url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

async function resolveLocationAuthority(base44, characterRecord, manualLocationId, manualZoneId, scenePrompt) {
  const result = {
    locationId: null,
    locationName: null,
    zoneName: null,
    zoneImages: [],
    authSource: null,
    resolutionTrace: [],
    hasLocationImages: false,
    error: null,
  };

  if (!characterRecord) {
    result.error = 'Character not found';
    return result;
  }

  const charId = characterRecord.id;

  // ── STEP 1: MANUAL OVERRIDE (if user explicitly selected) ───────────────
  if (manualLocationId) {
    result.resolutionTrace.push('Step 1: User explicitly selected location');
    try {
      const manualLoc = await base44.asServiceRole.entities.LocationReference.get(manualLocationId).catch(() => null);
      if (!manualLoc) {
        const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: manualLocationId }, null, 1).catch(() => []);
        manualLoc = locList?.[0] || null;
      }
      if (manualLoc) {
        result.locationId = manualLoc.id;
        result.locationName = manualLoc.name;
        result.authSource = `manual selection: ${manualLoc.name} (user override)`;
        result.resolutionTrace.push(`  ✓ Manual location "${manualLoc.name}" resolved`);

        // Resolve zone within manual location
        if (manualZoneId && manualLoc.zones?.length > 0) {
          const zone = manualLoc.zones.find(z => z.zone_name?.toLowerCase() === manualZoneId.toLowerCase());
          if (zone?.image_urls?.length > 0) {
            result.zoneImages = zone.image_urls.slice(0, 6).filter(isProviderAccessible);
            result.zoneName = zone.zone_name;
            result.hasLocationImages = result.zoneImages.length > 0;
            result.resolutionTrace.push(`  ✓ Zone "${zone.zone_name}" found with ${result.zoneImages.length} usable images`);
            return result;
          }
        }

        // Fallback: first zone with images
        if (manualLoc.zones?.length > 0) {
          const firstZone = manualLoc.zones.find(z => z.image_urls?.length > 0);
          if (firstZone) {
            result.zoneImages = firstZone.image_urls.slice(0, 6).filter(isProviderAccessible);
            result.zoneName = firstZone.zone_name;
            result.hasLocationImages = result.zoneImages.length > 0;
            result.resolutionTrace.push(`  ✓ First zone with images: "${firstZone.zone_name}" (${result.zoneImages.length} usable)`);
            return result;
          }
        }

        // Fallback: flat location images
        if (manualLoc.image_urls?.length > 0) {
          result.zoneImages = manualLoc.image_urls.slice(0, 6).filter(isProviderAccessible);
          result.hasLocationImages = result.zoneImages.length > 0;
          result.resolutionTrace.push(`  ✓ Using flat location images (${result.zoneImages.length} usable)`);
          return result;
        }

        result.error = `Manual location "${manualLoc.name}" has no usable reference images`;
        result.resolutionTrace.push(`  ✗ No images found for manual location`);
        return result;
      }
    } catch (err) {
      result.error = `Manual location lookup failed: ${err.message}`;
      result.resolutionTrace.push(`  ✗ Manual location lookup error`);
      return result;
    }
  }

  // ── STEP 2: CHARACTER FILE MULTI-SOURCE RESOLUTION ──────────────────────
  // MANDATORY: Check character file FIRST for authoritative location truth.
  // Do NOT skip to avatar background or prompt hints.
  result.resolutionTrace.push('Step 2: Checking character file for authoritative location truth');

  let authorizedLocId = null;
  let authSource = null;

  // STRICT PRIORITY ORDER (non-negotiable)
  if (characterRecord.resolved_current_location_id) {
    authorizedLocId = characterRecord.resolved_current_location_id;
    authSource = 'character.resolved_current_location_id (PRIMARY — current presence)';
  } else if (characterRecord.current_home_location_id) {
    authorizedLocId = characterRecord.current_home_location_id;
    authSource = 'character.current_home_location_id (SECONDARY — assigned home)';
  } else if (characterRecord.home_location_id) {
    authorizedLocId = characterRecord.home_location_id;
    authSource = 'character.home_location_id (TERTIARY — legacy home)';
  } else if (characterRecord.current_work_location_id && characterRecord.resolved_presence_status === 'at_work') {
    authorizedLocId = characterRecord.current_work_location_id;
    authSource = 'character.current_work_location_id (WORK)';
  } else if (characterRecord.current_school_location_id && characterRecord.resolved_presence_status === 'at_school') {
    authorizedLocId = characterRecord.current_school_location_id;
    authSource = 'character.current_school_location_id (SCHOOL)';
  }

  if (!authorizedLocId) {
    // Last resort: scan saved locations for where this character is a resident
    result.resolutionTrace.push('  ✗ No location ID found on character file — scanning resident locations');
    if (characterRecord.created_by) {
      const savedLocs = await base44.asServiceRole.entities.LocationReference.filter({ created_by: characterRecord.created_by }, '-created_date', 100).catch(() => []);
      const residentHome = savedLocs.find(l =>
        l.category === 'home' &&
        ((l.resident_character_ids || []).includes(charId) || (l.residents || []).some(r => r.character_id === charId))
      );
      if (residentHome) {
        authorizedLocId = residentHome.id;
        authSource = `resident scan: ${residentHome.name} (character is resident)`;
        result.resolutionTrace.push(`  ✓ Found resident home: "${residentHome.name}"`);
      }
    }
  } else {
    result.resolutionTrace.push(`  ✓ Authoritative source: ${authSource}`);
  }

  if (!authorizedLocId) {
    result.error = `Character has no location assigned in file or location records`;
    result.resolutionTrace.push('  ✗ HALT: No location could be resolved');
    return result;
  }

  result.authSource = authSource;

  // ── STEP 3: FETCH LOCATION RECORD ────────────────────────────────────────
  result.resolutionTrace.push('Step 3: Fetching LocationReference record for authoritative zone/image truth');

  let locationRecord = null;
  try {
    locationRecord = await base44.asServiceRole.entities.LocationReference.get(authorizedLocId).catch(() => null);
    if (!locationRecord) {
      const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: authorizedLocId }, null, 1).catch(() => []);
      locationRecord = locList?.[0] || null;
    }
  } catch (err) {
    result.error = `Location record fetch failed: ${err.message}`;
    result.resolutionTrace.push(`  ✗ Error fetching location`);
    return result;
  }

  if (!locationRecord) {
    result.error = `Location record not found (id=${authorizedLocId})`;
    result.resolutionTrace.push(`  ✗ Location record not found in database`);
    return result;
  }

  result.locationId = locationRecord.id;
  result.locationName = locationRecord.name;
  result.resolutionTrace.push(`  ✓ Location record found: "${locationRecord.name}"`);

  // ── STEP 4: RESOLVE ZONE AND IMAGES ──────────────────────────────────────
  result.resolutionTrace.push('Step 4: Resolving zone and images from location record');

  // Detect zone hint from prompt (if no manual zone selected)
  let zoneHint = null;
  if (scenePrompt) {
    const promptLower = scenePrompt.toLowerCase();
    if (/\b(kitchen|stove|fridge|counter|oven|microwave|sink|cooking|pancake|breakfast|eating|table)\b/.test(promptLower)) {
      zoneHint = 'kitchen';
    } else if (/\b(bedroom|bed|sleeping|nightstand|closet|duvet)\b/.test(promptLower)) {
      zoneHint = 'bedroom';
    } else if (/\b(bathroom|shower|bathtub|toilet)\b/.test(promptLower)) {
      zoneHint = 'bathroom';
    } else if (/\b(living room|couch|sofa|tv|lounge)\b/.test(promptLower)) {
      zoneHint = 'living room';
    } else if (/\b(backyard|patio|deck|yard|outside)\b/.test(promptLower)) {
      zoneHint = 'backyard';
    }
  }

  if (zoneHint) {
    result.resolutionTrace.push(`  Zone hint from prompt: "${zoneHint}"`);
  }

  // Try to match zone
  if (zoneHint && locationRecord.zones?.length > 0) {
    const matchedZone = locationRecord.zones.find(z => z.zone_name?.toLowerCase().includes(zoneHint.toLowerCase()));
    if (matchedZone?.image_urls?.length > 0) {
      result.zoneImages = matchedZone.image_urls.slice(0, 6).filter(isProviderAccessible);
      result.zoneName = matchedZone.zone_name;
      result.hasLocationImages = result.zoneImages.length > 0;
      result.resolutionTrace.push(`  ✓ Zone "${matchedZone.zone_name}" matched with ${result.zoneImages.length} usable images`);
      return result;
    }
  }

  // Fallback: first zone with images
  if (locationRecord.zones?.length > 0) {
    const firstZone = locationRecord.zones.find(z => z.image_urls?.length > 0);
    if (firstZone) {
      result.zoneImages = firstZone.image_urls.slice(0, 6).filter(isProviderAccessible);
      result.zoneName = firstZone.zone_name;
      result.hasLocationImages = result.zoneImages.length > 0;
      result.resolutionTrace.push(`  ✓ No zone match — using first zone: "${firstZone.zone_name}" (${result.zoneImages.length} usable)`);
      return result;
    }
  }

  // Fallback: flat location images
  if (locationRecord.image_urls?.length > 0) {
    result.zoneImages = locationRecord.image_urls.slice(0, 6).filter(isProviderAccessible);
    result.hasLocationImages = result.zoneImages.length > 0;
    result.resolutionTrace.push(`  ✓ No zones — using flat location images (${result.zoneImages.length} usable)`);
    return result;
  }

  // ── HARD HALT: Location found but no usable images ──────────────────────
  result.error = `Location "${locationRecord.name}" has no usable reference images (zones: ${locationRecord.zones?.length || 0}, flat: ${locationRecord.image_urls?.length || 0})`;
  result.resolutionTrace.push(`  ✗ HALT: No images found on location or zones`);
  result.resolutionTrace.push(`  ✗ Refusing to proceed — avatar background cannot fill this gap`);
  return result;
}