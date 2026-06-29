/**
 * resolveUserOutfitContext — THE SINGLE OUTFIT AUTHORITY FOR USER IMAGE GENERATION.
 *
 * Mirrors resolveCharacterOutfitContext for the user (who has no uniforms).
 *
 * AUTHORITY ORDER:
 *   ROTATION ON:
 *     1. Today's Special Occasion (StoryEvent with user_participant.user_id, keyword match)
 *     2. today_category_outfit_overrides (date-scoped per-category override, ET-aware)
 *     3. Day-stable closet rotation by resolved category chain
 *   ROTATION OFF:
 *     1. manual_category_selections (persistent per-category selection)
 *     2. user_current_outfit (legacy manual field)
 *     3. Day-stable rotation fallback
 *
 * TIMEZONE: All date comparisons use America/New_York (Eastern Time).
 *           UTC is forbidden as an application time reference.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── FALLBACK CHAINS ────────────────────────────────────────────────────────────
const FALLBACK_CHAINS: Record<string, string[]> = {
  sleepwear: ['sleepwear', 'lounge', 'daily_casual'],
  bath: ['bath', 'sleepwear', 'lounge'],
  swimwear: ['swimwear', 'gym', 'daily_casual'],
  gym: ['gym', 'outdoor', 'daily_casual'],
  work: ['work', 'formal', 'daily_casual'],
  formal: ['formal', 'work', 'daily_casual'],
  church: ['church', 'formal', 'daily_casual'],
  nightlife: ['nightlife', 'date_night', 'daily_casual'],
  date_night: ['date_night', 'nightlife', 'formal', 'daily_casual'],
  school: ['school', 'daily_casual'],
  lounge: ['lounge', 'daily_casual'],
  outdoor: ['outdoor', 'daily_casual'],
  special: ['special', 'formal', 'daily_casual'],
  daily_casual: ['daily_casual', 'outdoor', 'lounge'],
};

const OCCASION_KEYWORDS: Array<[RegExp, string]> = [
  [/\b(wedding|bridesmaid|groomsman|wedding guest|rehearsal dinner|funeral|memorial|viewing|wake|burial|celebration of life|gala|black tie|fundraiser|charity ball|red carpet|awards?|premiere|graduation|commencement|ceremony|prom)\b/i, 'formal'],
  [/\b(date night|romantic|anniversary|candlelit|valentine)\b/i, 'date_night'],
  [/\b(club|nightclub|party|birthday party|bar hop|night out)\b/i, 'nightlife'],
  [/\b(church|worship|mass|baptism|communion|service|bible study)\b/i, 'church'],
];

function buildOutfitText(outfit: any): string | null {
  if (!outfit) return null;
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
    .filter(Boolean)
    .map((p: any) => {
      const t = String(p).trim();
      if (/^(n\/?a|none|-)$/i.test(t)) return null;
      if (/^(shirtless|no top|no shirt)$/i.test(t)) return 'No shirt / bare torso';
      return t;
    })
    .filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  const fd = outfit.full_description?.trim();
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

    const { ownerEmail, locationCategory, locationId } = await req.json();
    const requestingEmail = ownerEmail || user.email;

    // ── FETCH USER SETTINGS ─────────────────────────────────────────────────
    const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: requestingEmail }, null, 1).catch(() => []);
    const settings = settingsList?.[0] || null;
    if (!settings) {
      console.warn(`[resolveUserOutfitContext] No UserSettings for ${requestingEmail}`);
      return Response.json({ text: null, source: 'no_settings', category: null });
    }

    const closet = settings.user_closet || [];
    const outfits = closet.filter((o: any) => o.outfit_id);

    if (!outfits.length) {
      const co = settings.user_current_outfit;
      const t = co ? buildOutfitText(co) || co.label?.trim() || null : null;
      return Response.json({ text: t, source: t ? 'user_current_outfit_no_closet' : 'no_closet', category: null });
    }

    // ── EASTERN TIME TODAY ──────────────────────────────────────────────────
    const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStr = `${etNow.getFullYear()}-${String(etNow.getMonth() + 1).padStart(2, '0')}-${String(etNow.getDate()).padStart(2, '0')}`;
    const dayOfYear = Math.floor((etNow - new Date(etNow.getFullYear(), 0, 0)) / 86400000);
    const idHash = (requestingEmail || 'user').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const stableIndex = dayOfYear + idHash;

    // ── SPECIAL OCCASION (StoryEvent today with user_participant.user_id) ───
    let specialOccasionCategory: string | null = null;
    try {
      const events = await base44.asServiceRole.entities.StoryEvent.filter({ owner_email: requestingEmail }, '-event_date', 100).catch(() => []);
      for (const ev of (events || [])) {
        if (!ev?.event_date || ev.event_date !== todayStr) continue;
        if (ev.user_participant?.user_id !== user.id) continue;
        const text = `${ev.title || ''} ${ev.plot || ''} ${ev.additional_notes || ''}`;
        for (const [pat, cat] of OCCASION_KEYWORDS) {
          if (pat.test(text)) { specialOccasionCategory = cat; break; }
        }
        if (specialOccasionCategory) break;
      }
    } catch (e) { /* non-blocking */ }

    // ── RESOLVE LOCATION CATEGORY ──────────────────────────────────────────
    let resolvedLocCategory = locationCategory || null;
    if (!resolvedLocCategory && locationId) {
      try {
        const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId }, null, 1).catch(() => []);
        resolvedLocCategory = locs?.[0]?.category || null;
      } catch (e) { /* non-blocking */ }
    }

    // ── TARGET CATEGORY: special occasion > home (present at home) > daily ──
    const presence = settings.user_presence_status || 'away';
    let targetCategory = specialOccasionCategory;
    if (!targetCategory) {
      targetCategory = (presence === 'present' && resolvedLocCategory === 'home') ? 'lounge' : 'daily_casual';
    }

    const chain = FALLBACK_CHAINS[targetCategory] || ['daily_casual', 'lounge'];
    const rotationEnabled = settings.user_outfit_rotation_enabled === true;

    console.log(`[resolveUserOutfitContext] user="${requestingEmail}" target="${targetCategory}" rotation=${rotationEnabled ? 'ON' : 'OFF'} special=${specialOccasionCategory || 'none'} loc=${resolvedLocCategory || 'none'}`);

    // ── ROTATION ON ──────────────────────────────────────────────────────────
    if (rotationEnabled) {
      // P1: today_category_outfit_overrides (date-scoped, ET-authoritative)
      const overrideState = settings.user_today_category_outfit_overrides;
      if (overrideState?.date && overrideState?.overrides && overrideState.date === todayStr) {
        for (const cat of chain) {
          const overrideId = overrideState.overrides[cat];
          if (overrideId) {
            const outfit = outfits.find((o: any) => o.outfit_id === overrideId);
            const t = outfit ? buildOutfitText(outfit) || outfit.label?.trim() || null : null;
            if (t) {
              console.log(`[resolveUserOutfitContext] ✅ TODAY_OVERRIDE cat="${cat}" → "${t.substring(0, 80)}"`);
              return Response.json({ text: t, source: 'today_category_override', category: cat });
            }
          }
        }
      }
      // P2: Day-stable closet rotation by category chain
      for (const cat of chain) {
        const pool = outfits.filter((o: any) => o.category === cat);
        if (!pool.length) continue;
        const picked = pool[stableIndex % pool.length];
        const t = buildOutfitText(picked) || picked.label?.trim() || null;
        if (t) {
          console.log(`[resolveUserOutfitContext] ✅ ROTATION_ON cat="${cat}" idx=${stableIndex % pool.length}/${pool.length} → "${t.substring(0, 80)}"`);
          return Response.json({ text: t, source: 'closet_rotation', category: cat });
        }
      }
      console.warn(`[resolveUserOutfitContext] ROTATION_ON chain miss for "${targetCategory}"`);
      return Response.json({ text: null, source: 'closet_chain_miss', category: targetCategory });
    }

    // ── ROTATION OFF ─────────────────────────────────────────────────────────
    // P1: manual_category_selections (persistent per-category selection)
    const manualSelections = settings.user_manual_category_selections;
    if (manualSelections) {
      for (const cat of chain) {
        const selectedId = manualSelections[cat];
        if (selectedId) {
          const outfit = outfits.find((o: any) => o.outfit_id === selectedId);
          const t = outfit ? buildOutfitText(outfit) || outfit.label?.trim() || null : null;
          if (t) {
            console.log(`[resolveUserOutfitContext] ✅ ROTATION_OFF manual cat="${cat}" → "${t.substring(0, 80)}"`);
            return Response.json({ text: t, source: 'rotation_off_manual_category', category: cat });
          }
        }
      }
    }
    // P2: user_current_outfit (legacy manual field)
    const co = settings.user_current_outfit;
    if (co) {
      const t = buildOutfitText(co) || co.label?.trim() || null;
      if (t) {
        console.log(`[resolveUserOutfitContext] ✅ ROTATION_OFF user_current_outfit → "${t.substring(0, 80)}"`);
        return Response.json({ text: t, source: 'user_current_outfit', category: co.category || targetCategory });
      }
    }
    // P3: Day-stable rotation fallback
    for (const cat of chain) {
      const pool = outfits.filter((o: any) => o.category === cat);
      if (!pool.length) continue;
      const picked = pool[stableIndex % pool.length];
      const t = buildOutfitText(picked) || picked.label?.trim() || null;
      if (t) {
        console.log(`[resolveUserOutfitContext] ✅ ROTATION_OFF fallback cat="${cat}" → "${t.substring(0, 80)}"`);
        return Response.json({ text: t, source: 'rotation_off_fallback', category: cat });
      }
    }

    console.warn(`[resolveUserOutfitContext] ROTATION_OFF chain miss for "${targetCategory}"`);
    return Response.json({ text: null, source: 'closet_chain_miss', category: targetCategory });
  } catch (error) {
    console.error('[resolveUserOutfitContext] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});