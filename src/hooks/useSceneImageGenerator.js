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
import { getEasternLightingDescriptor, buildZoneLockEnvNote, buildActionEnvNote, buildFacilityEnvNote, buildTimeOfDayLock, resolveExistingObjectCueForZone, buildPhysicalSettingNote } from "@/lib/sceneImagePromptBuilder";
import { physicalSettingFor } from "@/lib/physicalSetting";
import { resolveSpaceDescription, buildSpaceDescriptionNote } from "@/lib/spaceDescription";
import { getActiveSceneSpaceId } from "@/lib/activeSceneSpace";
import { getUnitById } from "@/lib/residentialUnits";
import { getWorkplaceById } from "@/lib/locationWorkspaces";
import { isUnhousedSpaceAt, buildUnhousedSpaceRule } from "@/lib/unhousedLivingSpace";
import { resolveEstablishedAccommodations, buildSleepAccommodationRule } from "@/lib/sceneAccommodations";
import { isCharacterAsleep } from "@/lib/sleepUtils";
import { dedupeSceneCast } from "@/lib/sceneCastUniqueness";
import { buildJailAttireBlock } from "@/lib/jailSceneRules";
import { buildShowerStateRule } from "@/lib/sceneActionConfig";
import { isPrivateResidentialZone } from "@/lib/sceneBackgroundPopulation";
import { resolveSceneZone } from "@/lib/sceneSpaceZone";
import { publishSceneImageFailure, publishSceneImageSuccess } from "@/lib/sceneImageFailure";

/**
 * Remove only the exact "no other people" statement an activity prompt ends with. It only
 * ever meant "nobody but the cast is identifiable"; it was never a statement that a bar, a
 * diner or a waiting room is empty. Only these exact statements are removed — every other
 * word of the activity prompt, including any privacy, safety, identity or location
 * constraint, is left exactly as written.
 */
function stripNoOtherPeopleClause(prompt) {
  return String(prompt || "")
    .replace(/\s*No other people(?:, no coworkers)?\./gi, "")
    .replace(/\s*No strangers(?: or extra people)?\./gi, "")
    .trim();
}

/**
 * Performing an activity is not the same as performing someone else's job. The named
 * person is the customer, patient, student or guest; the service is provided by the
 * person whose role it is. It never changes who the picture is about.
 */
