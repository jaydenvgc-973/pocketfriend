import { useState, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { buildSealedSubjectBundles } from "@/lib/sceneSubjectBundle";
import { deriveScenePhysicalState, buildPhysicalContinuityBlock } from "@/lib/scenePhysicalState";
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
import { getEasternLightingDescriptor, buildZoneLockEnvNote, buildActionEnvNote, buildFacilityEnvNote, buildTimeOfDayLock, resolveExistingObjectCueForZone } from "@/lib/sceneImagePromptBuilder";
import { isCharacterAsleep } from "@/lib/sleepUtils";
import { dedupeSceneCast } from "@/lib/sceneCastUniqueness";
import { buildJailAttireBlock } from "@/lib/jailSceneRules";
import { buildShowerStateRule } from "@/lib/sceneActionConfig";
import { isPrivateResidentialZone } from "@/lib/sceneBackgroundPopulation";
import { resolveSceneZone } from "@/lib/sceneSpaceZone";

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
export function useSceneImageGenerator({ transcript = [] } = {}) {
  const [sceneImage, setSceneImage] = useState(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  // The scene's transcript exactly as it stands now. Read when a picture is generated, so
  // every path — first image, refresh, activity, ride, photo — sees the same established
  // state, and a picture request never becomes a clothing-change event.
  const transcriptRef = useRef([]);
  transcriptRef.current = transcript;
  // Every request takes a ticket. Only the newest ticket may put its picture on screen, so a
  // picture already being drawn can never become the image of a space or cast the user has
  // since left — it is simply discarded when it arrives.
  const requestTicketRef = useRef(0);

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
      // The action being depicted is a shower: everyone under the water is unclothed,
      // and no uniform or clothing is drawn onto them.
      showerState = false,
      // Extra reference images for this one picture — the merchandise being tried on.
      // They are supplied alongside the people's own references; the prompt says what
      // they are, and no identity is ever taken from them.
      extraReferenceImages = [],
      // The environment for this one picture, when it is not the selected place — the inside
      // of a car during a ride. These exact references replace the zone/room references, so
      // no image of a room can be mixed into a picture taken inside a vehicle.
      environmentRefsOverride = null,
      // The sentence that stands in for the zone/room note. When present, the picture is
      // never told to preserve a room's layout.
      environmentNote = null,
      // The final word of the prompt, after the identity bundles — used to keep one
      // continuous ride (same seats, clothes, hour) across pictures.
      postPromptLock = null,
      // A picture that fails is never replaced by a place's fallback image: the picture
      // already on screen stays.
      keepImageOnFailure = false,
      // How many of each person's own reference images may be used. A ride spends the
      // budget on the vehicle's views, so each occupant keeps their avatar only.
      maxRefsPerPerson = 2,
      // A picture that must land now (the car when a ride begins) is never skipped because
      // another picture is still being drawn. The newest ticket wins, so the older picture
      // is discarded instead of replacing this one.
      supersede = false,
    } = opts;

    if (!location || (isGeneratingImage && !supersede)) return;
    // This request's ticket: anything it produces is only shown while it is still the newest.
    const ticket = ++requestTicketRef.current;
    const isCurrent = () => ticket === requestTicketRef.current;
    const commit = (url) => { if (isCurrent()) setSceneImage(url); };
    setIsGeneratingImage(true);

    const lightingDesc = getEasternLightingDescriptor();
    // The hour is stated on every path, and it is fixed for the whole continuous scene.
    const timeLock = buildTimeOfDayLock(lightingDesc);

    // ── FINAL PARTICIPANTS — selected by ID from the completed collection ──
    // Exactly one subject per person: the same individual reaching the cast twice (their own
    // record plus a placeholder, or a duplicate caregiver record) is collapsed here, so the
    // prompt can never ask for two of them — and a role is never part of a prompt name.
    const finalParticipants = dedupeSceneCast(selectImageParticipants(actionFocusIds));

    // ── USER APPEARANCE BLOCK ──
    const userAppearanceBlock = userParticipant ? buildAppearanceLockBlock(userParticipant) : '';

    // ── REFERENCE IMAGE ASSEMBLY ──
    // ── ZONE REFERENCE LOCK ──
    // The selected zone's own reference images (Places > Zones & Images) are the visual
    // authority for this scene. Images belonging to OTHER zones are never mixed in —
    // mixing them is what made a zone render as a different room. When a zone has no
    // images of its own, the location's own reference images are used; another zone's
    // room is never substituted.
    // A zone the user explicitly marked as Part of Main Category (Places > Zones & Images)
    // is the main-category space of this location, so it is preferred over an arbitrary
    // first zone when the active zone is not one of them. Nothing is reclassified: an
    // unchecked zone simply keeps the existing behavior.
    //
    // A property organized into private spaces (apartments, studios, dorm rooms, patient
    // rooms, cells, the businesses inside it) is never rendered as one of those rooms
    // unless that exact space was chosen. Resolving the zone here means every path — the
    // first image, a refresh, an activity, a transition — obeys the same rule.
    const sceneZoneName = resolveSceneZone(location, activeZone);
    const currentZoneForAction = locationZones.find((z) => z.zone_name === sceneZoneName) || null;
    const activeZoneImagesForAction = currentZoneForAction?.image_urls || [];
    // A picture taken somewhere other than the selected place — inside a car during a ride —
    // is composed from that environment's own references only. The selected zone's room
    // images are never supplied beside them, which is what put a living room into a car.
    const zoneEnvRefs = environmentRefsOverride
      ? (Array.isArray(environmentRefsOverride) ? environmentRefsOverride : []).filter((u) => typeof u === "string" && u.trim().length > 0).slice(0, 4)
      : activeZoneImagesForAction.length > 0
        ? activeZoneImagesForAction.slice(0, 4)
        : (location.image_urls || []).slice(0, 4);
    // Merchandise being tried on is a reference for the item, not a person: it is placed
    // with the environment references, never among anyone's identity images.
    const itemRefs = (Array.isArray(extraReferenceImages) ? extraReferenceImages : [])
      .filter((u) => typeof u === "string" && u.trim().length > 0);
    const envRefs = [...itemRefs, ...zoneEnvRefs];
    // Fallback display when generation fails must stay the SAME zone, never a first-zone image.
    const zoneFallbackImage = activeZoneImagesForAction[0] || firstImage;

    // ── REFERENCE KEY — avatar primary, reference images supplement ──
    // The avatar is the primary visual identity image (always included when present).
    // Additional reference_image_urls supplement it (up to 2) with more angles/detail.
    // The sealed subject bundle adds face-only extraction instructions so the avatar
    // is used for identity while its background/pose/clothing/props are ignored.
    const refKey = buildSceneParticipantReferenceKey(finalParticipants, envRefs, { maxPerPerson: maxRefsPerPerson });
    // What this scene has already established about these people — a shirt already taken
    // off, a jacket already removed — is stated AFTER their outfit locks, so a new picture
    // never dresses them again from the avatar, the saved outfit or an earlier image.
    const physicalState = deriveScenePhysicalState(transcriptRef.current, finalParticipants);
    const sealedBundles = buildSealedSubjectBundles(finalParticipants, refKey, location)
      + buildPhysicalContinuityBlock(physicalState, finalParticipants);

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
    // Prison / jail: the facility's clothing and population rules belong in every image
    // of this place. Empty string at any other location.
    const jailAttireBlock = buildJailAttireBlock(finalParticipants, location, { shower: showerState, zoneName: currentZoneForAction?.zone_name || activeZone || null });

    const identityPrefix = `${FICTIONAL_CHARACTER_DECLARATION}${CAUCASIAN_DEFAULT_PROHIBITION}${nameRefKey}${jailAttireBlock}`;

    // ── BACKGROUND POPULATION ──
    // A public venue is populated when characters are in it. The named people stay the
    // only identifiable subjects; ordinary staff and patrons may be visible behind them.
    // Private residences and restricted zones never get this.
    const ambientList = (Array.isArray(ambientPopulation) ? ambientPopulation : []).filter((p) => p && (p.name || p.role));
    // A private living space of the property — a dorm room, studio apartment or other
    // student residence — is never populated with strangers merely because the school
    // around it has ambient students. The shared school zones are unaffected.
    const privateLivingSpace = isPrivateResidentialZone(location, activeZone);
    // A chosen cast is the whole picture. Background people only fill a venue the user has
    // not selected anyone for: being at the location is not the same as being in the scene.
    const allowBackgroundExtras = ambientList.length > 0 && finalParticipants.length === 0 && !isHomeLocation && !isRestrictedEnv && !privateLivingSpace;
    // ⛔ Background people are NEVER named in the prompt. A name makes them a named subject
    // competing for the supplied reference images — that is how a random student, teacher,
    // or bartender could end up rendered in place of the actual character. They are
    // described only by role, so they can never be taken for a named participant.
    const ambientText = allowBackgroundExtras
      ? ambientList.slice(0, 3).map((p) => (p.role ? String(p.role).toLowerCase() : 'person')).join(', ')
      : '';
    // The real people taking part outrank the place's background population in every
    // prompt, so the frame is never left to choose a generic crowd over the character
    // or characters actually in the scene.
    const focusNames = finalParticipants.filter((p) => p && p.name).map((p) => p.name);
    const namedSubjectsRule = (people) => (people.length > 0
      ? `Only these people are identifiable: ${people.map((c) => c.name).join(', ')} — each one present exactly once, never duplicated, never replaced by an invented or background person.`
      : `No named person is the subject of this frame.`);
    const ambientRule = allowBackgroundExtras
      ? ` The venue is populated as it really is right now by ordinary background people: ${ambientText}. They are anonymous strangers with no name, no identity, and NO reference images — none of the reference images supplied with this request belongs to any of them. They go about their own business, small, softly out of focus, at a natural distance toward the edges of the frame behind the named subjects. They never stand in the foreground, never occupy the center, never obscure, stand in for, or replace a named subject, and are never the subject of the photograph.`
      : '';
    // ── BACKGROUND IDENTITY SEPARATION ──
    // A background person of the venue is a DIFFERENT person with their own face and
    // their own identity. They are never an alias of, a stand-in for, a second version
    // of, or a look-alike for any named participant, and they never take that
    // participant's place. The named participants keep their own reference images.
    const backgroundSeparationRule = (allowBackgroundExtras && focusNames.length > 0)
      ? ` ⛔ BACKGROUND PEOPLE ARE SEPARATE IDENTITIES, NOT THE NAMED PEOPLE: ${focusNames.join(', ')} ${focusNames.length === 1 ? 'is' : 'are'} a specific ${focusNames.length === 1 ? 'person' : 'people'} whose face comes only from ${focusNames.length === 1 ? 'their own reference images' : 'their own reference images'}. The background people are unrelated strangers with different faces — never ${focusNames.join(' or ')}, never a version of ${focusNames.length === 1 ? 'them' : 'them'}, never a look-alike, never ${focusNames.length === 1 ? 'their' : 'their'} replacement. If a background face would be mistaken for ${focusNames.length === 1 ? 'them' : 'any of them'}, that background person is wrong.`
      : '';
    const primaryFocusRule = focusNames.length > 0
      ? ` PRIMARY SUBJECT (mandatory): ${focusNames.join(' and ')} ${focusNames.length === 1 ? 'is' : 'are'} the subject of this photograph. ${focusNames.length === 1 ? 'They are' : 'They are all'} present in the frame — close to medium framing, centered, clearly visible, faces unobscured, in the sharpest focus and the brightest light, rendered from ${focusNames.length === 1 ? 'their' : 'their'} own reference image${focusNames.length === 1 ? '' : 's'} — those references are supplied for ${focusNames.length === 1 ? 'them' : 'them'} alone and may never be given to anyone else in the frame. ⛔ No named participant may be omitted, and none may be exchanged for a background person. No background person outranks them in size, position, sharpness, or focus.${backgroundSeparationRule}`
      : '';

    // If an action triggered this, use the action's specific prompt
    if (actionOverridePrompt) {
      let finalPrompt = actionOverridePrompt;
      // An activity never widens the cast. Whatever the activity is and whatever kind of
      // place this is, the picture holds exactly the selected participants — no coworkers,
      // no residents, no staff, no strangers filling the background.
      if (finalParticipants.length === 0) {
        finalPrompt += ` CRITICAL: This space is empty. There are absolutely NO people in this image — no humans, no silhouettes, no background figures, no one. Only the room/space itself.`;
      } else {
        finalPrompt += ` CRITICAL: Only these people may appear: ${finalParticipants.map((c) => c.name).join(", ")}. No other people, no strangers, no coworkers, no employees, no residents, no background figures under any circumstances.`;
        // A home's residential constraint belongs to a home. Inside a vehicle the picture is
        // composed as a car cabin, never as a furnished living space.
        if (isHomeLocation && !environmentRefsOverride) {
          finalPrompt += buildResidentialImageConstraint(location, finalParticipants);
        }
      }
      // The people the action involves are the picture, whatever else is in the place.
      finalPrompt += primaryFocusRule;
      if (environmentNote) {
        // The environment is stated outright (the car's own cabin) instead of the zone's
        // "preserve this room's layout" note.
        finalPrompt += ` ` + environmentNote;
      } else if (envRefs.length > 0) {
        finalPrompt += ` ` + (currentZoneForAction
          ? buildActionEnvNote(currentZoneForAction.zone_name, true, lightingDesc)
          : buildFacilityEnvNote(location.name, true, lightingDesc));
      }
      // The hour is stated on every activity picture too — the same hour as the scene.
      if (!environmentNote) finalPrompt += timeLock;
      finalPrompt += buildSleepDescriptor(finalParticipants);
      // A shower is never rendered with anyone dressed in it.
      if (showerState) finalPrompt += buildShowerStateRule();
      finalPrompt += sealedBundles;
      // The last word: what must not change between pictures of the same moment or ride.
      if (postPromptLock) finalPrompt += postPromptLock;
      try {
        const result = await base44.integrations.Core.GenerateImage({
          prompt: `${identityPrefix}${finalPrompt} Photorealistic, high quality, authentic.`,
          existing_image_urls: refKey.visualRefs.length > 0 ? refKey.visualRefs : undefined
        });
        commit(result.url);
      } catch {
        // A failed picture never becomes a picture of somewhere else: the current image stays.
        if (!keepImageOnFailure) commit(zoneFallbackImage);
      } finally { if (isCurrent()) setIsGeneratingImage(false); }
      return;
    }

    const zoneSuffix = currentZoneForAction?.zone_name ? ` — ${currentZoneForAction.zone_name}` : "";
    const activeZoneName = currentZoneForAction?.zone_name || "this area";
    const isGlobal = !strictCastOnly && !isHomeLocation && !isRestrictedEnv && !privateLivingSpace && location.location_type === "global";
    const existingObjectCue = resolveExistingObjectCueForZone(activeZoneName);
    // No single room is the scene (the property as a whole): the note describes the
    // property itself instead of asserting a room nobody selected.
    const envNote = currentZoneForAction
      ? buildZoneLockEnvNote(activeZoneName, authoratativeEnvRefs.length > 0, lightingDesc, existingObjectCue)
      : buildFacilityEnvNote(location.name, authoratativeEnvRefs.length > 0, lightingDesc);

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
      prompt = `${envNote} Scene: ${location.name}${zoneSuffix}.${atmosphereSuffix} ${strictPeopleRule}${primaryFocusRule}${residentialConstraint}${sealedBundles}${buildSleepDescriptor(finalParticipants)}${timeLock} Photorealistic.`;
      try {
        const result = await base44.integrations.Core.GenerateImage({
          prompt: `${identityPrefix}${prompt}`,
          existing_image_urls: refKey.visualRefs.length > 0 ? refKey.visualRefs : undefined
        });
        commit(result.url);
      } catch {
        commit(zoneFallbackImage);
      } finally {
        if (isCurrent()) setIsGeneratingImage(false);
      }
      return;
    }

    // ── NON-RESIDENTIAL SCENE ──
    {
      if (isGlobal) {
        const charNames = finalParticipants.map((c) => c.name).join(", ");
        // A selected cast is never diluted: "among other patrons" invited invented people
        // into a picture the user had already cast.
        const peopleDesc = charNames
          ? `${charNames} as the clear main subject of the frame${allowBackgroundExtras ? `, with ordinary patrons of this place kept as distant, out-of-focus background` : ""}`
          : "with other people around";
        const _diversityDirective = getBackgroundPopulationDiversityDirective();
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${peopleDesc}.${namedSubjectsRule(finalParticipants)}${primaryFocusRule}${allowBackgroundExtras ? ambientRule : ''}${userAppearanceBlock}${sealedBundles}${_diversityDirective}${buildSleepDescriptor(finalParticipants)}${timeLock} Photorealistic.`;
      } else if (allowBackgroundExtras) {
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${namedSubjectsRule(finalParticipants)}${primaryFocusRule}${ambientRule}${userAppearanceBlock}${sealedBundles}${getBackgroundPopulationDiversityDirective()}${buildSleepDescriptor(finalParticipants)}${timeLock} Photorealistic.`;
      } else {
        const restrictedPrefix = isRestrictedEnv ? ` This is a restricted/private area (e.g. stockroom, backstage, office, break room).` : '';
        const peopleDesc = (finalParticipants.length > 0 ?
          `Only these specific people are present: ${finalParticipants.map((c) => c.name).join(", ")}. No other people, no strangers, no background figures.` :
          `The space is completely empty — no silhouettes, no background figures, nobody.`) + restrictedPrefix;
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${peopleDesc}${primaryFocusRule}${userAppearanceBlock}${sealedBundles}${buildSleepDescriptor(finalParticipants)}${timeLock} Photorealistic.`;
      }
    }

    try {
      const result = await base44.integrations.Core.GenerateImage({
        prompt: `${identityPrefix}${prompt}`,
        existing_image_urls: refKey.visualRefs.length > 0 ? refKey.visualRefs : undefined
      });
      commit(result.url);
    } catch {
      commit(zoneFallbackImage);
    } finally {
      if (isCurrent()) setIsGeneratingImage(false);
    }
  }, [isGeneratingImage]);

  return { sceneImage, setSceneImage, isGeneratingImage, setIsGeneratingImage, generateSceneImage };
}