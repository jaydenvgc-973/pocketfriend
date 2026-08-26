import { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { buildSealedSubjectBundles } from "@/lib/sceneSubjectBundle";
import {
  buildSceneNameReferenceKey,
  buildSceneParticipantReferenceKey,
  FICTIONAL_CHARACTER_DECLARATION,
  CAUCASIAN_DEFAULT_PROHIBITION,
} from "@/lib/sceneIdentityAuthority";
import { prioritizeAvatarReferences } from "@/lib/characterIdentityLock";
import { buildResidentialImageConstraint } from "@/lib/residentialSceneFiltering";
import { buildAppearanceLockBlock } from "@/lib/appearanceLockValidator";
import { getBackgroundPopulationDiversityDirective } from "@/lib/imageDiversityConstraints";
import { getLightingDescriptor, buildZoneLockEnvNote, buildActionEnvNote, resolveExistingObjectCueForZone } from "@/lib/sceneImagePromptBuilder";
import { isCharacterAsleep } from "@/lib/sleepUtils";

/**
 * useSceneImageGenerator
 *
 * Encapsulates the Scene page image generation logic, extracted from Scene.jsx
 * for maintainability. Uses the SAME identity authority chain as
 * regenerateImageWithReason (the stronger identity path):
 *
 *   Scene participant ID → avatar (primary) + additional reference images (supplements)
 *   + Appearance Lock reinforcement → participant binding → Closet → composition
 *
 * Identity authority:
 *   - avatar_url / image_avatar_url is the PRIMARY visual identity image — always
 *     included when present. The avatar is the main established image of the person;
 *     it is NOT a fallback and is NOT displaced by additional references.
 *   - reference_image_urls SUPPLEMENT the avatar (up to 2) — additional angles / detail
 *     that strengthen identity coverage alongside the avatar.
 *   - The sealed subject bundle adds FACE-ONLY EXTRACTION instructions so the model
 *     uses the avatar for identity while ignoring its background/pose/clothing/props.
 *   - Name Reference Key mapping each prompt name → Character ID / User ID.
 *   - Fictional character declaration + Caucasian-default prohibition.
 *   - Sealed subject bundles with Appearance Lock reinforcement + identity preservation
 *     directive (72–100% resemblance across natural variation in angle/expression/pose/
 *     lighting — NOT face cut-and-paste).
 *
 * Initial generation, Refresh, and action-triggered generation all use this same
 * function — they all derive their cast from the exact Scene participant IDs.
 */
export function useSceneImageGenerator() {
  const [sceneImage, setSceneImage] = useState(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const generateSceneImage = useCallback(async (opts) => {
    const {
      location,
      locationZones,
      activeZone,
      sceneParticipants,
      userParticipant,
      isHomeLocation,
      isRestrictedEnv,
      firstImage,
      selectImageParticipants,
      characters,
      locationMap,
      actionOverridePrompt = null,
    } = opts;

    if (!location || isGeneratingImage) return;
    setIsGeneratingImage(true);

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const lightingDesc = getLightingDescriptor(hour);

    // ── FINAL PARTICIPANTS — selected by ID from the completed collection ──
    const finalParticipants = selectImageParticipants();

    // ── USER APPEARANCE BLOCK ──
    const userAppearanceBlock = userParticipant ? buildAppearanceLockBlock(userParticipant) : '';

    // ── REFERENCE IMAGE ASSEMBLY ──
    const currentZoneForAction = locationZones.find((z) => z.zone_name === activeZone) || locationZones[0];
    const allZoneImagesFlat = locationZones.flatMap((z) => z.image_urls || []);
    const activeZoneImagesForAction = currentZoneForAction?.image_urls || [];
    const envRefs = activeZoneImagesForAction.length > 0 ?
      [...activeZoneImagesForAction, ...allZoneImagesFlat.filter((u) => !activeZoneImagesForAction.includes(u))].slice(0, 4) :
      allZoneImagesFlat.length > 0 ?
      allZoneImagesFlat.slice(0, 4) :
      firstImage ? [firstImage] : [];

    // ── REFERENCE KEY — avatar primary, reference images supplement ──
    // The avatar is the primary visual identity image (always included when present).
    // Additional reference_image_urls supplement it (up to 2) with more angles/detail.
    // The sealed subject bundle adds face-only extraction instructions so the avatar
    // is used for identity while its background/pose/clothing/props are ignored.
    const refKey = buildSceneParticipantReferenceKey(finalParticipants, envRefs);
    const sealedBundles = buildSealedSubjectBundles(finalParticipants, refKey, location);

    // ── NAME REFERENCE KEY — maps each prompt name → Character ID / User ID ──
    // This is the proven identity-binding mechanism from regenerateImageWithReason.
    const nameRefKey = buildSceneNameReferenceKey(finalParticipants);

    const authoratativeEnvRefs = prioritizeAvatarReferences(finalParticipants, envRefs);

    // ── SLEEP/REST STATE DESCRIPTOR ──
    const buildSleepDescriptor = (people) => {
      const asleep = [];
      const napping = [];
      const passedOut = [];
      for (const p of people || []) {
        if (!p || p.isUser) continue;
        const rec = characters.find((c) => c.id === p.id);
        if (!rec) continue;
        const status = rec.resolved_presence_status;
        if (status === 'passed_out') passedOut.push(p.name);
        else if (status === 'napping') napping.push(p.name);
        else if (status === 'sleeping' || isCharacterAsleep(rec, locationMap)) asleep.push(p.name);
      }
      const parts = [];
      if (asleep.length) parts.push(`${asleep.join(', ')} ${asleep.length === 1 ? 'is' : 'are'} asleep — depict sleeping with eyes closed, in bed or wherever they fell asleep, NOT awake, NOT active, NOT talking`);
      if (napping.length) parts.push(`${napping.join(', ')} ${napping.length === 1 ? 'is' : 'are'} napping — drowsy, eyes closed, resting`);
      if (passedOut.length) parts.push(`${passedOut.join(', ')} ${passedOut.length === 1 ? 'is' : 'are'} passed out unconscious from exhaustion — slumped, unresponsive`);
      return parts.length ? ` SLEEP/REST STATE (authoritative — do not contradict): ${parts.join('. ')}.` : '';
    };

    // ── IDENTITY PREFIX — declaration + prohibition + name key ──
    // These are prepended to ALL Scene image prompts (initial, refresh, action).
    const identityPrefix = `${FICTIONAL_CHARACTER_DECLARATION}${CAUCASIAN_DEFAULT_PROHIBITION}${nameRefKey}`;

    // If an action triggered this, use the action's specific prompt
    if (actionOverridePrompt) {
      let finalPrompt = actionOverridePrompt;
      const isGlobal = !isHomeLocation && !isRestrictedEnv && location.location_type === "global";

      if (!isGlobal) {
        if (finalParticipants.length === 0) {
          finalPrompt += ` CRITICAL: This space is empty. There are absolutely NO people in this image — no humans, no silhouettes, no background figures, no one. Only the room/space itself.`;
        } else {
          finalPrompt += ` CRITICAL: Only these people may appear: ${finalParticipants.map((c) => c.name).join(", ")}. No other people, no strangers, no random background figures under any circumstances.`;
          if (isHomeLocation) {
            finalPrompt += buildResidentialImageConstraint(location, finalParticipants);
          }
        }
      }
      if (envRefs.length > 0) {
        finalPrompt += ` ` + buildActionEnvNote(currentZoneForAction?.zone_name || "this area", true, lightingDesc);
      }
      finalPrompt += buildSleepDescriptor(finalParticipants);
      finalPrompt += sealedBundles;
      try {
        const result = await base44.integrations.Core.GenerateImage({
          prompt: `${identityPrefix}${finalPrompt} Photorealistic, high quality, authentic.`,
          existing_image_urls: refKey.visualRefs.length > 0 ? refKey.visualRefs : undefined
        });
        setSceneImage(result.url);
      } catch { setSceneImage(firstImage); } finally { setIsGeneratingImage(false); }
      return;
    }

    const zoneSuffix = currentZoneForAction?.zone_name ? ` — ${currentZoneForAction.zone_name}` : "";
    const activeZoneName = currentZoneForAction?.zone_name || "this area";
    const isGlobal = !isHomeLocation && !isRestrictedEnv && location.location_type === "global";
    const existingObjectCue = resolveExistingObjectCueForZone(activeZoneName);
    const envNote = buildZoneLockEnvNote(activeZoneName, authoratativeEnvRefs.length > 0, lightingDesc, existingObjectCue);

    let prompt;
    if (isHomeLocation) {
      const visibleNames = finalParticipants.map((c) => c.name);
      const strictPeopleRule = visibleNames.length > 0 ?
        `STRICT RULE: The ONLY people who may appear are: ${visibleNames.join(", ")}. No other residents, no unselected family members, no NPCs. ONLY those named above.` :
        `STRICT RULE: This space is completely empty — nobody is present. Do not render any people, no silhouettes, no background figures. Empty room only.`;
      const atmosphereSuffix = finalParticipants.length > 0 ?
        " The home is clearly lived-in: warm, fully furnished, decorated with personal belongings." :
        "";
      const residentialConstraint = buildResidentialImageConstraint(location, finalParticipants);
      prompt = `${envNote} Scene: ${location.name}${zoneSuffix}.${atmosphereSuffix} ${strictPeopleRule}${residentialConstraint}${sealedBundles}${buildSleepDescriptor(finalParticipants)} Photorealistic.`;
      try {
        const result = await base44.integrations.Core.GenerateImage({
          prompt: `${identityPrefix}${prompt}`,
          existing_image_urls: refKey.visualRefs.length > 0 ? refKey.visualRefs : undefined
        });
        setSceneImage(result.url);
      } catch {
        setSceneImage(firstImage);
      } finally {
        setIsGeneratingImage(false);
      }
      return;
    }

    // ── NON-RESIDENTIAL SCENE ──
    {
      if (isGlobal) {
        const charNames = finalParticipants.map((c) => c.name).join(", ");
        const peopleDesc = charNames ? `with ${charNames} among other patrons` : "with other people around";
        const _diversityDirective = getBackgroundPopulationDiversityDirective();
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${peopleDesc}.${userAppearanceBlock}${sealedBundles}${_diversityDirective}${buildSleepDescriptor(finalParticipants)} Photorealistic.`;
      } else {
        const restrictedPrefix = isRestrictedEnv ? ` This is a restricted/private area (e.g. stockroom, backstage, office, break room).` : '';
        const peopleDesc = (finalParticipants.length > 0 ?
          `Only these specific people are present: ${finalParticipants.map((c) => c.name).join(", ")}. No other people, no strangers, no background figures.` :
          `The space is completely empty — no silhouettes, no background figures, nobody.`) + restrictedPrefix;
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${peopleDesc}${userAppearanceBlock}${sealedBundles}${buildSleepDescriptor(finalParticipants)} Photorealistic.`;
      }
    }

    try {
      const result = await base44.integrations.Core.GenerateImage({
        prompt: `${identityPrefix}${prompt}`,
        existing_image_urls: refKey.visualRefs.length > 0 ? refKey.visualRefs : undefined
      });
      setSceneImage(result.url);
    } catch {
      setSceneImage(firstImage);
    } finally {
      setIsGeneratingImage(false);
    }
  }, [isGeneratingImage]);

  return { sceneImage, setSceneImage, isGeneratingImage, setIsGeneratingImage, generateSceneImage };
}