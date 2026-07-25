/**
 * clothingOwnerAdapter.js
 *
 * Owner-aware adapter for the Scene "Change Clothes" action.
 *
 * The Scene modal must NOT know field names like `user_closet` or `character_closet`.
 * It asks this adapter for: the owner's normalized closet, the currently-active outfit
 * id, an apply-outfit mutation, and a canonical active-outfit resolver — each routed
 * through the ESTABLISHED authority for that owner kind.
 *
 * Supported owner kinds:
 *   - user     → UserSettings (user_closet / user_today_category_outfit_overrides /
 *                user_manual_category_selections / user_outfit_rotation_enabled)
 *   - character→ Character entity (character_closet / today_category_outfit_overrides /
 *                manual_category_selections / outfit_rotation_enabled / current_outfit)
 *
 * ALL persistent character types share the same Character-entity closet fields, so
 * active_created_character, npc_fictitious, npc_family_member, etc. are all supported
 * through the SAME character branch. Only non-persistent scene constructs (venue
 * templates, temp staff, synthesized presence objects) are unsupported — and those
 * never reach this adapter because they are excluded upstream by the eligible list.
 *
 * TIMEZONE: date comparisons use America/New_York (Eastern Time). UTC is forbidden.
 */
import { base44 } from '@/api/base44Client';
import {
  applyUserManualCategoryOverride,
  applyManualCategoryOverride,
  getTodayUserOverrides,
  getTodayCharacterOverrides,
} from './activeOutfitResolver';

// ── CANONICAL OUTFIT TEXT (mirrors backend buildOutfitText) ──────────────────
// Used to verify that the backend resolver actually returned the selected outfit.
// Must match resolveCharacterOutfitContext/resolveUserOutfitContext buildOutfitText.
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
  // Resolver falls back to label when no text is usable.
  return (outfit.label || '').trim() || null;
}

// ── CLOSET NORMALIZATION ─────────────────────────────────────────────────────
// Outfits only — exclude standalone "piece" records (type === 'piece' or piece_id).
function normalizeClosetItems(rawCloset) {
  return (rawCloset || [])
    .filter((o) => o && o.outfit_id && (o.type === 'outfit' || (!o.piece_id?.startsWith('piece_') && o.outfit_id)));
}

// ── ACTIVE OUTFIT ID (for "Wearing" highlight in the modal) ──────────────────
function deriveActiveOutfitId(kind, record, rotationEnabled) {
  if (kind === 'user') {
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
  // character
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
 *
 * Returns the owner adapter for a target. Pure function — no hooks.
 *
 * @param {{type:'user'|'character', id?:string}} target
 * @param {{settings?:object, presentCharacters?:object[]}} records
 * @returns {object} owner adapter
 */
export function resolveClothingOwner(target, records) {
  const { settings, presentCharacters } = records || {};

  if (target.type === 'user') {
    const closet = normalizeClosetItems(settings?.user_closet);
    const rotationEnabled = settings?.user_outfit_rotation_enabled === true;
    return {
      kind: 'user',
      ownerId: settings?.id || null,
      label: 'Me',
      record: settings || null,
      closet,
      rotationEnabled,
      activeOutfitId: deriveActiveOutfitId('user', settings, rotationEnabled),
      async applyOverride(outfit) {
        if (!settings?.id) throw new Error('Your settings are still loading. Try again in a moment.');
        const patch = applyUserManualCategoryOverride(settings, outfit.category, outfit.outfit_id);
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

  // character
  const char = (presentCharacters || []).find((c) => c.id === target.id);
  const closet = normalizeClosetItems(char?.character_closet);
  const rotationEnabled = char?.outfit_rotation_enabled !== false;
  return {
    kind: 'character',
    ownerId: char?.id || target.id,
    label: char?.display_name || char?.name || 'Character',
    record: char || null,
    avatar: char?.avatar_url || char?.image_avatar_url || null,
    closet,
    rotationEnabled,
    activeOutfitId: deriveActiveOutfitId('character', char, rotationEnabled),
    async applyOverride(outfit) {
      if (!char?.id) throw new Error('That character is no longer in the scene.');
      const patch = applyManualCategoryOverride(char, outfit.category, outfit.outfit_id);
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
 * After writing the override, confirm the canonical resolver now returns the
 * selected outfit. Uses source + category (the resolver returns the winning
 * override's category) and falls back to canonical-text comparison.
 *
 * Returns { verified: boolean, resolved: object, mismatchReason: string|null }.
 */
export function verifySelectedOutfitActive(resolved, outfit) {
  if (!resolved) return { verified: false, mismatchReason: 'No response from the outfit resolver.' };
  const src = resolved.source || '';
  // The override must have been the winning source.
  const overrideWon =
    src === 'today_category_override' ||
    src === 'rotation_off_manual_category';
  if (overrideWon && resolved.category === outfit.category) {
    return { verified: true, resolved };
  }
  // Secondary: canonical text match (handles resolvers that re-label sources).
  const selectedText = buildOutfitCanonicalText(outfit);
  const resolvedText = (resolved.text || '').trim();
  if (selectedText && resolvedText && selectedText.toLowerCase() === resolvedText.toLowerCase()) {
    return { verified: true, resolved };
  }
  // Not verified — explain why.
  const winningCat = resolved.category || 'unknown category';
  const selectedCat = outfit.category || 'unknown';
  let reason;
  if (src === 'uniform') {
    reason = 'A required uniform applies at this location and overrides clothing selections.';
  } else if (src === 'today_category_override' || src === 'rotation_off_manual_category') {
    reason = 'Another outfit selection (' + winningCat + ') takes priority for this scene. The selected ' + selectedCat + ' outfit will not be visible here.';
  } else if (src === 'closet_rotation' || src === 'rotation_off_current_outfit') {
    reason = 'This scene calls for a different outfit category than ' + selectedCat + '. The selected outfit will not be visible here. Try an outfit whose category matches this location.';
  } else if (src === 'no_closet' || src === 'no_settings' || src === 'character_not_found') {
    reason = 'The owner record could not be read back after the update.';
  } else {
    reason = 'The selected outfit could not be confirmed as active (resolver source: ' + (src || 'unknown') + ').';
  }
  return { verified: false, resolved, mismatchReason: reason };
}