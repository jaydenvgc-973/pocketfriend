/**
 * clothingOwnerAdapter.js
 *
 * Owner-aware adapter for the Scene "Change Clothes" EXPLICIT manual selection.
 *
 * The Scene modal must NOT know field names. It asks this adapter for the owner's
 * normalized closet, the currently-active outfit id, an apply-outfit mutation, and
 * a canonical active-outfit resolver — each routed through the ESTABLISHED authority
 * for that owner kind.
 *
 * EXPLICIT SCENE OUTFIT:
 *   The Scene Change Clothes action writes `scene_explicit_outfit` (a location-scoped
 *   explicit outfit reference) on the owner record. The backend resolvers
 *   (resolveUserOutfitContext / resolveCharacterOutfitContext) honor this field
 *   ABOVE all automatic logic (uniform, special occasion, rotation, category
 *   fallback) for the matching location only. This lets the user manually wear ANY
 *   complete stored outfit regardless of its category.
 *
 *   This pathway does NOT touch today_category_outfit_overrides, manual_category_selections,
 *   current_outfit, or the closet — so the Profile closet's automatic category behavior
 *   remains fully intact. When scene_explicit_outfit is absent or its location_id does not
 *   match the request location, the automatic wardrobe system selects normally.
 *
 * Supported owner kinds:
 *   - user      → UserSettings
 *   - character → Character entity (ALL persistent types: active_created_character,
 *                 npc_fictitious, npc_family_member, etc. — they share the same closet fields)
 *
 * TIMEZONE: set_at uses ISO (UTC infrastructure metadata). Date comparisons in the
 * resolvers use America/New_York (Eastern Time). UTC is never an application time reference.
 */
import { base44 } from '@/api/base44Client';
import {
  getTodayUserOverrides,
  getTodayCharacterOverrides,
} from './activeOutfitResolver';

// ── CANONICAL OUTFIT TEXT (mirrors backend buildOutfitText) ──────────────────
export function buildOutfitCanonicalText(outfit) {
  if (!outfit) return null;
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
    .filter(Boolean)
    .map((p) => {
      const t = String(p).trim();
      if (!t) return null;
      if (/^(n\/?a|none|-)$/i.test(t)) return null;
      if (/^(shirtless|no top|no shirt)$/i.test(t)) return 'No shirt / bare torso';
      return t;
    })
    .filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  const fd = (outfit.full_description || '').trim();
  if (fd && !/\b(cinematic|chiaroscuro|dramatic lighting|editorial photography|fine art|low-key lighting|sculptural anatomy|artistic composition|museum.quality|photorealistic|ultra.detailed|high.resolution|bokeh|dramatic shadow|noir atmosphere|hyper.realistic|studio lighting|professional photography|stock photo)\b/i.test(fd)) {
    return fd;
  }
  return (outfit.label || '').trim() || null;
}

function normalizeClosetItems(rawCloset) {
  return (rawCloset || [])
    .filter((o) => o && o.outfit_id && (o.type === 'outfit' || (!o.piece_id?.startsWith('piece_') && o.outfit_id)));
}

// ── ACTIVE OUTFIT ID (for "Wearing" highlight in the modal) ──────────────────
// Priority: explicit scene outfit (matching this location) > category-based active id.
// Matches when the stored location_id equals the request locationId, including
// when both are null/absent (scene with no specific location). Never category-based.
function deriveActiveOutfitId(kind, record, locationId) {
  const explicit = record?.scene_explicit_outfit;
  if (explicit?.outfit_id && (explicit.location_id || null) === (locationId || null)) {
    return explicit.outfit_id;
  }
  if (kind === 'user') {
    const rotationEnabled = record?.user_outfit_rotation_enabled === true;
    if (rotationEnabled) {
      const ov = getTodayUserOverrides(record);
      const ids = Object.values(ov || {});
      return ids.length ? ids[ids.length - 1] : null;
    }
    const manual = record?.user_manual_category_selections || {};
    const ids = Object.values(manual);
    if (ids.length) return ids[ids.length - 1];
    return record?.user_current_outfit?.outfit_id || null;
  }
  const rotationEnabled = record?.outfit_rotation_enabled !== false;
  if (rotationEnabled) {
    const ov = getTodayCharacterOverrides(record);
    const ids = Object.values(ov || {});
    return ids.length ? ids[ids.length - 1] : null;
  }
  const manual = record?.manual_category_selections || {};
  const ids = Object.values(manual);
  if (ids.length) return ids[ids.length - 1];
  return record?.current_outfit?.outfit_id || null;
}