const SERVICE_ROLE_RULE = ` If the named person here is being served, treated, taught or assisted, the person providing that service is a member of this place's staff shown doing their job — preparing it, handing it over or delivering it — and the named person is the customer, patient, student or guest receiving it: never behind the counter, and never doing the staff member's work themselves. If the named person is the one whose job it is, they are shown in that role instead.`;

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
 *   - original reference photos are NEVER passed — they exist to create the avatar
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
export function useSceneImageGenerator({ transcript = [], getActiveSpace = null } = {}) {
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
    // A drawn picture is the picture of the moment — and it clears any notice about a
    // request the image service refused.
    const commit = (url) => { if (!isCurrent()) return; setSceneImage(url); publishSceneImageSuccess(); };
    // The place's own reference image is not a picture of anything that happened. Showing
    // it after a refused request must never read as a success, so it never clears the notice.
    const commitPlaceImage = (url) => { if (isCurrent()) setSceneImage(url); };
    setIsGeneratingImage(true);

    const lightingDesc = getEasternLightingDescriptor();
    // The hour is stated on every path, and it is fixed for the whole continuous scene.
    const timeLock = buildTimeOfDayLock(lightingDesc);

    // ── SPACE DESCRIPTION — THE MOST SPECIFIC ONE THAT EXISTS ──
    // The exact room if it has its own description, then the residence or workspace it is
    // in, then the shared zone, then the property. It adds appearance, condition and
    // atmosphere only: it never moves the picture into another room, never overrides the
    // reference images' layout, and never changes what kind of place this is.
    // The configured space the picture is of: the residence or workplace the Scenes page
    // published, resolved from the live location so an edited description is used at once.
    const activeSpace = (() => {
      const supplied = getActiveSpace?.() || null;
      if (supplied) return supplied;
      const spaceId = getActiveSceneSpaceId();
      if (!spaceId || !location) return null;
      return getUnitById(location, spaceId) || getWorkplaceById(location, spaceId) || null;
    })();
    // The same resolved description also guides this place's ordinary people further down:
    // a venue's own words establish who usually comes here, how they dress, what they are
    // doing and how full the room is. It is read once and used for both.
    const spaceDescriptionText = resolveSpaceDescription({
      space: activeSpace,
      zoneName: activeZone,
      zones: locationZones,
      locationDescription: location?.description || "",
    }).text;
    const spaceDescriptionNote = buildSpaceDescriptionNote({
      description: spaceDescriptionText,
      label: activeSpace?.unit_name || activeSpace?.name || location?.name || "this place",
      kind: activeSpace?.workplace_id ? "workspace" : activeSpace?.unit_id ? "residence" : "place",
    });

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
    // The space being pictured decides whether this is an unhoused arrangement. A city that
    // also holds a tent is not itself a tent, and its apartments are ordinary interiors.
    const unhousedSpace = isUnhousedSpaceAt(location, currentZoneForAction?.zone_name);
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
    // Original reference photos are never added — the avatar is the only identity image.
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
      const sentences = [];
      // Where someone is asleep decides what they are asleep ON — read from what this place
      // actually establishes. A bed is used where a bed exists, a couch where the room has
      // one, and the ground where there is nothing else. Nothing is invented either way.
      if (asleep.length) {
        sentences.push(buildSleepAccommodationRule({
          names: asleep,
          accommodations: resolveEstablishedAccommodations(location, currentZoneForAction?.zone_name || activeZone),
        }));
      }
      if (napping.length) sentences.push(`${napping.join(', ')} ${napping.length === 1 ? 'is' : 'are'} napping — drowsy, eyes closed, resting.`);
      if (passedOut.length) sentences.push(`${passedOut.join(', ')} ${passedOut.length === 1 ? 'is' : 'are'} passed out unconscious from exhaustion — slumped, unresponsive.`);
      return sentences.length ? ` ${sentences.filter(Boolean).join(' ')}` : '';
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
    // Nobody who is already a named subject of this picture may be described again as a
    // background person: that is how one individual would be drawn twice.
    const participantIdSet = new Set(finalParticipants.map((p) => p?.id).filter(Boolean));
    const ambientList = (Array.isArray(ambientPopulation) ? ambientPopulation : [])
      .filter((p) => p && (p.name || p.role) && !participantIdSet.has(p.id));
    // A private living space of the property — a dorm room, studio apartment or other
    // student residence — is never populated with strangers merely because the school
    // around it has ambient students. The shared school zones are unaffected.
    const privateLivingSpace = isPrivateResidentialZone(location, activeZone);
    // The environment itself decides whether ordinary people belong here: a home, a
    // restricted area and a private living space never have them; every other place keeps
    // its own people — its staff and its patrons — whatever the selected people are doing
    // and however few of them are selected. Selection decides participation, never
    // population, and a selected cast is not the whole population of a place.
    const venueAllowsAmbient = !isHomeLocation && !isRestrictedEnv && !privateLivingSpace;
    const allowBackgroundExtras = ambientList.length > 0 && venueAllowsAmbient;
    // ⛔ Background people are NEVER named in the prompt. A name makes them a named subject
    // competing for the supplied reference images — that is how a random student, teacher,
    // or bartender could end up rendered in place of the actual character. They are
    // described only by role, so they can never be taken for a named participant.
    const ambientText = allowBackgroundExtras
      ? `${ambientList.slice(0, 4).map((p) => (p.role ? String(p.role).toLowerCase() : 'person')).join(', ')}, and others like them`
      : '';
    // The real people taking part outrank the place's background population in every
    // prompt, so the frame is never left to choose a generic crowd over the character
    // or characters actually in the scene.
    const focusNames = finalParticipants.filter((p) => p && p.name).map((p) => p.name);
    const namedSubjectsRule = (people) => (people.length > 0
      ? `Only these people are identifiable: ${people.map((c) => c.name).join(', ')} — each one present exactly once, never duplicated, never replaced by an invented or background person.`
      : `No named person is the subject of this frame.`);
    // ── THE PLACE'S OWN DESCRIPTION DECIDES WHO ITS ORDINARY PEOPLE ARE ──
    // Two places of the same kind are not the same room: a description that establishes a
    // quiet neighborhood bar and one that establishes a packed club must never both be
    // drawn as the same generic crowd. The place's own established words decide its usual
    // clientele, how they dress, what they are doing, the energy of the room and how full
    // it is. They describe the place and its ordinary visitors only — never a named person,
    // who keeps their own face, body, hair, clothing and personality exactly as established
    // and who need not resemble the usual crowd at all.
    const crowdDescriptionRule = (allowBackgroundExtras && spaceDescriptionText)
      ? ` This place's own established description decides who its ordinary people are: "${spaceDescriptionText}" Let it set the typical clientele, the staff who serve them, how those people are dressed, what they are doing, the social atmosphere and energy of the room, and how busy or quiet it feels — read together with what kind of place this is, the time of day and what is happening right now. The background people must look and behave like the people this description establishes, never a generic crowd. It describes the place and its usual visitors only: it never changes a named person's face, body type, hairstyle, clothing, personality or identity, and the named people are individuals here who need not resemble the usual crowd.`
      : '';
    const ambientRule = allowBackgroundExtras
      ? ` The venue is populated as it really is right now by ordinary background people: ${ambientText}. Those are kinds of people, never a maximum count: draw the number this place actually holds at this hour — a few in a quiet waiting room, a real crowd in a busy nightclub. They are anonymous strangers with no name, no identity, and NO reference images — none of the reference images supplied with this request belongs to any of them. They stand and move where the place and the moment naturally put them, at whatever distance and position the scene requires: a bartender behind the counter or reaching into the foreground to hand over a drink, a barber or examiner close beside the person they are serving, a passer-by crossing near the subject. They may be fully visible, partly visible, or only their hands, arms or other naturally framed parts in the frame. What keeps them background is their visual importance, not their distance: they never replace, obscure or stand in for a named subject, never inherit a named subject's face, body type or clothing, never take over an action assigned to a named subject, never cause a named subject to be left out of the frame, and are never the subject of the photograph.${crowdDescriptionRule}`
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
      ? ` PRIMARY SUBJECT (mandatory): ${focusNames.join(' and ')} ${focusNames.length === 1 ? 'is' : 'are'} the subject of this photograph. ${focusNames.length === 1 ? 'They are' : 'They are all'} present in the frame — close to medium framing, centered, clearly visible, faces unobscured, in the sharpest focus and the brightest light, rendered from ${focusNames.length === 1 ? 'their' : 'their'} own reference image${focusNames.length === 1 ? '' : 's'} — those references are supplied for ${focusNames.length === 1 ? 'them' : 'them'} alone and may never be given to anyone else in the frame. ⛔ No named participant may be omitted, and none may be exchanged for a background person. No background person outranks them in visual importance, size, sharpness or focus, and none may take their place as the subject — their being close by or partly in front is natural composition, not importance.${backgroundSeparationRule}`
      : '';

    // If an action triggered this, use the action's specific prompt
    if (actionOverridePrompt) {
      // ── THE ROOM'S OWN PEOPLE STAY WHILE THE ACTIVITY HAPPENS ──
      // The place, its zone and its established circumstances decide whether ordinary people
      // are there — never the activity. A kiss, a fight, an embrace or a private conversation
      // happens in the room as it really is, with the room's own people still in it. Only a
      // home, a restricted area and a private living space keep the picture to its cast.
      const activityAllowsAmbient = venueAllowsAmbient;
      let finalPrompt = activityAllowsAmbient
        ? stripNoOtherPeopleClause(actionOverridePrompt)
        : actionOverridePrompt;
      // An activity never widens the cast: the selected participants stay the only
      // identifiable people in the picture.
      if (finalParticipants.length === 0) {
        // A place that holds people is the subject itself when nobody is selected — it is
        // never described as an empty room. Only a place that genuinely has nobody in it is.
        finalPrompt += venueAllowsAmbient
          ? ` CRITICAL: No named person is the subject of this picture — the place itself is. Its ordinary people are present exactly as the environment and its description establish.`
          : ` CRITICAL: This space is empty. There are absolutely NO people in this image — no humans, no silhouettes, no background figures, no one. Only the room/space itself.`;
      } else {
        finalPrompt += activityAllowsAmbient
          ? ` CRITICAL: Only these people are identifiable: ${finalParticipants.map((c) => c.name).join(", ")} — each one present exactly once, never duplicated, never replaced by an invented or background person, and none may be omitted.`
          : ` CRITICAL: Only these people may appear: ${finalParticipants.map((c) => c.name).join(", ")}. No other people, no strangers, no coworkers, no employees, no residents, no background figures under any circumstances.`;
        // A home's residential constraint belongs to a home. Inside a vehicle the picture is
        // composed as a car cabin, never as a furnished living space.
        // An encampment is not a home interior: no furnished living space is ever composed
        // around people sleeping in a tent or under a bridge.
        if (isHomeLocation && !environmentRefsOverride && !unhousedSpace) {
          finalPrompt += buildResidentialImageConstraint(location, finalParticipants);
        }
        // The same picture is never furnished into a home. Only what the place has.
        if (unhousedSpace) {
          finalPrompt += buildUnhousedSpaceRule({ zoneName: currentZoneForAction?.zone_name });
        }
      }
      // The people the action involves are the picture, whatever else is in the place.
      finalPrompt += primaryFocusRule;
      // A public place stays populated while the activity happens, and a service is
      // performed by the person whose job it is — never by the customer.
      if (activityAllowsAmbient) finalPrompt += ambientRule + getBackgroundPopulationDiversityDirective() + SERVICE_ROLE_RULE;
      if (environmentNote) {
        // The environment is stated outright (the car's own cabin) instead of the zone's
        // "preserve this room's layout" note.
        finalPrompt += ` ` + environmentNote;
      } else {
        // The selected zone is stated on EVERY activity picture, with or without its own
        // reference images — an activity never moves anyone indoors, and a zone that has
        // no images yet is still the place this moment happens in.
        finalPrompt += spaceDescriptionNote + ` ` + buildPhysicalSettingNote(physicalSettingFor(location, currentZoneForAction?.zone_name)) + (currentZoneForAction
          ? buildActionEnvNote(currentZoneForAction.zone_name, envRefs.length > 0, lightingDesc)
          : buildFacilityEnvNote(location.name, envRefs.length > 0, lightingDesc));
      }
      // The hour is stated on every activity picture too — the same hour as the scene,
      // including a picture taken inside a car.
      finalPrompt += timeLock;
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
        // A refused picture is never passed off as the moment itself. An activity's own
        // picture never falls back to the place's empty reference image — that fallback is
        // exactly what left an empty tent on screen looking like a completed shower. The
        // picture already on screen stays, and the picture area says what happened.
        if (!keepImageOnFailure && !actionOverridePrompt) commitPlaceImage(zoneFallbackImage);
        publishSceneImageFailure();
      } finally { if (isCurrent()) setIsGeneratingImage(false); }
      return;
    }

    const zoneSuffix = currentZoneForAction?.zone_name ? ` — ${currentZoneForAction.zone_name}` : "";
    const activeZoneName = currentZoneForAction?.zone_name || "this area";
    const isGlobal = !strictCastOnly && !isHomeLocation && !isRestrictedEnv && !privateLivingSpace && location.location_type === "global";
    const existingObjectCue = resolveExistingObjectCueForZone(activeZoneName);
    // No single room is the scene (the property as a whole): the note describes the
    // property itself instead of asserting a room nobody selected.
    // The designated setting outranks assumptions about the parent property.
    const envNote = spaceDescriptionNote + buildPhysicalSettingNote(physicalSettingFor(location, activeZoneName)) + (currentZoneForAction
      ? buildZoneLockEnvNote(activeZoneName, authoratativeEnvRefs.length > 0, lightingDesc, existingObjectCue)
      : buildFacilityEnvNote(location.name, authoratativeEnvRefs.length > 0, lightingDesc));

    let prompt;
    if (isHomeLocation) {
      const visibleNames = finalParticipants.map((c) => c.name);
      const strictPeopleRule = visibleNames.length > 0 ?
        `STRICT RULE: The ONLY people who may appear are: ${visibleNames.join(", ")}. No other residents, no unselected family members, no NPCs. ONLY those named above.` :
        `STRICT RULE: This space is completely empty — nobody is present. Do not render any people, no silhouettes, no background figures. Empty room only.`;
      // A place someone stays without housing is never rendered as a furnished home.
      const unhousedHome = unhousedSpace;
      // An outdoor zone of a property (a yard, a street front, a lot) is not a furnished interior:
      // the designated setting outranks the assumption that a home is always rooms.
      const outdoorZone = physicalSettingFor(location, currentZoneForAction?.zone_name) === 'outdoor';
      // Lived-in, never "furnished": the line may not promise furniture a place does not
      // have, and the zone's own reference images decide what is actually there.
      const atmosphereSuffix = finalParticipants.length > 0 && !unhousedHome && !outdoorZone ?
        " The home shows the signs of daily life — personal belongings and everyday things where the people who live here leave them." :
        "";
      const residentialConstraint = unhousedHome
        ? buildUnhousedSpaceRule({ zoneName: currentZoneForAction?.zone_name })
        : buildResidentialImageConstraint(location, finalParticipants);
      prompt = `${envNote} Scene: ${location.name}${zoneSuffix}.${atmosphereSuffix} ${strictPeopleRule}${primaryFocusRule}${residentialConstraint}${sealedBundles}${buildSleepDescriptor(finalParticipants)}${timeLock} Photorealistic.`;
      try {
        const result = await base44.integrations.Core.GenerateImage({
          prompt: `${identityPrefix}${prompt}`,
          existing_image_urls: refKey.visualRefs.length > 0 ? refKey.visualRefs : undefined
        });
        commit(result.url);
      } catch {
        commitPlaceImage(zoneFallbackImage);
        publishSceneImageFailure();
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
          ? `${charNames} as the clear main subject of the frame${allowBackgroundExtras ? `, with this place's ordinary patrons and staff naturally present around them` : ""}`
          : "with other people around";
        const _diversityDirective = getBackgroundPopulationDiversityDirective();
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${peopleDesc}.${namedSubjectsRule(finalParticipants)}${primaryFocusRule}${allowBackgroundExtras ? ambientRule : ''}${userAppearanceBlock}${sealedBundles}${_diversityDirective}${buildSleepDescriptor(finalParticipants)}${timeLock} Photorealistic.`;
      } else if (allowBackgroundExtras) {
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${namedSubjectsRule(finalParticipants)}${primaryFocusRule}${ambientRule}${userAppearanceBlock}${sealedBundles}${getBackgroundPopulationDiversityDirective()}${buildSleepDescriptor(finalParticipants)}${timeLock} Photorealistic.`;
      } else {
        const restrictedPrefix = isRestrictedEnv ? ` This is a restricted/private area (e.g. stockroom, backstage, office, break room).` : '';
        const peopleDesc = (finalParticipants.length > 0 ?
          `Only these specific people are present: ${finalParticipants.map((c) => c.name).join(", ")}. No other people, no strangers, no background figures.` :
          venueAllowsAmbient
            ? `No named person is the subject — the place itself is, with its ordinary people present exactly as the environment and its description establish.`
            : `The space is completely empty — no silhouettes, no background figures, nobody.`) + restrictedPrefix;
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
      commitPlaceImage(zoneFallbackImage);
      publishSceneImageFailure();
    } finally {
      if (isCurrent()) setIsGeneratingImage(false);
    }
  }, [isGeneratingImage]);

  return { sceneImage, setSceneImage, isGeneratingImage, setIsGeneratingImage, generateSceneImage };
}