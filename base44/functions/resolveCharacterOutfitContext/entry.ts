/**
 * resolveCharacterOutfitContext — THE SINGLE OUTFIT AUTHORITY FOR IMAGE GENERATION
 *
 * This is the only function allowed to decide what a character is wearing for image generation.
 * All image generation paths (generateImageAsync, mediaGridGenerate, regenerateImageWithReason)
 * MUST call this function. None of them may implement their own outfit resolution logic.
 *
 * INPUT:
 *   characterId      — Character DB record ID
 *   locationCategory — Location category string (e.g. 'gym', 'home', 'workplace') or null
 *   ownerEmail       — Required for RLS-safe character fetch
 *
 * OUTPUT:
 *   {
 *     text:     string|null   — The resolved outfit text for prompt injection, or null if no outfit
 *     source:   string        — Diagnostic source label
 *     category: string|null   — Resolved outfit category
 *   }
 *
 * AUTHORITY ORDER (same as outfitRotationEngine.resolveCurrentOutfit in lib/):
 *   ROTATION ON:
 *     1. today_category_outfit_overrides (date-scoped per-category override, ET-aware)
 *     2. Day-stable closet rotation by resolved category chain
 *   ROTATION OFF:
 *     1. manual_category_selections (persistent per-category selection)
 *     2. Day-stable rotation fallback
 *
 * current_outfit is NEVER an authority. It is stale UI state.
 * It is only used as an absolute last resort when the closet is completely empty.
 *
 * TIMEZONE: All date comparisons use America/New_York (Eastern Time).
 *           UTC is forbidden as an application time reference.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── UNIFORM RESOLVER ─────────────────────────────────────────────────────────
// Returns uniform description text if a required uniform applies, null otherwise.
// Only fires when character is a worker/inmate/student at the location — never for visitors.
function resolveUniformText(character, locationRecord) {
  if (!character || !locationRecord) return null;
  const uniforms = locationRecord.uniforms || {};
  if (!uniforms || Object.keys(uniforms).length === 0) return null;

  const workerIds = locationRecord.worker_character_ids || [];
  const isWorker = workerIds.includes(character.id);
  const jobTitle = locationRecord.worker_job_titles?.[character.id];
  const isInmate = locationRecord.category === 'jail_prison' && character.is_jailed;
  const isStudent = (locationRecord.category === 'school' || locationRecord.category === 'education')
    && character.education_location_id === locationRecord.id;

  if (!isWorker && !isInmate && !isStudent) return null;

  let role = isInmate ? 'inmate' : isStudent ? 'student' : isWorker ? 'employee' : null;
  if (isWorker && locationRecord.category === 'jail_prison') role = 'staff';
  if (isWorker && locationRecord.category === 'medical') role = 'staff';
  if (!role) return null;

  function uniformToText(u) {
    if (!u) return null;
    const parts = [u.description, u.name].filter(Boolean);
    return parts[0] || null;
  }

  const manualKey = locationRecord.worker_manual_uniforms?.[character.id];
  if (manualKey && uniforms[manualKey]) return uniformToText(uniforms[manualKey]);

  if (jobTitle) {
    const normalizedTitle = jobTitle.toLowerCase().trim();
    for (const u of Object.values(uniforms)) {
      if (u?.applicability === 'job_title' && (u.job_title || '').toLowerCase().trim() === normalizedTitle) {
        return uniformToText(u);
      }
    }
  }

  const characterZone = (character.current_zone || character.current_activity || '').toLowerCase();
  if (characterZone) {
    for (const u of Object.values(uniforms)) {
      if (u?.applicability === 'zone' && u.zone && characterZone.includes(u.zone.toLowerCase())) {
        return uniformToText(u);
      }
    }
  }

  for (const u of Object.values(uniforms)) {
    if (u?.applicability === 'role_status' && (u.role_status || '').toLowerCase().trim() === role) {
      return uniformToText(u);
    }
  }

  if (isWorker && jobTitle) {
    for (const u of Object.values(uniforms)) {
      if (u?.applicability === 'generic_staff') return uniformToText(u);
    }
  }

  for (const u of Object.values(uniforms)) {
    if (u?.applicability === 'location_wide') return uniformToText(u);
  }

  return null;
}

// ── FALLBACK CHAINS ────────────────────────────────────────────────────────────
// Copied from lib/outfitRotationEngine.js buildFallbackChain().
// This file IS the authority — if fallback chains need to change, change them here.
const FALLBACK_CHAINS = {
  bath:         ['bath', 'sleepwear', 'lounge'],
  sleepwear:    ['sleepwear', 'lounge', 'daily_casual'],
  swimwear:     ['swimwear', 'gym', 'daily_casual'],
  gym:          ['gym', 'outdoor', 'daily_casual'],
  work:         ['work', 'formal', 'daily_casual'],
  formal:       ['formal', 'work', 'daily_casual'],
  church:       ['church', 'formal', 'daily_casual'],
  nightlife:    ['nightlife', 'date_night', 'daily_casual'],
  date_night:   ['date_night', 'nightlife', 'formal', 'daily_casual'],
  school:       ['school', 'daily_casual'],
  lounge:       ['lounge', 'daily_casual'],
  outdoor:      ['outdoor', 'daily_casual'],
  travel:       ['travel', 'outdoor', 'daily_casual'],
  medical:      ['medical', 'daily_casual'],
  special:      ['special', 'formal', 'daily_casual'],
  cold_weather: ['cold_weather', 'outdoor', 'daily_casual'],
  hot_weather:  ['hot_weather', 'outdoor', 'daily_casual'],
  daily_casual: ['daily_casual', 'outdoor', 'lounge'],
};

// ── CATEGORY RESOLVER ─────────────────────────────────────────────────────────
// Mirrors lib/outfitRotationEngine.js resolveTargetCategory().
// Uses presence status, current_activity, and location category to determine
// the correct outfit category for context.
function resolveTargetCategory(character, locationCategory) {
  const presence = character?.resolved_presence_status || character?.location_status || '';
  const activity = (character?.current_activity || '').toLowerCase();

  if (/bath|shower|grooming/.test(activity)) return 'bath';
  if (presence === 'sleeping' || presence === 'napping' || presence === 'passed_out') return 'sleepwear';
  if (/\b(sleep|nap|asleep|bedtime|going to sleep)\b/.test(activity)) return 'sleepwear';

  // Pre-sleep window: within 60 minutes of scheduled sleep start
  if (character?.sleep_start_time) {
    const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const [sh, sm] = character.sleep_start_time.split(':').map(Number);
    const sleepMin = sh * 60 + sm;
    const nowMin = etNow.getHours() * 60 + etNow.getMinutes();
    const diff = sleepMin > nowMin ? sleepMin - nowMin : (sleepMin + 1440) - nowMin;
    if (diff <= 60 && diff >= 0) return 'sleepwear';
  }

  if (/\b(swim|pool|beach|ocean|water park|sunbath)\b/.test(activity)) return 'swimwear';
  if (/\b(gym|workout|exercise|lifting|cardio|yoga|jogging|running|training)\b/.test(activity)) return 'gym';
  if (locationCategory === 'gym') return 'gym';

  if (presence === 'at_work') return 'work';
  if (/\b(working|at work|work shift|on the clock)\b/.test(activity)) return 'work';
  if (locationCategory === 'workplace' || locationCategory === 'business') return 'work';

  if (/\b(church|worship|mass|prayer|service)\b/.test(activity)) return 'church';
  if (locationCategory === 'religion') return 'church';

  if (/\b(wedding|funeral|gala|graduation|ceremony|formal event|black tie)\b/.test(activity)) return 'formal';
  if (/\b(club|nightclub|party|going out|night out|bar hopping)\b/.test(activity)) return 'nightlife';
  if (/\b(date|date night|romantic dinner|anniversary)\b/.test(activity)) return 'date_night';

  if (/\b(school|class|campus|lecture|study|college|university)\b/.test(activity)) return 'school';
  if (locationCategory === 'school' || locationCategory === 'education') return 'school';

  if (/\b(airport|train|travel|hotel check-in|vacation departure)\b/.test(activity)) return 'travel';

  if (presence === 'home' || locationCategory === 'home') return 'lounge';
  if (/\b(relaxing|chilling|lounging|watching tv|at home)\b/.test(activity)) return 'lounge';

  return 'daily_casual';
}

// ── OUTFIT TEXT BUILDER ───────────────────────────────────────────────────────
function buildOutfitText(outfit) {
  if (!outfit) return null;
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
    .filter(Boolean)
    .map(p => {
      const t = p.trim();
      if (/^(n\/?a|none|-)$/i.test(t)) return null;
      const s = t.replace(/^n\/?a[,\-–]\s*/i, '').trim();
      if (/^(shirtless|no top|no shirt)$/i.test(s)) return 'No shirt / bare torso';
      return s || null;
    })
    .filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  const fd = outfit.full_description?.trim();
  // Reject AI-style prompts — they are generation artifacts, not real clothing descriptions
  if (fd && !/\b(cinematic|chiaroscuro|dramatic lighting|editorial photography|fine art|low-key lighting|sculptural anatomy|artistic composition|museum.quality|photorealistic|ultra.detailed|high.resolution|bokeh|dramatic shadow|noir atmosphere|hyper.realistic|studio lighting|professional photography|stock photo)\b/i.test(fd)) {
    return fd;
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, locationCategory, locationId, ownerEmail } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId is required' }, { status: 400 });
    }

    const requestingEmail = ownerEmail || user.email;

    // ── FETCH CHARACTER RECORD ────────────────────────────────────────────────
    // Try user-scoped first (respects RLS), fall back to service role
    let character = null;
    const userScoped = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
    character = userScoped?.[0] || null;

    if (!character) {
      const srScoped = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
      const candidate = srScoped?.[0] || null;
      if (candidate) {
        const owner = candidate.owner_email;
        if (owner && owner !== requestingEmail) {
          console.error(`[resolveCharacterOutfitContext] ⛔ Cross-account: char ${characterId} owned by ${owner}, request from ${requestingEmail}`);
          return Response.json({ error: 'Character does not belong to your account.' }, { status: 403 });
        }
        character = candidate;
      }
    }

    if (!character) {
      console.warn(`[resolveCharacterOutfitContext] Character ${characterId} not found`);
      return Response.json({ text: null, source: 'character_not_found', category: null });
    }

    // ── PRIORITY 1: UNIFORM (work/school/jail) ───────────────────────────────
    // Resolve the effective location ID: passed locationId, then work/school/jail from presence.
    const presence = character.resolved_presence_status || character.location_status || '';
    const effectiveLocationId = locationId
      || (presence === 'at_work' ? (character.current_work_location_id || character.occupation_location_id || null) : null)
      || (presence === 'at_school' ? (character.current_school_location_id || character.education_location_id || null) : null)
      || (presence === 'incarcerated' ? (character.incarceration_facility_id || null) : null);

    if (effectiveLocationId) {
      const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: effectiveLocationId }, null, 1).catch(() => []);
      const locRecord = locList?.[0] || null;
      if (locRecord) {
        const uniformText = resolveUniformText(character, locRecord);
        if (uniformText) {
          console.log(`[resolveCharacterOutfitContext] ✅ UNIFORM for "${character.name}" at "${locRecord.name}": "${uniformText.substring(0,80)}"`);
          return Response.json({ text: uniformText, source: 'uniform', category: 'uniform' });
        }
      }
    }

    // ── CLOSET FILTER ─────────────────────────────────────────────────────────
    const outfits = (character.character_closet || []).filter(item => item.outfit_id);

    // No closet — absolute last resort: current_outfit stub only
    if (!outfits.length) {
      const co = character.current_outfit;
      const t = co ? buildOutfitText(co) || co.label?.trim() || null : null;
      console.warn(`[resolveCharacterOutfitContext] ⚠️ No closet for "${character.name}" — ${t ? 'using current_outfit stub' : 'no wardrobe constraint'}`);
      return Response.json({ text: t, source: t ? 'current_outfit_no_closet_fallback' : 'no_closet', category: null });
    }

    // ── PRIORITY 1.5: SPECIAL OCCASION (StoryEvent today) ─────────────────────
    // Calendar events (weddings, funerals, date nights, etc.) activate "Today's Special
    // Occasion" above Home/Daily Wear but below required uniforms. Keyword-matched only —
    // generic meet-ups do NOT force a special outfit.
    let specialOccasionCategory = null;
    try {
      const etDateForEvents = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const todayStrForEvents = `${etDateForEvents.getFullYear()}-${String(etDateForEvents.getMonth()+1).padStart(2,'0')}-${String(etDateForEvents.getDate()).padStart(2,'0')}`;
      const events = await base44.asServiceRole.entities.StoryEvent.filter({ owner_email: requestingEmail }, '-event_date', 100).catch(() => []);
      const occasionKws: Array<[RegExp, string]> = [
        [/\b(wedding|bridesmaid|groomsman|wedding guest|rehearsal dinner|funeral|memorial|viewing|wake|burial|celebration of life|gala|black tie|fundraiser|charity ball|red carpet|awards?|premiere|graduation|commencement|ceremony|prom)\b/i, 'formal'],
        [/\b(date night|romantic|anniversary|candlelit|valentine)\b/i, 'date_night'],
        [/\b(club|nightclub|party|birthday party|bar hop|night out)\b/i, 'nightlife'],
        [/\b(church|worship|mass|baptism|communion|service|bible study)\b/i, 'church'],
      ];
      for (const ev of (events || [])) {
        if (!ev?.event_date || ev.event_date !== todayStrForEvents) continue;
        const participates = (ev.participant_character_ids || []).includes(characterId) || (ev.focus_character_ids || []).includes(characterId);
        if (!participates) continue;
        const text = `${ev.title || ''} ${ev.plot || ''} ${ev.additional_notes || ''}`;
        for (const [pat, cat] of occasionKws) { if (pat.test(text)) { specialOccasionCategory = cat; break; } }
        if (specialOccasionCategory) break;
      }
      if (specialOccasionCategory) console.log(`[resolveCharacterOutfitContext] ✅ SPECIAL OCCASION for "${character.name}": ${specialOccasionCategory}`);
    } catch (e) { /* non-blocking */ }

    // ── RESOLVE TARGET CATEGORY ───────────────────────────────────────────────
    const targetCategory = specialOccasionCategory || resolveTargetCategory(character, locationCategory || null);
    const chain = FALLBACK_CHAINS[targetCategory] || ['daily_casual', 'lounge'];

    // ── DAY-STABLE INDEX ──────────────────────────────────────────────────────
    // Uses Eastern Time day-of-year so rotation is consistent regardless of UTC offset.
    const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfYear = Math.floor((etNow - new Date(etNow.getFullYear(), 0, 0)) / 86400000);
    const idHash = (character.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const stableIndex = dayOfYear + idHash;

    const rotationEnabled = character.outfit_rotation_enabled !== false;

    console.log(`[resolveCharacterOutfitContext] char="${character.name}" category="${targetCategory}" rotation=${rotationEnabled ? 'ON' : 'OFF'} locationCategory="${locationCategory || 'none'}"`);

    // ── ROTATION ON ───────────────────────────────────────────────────────────
    if (rotationEnabled) {
      // P1: today_category_outfit_overrides (date-scoped, ET-authoritative)
      const overrideState = character.today_category_outfit_overrides;
      if (overrideState?.date && overrideState?.overrides) {
        const todayStr = `${etNow.getFullYear()}-${String(etNow.getMonth()+1).padStart(2,'0')}-${String(etNow.getDate()).padStart(2,'0')}`;
        if (overrideState.date === todayStr) {
          for (const cat of chain) {
            const overrideId = overrideState.overrides[cat];
            if (overrideId) {
              const outfit = outfits.find(o => o.outfit_id === overrideId);
              const t = outfit ? buildOutfitText(outfit) || outfit.label?.trim() || null : null;
              if (t) {
                console.log(`[resolveCharacterOutfitContext] ✅ TODAY_OVERRIDE cat="${cat}" → "${t.substring(0,80)}"`);
                return Response.json({ text: t, source: 'today_category_override', category: cat });
              }
            }
          }
        } else {
          console.log(`[resolveCharacterOutfitContext] today_category_outfit_overrides stale (stored="${overrideState.date}" today="${etNow.getFullYear()}-${String(etNow.getMonth()+1).padStart(2,'0')}-${String(etNow.getDate()).padStart(2,'0')}") — ignored`);
        }
      }

      // P2: Day-stable closet rotation by category chain
      for (const cat of chain) {
        const pool = outfits.filter(o => o.category === cat);
        if (!pool.length) continue;
        const picked = pool[stableIndex % pool.length];
        const t = buildOutfitText(picked) || picked.label?.trim() || null;
        if (t) {
          console.log(`[resolveCharacterOutfitContext] ✅ ROTATION_ON cat="${cat}" idx=${stableIndex % pool.length}/${pool.length} → "${t.substring(0,80)}"`);
          return Response.json({ text: t, source: 'closet_rotation', category: cat });
        }
      }

      console.warn(`[resolveCharacterOutfitContext] ROTATION_ON chain miss for "${targetCategory}" — no outfits in any chain category`);
      return Response.json({ text: null, source: 'closet_chain_miss', category: targetCategory });
    }

    // ── ROTATION OFF ──────────────────────────────────────────────────────────
    // Rotation OFF — P1: manual_category_selections (persistent per-category selection)
    const manualSelections = character.manual_category_selections;
    if (manualSelections) {
      for (const cat of chain) {
        const selectedId = manualSelections[cat];
        if (selectedId) {
          const outfit = outfits.find(o => o.outfit_id === selectedId);
          const t = outfit ? buildOutfitText(outfit) || outfit.label?.trim() || null : null;
          if (t) {
            console.log(`[resolveCharacterOutfitContext] ✅ ROTATION_OFF manual_category cat="${cat}" → "${t.substring(0,80)}"`);
            return Response.json({ text: t, source: 'rotation_off_manual_category', category: cat });
          }
        }
      }
    }

    // ROTATION OFF: current_outfit is the authority. null = nothing selected.
    // Do NOT auto-pick from the closet — that would override the user's explicit "no selection" state.
    const currentOutfitId = character.current_outfit?.outfit_id || null;
    if (!currentOutfitId) {
      console.log(`[resolveCharacterOutfitContext] ROTATION_OFF no selection (current_outfit=null) — returning null`);
      return Response.json({ text: null, source: 'rotation_off_no_selection', category: null });
    }

    // current_outfit is set — find it in closet and use it
    const selectedOutfit = outfits.find(o => o.outfit_id === currentOutfitId);
    const t = selectedOutfit ? buildOutfitText(selectedOutfit) || selectedOutfit.label?.trim() || null : null;
    if (t) {
      console.log(`[resolveCharacterOutfitContext] ✅ ROTATION_OFF current_outfit → "${t.substring(0,80)}"`);
      return Response.json({ text: t, source: 'rotation_off_current_outfit', category: selectedOutfit?.category || targetCategory });
    }

    // current_outfit ID found but outfit deleted from closet — treat as null
    console.warn(`[resolveCharacterOutfitContext] ROTATION_OFF current_outfit id="${currentOutfitId}" not in closet — returning null`);
    return Response.json({ text: null, source: 'rotation_off_outfit_deleted', category: null });

  } catch (error) {
    console.error('[resolveCharacterOutfitContext] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});