/**
 * resolveClothingOwner
 * @param {{type:'user'|'character', id?:string}} target
 * @param {{settings?:object, presentCharacters?:object[], locationId?:string}} records
 */
export function resolveClothingOwner(target, records) {
  const { settings, presentCharacters, locationId } = records || {};

  if (target.type === 'user') {
    const closet = normalizeClosetItems(settings?.user_closet);
    return {
      kind: 'user',
      ownerId: settings?.id || null,
      label: 'Me',
      record: settings || null,
      closet,
      activeOutfitId: deriveActiveOutfitId('user', settings, locationId),
      /**
       * Write the EXPLICIT scene outfit for this owner. Does NOT touch category
       * overrides, manual selections, current_outfit, or the closet.
       */
      async applyOverride(outfit, ctx) {
        if (!settings?.id) throw new Error('Your settings are still loading. Try again in a moment.');
        const patch = {
          scene_explicit_outfit: {
            outfit_id: outfit.outfit_id,
            location_id: ctx?.locationId || null,
            set_at: new Date().toISOString(),
          },
        };
        await base44.entities.UserSettings.update(settings.id, patch);
        return patch;
      },
      async resolveActiveOutfit(ctx) {
        const res = await base44.functions.invoke('resolveUserOutfitContext', {
          ownerEmail: ctx.ownerEmail,
          locationCategory: ctx.locationCategory,
          locationId: ctx.locationId,
        });
        return res?.data || res;
      },
    };
  }

  const char = (presentCharacters || []).find((c) => c.id === target.id);
  const closet = normalizeClosetItems(char?.character_closet);
  return {
    kind: 'character',
    ownerId: char?.id || target.id,
    label: char?.display_name || char?.name || 'Character',
    record: char || null,
    avatar: char?.avatar_url || char?.image_avatar_url || null,
    closet,
    activeOutfitId: deriveActiveOutfitId('character', char, locationId),
    async applyOverride(outfit, ctx) {
      if (!char?.id) throw new Error('That character is no longer in the scene.');
      const patch = {
        scene_explicit_outfit: {
          outfit_id: outfit.outfit_id,
          location_id: ctx?.locationId || null,
          set_at: new Date().toISOString(),
        },
      };
      await base44.entities.Character.update(char.id, patch);
      return patch;
    },
    async resolveActiveOutfit(ctx) {
      const res = await base44.functions.invoke('resolveCharacterOutfitContext', {
        characterId: char.id,
        locationCategory: ctx.locationCategory,
        locationId: ctx.locationId,
        ownerEmail: ctx.ownerEmail,
      });
      return res?.data || res;
    },
  };
}

/**
 * verifySelectedOutfitActive
 *
 * Verify the EXACT selected outfit is now the resolved active outfit by outfit_id.
 * Category, source name, and text similarity are NOT sufficient proof — only an
 * exact outfit_id match is accepted. This never blocks on category appropriateness;
 * it only fails on real persistence/ownership errors (outfit deleted, record not found).
 */
export function verifySelectedOutfitActive(resolved, outfit) {
  if (!resolved) return { verified: false, mismatchReason: 'No response from the outfit resolver.' };
  if (resolved.outfit_id && resolved.outfit_id === outfit.outfit_id) {
    return { verified: true, resolved };
  }
  let reason;
  const src = resolved.source || '';
  if (src === 'character_not_found' || src === 'no_settings') {
    reason = 'The owner record could not be read back after the update.';
  } else if (src === 'no_closet') {
    reason = 'The selected outfit was not found in the owner\'s closet after the update. It may have been removed.';
  } else {
    reason = 'The selected outfit could not be confirmed as the active scene outfit. Please try again.';
  }
  return { verified: false, resolved, mismatchReason: reason };
}