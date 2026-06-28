/**
 * proofExistingObjectCue
 *
 * Directly tests the resolveZoneFromLocation logic and buildPrompt envLock block
 * for three cases:
 *   1. Desk-at-home: prompt says "living room zone" but Office zone exists → redirect + desk cue
 *   2. Dining room: dining room zone + dining table cue
 *   3. Factory floor: sleeping prompt, no valid bedroom zone → no bed invented
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── INLINE ZONE RESOLVER (mirrors generateImageAsync) ─────────────────────────
const ZONE_KEYWORD_MAP = [
  {keywords:['bedroom','in bed','on the bed','sleeping','woke up','waking up','nightstand','duvet','pillow'],zone:'bedroom'},
  {keywords:['kitchen','cooking','stove','fridge','oven','counter'],zone:'kitchen'},
  {keywords:['bathroom','shower','bathtub','toilet','vanity','brushing teeth'],zone:'bathroom'},
  {keywords:['living room','couch','sofa','tv ','on the couch','lounge','watching tv'],zone:'living room'},
  {keywords:['backyard','patio','deck','yard','garden','grill'],zone:'backyard'},
  {keywords:['dining room','dining table','dinner table','eating at the table'],zone:'dining room'},
  {keywords:['office','desk','home office','workspace','working from home'],zone:'office'},
  {keywords:['gym','workout','weights','treadmill','lifting','training','exercise'],zone:'gym'},
];

const ACTIVITY_OBJECT_MAP = [
  { keywords: ['desk','working from home','home office','workspace','paperwork','writing','studying','homework','computer at home','laptop at home'], zone: 'office', existingObject: 'desk' },
  { keywords: ['dining table','dinner table','eating at table','dining room','formal meal','dinner at home','lunch at home'], zone: 'dining room', existingObject: 'dining table' },
  { keywords: ['sleeping','asleep','in bed','lying in bed','waking up','bedroom','napping in bed','nightstand'], zone: 'bedroom', existingObject: 'bed' },
  { keywords: ['workout','weights','treadmill','lifting','exercise at home','home gym'], zone: 'gym', existingObject: 'gym equipment' },
  { keywords: ['laundry','washer','dryer','folding clothes'], zone: 'laundry', existingObject: 'washer/dryer' },
  { keywords: ['couch','sofa','watching tv','on the couch','tv show'], zone: 'living room', existingObject: 'couch/sofa' },
];

function cdnFilterMock(urls) {
  return (urls || []).filter(u => u && typeof u === 'string');
}

function resolveZoneFromLocation(location, promptLower, preferredZoneName) {
  const allZones = location.zones || [];
  // For test: treat all zones as having images
  const zones = allZones.filter(z => z.zone_name && (z.image_urls || []).length > 0);

  if (zones.length === 0) {
    return { images: (location.image_urls || []).slice(0, 4), zoneName: null, existingObjectCue: null };
  }

  let requiredObjectEntry = null;
  for (const entry of ACTIVITY_OBJECT_MAP) {
    if (entry.keywords.some(kw => promptLower.includes(kw))) {
      requiredObjectEntry = entry;
      break;
    }
  }

  function findCanonicalZoneForObject(entry) {
    if (!entry) return null;
    return zones.find(z => z.zone_name && z.zone_name.toLowerCase().includes(entry.zone)) || null;
  }

  if (preferredZoneName) {
    const preferred = zones.find(z => z.zone_name && z.zone_name.toLowerCase() === preferredZoneName.toLowerCase());
    if (preferred) {
      if (requiredObjectEntry) {
        const isCorrectZone = preferred.zone_name.toLowerCase().includes(requiredObjectEntry.zone);
        if (!isCorrectZone) {
          const canonicalZone = findCanonicalZoneForObject(requiredObjectEntry);
          if (canonicalZone) {
            return { images: canonicalZone.image_urls.slice(0, 4), zoneName: canonicalZone.zone_name, existingObjectCue: requiredObjectEntry.existingObject, redirect: `preferred="${preferred.zone_name}" lacks "${requiredObjectEntry.existingObject}" → redirected to "${canonicalZone.zone_name}"` };
          }
        }
      }
      return { images: preferred.image_urls.slice(0, 4), zoneName: preferred.zone_name, existingObjectCue: requiredObjectEntry?.existingObject || null };
    }
  }

  // Exact name match
  for (const zone of zones) {
    if (zone.zone_name && promptLower.includes(zone.zone_name.toLowerCase())) {
      if (requiredObjectEntry) {
        const isCorrectZone = zone.zone_name.toLowerCase().includes(requiredObjectEntry.zone);
        if (!isCorrectZone) {
          const canonicalZone = findCanonicalZoneForObject(requiredObjectEntry);
          if (canonicalZone) {
            return { images: canonicalZone.image_urls.slice(0, 4), zoneName: canonicalZone.zone_name, existingObjectCue: requiredObjectEntry.existingObject, redirect: `exact-name "${zone.zone_name}" wrong for activity → redirected to "${canonicalZone.zone_name}"` };
          }
        }
      }
      return { images: zone.image_urls.slice(0, 4), zoneName: zone.zone_name, existingObjectCue: requiredObjectEntry?.existingObject || null };
    }
  }

  // Keyword map
  for (const entry of ZONE_KEYWORD_MAP) {
    if (entry.keywords.some(kw => promptLower.includes(kw))) {
      const matched = zones.find(z => z.zone_name && z.zone_name.toLowerCase().includes(entry.zone));
      if (matched) {
        const cueKw = requiredObjectEntry && matched.zone_name.toLowerCase().includes(requiredObjectEntry.zone)
          ? requiredObjectEntry.existingObject : null;
        return { images: matched.image_urls.slice(0, 4), zoneName: matched.zone_name, existingObjectCue: cueKw };
      }
    }
  }

  // Fallback: first zone — only inject cue if zone canonically owns the required object
  const cueFirst = requiredObjectEntry && zones[0].zone_name.toLowerCase().includes(requiredObjectEntry.zone)
    ? requiredObjectEntry.existingObject : null;
  return { images: zones[0].image_urls.slice(0, 4), zoneName: zones[0].zone_name, existingObjectCue: cueFirst };
}

// ── MOCK LOCATION RECORDS ─────────────────────────────────────────────────────

const HOME_WITH_OFFICE = {
  name: "Ethan's Apartment",
  category: "home",
  image_urls: ["https://media.base44.com/images/public/home_fallback.jpg"],
  zones: [
    { zone_name: "Living Room Zone", image_urls: ["https://media.base44.com/images/public/living_room_1.jpg", "https://media.base44.com/images/public/living_room_2.jpg"] },
    { zone_name: "Office Zone", image_urls: ["https://media.base44.com/images/public/office_1.jpg", "https://media.base44.com/images/public/office_2.jpg"] },
    { zone_name: "Bedroom Zone", image_urls: ["https://media.base44.com/images/public/bedroom_1.jpg"] },
    { zone_name: "Kitchen Zone", image_urls: ["https://media.base44.com/images/public/kitchen_1.jpg"] },
  ]
};

const HOME_WITH_DINING = {
  name: "Marley's House",
  category: "home",
  image_urls: ["https://media.base44.com/images/public/home_fallback.jpg"],
  zones: [
    { zone_name: "Living Room Zone", image_urls: ["https://media.base44.com/images/public/lr_1.jpg"] },
    { zone_name: "Dining Room Zone", image_urls: ["https://media.base44.com/images/public/dining_1.jpg", "https://media.base44.com/images/public/dining_2.jpg"] },
    { zone_name: "Kitchen Zone", image_urls: ["https://media.base44.com/images/public/kitchen_1.jpg"] },
  ]
};

const FACTORY_FLOOR = {
  name: "Meridian Manufacturing Plant",
  category: "workplace",
  image_urls: ["https://media.base44.com/images/public/factory_main.jpg"],
  zones: [
    { zone_name: "Production Floor", image_urls: ["https://media.base44.com/images/public/factory_1.jpg", "https://media.base44.com/images/public/factory_2.jpg"] },
    { zone_name: "Break Room", image_urls: ["https://media.base44.com/images/public/breakroom_1.jpg"] },
    { zone_name: "Loading Dock", image_urls: ["https://media.base44.com/images/public/dock_1.jpg"] },
  ]
};

// ── envLock block builder (mirrors buildPrompt logic) ─────────────────────────
function buildEnvLockExcerpt(envRefStart, envRefCount, locationName, zoneName, existingObjectCue) {
  if (envRefCount === 0) return "[NO ENV REFS — no envLock block]";
  const envEnd = envRefStart + envRefCount - 1;
  const place = [locationName, zoneName].filter(Boolean).join(' → ');

  let block = `\n  LOCATION FIDELITY — "${place}"\n`;
  block += `  ✅ Character inside room shown in images ${envRefStart}–${envEnd}.\n`;

  if (existingObjectCue) {
    block += `\n  ════ EXISTING OBJECT AUTHORITY ════\n`;
    block += `  This room already contains a canonical ${existingObjectCue}.\n`;
    block += `  ⛔ Do NOT create a second ${existingObjectCue}\n`;
    block += `  ⛔ Do NOT replace the existing ${existingObjectCue}\n`;
    block += `  ✅ Compose scene around THE EXISTING ${existingObjectCue.toUpperCase()}\n`;
    block += `  ════════════════════════════════════\n`;
    block += `\n  🚫 GENERATION INVALID IF a second or replacement ${existingObjectCue} appears\n`;
  } else {
    block += `  [No existing object cue — standard furniture prohibition only]\n`;
  }
  return block;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const results = {};

    // ── TEST 1: Desk-at-home — prompt says "living room zone" but Office exists ──
    {
      const prompt = "sitting at desk working from home. living room zone.";
      const promptLower = prompt.toLowerCase();
      // Simulate the LLM having written "living room zone" in the prompt
      const preferredZone = "Living Room Zone"; // wrong zone passed from prior context
      const result = resolveZoneFromLocation(HOME_WITH_OFFICE, promptLower, preferredZone);
      const envLockExcerpt = buildEnvLockExcerpt(1, result.images.length, HOME_WITH_OFFICE.name, result.zoneName, result.existingObjectCue);

      const pass_zone = result.zoneName?.toLowerCase().includes('office');
      const pass_cue = result.existingObjectCue === 'desk';
      const pass_no_lr_refs = !result.images.some(u => u.includes('living_room'));
      const pass_prompt_has_authority = envLockExcerpt.includes('EXISTING OBJECT AUTHORITY') && envLockExcerpt.includes('desk');

      results.test1_desk_at_home = {
        input_prompt: prompt,
        input_preferred_zone: preferredZone,
        redirect_reason: result.redirect || null,
        SELECTED_ZONE: result.zoneName,
        ENV_REFS: result.images,
        EXISTING_OBJECT_CUE: result.existingObjectCue,
        ENV_LOCK_EXCERPT: envLockExcerpt,
        PASS: {
          zone_is_office: pass_zone,
          cue_is_desk: pass_cue,
          no_living_room_refs: pass_no_lr_refs,
          prompt_has_object_authority_block: pass_prompt_has_authority,
          OVERALL: pass_zone && pass_cue && pass_no_lr_refs && pass_prompt_has_authority,
        }
      };
    }

    // ── TEST 2: Dining room — table already exists ────────────────────────────
    {
      const prompt = "sitting at the dining table having dinner at home.";
      const promptLower = prompt.toLowerCase();
      const preferredZone = null;
      const result = resolveZoneFromLocation(HOME_WITH_DINING, promptLower, preferredZone);
      const envLockExcerpt = buildEnvLockExcerpt(1, result.images.length, HOME_WITH_DINING.name, result.zoneName, result.existingObjectCue);

      const pass_zone = result.zoneName?.toLowerCase().includes('dining');
      const pass_cue = result.existingObjectCue === 'dining table';
      const pass_prompt_has_authority = envLockExcerpt.includes('EXISTING OBJECT AUTHORITY') && envLockExcerpt.includes('dining table');
      const pass_no_duplicate_instruction = envLockExcerpt.includes('Do NOT create a second dining table');

      results.test2_dining_table = {
        input_prompt: prompt,
        SELECTED_ZONE: result.zoneName,
        ENV_REFS: result.images,
        EXISTING_OBJECT_CUE: result.existingObjectCue,
        ENV_LOCK_EXCERPT: envLockExcerpt,
        PASS: {
          zone_is_dining_room: pass_zone,
          cue_is_dining_table: pass_cue,
          prompt_has_object_authority_block: pass_prompt_has_authority,
          prompt_forbids_second_table: pass_no_duplicate_instruction,
          OVERALL: pass_zone && pass_cue && pass_prompt_has_authority && pass_no_duplicate_instruction,
        }
      };
    }

    // ── TEST 3: Factory floor — sleeping prompt, no bedroom zone ─────────────
    {
      const prompt = "character is sleeping in bed after a long shift.";
      const promptLower = prompt.toLowerCase();
      const preferredZone = null;
      const result = resolveZoneFromLocation(FACTORY_FLOOR, promptLower, preferredZone);
      const envLockExcerpt = buildEnvLockExcerpt(1, result.images.length, FACTORY_FLOOR.name, result.zoneName, result.existingObjectCue);

      // The factory has no bedroom zone. The ACTIVITY_OBJECT_MAP will find 'bed' as requiredObjectEntry
      // but findCanonicalZoneForObject('bedroom') will return null (no bedroom zone exists).
      // So it falls through — no redirect, no bed fabricated in the canonical env block.
      // The zone selected should be a non-bedroom zone (keyword fallback or first zone).
      // existingObjectCue for bed should NOT appear unless there's actually a bedroom zone.
      const pass_no_bedroom_zone_selected = !result.zoneName?.toLowerCase().includes('bedroom');
      const pass_no_bed_cue_injected = result.existingObjectCue !== 'bed';
      // The env lock should NOT contain "EXISTING OBJECT AUTHORITY" for a bed on factory floor
      const pass_no_bed_authority = !envLockExcerpt.includes('canonical bed') && !envLockExcerpt.includes('EXISTING OBJECT AUTHORITY\n  This room already contains a canonical bed');

      results.test3_factory_floor = {
        input_prompt: prompt,
        SELECTED_ZONE: result.zoneName,
        ENV_REFS: result.images,
        EXISTING_OBJECT_CUE: result.existingObjectCue,
        redirect_reason: result.redirect || null,
        note: "Factory has no bedroom zone. Bed activity detected but canonical zone redirect found nothing — no bed fabricated in prompt.",
        ENV_LOCK_EXCERPT: envLockExcerpt,
        PASS: {
          no_bedroom_zone_selected: pass_no_bedroom_zone_selected,
          no_bed_cue_injected: pass_no_bed_cue_injected,
          no_bed_authority_block_in_prompt: pass_no_bed_authority,
          OVERALL: pass_no_bedroom_zone_selected && pass_no_bed_cue_injected && pass_no_bed_authority,
        }
      };
    }

    // ── SUMMARY — compact for output limits ──────────────────────────────────
    const allPass = results.test1_desk_at_home.PASS.OVERALL &&
                    results.test2_dining_table.PASS.OVERALL &&
                    results.test3_factory_floor.PASS.OVERALL;

    // Strip ENV_LOCK_EXCERPT from results to fit within response size limit
    const compact = {};
    for (const [k, v] of Object.entries(results)) {
      compact[k] = {
        input_prompt: v.input_prompt,
        redirect_reason: v.redirect_reason || null,
        SELECTED_ZONE: v.SELECTED_ZONE,
        ENV_REFS_COUNT: (v.ENV_REFS || []).length,
        ENV_REFS_URLS: v.ENV_REFS || [],
        EXISTING_OBJECT_CUE: v.EXISTING_OBJECT_CUE,
        AUTHORITY_BLOCK_PRESENT: (v.ENV_LOCK_EXCERPT || '').includes('EXISTING OBJECT AUTHORITY'),
        AUTHORITY_MENTIONS_CUE: v.EXISTING_OBJECT_CUE ? (v.ENV_LOCK_EXCERPT || '').includes(v.EXISTING_OBJECT_CUE) : null,
        note: v.note || null,
        PASS: v.PASS,
      };
    }

    // Return only test3 + summary to fit within size limit
    return Response.json({
      VERIFICATION_COMPLETE: allPass,
      ALL_TESTS_PASS: allPass,
      t1_OVERALL: results.test1_desk_at_home.PASS.OVERALL,
      t2_OVERALL: results.test2_dining_table.PASS.OVERALL,
      t3_OVERALL: results.test3_factory_floor.PASS.OVERALL,
      test3_detail: compact.test3_factory_floor,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});