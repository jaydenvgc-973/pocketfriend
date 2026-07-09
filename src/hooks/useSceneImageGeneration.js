import { useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { enforceZoneLock, buildAvatarIdentityBlock } from '@/lib/sceneImageGenerator';
import { prioritizeAvatarReferences } from '@/lib/characterIdentityLock';
import { isResidentialLocation, resolveSceneImagePeople, buildResidentialImageConstraint } from '@/lib/residentialSceneFiltering';
import { buildIdentityLockBlock } from '@/lib/characterIdentityLock';
import { resolveCurrentOutfit, buildOutfitPromptText } from '@/lib/outfitRotationEngine';
import { getBackgroundPopulationDiversityDirective } from '@/lib/imageDiversityConstraints';

/**
 * Normalize outfit field values — mirrors the exact logic in generateImageAsync/regenerateImageWithReason.
 * Converts bare-torso aliases to the canonical model-safe string.
 * Strips N/A placeholders.
 */
function normalizeOutfitField(val) {
  if (!val) return null;
  const t = val.trim();
  if (/^(n\/?a|none|-)$/i.test(t)) return null;
  const s = t.replace(/^n\/?a[,\-–]\s*/i, '').trim();
  if (/^(shirtless|no top|no shirt)$/i.test(s)) return 'No shirt / bare torso';
  return s || null;
}

/**
 * Build canonical outfit text from an outfit object.
 * Identical normalization logic to generateImageAsync's buildOutfitText.
 */
function buildCanonicalOutfitText(outfit) {
  if (!outfit) return null;
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
    .map(normalizeOutfitField)
    .filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  if (outfit.full_description) {
    return outfit.full_description
      .replace(/^in [^,.]+(,|\.) ?/i, '')
      .replace(/^a (man|woman|person)[^,.]*(,|\.) ?/i, '')
      .trim() || outfit.full_description;
  }
  return null;
}

/**
 * Resolve the canonical outfit text for a person.
 * Priority: current_outfit (explicit selection) → closet rotation → null.
 */
function resolveOutfitText(person, locationCategory = null) {
  if (!person) return null;

  // For user: current_outfit or selected_outfit wins
  if (person._isUser) {
    const outfit = person.current_outfit || person.selected_outfit || null;
    return buildCanonicalOutfitText(outfit);
  }

  // For characters: current_outfit ALWAYS wins (canonical law)
  const current = person.current_outfit;
  if (current?.outfit_id || current?.label) {
    const text = buildCanonicalOutfitText(current);
    if (text) return text;
  }

  // Fall back to rotation engine if no current_outfit
  const outfit = resolveCurrentOutfit(person, '', locationCategory);
  return buildCanonicalOutfitText(outfit);
}

/**
 * Build the CLOSET OUTFIT LOCK block — identical structure to generateImageAsync.
 * This is the terminal enforcement block injected at end of prompt.
 */
function buildOutfitEnforcementBlock(people, locationCategory = null) {
  const resolved = [];
  for (const person of people) {
    const name = person.name || person.full_name || 'Person';
    const outfitText = resolveOutfitText(person, locationCategory);
    if (outfitText) resolved.push({ name, outfitText });
  }
  if (resolved.length === 0) return '';

  const lines = [
    '',
    '🔒 CLOSET OUTFIT LOCK — CANONICAL LAW. OVERRIDES ALL SCENE STYLING.',
    '════════════════════════════════════════════════════════════',
  ];
  for (const { name, outfitText } of resolved) {
    const hasBottoms = /sweatpants|pants|jeans|shorts|joggers|leggings|trousers/i.test(outfitText);
    const hasShoes = /sneakers|shoes|boots|sandals|loafers|heels/i.test(outfitText);
    const isBareTorso = /no shirt \/ bare torso/i.test(outfitText);
    lines.push(`${name} OUTFIT — RENDER EXACTLY:`);
    outfitText.split(',').map(s => s.trim()).filter(Boolean).forEach(item => lines.push(`  • ${item}`));
    lines.push('NON-NEGOTIABLE:');
    if (isBareTorso) {
      lines.push('⛔ BARE TORSO — NO shirt, tank top, hoodie, jacket, robe, or any upper-body clothing.');
      lines.push('✅ Torso must be completely bare and clearly visible.');
    }
    if (hasBottoms) lines.push('✅ BOTTOMS VISIBLE — frame mid-thigh or lower to show full pants/shorts.');
    if (hasShoes) lines.push('✅ SHOES VISIBLE — full-body or 3/4-body framing required. Do not crop feet.');
    lines.push('⛔ Do NOT add or invent any clothing item not listed above.');
    lines.push('');
  }
  lines.push('════════════════════════════════════════════════════════════');
  lines.push('FAIL: shirt on bare torso | wrong bottoms | shoes cropped | invented outfit');
  return lines.join('\n');
}

/**
 * Hook for managing scene image generation with strict zone-lock and identity enforcement.
 */
export function useSceneImageGeneration(location, locationZones, currentUser, displayName, settings) {
  const [sceneImage, setSceneImage] = useState(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const generateSceneImage = useCallback(async (activeZone, resolvedWhosHereList, characters, actionOverridePrompt = null) => {
    if (!location || isGeneratingImage) return;
    setIsGeneratingImage(true);

    try {
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hour = nowET.getHours();
      const timeOfDay = hour < 6 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";

      // ── STRICT ZONE-LOCK ──────────────────────────────────────────────────
      const currentZoneForAction = locationZones.find(z => z.zone_name === activeZone) || locationZones[0];
      const activeZoneName = activeZone || currentZoneForAction?.zone_name || 'Main';
      const activeZoneImagesForAction = currentZoneForAction?.image_urls || [];

      // ZONE-LOCK: Only use images from the currently selected zone, NO fallback
      const zoneLockedImages = enforceZoneLock(
        activeZoneImagesForAction,
        activeZoneImagesForAction,
        activeZoneName
      );

      // Cap at 4 reference images, NO cross-zone fallback
      const envRefs = zoneLockedImages.length > 0 ? zoneLockedImages.slice(0, 4) : [];

      // Prioritize avatars before environment images (zone-locked)
      const authoratativeEnvRefs = prioritizeAvatarReferences(resolvedWhosHereList, envRefs);

      const zoneSuffix = activeZoneName ? ` — ${activeZoneName}` : "";
      const envNote = authoratativeEnvRefs.length > 0
        ? `CRITICAL ENVIRONMENT RULE: The reference images are the AUTHORITATIVE source for this location's environment. Reproduce the EXACT room shown — same layout, furniture, wall colors, lighting, and architecture. Do NOT invent a new room. Characters exist INSIDE this environment; they do NOT define it.`
        : "";

      let prompt;

      const locationCategory = location.category || null;

      // Tag currentUser so outfit resolver knows it's a user (not a character)
      const taggedUser = currentUser ? { ...currentUser, _isUser: true } : null;

      if (isResidentialLocation(location)) {
        // ── RESIDENTIAL SCENE ──────────────────────────────────────────────
        const validResidentialPeople = resolveSceneImagePeople(
          location,
          resolvedWhosHereList,
          currentUser,
          true
        );

        const visibleNames = validResidentialPeople.slice(0, 3).map(c => c.name);
        const residentialConstraint = buildResidentialImageConstraint(location, validResidentialPeople);
        const identityLockBlock = buildIdentityLockBlock(validResidentialPeople, currentUser);
        const avatarRefInstructions = buildAvatarIdentityBlock(validResidentialPeople);
        const outfitBlock = buildOutfitEnforcementBlock(
          [...validResidentialPeople.slice(0, 3), ...(taggedUser ? [taggedUser] : [])],
          locationCategory
        );

        const strictPeopleRule = visibleNames.length > 0
          ? `STRICT RULE: The ONLY people who may appear are: ${visibleNames.join(", ")}. No other people, no strangers, no background figures.`
          : `STRICT RULE: This space is completely empty — no people, no silhouettes, only the room.`;

        const atmosphereSuffix = (location.resident_family_members?.length > 0 || characters.some(c => c.current_home_location_id === location.id))
          ? " The home is clearly lived-in: warm, fully furnished, decorated with personal belongings."
          : "";

        prompt = `${envNote} Scene: ${location.name}${zoneSuffix}, ${timeOfDay} lighting.${atmosphereSuffix} ${strictPeopleRule}${residentialConstraint}${identityLockBlock}${avatarRefInstructions}${outfitBlock}. Photorealistic.`;
      } else {
        // ── NON-RESIDENTIAL SCENE ────────────────────────────────────────────
        const isGlobal = location.location_type === "global";

        if (isGlobal) {
          const visiblePeople = resolvedWhosHereList.slice(0, 3);
          const charNames = visiblePeople.map(c => c.name).join(", ");
          const peopleDesc = charNames ? `with ${charNames} among other patrons` : "with other people around";
          const charIdentityLocks = buildIdentityLockBlock(visiblePeople, currentUser);
          const avatarRefInstructions = buildAvatarIdentityBlock(visiblePeople);
          const outfitBlock = buildOutfitEnforcementBlock(
            [...visiblePeople, ...(taggedUser ? [taggedUser] : [])],
            locationCategory
          );
          const diversityDirective = getBackgroundPopulationDiversityDirective();
          prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting, ${timeOfDay} lighting. ${peopleDesc}.${charIdentityLocks}${avatarRefInstructions}${outfitBlock}.${diversityDirective} Photorealistic.`;
        } else {
          const physicallyPresent = resolvedWhosHereList.slice(0, 3);
          const peopleDesc = physicallyPresent.length > 0
            ? `Only these specific people are present: ${physicallyPresent.map(c => c.name).join(", ")}. No other people, no strangers, no background figures.`
            : `The space is completely empty — no silhouettes, no background figures, nobody.`;

          const charIdentityLocks = buildIdentityLockBlock(physicallyPresent, currentUser);
          const avatarRefInstructions = buildAvatarIdentityBlock(physicallyPresent);
          const outfitBlock = buildOutfitEnforcementBlock(
            [...physicallyPresent, ...(taggedUser ? [taggedUser] : [])],
            locationCategory
          );
          prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting, ${timeOfDay} lighting. ${peopleDesc}${charIdentityLocks}${avatarRefInstructions}${outfitBlock}. Photorealistic.`;
        }
      }

      const result = await base44.integrations.Core.GenerateImage({
        prompt,
        existing_image_urls: authoratativeEnvRefs.length > 0 ? authoratativeEnvRefs : undefined,
      });

      setSceneImage(result.url);
    } catch {
      setSceneImage(null);
    } finally {
      setIsGeneratingImage(false);
    }
  }, [location, locationZones, currentUser, displayName, isGeneratingImage]);

  return {
    sceneImage,
    setSceneImage,
    isGeneratingImage,
    generateSceneImage,
  };
}