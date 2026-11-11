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
      strictCastOnly = false,
      // The exact people the chosen action involves (acting participant + chosen target).
      // When present, they are the cast of the image — the action is never rendered
      // without the person it was aimed at.
      actionFocusIds = null,
      // Ordinary background people of the venue (staff, patrons) — used only where the
      // place is genuinely public. They are never named participants and never replace
      // an established person.
      ambientPopulation = [],
    } = opts;

    if (!location || isGeneratingImage) return;
    setIsGeneratingImage(true);

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const lightingDesc = getLightingDescriptor(hour);

    // ── FINAL PARTICIPANTS — selected by ID from the completed collection ──
    const finalParticipants = selectImageParticipants(actionFocusIds);

    // ── USER APPEARANCE BLOCK ──
    const userAppearanceBlock = userParticipant ? buildAppearanceLockBlock(userParticipant) : '';

    // ── REFERENCE IMAGE ASSEMBLY ──
    // ── ZONE REFERENCE LOCK ──
    // The selected zone's own reference images (Places > Zones & Images) are the visual
    // authority for this scene. Images belonging to OTHER zones are never mixed in —
    // mixing them is what made a zone render as a different room. When a zone has no
    // images of its own, the location's own reference images are used; another zone's
    // room is never substituted.
    const currentZoneForAction = locationZones.find((z) => z.zone_name === activeZone) || locationZones[0];
    const activeZoneImagesForAction = currentZoneForAction?.image_urls || [];
    const envRefs = activeZoneImagesForAction.length > 0
      ? activeZoneImagesForAction.slice(0, 4)
      : (location.image_urls || []).slice(0, 4);
    // Fallback display when generation fails must stay the SAME zone, never a first-zone image.
    const zoneFallbackImage = activeZoneImagesForAction[0] || firstImage;

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

    // ── BACKGROUND POPULATION ──
    // A public venue is populated when characters are in it. The named people stay the
    // only identifiable subjects; ordinary staff and patrons may be visible behind them.
    // Private residences and restricted zones never get this.
    const ambientList = (Array.isArray(ambientPopulation) ? ambientPopulation : []).filter((p) => p && p.name);
    const allowBackgroundExtras = ambientList.length > 0 && !isHomeLocation && !isRestrictedEnv;
    const ambientText = allowBackgroundExtras
      ? ambientList.slice(0, 4).map((p) => (p.role ? `${p.name} (${String(p.role).toLowerCase()})` : p.name)).join(', ')
      : '';
    const namedSubjectsRule = (people) => (people.length > 0
      ? `Only these people are identifiable: ${people.map((c) => c.name).join(', ')} — never duplicated, never replaced by an invented person.`
      : `No named person is the subject of this frame.`);
    const ambientRule = allowBackgroundExtras
      ? ` The venue is populated as it really is right now: ${ambientText}. They are ordinary background people going about their own business — small, softly out of focus, at a natural distance toward the edges of the frame behind the named people. They never stand in the foreground, never occupy the center, never obscure or replace the named people, and are never the subject of the photograph.`
      : '';
    // The real people taking part outrank the place's background population in every
    // prompt, so the frame is never left to choose a generic crowd over the character
    // or characters actually in the scene.
    const focusNames = finalParticipants.filter((p) => p && p.name).map((p) => p.name);
    const primaryFocusRule = focusNames.length > 0
      ? ` PRIMARY SUBJECT (mandatory): ${focusNames.join(' and ')} ${focusNames.length === 1 ? 'is' : 'are'} the subject of this photograph — framed close to medium, in the center of the frame, clearly visible, faces unobscured, in the sharpest focus and the brightest light. No background person outranks ${focusNames.length === 1 ? 'them' : 'them'} in size, position, or focus.`
      : '';

    // If an action triggered this, use the action's specific prompt
    if (actionOverridePrompt) {
      let finalPrompt = actionOverridePrompt;
      const isGlobal = !strictCastOnly && !isHomeLocation && !isRestrictedEnv && location.location_type === "global";

      if (!isGlobal && allowBackgroundExtras) {
        finalPrompt += ` ${namedSubjectsRule(finalParticipants)}${ambientRule}`;
      } else if (!isGlobal) {
        if (finalParticipants.length === 0) {
          finalPrompt += ` CRITICAL: This space is empty. There are absolutely NO people in this image — no humans, no silhouettes, no background figures, no one. Only the room/space itself.`;
        } else {
          finalPrompt += ` CRITICAL: Only these people may appear: ${finalParticipants.map((c) => c.name).join(", ")}. No other people, no strangers, no random background figures under any circumstances.`;
          if (isHomeLocation) {
            finalPrompt += buildResidentialImageConstraint(location, finalParticipants);
          }
        }
      }
      // The people the action involves are the picture, whatever else is in the place.
      finalPrompt += primaryFocusRule;
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
      } catch { setSceneImage(zoneFallbackImage); } finally { setIsGeneratingImage(false); }
      return;
    }

    const zoneSuffix = currentZoneForAction?.zone_name ? ` — ${currentZoneForAction.zone_name}` : "";
    const activeZoneName = currentZoneForAction?.zone_name || "this area";
    const isGlobal = !strictCastOnly && !isHomeLocation && !isRestrictedEnv && location.location_type === "global";
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
      prompt = `${envNote} Scene: ${location.name}${zoneSuffix}.${atmosphereSuffix} ${strictPeopleRule}${primaryFocusRule}${residentialConstraint}${sealedBundles}${buildSleepDescriptor(finalParticipants)} Photorealistic.`;
      try {
        const result = await base44.integrations.Core.GenerateImage({
          prompt: `${identityPrefix}${prompt}`,
          existing_image_urls: refKey.visualRefs.length > 0 ? refKey.visualRefs : undefined
        });
        setSceneImage(result.url);
      } catch {
        setSceneImage(zoneFallbackImage);
      } finally {
        setIsGeneratingImage(false);
      }
      return;
    }

    // ── NON-RESIDENTIAL SCENE ──
    {
      if (isGlobal) {
        const charNames = finalParticipants.map((c) => c.name).join(", ");
        const peopleDesc = charNames
          ? `${charNames} as the clear main subject of the frame${allowBackgroundExtras ? `, with ordinary patrons of this place kept as distant, out-of-focus background` : " among other patrons"}`
          : "with other people around";
        const _diversityDirective = getBackgroundPopulationDiversityDirective();
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${peopleDesc}.${primaryFocusRule}${allowBackgroundExtras ? ambientRule : ''}${userAppearanceBlock}${sealedBundles}${_diversityDirective}${buildSleepDescriptor(finalParticipants)} Photorealistic.`;
      } else if (allowBackgroundExtras) {
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${namedSubjectsRule(finalParticipants)}${primaryFocusRule}${ambientRule}${userAppearanceBlock}${sealedBundles}${getBackgroundPopulationDiversityDirective()}${buildSleepDescriptor(finalParticipants)} Photorealistic.`;
      } else {
        const restrictedPrefix = isRestrictedEnv ? ` This is a restricted/private area (e.g. stockroom, backstage, office, break room).` : '';
        const peopleDesc = (finalParticipants.length > 0 ?
          `Only these specific people are present: ${finalParticipants.map((c) => c.name).join(", ")}. No other people, no strangers, no background figures.` :
          `The space is completely empty — no silhouettes, no background figures, nobody.`) + restrictedPrefix;
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${peopleDesc}${primaryFocusRule}${userAppearanceBlock}${sealedBundles}${buildSleepDescriptor(finalParticipants)} Photorealistic.`;
      }
    }

    try {
      const result = await base44.integrations.Core.GenerateImage({
        prompt: `${identityPrefix}${prompt}`,
        existing_image_urls: refKey.visualRefs.length > 0 ? refKey.visualRefs : undefined
      });
      setSceneImage(result.url);
    } catch {
      setSceneImage(zoneFallbackImage);
    } finally {
      setIsGeneratingImage(false);
    }
  }, [isGeneratingImage]);

  return { sceneImage, setSceneImage, isGeneratingImage, setIsGeneratingImage, generateSceneImage };
}