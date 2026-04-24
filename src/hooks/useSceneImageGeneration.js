import { useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { enforceZoneLock, buildAvatarIdentityBlock } from '@/lib/sceneImageGenerator';
import { prioritizeAvatarReferences } from '@/lib/characterIdentityLock';
import { isResidentialLocation, resolveSceneImagePeople, buildResidentialImageConstraint } from '@/lib/residentialSceneFiltering';
import { buildIdentityLockBlock } from '@/lib/characterIdentityLock';

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

        const strictPeopleRule = visibleNames.length > 0
          ? `STRICT RULE: The ONLY people who may appear are: ${visibleNames.join(", ")}. No other people, no strangers, no background figures.`
          : `STRICT RULE: This space is completely empty — no people, no silhouettes, only the room.`;

        const atmosphereSuffix = (location.resident_family_members?.length > 0 || characters.some(c => c.current_home_location_id === location.id))
          ? " The home is clearly lived-in: warm, fully furnished, decorated with personal belongings."
          : "";

        prompt = `${envNote} Scene: ${location.name}${zoneSuffix}, ${timeOfDay} lighting.${atmosphereSuffix} ${strictPeopleRule}${residentialConstraint}${identityLockBlock}${avatarRefInstructions}. Photorealistic.`;
      } else {
        // ── NON-RESIDENTIAL SCENE ────────────────────────────────────────────
        const isGlobal = location.location_type === "global";

        if (isGlobal) {
          const charNames = resolvedWhosHereList.slice(0, 3).map(c => c.name).join(", ");
          const peopleDesc = charNames ? `with ${charNames} among other patrons` : "with other people around";
          const charIdentityLocks = buildIdentityLockBlock(resolvedWhosHereList.slice(0, 3), currentUser);
          const avatarRefInstructions = buildAvatarIdentityBlock(resolvedWhosHereList);
          prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting, ${timeOfDay} lighting. ${peopleDesc}.${charIdentityLocks}${avatarRefInstructions}. Photorealistic.`;
        } else {
          const physicallyPresent = resolvedWhosHereList.slice(0, 3);
          const peopleDesc = physicallyPresent.length > 0
            ? `Only these specific people are present: ${physicallyPresent.map(c => c.name).join(", ")}. No other people, no strangers, no background figures.`
            : `The space is completely empty — no silhouettes, no background figures, nobody.`;

          const charIdentityLocks = buildIdentityLockBlock(physicallyPresent, currentUser);
          const avatarRefInstructions = buildAvatarIdentityBlock(physicallyPresent);
          prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting, ${timeOfDay} lighting. ${peopleDesc}${charIdentityLocks}${avatarRefInstructions}. Photorealistic.`;
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