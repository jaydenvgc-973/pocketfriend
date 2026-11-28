import React, { useState, useEffect, useRef, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Camera, Tv, Users as UsersIcon } from "lucide-react";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import ScenePhotoModal from "@/components/travel/ScenePhotoModal";
import SceneMediaArea from "@/components/scene/SceneMediaArea";
import { useSceneViewportHeight } from "@/hooks/useSceneViewportHeight";
import { filterDashes } from "@/lib/dashFilter";
import { isCharacterAtWork } from "@/lib/workScheduleUtils";
import { getPrivateSpaceOccupantIds } from "@/lib/sceneImmediateArea";
import { isCharacterHome } from "@/lib/travelAvailability";
import { isCharacterAsleep } from "@/lib/sleepUtils";
import { isLocationOpen } from "@/lib/locationHoursUtils";
import { getPresenceAtLocation, resolveTravelPresenceEntities } from "@/lib/travelPresenceResolver";
import ConversationTypeSelector from "@/components/scene/ConversationTypeSelector";
import InviteToSceneModal from "@/components/scene/InviteToSceneModal";
import WhosHereDropdown from "@/components/scene/WhosHereDropdown";
import { writeSceneExitMemories } from "@/lib/sceneExitMemory";
import { useSceneCompletion } from "@/hooks/useSceneCompletion";
import ResidenceOptionsDropdown from "@/components/scene/ResidenceOptionsDropdown";
import RealtorTourModal from "@/components/scene/RealtorTourModal";
import MoveInPopup from "@/components/travel/MoveInPopup";
import InviteOutModal from "@/components/home/InviteOutModal";
import LeaveLocationModal from "@/components/scene/LeaveLocationModal";
import ProductPurchaseModal from "@/components/scene/ProductPurchaseModal";
import { useShoppingVisit, ShoppingPreferencesGate } from "@/components/scene/ShoppingVisit";
import useSceneResidenceActions from "@/hooks/useSceneResidenceActions";
import PurchaseClosetEntryModal from "@/components/closet/PurchaseClosetEntryModal";
import ChangeClothesModal from "@/components/scene/ChangeClothesModal";
import { isNPCOnShift } from "@/lib/npcShiftUtils";
import SceneInputBar from "@/components/scene/SceneInputBar";
import ObserveStageControls from "@/components/scene/ObserveStageControls";
import SceneTargetPickers from "@/components/scene/SceneTargetPickers";
import { getCourtActionAuthority, courtActors, courtSubjects, courtActionLine } from "@/lib/courtroomActions";
import { generateObserveBeat, recordObserveBeatMemories, recordVoicedLineMemory, recordNarrativeMemories } from "@/lib/observeInteraction";
import NPCEvolutionTracker from "@/components/scene/NPCEvolutionTracker";
import { getEnvironmentTypeForZone, getLocationEnvironments, isEnvironmentAccessibleNow } from "@/components/location/EnvironmentSelectorModal";
import { isOnSiteResidenceZone } from "@/lib/onsiteResidence";
import { ACTION_IMAGE_PROMPTS, buildDirectedActionPrompt, HOUSEHOLD_ACTION_IDS, EATING_ACTION_IDS, SHOWER_ACTION_IDS, IN_WORLD_ACTIVITY_TEXT } from "@/lib/sceneActionConfig";
import { getSceneInteractions, getTemporarySceneStaff } from "@/lib/sceneInteractionEngine";
import { checkImageTrigger as _checkImageTrigger, isPurchaseOfferAction, presentOfferInWatchedScene } from "@/lib/sceneCheckImageTrigger";
import { buildTryOnPrompt, resolveTryOnZone } from "@/lib/sceneTryOnPrompt";
import { createImageParticipantSelector } from "@/lib/sceneImageParticipants";
import { useSceneCharacters } from "@/hooks/useSceneCharacters";
import SceneNpcRow from "@/components/scene/SceneNpcRow";
import SceneCharacterCommands, { isSleepingCharacter } from "@/components/scene/SceneCharacterCommands";
import ScenePresenceStrip from "@/components/scene/ScenePresenceStrip";
import { presentShoppingPeople, onShiftEmployeeIds, accountRecipients } from "@/lib/shoppingParticipants";
import { purchaseConfirmationLine } from "@/lib/scenePurchaseCloset";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useUserPresence } from "@/hooks/useUserPresence";
import { useSharedResidenceParticipants } from "@/hooks/useSharedResidencePresence";
import SharedResidenceConversation from "@/components/scene/SharedResidenceConversation";
import { useSceneImageGenerator } from "@/hooks/useSceneImageGenerator";
import { useSceneSpaceImage } from "@/hooks/useSceneSpaceImage";
import { loadSceneResponseContext } from "@/lib/sceneResponseContext";
import { getVenueNpcDefaults } from "@/lib/sceneVenueNPCs";
import { usePageContext } from "@/hooks/usePageContext";
import { useAuth } from "@/lib/AuthContext";
import SceneProductCard from "@/components/scene/SceneProductCard";
import { handleCharacterWorldPhoneAction } from "@/lib/worldPhoneActionHandler";
import { detectWorldPhoneIntent } from "@/lib/worldPhoneIntentDetector";
import { buildWatchContextLabel } from "@/lib/videoEmbedSanitizer";
import { isVickServicioCharacter } from "@/lib/vickDiagnosticIntentCheck";
import { resolveSceneRole, isEmployedAtLocation } from "@/lib/sceneRoleResolver";
import { isSelectableParticipantAtZone, isIncarceratedCharacter, isJailOrPrison } from "@/lib/jailSceneRules";
import { buildSceneCircumstances } from "@/lib/sceneCircumstances";
import { isInfantCharacter, childSpeechLimit } from "@/lib/characterAgeStage";
import { isAdultCharacter } from "@/lib/characterAgeSystem";
import { activityBehaviorFor, activityFeedLine } from "@/lib/sceneActivityBehavior";
import { isCaregiverOnDuty, supervisedChildren } from "@/lib/childCaregiver";
import { buildPossibleNpcs } from "@/lib/scenePossibleNpcs";
import { buildBackgroundPopulation, isPrivateResidentialZone } from "@/lib/sceneBackgroundPopulation";
import { findAddressedBackgroundPeople, buildBackgroundResponderRule } from "@/lib/sceneBackgroundResponse";
import { getAssignableUnits, getUnitPresentOccupantIds, getUnitById, getUnitForCharacter, getUnitLabel, getUnitZoneName, isStudentHousingSpace } from "@/lib/residentialUnits";
import { getWorkplaceSpaces, getWorkplaceById, getWorkplaceZoneName, getResidentialZoneName } from "@/lib/locationWorkspaces";
import { getSceneUnitScope, getWorkspaceSceneScope, scopeCanonicalContext, buildUnitBoundaryBlock } from "@/lib/sceneUnitScope";
import GovernmentVenueSetupModal from "@/components/government/GovernmentVenueSetupModal";
import MarriageConfirmationModal from "@/components/government/MarriageConfirmationModal";
import JudicialOutcomeModal from "@/components/government/JudicialOutcomeModal";
import { isGovernmentActionId } from "@/lib/governmentVenues";
import useGovernmentVenueScene from "@/hooks/useGovernmentVenueScene";
import SceneChatFeed from "@/components/scene/SceneChatFeed";
import SceneActionStrip from "@/components/scene/SceneActionStrip";
import SceneRideFlow from "@/components/scene/SceneRideFlow";
import MissingBelongingModal from "@/components/scene/MissingBelongingModal";
import { runNextSceneTransition } from "@/lib/sceneNextScene";
import { loadBelongings, hasPet, buildWalkPetPrompt } from "@/lib/ownerBelongings";
import { rideImageRequest } from "@/lib/sceneRide";
import { useSceneRide } from "@/hooks/useSceneRide";
import SceneRideBar from "@/components/scene/SceneRideBar";
import { useSceneArrest } from "@/hooks/useSceneArrest";
import SceneTransitionModals from "@/components/scene/SceneTransitionModals";
import SceneMoneyModal from "@/components/scene/SceneMoneyModal";
import OpenPhoneModal from "@/components/scene/OpenPhoneModal";
import useSpawnNpc from "@/hooks/useSpawnNpc";
import { TRAIT_GATED_CRIME_ACTIONS } from "@/lib/actionGenerator";
import { resolveCrimeOutcome, CRIME_ACTIVITY_IDS, buildRespondingOfficer, officerAlreadyHere, pickCustodyFacility, castHasCrimeTrait } from "@/lib/sceneCrimeOutcome";

import { CATEGORY_EMOJIS, isUserPresenceEntity } from "@/lib/sceneStripConfig";

export default function Scene() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const locationId = urlParams.get("locationId");
  const characterIds = (urlParams.get("characterIds") || "").split(",").filter(Boolean);
  const initialZoneName = urlParams.get("zoneName") || null;
  const initialEnvironmentId = urlParams.get("environmentId") || null;
  // The apartment of a multi-dwelling residence the user entered. It selects the
  // residential space inside the building — zones stay shared across units.
  const initialUnitId = urlParams.get("unitId") || null;
  // OBSERVE MODE — the user is watching characters interact with each other.
  // They are not a participant, not present, and not written into the scene.
  // A location can be opened for viewing without sending anyone: the people already
  // there are the scene. Opening it is not travel and is not an arrival.
  const observeMode = urlParams.get("observe") === "1";
  // Each traveling companion's own resolved location at the moment they were chosen for
  // this trip, carried through the existing travel navigation as id:locationId pairs.
  // It is the destination a companion returns to when the user leaves with them.
  const travelOrigins = useMemo(() => {
    const map = {};
    (urlParams.get("originLocations") || "").split(",").filter(Boolean).forEach((pair) => {
      const [id, originId] = pair.split(":");
      if (id && originId) map[id] = originId;
    });
    return map;
  }, [urlParams.get("originLocations") || ""]);

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [hasUserRequestedImage, setHasUserRequestedImage] = useState(false);
  const [actions, setActions] = useState([]);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  // Send / Receive Money — which side of the established financial interaction was chosen.
  const [moneyMode, setMoneyMode] = useState(null);
  // The scene's phone. A presentation layer over existing messaging, games and Scene Photo.
  const [showPhone, setShowPhone] = useState(false);
  const [actionCooldown, setActionCooldown] = useState(false);
  // Go to Sleep / Wake Up / Go Home / Go to Work — which one is asking WHO right now.
  const [commandAction, setCommandAction] = useState(null);
  const [selectedNpcIds, setSelectedNpcIds] = useState(null);
  // Court participants taking part by remote link (in custody or hospitalized): in the
  // proceeding, never in the room.
  const [remoteParticipants, setRemoteParticipants] = useState([]);
  const [showNpcDropdown, setShowNpcDropdown] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [activeZone, setActiveZone] = useState(initialZoneName);
  const [activeUnitId, setActiveUnitId] = useState(initialUnitId);
  const [conversationModal, setConversationModal] = useState(null);
  const [narratorMode, setNarratorMode] = useState(false);
  const [showTourModal, setShowTourModal] = useState(false);
  const [showMoveInPopup, setShowMoveInPopup] = useState(false);
  const [isMoveInLoading, setIsMoveInLoading] = useState(false);
  const [extraNpcs, setExtraNpcs] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  // Where an exit of this scene goes once it has been completed. Every exit path writes the
  // same journal and memories; only the page that opens afterwards differs — the phone's
  // Media Gallery opens the Gallery instead of Travel. Held in a ref so the destination the
  // phone chose is the one the exit actually uses, never a value from an earlier render.
  const exitDestinationRef = useRef("/travel");
  const [privateTarget, setPrivateTarget] = useState(null);
  const [pendingPurchase, setPendingPurchase] = useState(null);
  // Try On: the product card's own merchandise, waiting for the user to pick who wears it.
  const [tryOnRequest, setTryOnRequest] = useState(null);
  // A paid purchase whose closet entry is being completed. The entry already exists in
  // the recipient's real closet — this only finishes its details.
  const [pendingClosetEntry, setPendingClosetEntry] = useState(null);
  const [watchVideoActive, setWatchVideoActive] = useState(false);
  const [watchContext, setWatchContext] = useState(null);
  const [showChangeClothesModal, setShowChangeClothesModal] = useState(false);
  const [directedAction, setDirectedAction] = useState(null);
  // A recipient action (shakedown, search, warning, escort) involves ONE chosen person.
  const [recipientAction, setRecipientAction] = useState(null);
  // Courtroom activities: who acts, and who the action is directed at.
  const [courtActorAction, setCourtActorAction] = useState(null);
  const [courtSubjectAction, setCourtSubjectAction] = useState(null);
  // In a watched scene an activity belongs to a person IN the scene. When more than one
  // eligible character is here, the observer says who before anything happens.
  const [actorAction, setActorAction] = useState(null);
  // Pickpocket names TWO people: who attempts it, and whose pocket it is. The actor is
  // chosen first through the existing selector, then the target through the same one.
  const [crimeTargetAction, setCrimeTargetAction] = useState(null);
  const [showSharedConversation, setShowSharedConversation] = useState(false);
  const bottomRef = useRef(null);
  const npcDropdownRef = useRef(null);
  // While the keyboard is open the screen is shorter: Scenes follows the visible area.
  const keyboardViewportHeight = useSceneViewportHeight();
  const narratorModeRef = useRef(narratorMode);
  const sendMessageRef = useRef(null);
  const sendNarrationRef = useRef(null);

  const { user: currentUser } = useAuth();
  const { settings, isLoading: isUserSettingsLoading } = useUserSettings(currentUser?.email || null);
  const displayName = settings.fictional_world_name || currentUser?.full_name || "You";

  const userParticipant = useMemo(() => {
    // Observing means absent: no user participant, no user in prompts or images.
    if (observeMode) return null;
    // AVATAR AUTHORITY: only the current avatar — original reference photos are never inputs.
    const userAvatar = currentUser?.generated_avatar_urls?.[0] || currentUser?.avatar_url || null;
    if (!userAvatar) return null;
    return {
      id: currentUser?.id || 'user', name: displayName, avatar_url: userAvatar, image_avatar_url: userAvatar,
      reference_image_urls: [], appearance_lock: settings?.appearance_lock || null,
      user_race: settings?.user_race || null, gender: settings?.user_gender || currentUser?.gender || null, isUser: true,
    };
  }, [observeMode, currentUser?.id, currentUser?.generated_avatar_urls, currentUser?.avatar_url, displayName, settings?.appearance_lock, settings?.user_gender, currentUser?.gender]);

  const { data: locationsData = [], isFetching: isLocationsFetching } = useQuery({
    queryKey: ["locationReferences", currentUser?.email],
    queryFn: async () => { const res = await base44.functions.invoke("fetchAllLocationsForUser", {}); return res?.data?.locations || []; },
    enabled: !!currentUser?.email
  });

  const { data: directLocation = null, isLoading: isDirectLoading } = useQuery({
    queryKey: ["locationReferenceDirect", locationId],
    queryFn: async () => { if (!locationId) return null; try { return await base44.entities.LocationReference.get(locationId); } catch { return null; } },
    enabled: !!locationId && !locationsData.find((l) => l.id === locationId),
  });

  const { characters, activeChars, backendNpcFictitious, rlsNpcFictitious, familyByCreatedBy, familyByOwner, sceneCaregivers, npcRegular, sharedLocationEmployees, sharedLocationVisitors } = useSceneCharacters(currentUser);

  // Courthouse picker pool: a test-flagged regular NPC is a real record, so a court proceeding may offer one.
  const courtCharacters = useMemo(() => [...characters, ...(npcRegular || []).filter((c) => c?.is_test_character === true && c.character_type === 'npc_regular' && c.life_status !== 'deceased' && !['deceased', 'deleted', 'soft_deleted', 'merged'].includes(c.status))], [characters, npcRegular]);

  const location = locationsData.find((l) => l.id === locationId) || directLocation || null;

  // Regular NPCs are present in the world like anyone else, so they appear in Who's Here.
  // They are never auto-added to the cast: being here is not being selected. The
  // household's assigned caregiver is the exception — supervision already selects them.
  const regularNpcIds = useMemo(() => new Set((npcRegular || []).filter((c) => !isCaregiverOnDuty(c, location?.id)).map((c) => c.id)), [npcRegular, location?.id]);

  // ── SHARED RESIDENCE ──
  // A deliberately shared residential property supports the same cross-account
  // interaction as a Gathering Room. The property stays a residence: its
  // ownership, residents, and presence are untouched. Only the conversation
  // surface is added, and only while people are actually here together.
  const isSharedResidence = !!location
    && (location.scope === 'shared' || location.location_type === 'shared')
    && (location.category === 'home' || (location.environments || []).some((e) => e.type === 'residential'));

  const { participants: sharedResidenceParticipants } = useSharedResidenceParticipants(
    location?.id,
    isSharedResidence && !!currentUser?.email
  );
  const { setUserLocation, setUserAway } = useUserPresence(currentUser, settings, settings?.id);

  // Arriving at a shared residence IS the user's presence there — the existing
  // user-presence authority records it, so co-present users can see each other.
  useEffect(() => {
    // Observing never relocates the user — their authoritative location is untouched.
    if (!isSharedResidence || !location?.id || observeMode) return;
    setUserLocation(location.id, location.name).catch(() => {});
  }, [isSharedResidence, location?.id, observeMode]);

  const locationMap = Object.fromEntries(locationsData.map((l) => [l.id, l]));
  const locationZones = location?.zones || [];
  const activeEnvType = getEnvironmentTypeForZone(location, activeZone || locationZones[0]?.zone_name);
  const isRestrictedEnv = activeEnvType === 'restricted';

  // The environment the user selected on Travel is authoritative for arrival access.
  // Resolved once from the carried environmentId (or the arrival zone's environment),
  // so moving between zones inside the scene never re-triggers the closing gate.
  const selectedEnvironment = useMemo(() => {
    const envs = getLocationEnvironments(location);
    if (envs.length === 0) return null;
    const byId = initialEnvironmentId ? envs.find((e) => e.id === initialEnvironmentId) : null;
    if (byId) return byId;
    const arrivalZone = initialZoneName || locationZones[0]?.zone_name;
    return envs.find((e) => Array.isArray(e.zone_names) && e.zone_names.includes(arrivalZone)) || null;
  }, [location?.id, initialEnvironmentId, initialZoneName]);
  const broughtCharacters = characters.filter((c) => characterIds.includes(c.id));

  const unifiedPresenceEntities = useMemo(() => {
    const resolved = resolveTravelPresenceEntities({
      currentUser, userSettings: settings || null, activeCharacters: activeChars,
      npcFictitious: [...backendNpcFictitious, ...rlsNpcFictitious].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i),
      npcFamilyMembers: [...familyByCreatedBy, ...familyByOwner].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i),
      // Regular NPCs — caregivers included — carry their own authoritative presence.
      npcRegular,
      allCharacters: characters, sharedLocationEmployees, sharedLocationVisitors, locations: locationsData
    });
    const withBrought = resolved.map((entity) => {
      if (broughtCharacters.find((bc) => bc.id === entity.id)) return { ...entity, resolved_current_location_id: locationId, is_currently_present: true };
      return entity;
    });
    broughtCharacters.forEach((brought) => {
      if (!withBrought.find((e) => e.id === brought.id)) {
        withBrought.push({ id: brought.id, display_name: brought.display_name || brought.name, name: brought.name, character_type: brought.character_type, avatar_url: brought.avatar_url, resolved_current_location_id: locationId, resolved_current_location_name: location?.name, resolved_presence_status: 'visiting', is_currently_present: true, is_home_resident: brought.current_home_location_id === locationId, personality_summary: brought.personality_summary, emotional_state: brought.emotional_state });
      }
    });
    return withBrought;
  }, [currentUser?.id, activeChars, backendNpcFictitious, rlsNpcFictitious, familyByCreatedBy, familyByOwner, npcRegular, sharedLocationEmployees, sharedLocationVisitors, locationsData, broughtCharacters, locationId, location?.name]);

  // The household's temporary child-care caregiver, exactly as the existing
  // child-supervision system maintains them. The assignment (is_sitter + the home it is
  // assigned to) is the authority: on duty while children are home and no adult who lives
  // here has returned. A visiting adult never ends it, and it is never a random NPC.
  const isAssignedCaregiverHere = (c) => isCaregiverOnDuty(c, location?.id);
  const isHomeLocation = location?.category === "home";
  // An On-Site Residence inside a business property is a living space, not a workplace.
  // Its own zones behave residentially; the business's zones keep their operational behavior.
  const inOnSiteResidence = isOnSiteResidenceZone(location, activeZone || locationZones[0]?.zone_name);
  const isResidentialSpace = isHomeLocation || inOnSiteResidence;
  // A resident of this property is at home inside the residence; anyone else here is
  // visiting. Only someone whose OWN home is this place is 'home': the 'home' presence
  // branch returns a character to their own residence, so marking a guest 'home' at
  // someone else's address is what sent them away from a place they were left at.
  const residencePresenceStatus = (char) => (
    char?.current_home_location_id && char.current_home_location_id === location?.id ? 'home' : 'visiting'
  );
  // Adults-only activities use the app's established age rule (isAdultCharacter), never a
  // filled-in optional field. One check feeds the strip, both selectors and the validation,
  // so no part of the activity can disagree about who is an adult.
  const isAdultForActivity = (person) => isAdultCharacter(person);
  const eligibleForAction = (list, action) => (
    action?.adults_only === true ? (list || []).filter(isAdultForActivity) : (list || [])
  );
  const isSharedLocation = location?.scope === 'shared' || location?.location_type === 'shared';
  // Gateway House — the administrator-shared residence where characters from
  // different accounts may live. Only this property accepts move-ins while shared.
  const isGatewayHouse = location?.canonical_location_key === 'gateway_house';
  const isVGCTowers = location?.name === 'VGC Towers';
  const homeResidents = isResidentialSpace ? characters.filter((c) => c.current_home_location_id === location.id) : [];
  const homeResidentsPresent = homeResidents.filter((c) => isCharacterHome(c, locationMap));
  const homeResidentsAway = homeResidents.filter((c) => !isCharacterHome(c, locationMap));

  // ── APARTMENT (RESIDENTIAL UNIT) ──
  // The apartment being visited — never the whole building — decides who is selected on
  // open. Occupants of another unit stay available through Who's Here, unselected.
  const locationUnits = getAssignableUnits(location);
  const activeUnit = getUnitById(location, activeUnitId);
  // ── WORKPLACE (A BUSINESS INSIDE THE PROPERTY) ──
  // A mixed-use property — a residence such as Gateway House among them — keeps its
  // businesses in workplaces (Places). A workplace is a selectable space of its own,
  // exactly like an apartment: it travels in the visit, and Scenes opens inside THAT
  // establishment instead of reading the property as a home.
  const locationWorkplaces = getWorkplaceSpaces(location);
  const activeWorkspace = getWorkplaceById(location, activeUnitId);
  const isWorkspaceScene = !!activeWorkspace;
  const workspaceEmployeeIds = new Set(activeWorkspace?.worker_character_ids || []);
  // The space this scene is inside (apartment / patient room / cell / workplace), from the
  // existing assignments. Null when the whole property is the scene.
  const sceneUnitScope = getSceneUnitScope(location, activeUnitId)
    || getWorkspaceSceneScope(location, activeWorkspace);
  const unitPresentOccupantIds = locationUnits.length > 0 ? getUnitPresentOccupantIds(location, activeUnitId, characters) : [];
  const unitAutoSelectedIdsRef = useRef([]);
  const unitManualDeselectRef = useRef(new Set());
  const previousUnitIdRef = useRef(initialUnitId);

  // ── WHOLE FACILITY IS NOT ONE ROOM ──
  // A property organized into separate occupied spaces — apartments, patient rooms,
  // cells, dorm rooms, the businesses inside it — is opened at whole-property level
  // whenever no specific space is chosen. Someone inside one of those spaces is in their
  // own room, not in the immediate area where the scene opens: they stay available
  // through Who's Here and join only when the user actually selects them. Nobody is
  // moved, and a single-household home (which has no such spaces) is untouched.
  const privateSpaceOccupantIds = useMemo(
    () => (!activeUnitId ? getPrivateSpaceOccupantIds(location, characters, unifiedPresenceEntities) : new Set()),
    [location?.id, activeUnitId, locationUnits.length, locationWorkplaces.length, characters.length, unifiedPresenceEntities]
  );

  // WHO IS IN THIS SPACE RIGHT NOW — the physical-presence half of Who's Here.
  // Inside an open apartment / room / cell the space is that unit alone; everywhere else
  // (the whole property, a venue, a workplace) it is whoever is genuinely present there.
  // The user, characters who traveled here with the user (they are already selected), and
  // background placeholders are not part of this.
  const presentHereIds = useMemo(() => {
    if (!location?.id) return [];
    if (activeUnit) return unitPresentOccupantIds;
    const present = getPresenceAtLocation(location, unifiedPresenceEntities)
      .filter((e) => e?.id
        && !isUserPresenceEntity(e, currentUser?.id)
        && !String(e.id).startsWith("npc_")
        // Inside a private space of the property — a patient room, a cell, an apartment,
        // a workplace — they are not in the immediate area the scene opens in.
        && !privateSpaceOccupantIds.has(e.id)
        // A Regular NPC who is here is listed in Who's Here; they are never auto-selected.
        && !regularNpcIds.has(e.id)
        && !characterIds.includes(e.id));
    // ONE WORKPLACE: the chosen space is this establishment, not the property around it.
    // The people in it are its own people whose existing shift has them working here now.
    // A resident of an apartment in the same building is elsewhere, not in this room —
    // they stay available through Who's Here and join only when actually selected.
    if (activeWorkspace) {
      return present
        .filter((e) => {
          if (!workspaceEmployeeIds.has(e.id)) return false;
          const c = characters.find((x) => x.id === e.id) || e;
          return isEmployedAtLocation(c, location) && (isCharacterAtWork(c, location) || (c.resolved_presence_status === 'at_work' && c.resolved_current_location_id === locationId)) && !isCharacterAsleep(c);
        })
        .map((e) => e.id);
    }
    return present.map((e) => e.id);
  }, [location?.id, activeUnitId, activeWorkspace?.workplace_id, unitPresentOccupantIds.join(','), privateSpaceOccupantIds, unifiedPresenceEntities, currentUser?.id, characters.length, regularNpcIds]);

  // Presence decides who is AVAILABLE and initially selected; the selection itself decides
  // who actually participates. Entering a location or one of its units preselects the
  // characters actually there through the existing Who's Here list. A character the user
  // deselects is never re-selected for that space, and moving to another space starts a
  // fresh automatic selection for it.
  useEffect(() => {
    if (!location?.id) return;
    // Moving to another apartment releases the previous space's automatic picks.
    if (previousUnitIdRef.current !== activeUnitId) {
      previousUnitIdRef.current = activeUnitId;
      unitManualDeselectRef.current = new Set();
    }
    const nextAuto = [...new Set(presentHereIds)].filter((id) => !unitManualDeselectRef.current.has(id));
    const previousAuto = unitAutoSelectedIdsRef.current;
    unitAutoSelectedIdsRef.current = nextAuto;
    setSelectedNpcIds((prev) => {
      const current = prev || [];
      const base = current.filter((id) => !previousAuto.includes(id) || nextAuto.includes(id));
      const merged = [...new Set([...base, ...nextAuto])];
      if (merged.length === current.length && merged.every((id) => current.includes(id))) return prev;
      return merged;
    });
  }, [activeUnitId, location?.id, presentHereIds.join(',')]);

  // Choosing an apartment is a move between units, not a change of zone: the property's
  // zone references and images stay exactly as they are.
  const handleUnitChange = (unitId) => {
    setActiveUnitId(unitId);
    const unit = getUnitById(location, unitId);
    const workspace = getWorkplaceById(location, unitId);
    // A workplace shows itself through one of its OWN zones — never an apartment or
    // another business's room. Leaving a workplace back into the property restores the
    // property's own (non-business) zone, so the residence is shown as a residence.
    if (workspace) {
      const workspaceZone = getWorkplaceZoneName(location, workspace);
      if (workspaceZone) setActiveZone(workspaceZone);
    } else if (isWorkspaceScene) {
      const residentialZone = getResidentialZoneName(location);
      if (residentialZone) setActiveZone(residentialZone);
    }
    // A room or cell identifies the space; the zone identifies the kind of space. Moving
    // between a hospital's patient rooms (or a jail's cells) keeps that facility's own
    // Patient Room / Cell zone — its reference images and dropdown are unchanged.
    const unitZone = unitId ? getUnitZoneName(location, unitId) : null;
    if (unitZone) setActiveZone(unitZone);
    // A different apartment, workplace or room is a different space, so its own picture is
    // drawn. Choosing the space already on screen changes nothing and draws nothing.
    if (unitId !== activeUnitId) requestSpaceImage();
    if (observeMode) {
      // Choosing the whole facility releases the unit cast back to the default selection.
      // Inside one workplace, the people working there now are the ones offered.
      setObserveCastIds(
        workspace
          ? [...onShiftIds].filter((id) => workspaceEmployeeIds.has(id))
          : unitId ? getUnitPresentOccupantIds(location, unitId, characters) : null
      );
      return;
    }
    if (!unit && !workspace) return;
    const spaceLabel = workspace ? workspace.name : getUnitLabel(unit.unit_name, location);
    setMessages((prev) => [...prev, { id: `unit_${Date.now()}`, sender: "narrative", content: `You move to ${spaceLabel}.`, timestamp: new Date().toISOString() }]);
  };

  const getFamilyNpcLocationId = (fm) => {
    for (const char of homeResidents) {
      const rel = char.fictional_relationships?.find((r) => r.person_name?.trim().toLowerCase() === fm.name?.trim().toLowerCase() && !r.related_character_id);
      if (rel) return rel.current_location_id || null;
    }
    return null;
  };
  const familyMemberNpcsAway = isResidentialSpace ? (location.resident_family_members || []).filter((fm) => { if (!fm.name) return false; const locId = getFamilyNpcLocationId(fm); return locId && locId !== location.id; }) : [];
  const familyMemberNpcsPresent = isResidentialSpace ? (location.resident_family_members || []).filter((fm) => { if (!fm.name) return false; const locId = getFamilyNpcLocationId(fm); return !locId || locId === location.id; }) : [];
  const familyNpcSceneObjects = familyMemberNpcsPresent.map((fm) => {
    let photoUrl = null;
    for (const char of homeResidents) { const match = char.family_members?.find((m) => m.name?.trim().toLowerCase() === fm.name?.trim().toLowerCase()); if (match?.photo_url) { photoUrl = match.photo_url; break; } }
    return { id: `npc_family_${fm.name.replace(/\s+/g, '_')}`, name: fm.name, role: fm.relationship_type || 'Family', isNpc: true, character_type: 'family_npc', avatar_url: photoUrl };
  });

  const workerCharacters = (() => {
    if (!location) return [];
    const canonicalLocById = {};
    unifiedPresenceEntities.forEach((e) => { if (e.id) canonicalLocById[e.id] = e.resolved_current_location_id; });
    const onShift = characters.filter((c) => {
      if (characterIds.includes(c.id)) return false;
      if (isCharacterAsleep(c)) return false;
      if (c.resolved_presence_status === 'hospitalized') return false;
      if (['incarcerated', 'confined', 'house_arrest'].includes(c.resolved_presence_status)) return false;
      if (!isEmployedAtLocation(c, location)) return false;
      // Authoritative presence outranks a descriptive activity line: records that place them
      // at work HERE mean they are on shift here, even if an earlier activity string says home.
      if (!isCharacterAtWork(c, location) && !(c.resolved_presence_status === 'at_work' && (canonicalLocById[c.id] || c.resolved_current_location_id) === locationId)) return false;
      const canonicalLocId = canonicalLocById[c.id] || c.resolved_current_location_id;
      if (canonicalLocId && canonicalLocId !== locationId) return false;
      return true;
    });
    if (location.is_confinement_facility || location.category === 'jail_prison') return onShift.slice(0, 4);
    return onShift;
  })();

  const onShiftIds = new Set(workerCharacters.map((w) => w.id));
  // A property's own units are home for their people even when it is a city, not one household.
  const homeResidentIds = new Set([...homeResidentsPresent.map((r) => r.id), ...locationUnits.flatMap((u) => u.occupant_character_ids || [])]);
  const vgcDistributedNpcs = characters.filter((c) => {
    if (!c.character_type) return false;
    if (!['npc', 'family_npc', 'background', 'promoted_npc'].includes(c.character_type)) return false;
    if (characterIds.includes(c.id)) return false;
    if (c.resolved_current_location_id !== locationId) return false;
    if (c.presence_state === 'in_transit') return false;
    return true;
  });

  const changeClothesEligibleCharacters = useMemo(() => {
    const seen = new Set(); const list = [];
    const add = (c) => { if (!c || !c.id || seen.has(c.id)) return; seen.add(c.id); list.push(c); };
    broughtCharacters.forEach(add); homeResidentsPresent.forEach(add); workerCharacters.forEach(add); vgcDistributedNpcs.forEach(add);
    characters.filter((c) => c.resolved_current_location_id === locationId).forEach(add);
    return list;
  }, [broughtCharacters, homeResidentsPresent, workerCharacters, vgcDistributedNpcs, characters, locationId]);

  const npcsTravelingHere = (() => {
    const traveling = [];
    characters.forEach((char) => { if (!char.fictional_relationships) return; char.fictional_relationships.forEach((rel) => { if (!rel.related_character_id && rel.person_name && rel.current_location_id === locationId) { traveling.push({ id: `npc_${rel.person_name.replace(/\s+/g, "_")}_${char.id}`, name: rel.person_name, role: rel.relationship_type || "NPC", isNpc: true, avatar_url: null }); } }); });
    return traveling;
  })();

  const hereNowFromPresence = useMemo(() => {
    if (!location) return [];
    return getPresenceAtLocation(location, unifiedPresenceEntities)
      .filter((e) => e?.id && !characterIds.includes(e.id))
      // The user is the observer, not one of the other people here.
      .filter((e) => !isUserPresenceEntity(e, currentUser?.id))
      .map((entity) => {
        // The household's caregiver on duty is listed as the caregiver, never as a
        // random resident or visitor passing through.
        const rec = characters.find((c) => c.id === entity.id);
        const role = isCaregiverOnDuty(rec, location.id) ? 'Caregiver' : entity.resolved_presence_status === 'home' ? 'Resident' : 'Here now';
        return { id: entity.id, name: entity.display_name, avatar_url: entity.avatar_url, role, isNpc: false, npcType: 'present', resolved_presence_status: entity.resolved_presence_status, personality_summary: entity.personality_summary, emotional_state: entity.emotional_state };
      });
  }, [location, unifiedPresenceEntities, characterIds, characters]);

  const allPossibleNpcs = buildPossibleNpcs({
    location, locationId, characterIds, characters, homeResidents, vgcDistributedNpcs,
    workerCharacters, unifiedPresenceEntities, hereNowFromPresence, npcsTravelingHere,
    extraNpcs, locationUnits, isResidentialSpace, isRestrictedEnv,
    isAssignedCaregiverHere, getUnitForCharacter, getUnitLabel, getTemporarySceneStaff,
    isNPCOnShift, getVenueNpcDefaults, isJailOrPrison, isIncarceratedCharacter, getPresenceAtLocation,
  }).map((n) => ({ ...n, sceneRole: n.isNpc === true ? (n.npcType === 'staff' ? 'on-shift employee' : n.npcType === 'resident' ? 'home resident' : n.npcType === 'inmate' ? 'inmate' : 'visitor') : resolveSceneRole(n, { onShiftAtLocationIds: onShiftIds, homeResidentIds }) }));

  // A caregiver the existing supervision system currently has on duty in THIS household is
  // an ACTIVE participant from the first render: physically present, automatically
  // selected, and part of the opening image. The child is never shown as alone while
  // supervised, and the caregiver is never a name the user has to add by hand. The same
  // single individual is the Who's Here entry and the active participant — never a copy.
  const onDutyCaregiverIds = useMemo(
    () => characters.filter((c) => isCaregiverOnDuty(c, location?.id)).map((c) => c.id),
    [characters, location?.id]
  );
  const selectedNpcIdList = useMemo(
    () => [...new Set([...(selectedNpcIds || []), ...onDutyCaregiverIds])],
    [selectedNpcIds, onDutyCaregiverIds.join(',')]
  );

  // The exact household the caregiver is responsible for: the children whose OWN dwelling
  // (unit/apartment) has no adult member home. A neighbour's child is never attributed to
  // this caregiver, and a neighbour adult never ends the supervision.
  const supervisedChildIds = useMemo(
    () => [...new Set(onDutyCaregiverIds.flatMap((id) => {
      const caregiver = characters.find((c) => c.id === id);
      return supervisedChildren(location, caregiver, characters).map((c) => c.id);
    }))],
    [onDutyCaregiverIds.join(','), characters, location?.id]
  );

  const selectedNpcs = allPossibleNpcs.filter((n) => selectedNpcIdList.includes(n.id));
  // The people actually taking part: everyone selected through Who's Here, plus whoever
  // traveled here with the user and is still selected. Nobody else — presence alone never
  // adds a person to the scene.
  const selectedPeopleHere = useMemo(() => {
    const seen = new Set();
    const list = [];
    [...broughtCharacters.filter((c) => selectedNpcIdList.includes(c.id)), ...selectedNpcs].forEach((c) => {
      if (!c?.id || seen.has(c.id)) return;
      seen.add(c.id);
      list.push(c);
    });
    return list;
  }, [broughtCharacters.map((c) => c.id).join(','), selectedNpcIdList.join(','), selectedNpcs.map((n) => n.id).join(',')]);
  const traveledWithChars = broughtCharacters;

  const baseSceneParticipants = (() => {
    if (!location) return [];
    const participants = []; const seenIds = new Set();
    const presentEntities = getPresenceAtLocation(location, unifiedPresenceEntities);
    // The user's presence as the world resolves it — the same person as userParticipant.
    const ownUserPresence = presentEntities.find((e) => isUserPresenceEntity(e, currentUser?.id)) || null;
    for (const entity of presentEntities) {
      if (!entity || !entity.id || seenIds.has(entity.id)) continue;
      // A Regular NPC who is present appears in Who's Here and joins the cast only when
      // the user selects them. Being here never means being part of the scene.
      if (regularNpcIds.has(entity.id) && !characterIds.includes(entity.id)) continue;
      // Visiting ONE apartment: a resident of another apartment in the same building is
      // not in this room. They stay available through Who's Here and join the scene only
      // when the user actually selects them.
      if (activeUnitId && !characterIds.includes(entity.id)) {
        const otherUnit = getUnitForCharacter(location, entity.id);
        if (otherUnit && otherUnit.unit_id !== activeUnitId) continue;
      }
      // Whole facility: a resident of another apartment, a patient in their own room, an
      // inmate in their cell, a student in class, an employee in their own workplace is
      // elsewhere in the building — never a witness to what happens in the shared area.
      // They join only when the user selects them.
      if (!activeUnitId && !characterIds.includes(entity.id) && privateSpaceOccupantIds.has(entity.id)) continue;
      // Visiting ONE workplace: the people here are that establishment's own people —
      // its employees whose existing shift says they are working now — plus whoever
      // traveled in. The property's residents, another business's employees, and staff
      // who are not on shift are elsewhere in the building, not in this room.
      if (isWorkspaceScene && !characterIds.includes(entity.id)
        && !(workspaceEmployeeIds.has(entity.id) && onShiftIds.has(entity.id))) continue;
      // The observer is never a participant in an observed scene.
      if (observeMode && entity.id === currentUser?.id) continue;
      // The user is one person: their resolved presence is the user participant,
      // never an additional body in the scene.
      if (isUserPresenceEntity(entity, currentUser?.id)) continue;
      seenIds.add(entity.id);
      const char = characters.find((c) => c.id === entity.id); const full = char || {};
      participants.push({ ...full, id: entity.id, name: full.name || entity.display_name, display_name: entity.display_name, avatar_url: full.avatar_url || entity.avatar_url, image_avatar_url: full.image_avatar_url, reference_image_urls: [], appearance_lock: full.appearance_lock, ethnicities: full.ethnicities, gender: full.gender, personality_summary: full.personality_summary || entity.personality_summary, emotional_state: full.emotional_state || entity.emotional_state, archetype: full.archetype, age: full.age, age_range: full.age_range, resolved_presence_status: entity.resolved_presence_status, is_home_resident: entity.is_home_resident, isNpc: false, sceneRole: resolveSceneRole({ id: entity.id, resolved_presence_status: entity.resolved_presence_status }, { onShiftAtLocationIds: onShiftIds, homeResidentIds }) });
    }
    if (isResidentialSpace) { for (const fn of familyNpcSceneObjects) { if (!fn || !fn.id || seenIds.has(fn.id)) continue; seenIds.add(fn.id); participants.push({ ...fn, sceneRole: 'home resident', isNpc: true }); } }
    for (const n of npcsTravelingHere) { if (!n || !n.id || seenIds.has(n.id)) continue; seenIds.add(n.id); participants.push({ ...n, sceneRole: 'visitor', isNpc: true }); }
    for (const n of selectedNpcs) { if (!n || !n.id || seenIds.has(n.id)) continue; seenIds.add(n.id); participants.push({ ...n, sceneRole: n.sceneRole || 'visitor' }); }
    for (const n of extraNpcs) { if (!n || !n.id || seenIds.has(n.id)) continue; seenIds.add(n.id); participants.push({ ...n, sceneRole: n.sceneRole || 'visitor' }); }
    if (userParticipant && !seenIds.has(userParticipant.id)) {
      seenIds.add(userParticipant.id);
      participants.push({
        ...userParticipant,
        resolved_presence_status: userParticipant.resolved_presence_status || ownUserPresence?.resolved_presence_status,
        sceneRole: 'visitor',
      });
    }
    return participants;
  })();

  const [outfitVersion, setOutfitVersion] = useState(0);
  const [sceneParticipants, setSceneParticipants] = useState(() => baseSceneParticipants.map((p) => ({ ...p, resolvedOutfit: null })));
  const [participantsReady, setParticipantsReady] = useState(false);
  const participantIdsKey = baseSceneParticipants.map((p) => p.id).sort().join(',');

  useEffect(() => {
    // Nobody here is a valid, resolved scene — not a pending one. Watching an empty
    // place must still open and say who could be seen.
    if (!location || baseSceneParticipants.length === 0) { setSceneParticipants([]); setParticipantsReady(true); return; }
    setSceneParticipants(baseSceneParticipants.map((p) => ({ ...p, resolvedOutfit: null })));
    setParticipantsReady(false);
    let cancelled = false;
    Promise.all(baseSceneParticipants.map(async (p) => {
      if (!p || !p.id || p.isNpc === true) return p;
      try {
        let outfitText = null;
        if (p.isUser) { const res = await base44.functions.invoke('resolveUserOutfitContext', { ownerEmail: currentUser?.email, locationCategory: location?.category, locationId: location?.id }); outfitText = res?.data?.text || res?.text || null; }
        else { const res = await base44.functions.invoke('resolveCharacterOutfitContext', { characterId: p.id, locationCategory: location?.category, locationId: location?.id, ownerEmail: currentUser?.email }); outfitText = res?.data?.text || res?.text || null; }
        return { ...p, resolvedOutfit: outfitText };
      } catch { return { ...p, resolvedOutfit: null }; }
    })).then((enriched) => { if (cancelled) return; setSceneParticipants(enriched); setParticipantsReady(true); });
    return () => { cancelled = true; };
  }, [participantIdsKey, location?.id, location?.category, currentUser?.email, outfitVersion]);

  const allSceneChars = sceneParticipants;
  const displayCharacters = isVGCTowers && allSceneChars.length > 10 ? allSceneChars.slice(0, 10) : allSceneChars;
  const sceneCharacters = allSceneChars;
  const firstImage = location?.zones?.find((z) => z.image_urls?.length > 0)?.image_urls?.[0] || location?.image_urls?.[0] || null;

  // PRISON / JAIL ENTRANCE AND EXTERIOR: the incarcerated population is not offered as
  // selectable participants there — they are inside the facility, not at the gate.
  const selectableNpcCandidates = allPossibleNpcs
    .filter((n) => !sceneParticipants.some((p) => p.id === n.id))
    .filter((n) => isSelectableParticipantAtZone(characters.find((c) => c.id === n.id) || n, location, activeZone || locationZones[0]?.zone_name));

  // ── IMAGE GENERATION HOOK ──
  // Identity authority: participant ID → avatar (the only visual identity image, never a
  // fallback) + Appearance Lock. The scene's transcript goes to the picture, so an image
  // never contradicts an action the scene has already established.
  const { sceneImage, setSceneImage, isGeneratingImage, generateSceneImage } = useSceneImageGenerator({ transcript: messages });

  useEffect(() => {
    if (broughtCharacters.length === 0) return;
    setSelectedNpcIds((prev) => { const existing = prev || []; const broughtIds = broughtCharacters.map((c) => c.id); const merged = [...new Set([...existing, ...broughtIds])]; if (merged.length === existing.length && merged.every((id) => existing.includes(id))) return prev; return merged; });
  }, [broughtCharacters.map((c) => c.id).join(',')]);

  useEffect(() => {
    const handler = (e) => { if (npcDropdownRef.current && !npcDropdownRef.current.contains(e.target)) setShowNpcDropdown(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleZoneChange = (zoneName, requestImage = true) => {
    // Choosing the room already on screen changes nothing, so nothing is redrawn.
    if (zoneName === (activeZone || locationZones[0]?.zone_name)) return;
    setActiveZone(zoneName);
    setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `You move to the ${zoneName}.`, timestamp: new Date().toISOString() }]);
    if (requestImage) requestSpaceImage();
  };

  // Choosing someone from Who's Here puts them in the conversation. In a watched scene
  // that choice is also the moment's cast, so picking a background person actually
  // brings them into it instead of only changing a highlight.
  const toggleNpc = (npcId) => {
    const current = selectedNpcIds ?? [];
    const removing = current.includes(npcId);
    // An explicit choice overrides the apartment's automatic pick — the unit switch
    // never re-selects someone the user deliberately removed.
    if (removing) unitManualDeselectRef.current.add(npcId); else unitManualDeselectRef.current.delete(npcId);
    const next = removing ? current.filter((id) => id !== npcId) : [...current, npcId];
    setSelectedNpcIds(next);
    if (!observeMode) return;
    setObserveCastIds((prev) => {
      const base = prev || observeDefaultIds;
      return next.includes(npcId) ? [...new Set([...base, npcId])] : base.filter((id) => id !== npcId);
    });
  };

  useEffect(() => { if (location) { setActions(getSceneInteractions(location, activeZone || locationZones[0]?.zone_name, null)); } }, [location?.id, activeZone]);

  // Existing child-supervision check, unchanged in scope: a residence only. When it has
  // assigned (or reused) a caregiver, that caregiver is part of this household, so the
  // scene reads it again — opening the page must never leave a supervised child unseen.
  useEffect(() => {
    if (!isHomeLocation || !location?.id || !currentUser?.email) return;
    base44.functions.invoke('ensureChildCaregiverPresence', { locationId: location.id })
      .then(() => queryClient.invalidateQueries({ queryKey: ["sceneCaregivers", currentUser.email] }))
      .catch(() => {});
  }, [isHomeLocation, location?.id, currentUser?.email]);

  // Opening a supervised household opens ON the supervision, once: the caregiver is on
  // duty and the children are not alone. This is the scene's starting circumstance — it
  // never re-announces, and it never fabricates a caregiver who is not assigned.
  const caregivingAnnouncedForRef = useRef(null);
  useEffect(() => {
    if (!isHomeLocation || !location?.id || onDutyCaregiverIds.length === 0) return;
    if (caregivingAnnouncedForRef.current === location.id) return;
    caregivingAnnouncedForRef.current = location.id;
    const caregiver = characters.find((c) => c.id === onDutyCaregiverIds[0]);
    if (!caregiver) return;
    const children = characters
      .filter((c) => supervisedChildIds.includes(c.id))
      .map((c) => c.name);
    const text = children.length > 0
      ? `${caregiver.name} is here looking after ${children.join(', ')} until an adult who lives here is back.`
      : `${caregiver.name} is here, on duty as the household's caregiver.`;
    setMessages((prev) => [...prev, { id: `caregiver_${Date.now()}`, sender: "narrative", content: text, timestamp: new Date().toISOString() }]);
  }, [isHomeLocation, location?.id, onDutyCaregiverIds.join(','), characters.length]);

  useEffect(() => {
    if (!location || broughtCharacters.length === 0) return;
    // Opening the Scenes page is not an arrival. A character whose authoritative
    // location is already this place keeps their established circumstances.
    const travelling = broughtCharacters.filter((char) => char.resolved_current_location_id !== location.id);
    if (travelling.length === 0) return;
    let cancelled = false;
    Promise.all(travelling.map((char) => base44.functions.invoke('enforceCharacterLocationPresence', {
      character_id: char.id, owner_email: currentUser?.email,
      requested_presence_status: observeMode
        ? (char.current_home_location_id === location.id ? 'home' : 'visiting')
        : residencePresenceStatus(char),
      requested_location_id: location.id, requested_location_name: location.name,
      requested_source_reason: observeMode ? 'user_sent_ahead' : 'user_travel',
      requested_authority: observeMode ? 'ObserveArrival' : 'SceneArrival',
    }).then((res) => ({ char, data: res?.data })).catch((err) => ({ char, err }))))
      .then((results) => {
        if (cancelled) return;
        // The arrival is written. Presence must now be read from the characters as they
        // are — not from the records loaded before the trip, which would leave the page
        // showing only whoever was already here.
        queryClient.invalidateQueries({ queryKey: ["characters"] });
        queryClient.invalidateQueries({ queryKey: ["activeCharacters"] });
        queryClient.invalidateQueries({ queryKey: ["npcCharacters"] });
        // An arrival the authoritative system refused is said out loud, never hidden.
        const refused = results.filter((r) => r.data?.disposition
          && !['accepted', 'no_change'].includes(r.data.disposition));
        if (refused.length > 0) {
          const names = refused.map((r) => r.char.name).filter(Boolean).join(', ');
          const reason = refused[0].data?.reason;
          setMessages((prev) => [...prev, {
            id: `arrival_refused_${Date.now()}`, sender: "narrative",
            content: `${names} could not stay at ${location.name}${reason ? ` (${String(reason).replace(/_/g, ' ')})` : ''}.`,
            timestamp: new Date().toISOString(),
          }]);
        }
      });
    return () => { cancelled = true; };
  }, [location?.id, broughtCharacters.length, observeMode]);

  // ── OBSERVED CHARACTER-TO-CHARACTER EXCHANGE ──
  // One character is enough to send: whoever is already at the location joins the
  // moment. The observer is absent — their direction only shapes the circumstances,
  // and when they speak as a character those words belong to that character.
  const [isObservingTurn, setIsObservingTurn] = useState(false);
  // The same turn state as a ref, so a line spoken mid-beat is handled at once instead of
  // reading a stale value, and the latest messages are always the ones a beat answers.
  const observingTurnRef = useRef(false);
  const messagesRef = useRef([]);
  const pendingVoicesRef = useRef(0);
  messagesRef.current = messages;
  const [observeCastIds, setObserveCastIds] = useState(null);
  const observeAutoStartedRef = useRef(false);

  // Everybody who is here: those sent ahead, whoever was already here, and any
  // background person of the venue the observer picked from Who's Here. Background
  // people never join on their own — only when chosen.
  const observeCandidates = useMemo(() => {
    if (!observeMode) return [];
    const chosenBackground = new Set(selectedNpcIds || []);
    const seen = new Set();
    const list = [];
    const push = (p) => {
      if (!p?.id || seen.has(p.id)) return;
      if (isUserPresenceEntity(p, currentUser?.id) || p.id === currentUser?.id) return;
      const background = p.isNpc === true || String(p.id).startsWith('npc_');
      if (background && !chosenBackground.has(p.id)) return;
      if (background && !p.name) return;
      seen.add(p.id);
      list.push(background ? { ...p, isNpc: true } : p);
    };
    [...broughtCharacters, ...sceneParticipants].forEach(push);
    // A court participant taking part by remote link is in the proceeding without being
    // in the room: they can speak and be spoken to, and never appear in a picture of it.
    remoteParticipants.forEach((p) => push({ ...p, isNpc: false, isRemoteParticipant: true }));
    return list;
  }, [observeMode, broughtCharacters.map((c) => c.id).join(','), sceneParticipants.map((p) => p.id).join(','), currentUser?.id, (selectedNpcIds || []).join(','), remoteParticipants.map((p) => p.id).join(',')]);

  // The characters who were sent are the ones in the moment by default. When nothing
  // was sent, the people already at this place are the moment. Everyone else here is
  // offered, not assumed — the user picks who they came to see.
  const observeSentIds = useMemo(
    () => broughtCharacters.filter((c) => !c.isNpc && c.id).map((c) => c.id),
    [broughtCharacters.map((c) => c.id).join(',')]
  );
  const observeDefaultIds = useMemo(() => {
    // The cast of a watched scene is exactly who is in the chosen space. A workplace is
    // its own space — its people on shift, never the building's residents. When the whole
    // property or venue is the scene, everyone genuinely present is the cast: the count
    // comes from actual presence, never from a fixed number.
    // The cast is exactly the people in the space being watched: an apartment's own
    // occupants, or the business's own people on shift. Never the rest of the building
    // and never every resident of a multi-unit property — a multi-purpose property does
    // not make everyone in it part of this moment. Those people stay offered in Who's
    // Here and join only when the observer picks them.
    const base = observeSentIds.length > 0 ? observeSentIds : presentHereIds;
    const chosenBackground = observeCandidates.filter((c) => c.isNpc).map((c) => c.id);
    // The household's assigned caregiver is part of a watched residence: the children they
    // actually supervise are never in the moment alone, and the caregiver is never replaced
    // by an unrelated background person or a neighbour from another unit.
    const supervision = observeCandidates
      .filter((c) => {
        if (c.isNpc === true) return false;
        if (isAssignedCaregiverHere(c)) return true;
        return supervisedChildIds.includes(c.id);
      })
      .map((c) => c.id);
    return [...new Set([...base, ...chosenBackground, ...supervision])];
  }, [observeSentIds.join(','), observeCandidates.map((c) => c.id).join(','), unitPresentOccupantIds.join(','), presentHereIds.join(','), activeWorkspace?.workplace_id]);
  const observeCastIdList = observeCastIds || observeDefaultIds;
  const observeCast = observeCandidates.filter((c) => observeCastIdList.includes(c.id));
  const toggleObserveCast = (id) => setObserveCastIds((prev) => {
    const base = prev || observeDefaultIds;
    return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
  });

  // Thief and Lawbreaker may attempt a theft wherever a target exists. This is
  // CHARACTER-specific availability: it is offered because of who is in the scene, never
  // because of where the scene is — and only for the people who actually carry it.
  const traitCrimeActions = useMemo(() => {
    const cast = observeMode ? observeCast : selectedPeopleHere;
    if (!castHasCrimeTrait(cast)) return [];
    const present = new Set(actions.map((a) => a.id));
    return TRAIT_GATED_CRIME_ACTIONS.filter((a) => !present.has(a.id));
  }, [actions.map((a) => a.id).join(','), observeMode, (observeMode ? observeCast : selectedPeopleHere).map((p) => p.id).join(',')]);

  // The people actually here who can DO something: an activity belongs to one of them.
  // Background people of the venue are never puppeted and infants cannot act on cue.
  const observeActors = useMemo(
    () => observeCast.filter((c) => c.id
      && c.isNpc !== true
      && !String(c.id).startsWith("npc_")
      && !isInfantCharacter(c)),
    [observeCast.map((c) => c.id).join(',')]
  );

  // The people who can perform an activity while the user is present: the selected scene
  // cast only. A coworker on shift, a resident or a background person of the venue is here
  // but not part of the scene, so they are never offered as the one doing it.
  const userPresentActors = useMemo(
    () => selectedPeopleHere.filter((c) => c?.id
      && !c.isUser
      && c.id !== currentUser?.id
      && c.isNpc !== true
      && !String(c.id).startsWith("npc_")
      && !isInfantCharacter(c)),
    [selectedPeopleHere.map((c) => c.id).join(','), currentUser?.id]
  );

  // The user is a person in this scene whenever they are physically here. An activity that
  // someone performs must be able to be performed by them — watching is not presence, so
  // the observer is never added. This only feeds the activity selector.
  const activityActors = useMemo(() => {
    if (observeMode || !currentUser?.id) return userPresentActors;
    const alreadyListed = userPresentActors.some((c) => c.id === currentUser.id);
    if (alreadyListed) return userPresentActors;
    return [...userPresentActors, {
      id: currentUser.id,
      name: displayName,
      avatar_url: currentUser.avatar_url || null,
      isUser: true,
    }];
  }, [observeMode, currentUser?.id, currentUser?.avatar_url, displayName, userPresentActors.map((c) => c.id).join(',')]);

  // ── THE PLACE IS POPULATED ──
  // A public venue keeps its ordinary people — its staff and its patrons — whether the
  // user is taking part or watching, and whether or not any established character is
  // selected. Being at the location is not the same as being in the scene: none of these
  // people is a participant, none of them speaks, and none of them is created here.
  // Private residences and restricted/staff-only zones get none.
  const venueAmbientPopulation = useMemo(() => buildBackgroundPopulation({
    npcs: allPossibleNpcs,
    isHomeLocation,
    isRestrictedEnv,
    // A dorm room, studio apartment or other private living space of the property gets
    // no ambient population merely because it sits inside a school. The shared school
    // zones keep theirs.
    isPrivateSpace: isPrivateResidentialZone(location, activeZone || locationZones[0]?.zone_name),
    activeZone: activeZone || locationZones[0]?.zone_name,
  }), [allPossibleNpcs.filter((n) => n.isNpc === true).map((n) => n.id).join(','), isHomeLocation, isRestrictedEnv, activeZone, location?.id]);

  // Background people who support the picture. Whoever is chosen from Who's Here is
  // named first so the person being spoken to is in the frame with the real people;
  // the rest of the crowd stays behind them. They are never the main subject.
  const sceneAmbientPopulation = useMemo(() => {
    const chosen = observeMode
      ? observeCast
        .filter((c) => c.isNpc === true && c.name)
        .map((c) => ({ id: c.id, name: c.name, role: c.role || c.npcType || 'person' }))
      : selectedNpcs
        .filter((n) => n.isNpc === true && n.name)
        .map((n) => ({ id: n.id, name: n.name, role: n.role || n.npcType || 'person' }));
    // The venue's own staff and patrons come after whoever was chosen, so the person the
    // scene is with is never pushed out of the frame by the room's ordinary people.
    const rest = venueAmbientPopulation.filter((a) => !chosen.some((c) => c.id === a.id));
    return [...chosen, ...rest];
  }, [observeMode, observeCast.map((c) => c.id).join(','), venueAmbientPopulation, selectedNpcs.map((n) => n.id).join(',')]);

  // ── DIRECTED CHARACTER INTERACTIONS ──
  // Kiss / Flirt With / Argue With need a target the user chooses from the people who
  // are actually present. The list comes from the authoritative scene participants:
  // NPC placeholders, the user, deceased characters and infants are never offered.
  const directedTargets = useMemo(() => {
    const seen = new Set();
    // In a watched scene the moment belongs to the chosen cast — target one of them.
    const castSet = observeMode ? new Set(observeCastIdList) : null;
    return sceneParticipants
      .filter((p) => {
        if (!p || !p.id || p.isNpc || p.isUser) return false;
        if (p.id === currentUser?.id) return false;
        if (String(p.id).startsWith("npc_")) return false;
        if (castSet && !castSet.has(p.id)) return false;
        if (p.life_status === "deceased" || p.status === "deceased") return false;
        if (isInfantCharacter(p)) return false;
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
      .map((p) => ({ id: p.id, name: p.name || p.display_name, avatar_url: p.avatar_url, is_adult: isAdultForActivity(p) }));
  }, [sceneParticipants.map((p) => p.id).join(","), currentUser?.id, observeMode, observeCastIdList.join(",")]);

  // WHO THE SELECTOR MAY OFFER — exactly the people already taking part in this scene,
  // the same pool Kiss, Flirt With and Argue With use. The Who's Here directory is a
  // separate thing: someone in another room is listed there, never offered here. If the
  // user wants someone else involved, they bring them into the scene through Who's Here
  // first, and that selection — never this picker — decides who is here.
  const directedPickableTargets = directedTargets;

  // Who can be paired with this action: an adults-only activity offers only established
  // adults, and never the person acting. Nobody outside the scene is ever substituted in.
  const directedPartnersFor = (action, actorId = null) =>
    (action?.adults_only ? directedPickableTargets.filter((t) => t.is_adult) : directedPickableTargets)
      .filter((t) => t.id !== actorId);

  // In a watched scene the person who starts it is chosen too — the observer never is.
  const directedActorsFor = (action) => observeActors
    .filter((c) => (action?.adults_only ? isAdultForActivity(c) : true))
    .filter((c) => directedPartnersFor(action, c.id).length > 0);

  const directedAvailable = (action) => (observeMode
    ? directedActorsFor(action).length > 0
    : directedPartnersFor(action).length > 0);

  // ── RECIPIENT ACTIONS (prison / jail interactions) ──
  // A shakedown, a search, a warning, an escort involves ONE person who is actually
  // here. The facility's temporary Inmate counts — they are a person of this place, so a
  // confined character always has someone for the interaction.
  const recipientTargets = useMemo(() => {
    const seen = new Set();
    return sceneParticipants
      .filter((p) => {
        if (!p || !p.id || p.isUser) return false;
        if (p.id === currentUser?.id) return false;
        if (String(p.id).startsWith("npc_owner_")) return false;
        if (p.life_status === "deceased" || p.status === "deceased") return false;
        if (isInfantCharacter(p)) return false;
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
      .map((p) => ({ id: p.id, name: p.name || p.display_name, avatar_url: p.avatar_url }));
  }, [sceneParticipants.map((p) => p.id).join(","), currentUser?.id]);

  // The chosen person is the one it happens to. The action updates the top image to show
  // it, moves the scene when the action is an escort, and the chosen person answers
  // through the existing dialogue pipeline.
  const performRecipientAction = async (action, target) => {
    if (!action || !target?.id) return;
    const zoneName = action.zone_move ? (action.suggested_zone_name || null) : null;
    const actionImageFn = ACTION_IMAGE_PROMPTS[action.id];

    // A watched scene: the interaction belongs to the people in it. The chosen person is
    // the one it happens to, someone else here carries it out, and nobody in the room was
    // told to do anything by anyone outside it. The observer is never in the picture.
    if (observeMode) {
      if (zoneName && zoneName !== activeZone) setActiveZone(zoneName);
      const counterpart = observeActors.find((c) => c.id !== target.id) || null;
      if (actionImageFn) {
        generateSceneImage({
          location, locationZones, activeZone: zoneName || activeZone, sceneParticipants, userParticipant,
          isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap,
          strictCastOnly: true, ambientPopulation: sceneAmbientPopulation,
          actionFocusIds: [counterpart?.id, target.id].filter(Boolean),
          actionOverridePrompt: actionImageFn(location?.name || location?.category, [counterpart?.name, target.name].filter(Boolean).join(" and ")),
        });
      }
      if (observeCast.length >= 2) {
        runObserveBeat({
          direction: `[${action.emoji} ${action.label} — ${counterpart ? `${counterpart.name} with ${target.name}` : target.name}]`,
          actorName: counterpart?.name || null,
        });
      } else {
        setMessages((prev) => [...prev, { id: `obs_recipient_${Date.now()}`, sender: "narrative", content: `${action.emoji} ${action.label} — ${target.name} at ${location?.name}.`, timestamp: new Date().toISOString() }]);
      }
      return;
    }

    // An activity that moves the scene into its own space draws that space's picture itself,
    // so the move changes the space without asking for a second, generic picture.
    if (zoneName && zoneName !== activeZone) { setActiveZone(zoneName); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `You move to the ${zoneName}.`, timestamp: new Date().toISOString() }]); }
    if (actionImageFn) {
      const who = [displayName, target.name].filter(Boolean).join(" and ");
      generateSceneImage({
        location, locationZones, activeZone: zoneName || activeZone, sceneParticipants, userParticipant,
        isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap,
        actionFocusIds: [target.id, ...(userParticipant?.id ? [userParticipant.id] : [])],
        actionOverridePrompt: actionImageFn(location?.name || location?.category, who),
      });
    }
    await sendMessage(`[${action.emoji} ${action.label} — ${target.name}]`, true, null, null, null, null, null, false, {
      id: target.id,
      name: target.name,
      instruction: `${displayName} carries out "${action.label}" involving ${target.name}. ${target.name} reacts directly to what ${displayName} does.`,
    }, {
      // A strip action between two people, shown centered with both of them named.
      content: activityFeedLine({ actionId: action.id, label: action.label, participants: [displayName, target.name] }),
      emoji: action.emoji,
      behavior: activityBehaviorFor(action),
    });
  };

  // In a character-only scene the invitation comes FROM the character who is there,
  // never from the absent user.
  const characterInviter = observeMode
    ? (observeCast.find((c) => !c.isNpc && c.id && !String(c.id).startsWith("npc_")) || null)
    : null;
  const { spawnNpc, spawnNpcModal } = useSpawnNpc({ location, activeZone, sceneParticipants, setExtraNpcs, setMessages, queryClient, currentUser });
  const handleDirectedTarget = (target) => {
    const action = directedAction;
    setDirectedAction(null);
    if (!action || !target?.id) return;
    // The top scene image must show the interaction itself — the person acting and the
    // person it is aimed at. In a watched scene the actor is the character the observer
    // picked (or the only one here); when the user is present, the user is the one acting.
    const actor = observeMode
      ? (action.actorName
        ? { id: action.actorId, name: action.actorName }
        : (observeCast.find((c) => c.id !== target.id && sceneParticipants.some((p) => p.id === c.id)) || null))
      : userParticipant;
    const actorName = actor?.name || actor?.display_name || null;
    // The direction names the person taking the action, so the moment belongs to them
    // and never to the absent observer.
    // An interface-only title never becomes character vocabulary: where the strip's name
    // would otherwise reach the narrative, the moment itself is described instead.
    const inWorld = IN_WORLD_ACTIVITY_TEXT[action.id] || null;
    const pairNames = actorName ? `${actorName} with ${target.name}` : target.name;
    const label = inWorld
      ? `[${inWorld.direction} — ${pairNames}]`
      : observeMode && actorName
        ? `[${action.emoji} ${action.label} — ${actorName} with ${target.name}]`
        : `[${action.emoji} ${action.label} — ${target.name}]`;
    // Inside the car the moment stays in the car: the view follows the two people, drawn
    // against the owner's own vehicle references. Off-camera people remain in the ride.
    const inCarShot = buildRideShot(ride, action, [actor?.id], [target.id]);
    if (actor?.id && actorName) {
      generateSceneImage({
        location, locationZones, activeZone, sceneParticipants, userParticipant,
        isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap,
        strictCastOnly: observeMode || !!inCarShot,
        ambientPopulation: inCarShot ? undefined : sceneAmbientPopulation,
        actionFocusIds: inCarShot ? inCarShot.visibleIds : [actor.id, target.id],
        // The sentence names the selected zone, not only the property: "at Street — Riverside"
        // is where the moment happens, and the activity never moves it somewhere else.
        actionOverridePrompt: inCarShot ? null : buildDirectedActionPrompt({
          actionId: action.id,
          actorName,
          targetName: target.name,
          locationName: [location?.name, typeof activeZone === "string" ? activeZone : null].filter(Boolean).join(" — ") || location?.name,
        }),
        ...(inCarShot ? rideImageRequest(ride, inCarShot) : {}),
      });
    }
    // Whether this action is an established event or behavior being carried out now is
    // decided in one place, so the feed, the scene and the picture agree.
    const behavior = activityBehaviorFor(action);
    const activity = {
      content: activityFeedLine({
        actionId: action.id,
        label: action.label,
        verb: behavior === "immediate" ? (action.past_verb || action.verb) : action.verb,
        participants: [actorName, target.name],
      }),
      emoji: action.emoji,
      behavior,
    };
    // A watched scene stages the moment between the people in it: the cast acts on it.
    if (observeMode) {
      // Both people in a directed interaction take part in it, so the scene is written
      // as a moment between them — the person spoken to is the one standing there. A kiss
      // is already done; a flirt is played out now.
      const pairNames = [actorName, target.name].filter(Boolean);
      // One person starts it and the other answers: only the actor acts here, never both as
      // a mutual moment, so nobody reacts to what the actor has not yet said or done.
      if (behavior === "immediate") runObserveBeat({ narrative: `${activity.content}.`, actorName, actorNames: pairNames, activity });
      else runObserveBeat({ direction: label, actorName, initiatorName: actorName, activity });
      return;
    }
    sendMessage(label, true, null, null, null, null, null, false, {
      id: target.id,
      name: target.name,
      instruction: `${displayName} ${behavior === "immediate" ? (action.past_verb || action.verb) : action.verb} ${target.name}.`,
      behavior,
    }, activity);
  };

  // `actorName` names the person taking the directed action, so the moment is written as
  // theirs and never as anyone else's — the observer above all.
  // A line the observer speaks AS a character belongs to that character and is shown at
  // once — never the observer's words — and is remembered by them exactly as before.
  const appendVoicedLine = (speaker, spoken) => {
    if (!speaker?.id || !spoken) return null;
    const line = {
      id: `voiced_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sender: "character",
      senderName: speaker.name,
      characterId: speaker.id,
      avatarUrl: speaker.avatar_url,
      content: spoken,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, line]);
    messagesRef.current = [...messagesRef.current, line];
    // A background person of the facility has no record to remember with — only an
    // established character keeps the memory of their own words.
    if (speaker.isNpc !== true && !String(speaker.id).startsWith("npc_")) {
      recordVoicedLineMemory({ speaker, listeners: observeCast.filter((c) => c.id !== speaker.id), content: spoken, location }).catch(() => {});
    }
    return line;
  };

  const runObserveBeat = async ({ direction = null, voiceAs = null, narrative = null, actorName = null, actorNames = null, initiatorName = null, activity = null } = {}) => {
    if (!observeMode || !location) return;
    const speaker = voiceAs?.character;
    const spoken = (voiceAs?.content || "").trim();
    // The others are still answering. A line spoken as a character is recorded now and
    // answered by the next beat, in the order it was said — the observer never waits for
    // another character to finish before saying the next thing.
    if (observingTurnRef.current) {
      if (speaker?.id && spoken) {
        appendVoicedLine(speaker, spoken);
        pendingVoicesRef.current += 1;
      }
      return;
    }
    const cast = observeCast;
    // Established people carry identity and memory. Background people of the venue
    // speak in role only and never write memories.
    const characterCast = cast.filter((c) => c.id && c.isNpc !== true && !String(c.id).startsWith("npc_"));
    const backgroundCast = cast.filter((c) => c.isNpc === true || String(c.id).startsWith("npc_"));
    const ambientHere = venueAmbientPopulation.filter((a) => !backgroundCast.some((b) => b.id === a.id));
    // A chosen background person is enough to hold the moment on their own — they
    // speak for themselves in role, so selecting them is never just a highlight.
    if (characterCast.length === 0 && backgroundCast.length === 0) {
      setMessages((prev) => [...prev, { id: `obs_hint_${Date.now()}`, sender: "narrative", content: "No one is here to watch yet — send a character here, or pick someone from Who's Here.", timestamp: new Date().toISOString() }]);
      return;
    }
    // Speaking AS a character is never gated on someone else being here: a person alone
    // still says their own words. Only a beat that needs another person to answer it is.
    if (characterCast.length + backgroundCast.length < 2 && ambientHere.length === 0 && !voiceAs) {
      setMessages((prev) => [...prev, { id: `obs_hint_${Date.now()}`, sender: "narrative", content: "Pick someone from Who's Here — no one else is in this part of the place right now.", timestamp: new Date().toISOString() }]);
      return;
    }
    setIsObservingTurn(true);
    observingTurnRef.current = true;
    // NARRATIVE — what has already happened. Canon: the characters already lived it.
    // DIRECT — what happens next. It is played out now, not treated as history.
    const narration = (narrative || "").trim();
    const note = (direction || "").trim();
    // A strip activity is shown as a centered scene activity naming the people taking
    // part — never as a message, and never as the user's words. Its mode is unchanged:
    // an immediate activity is canon, a direct one is a direction being played out.
    if (narration) {
      setMessages((prev) => [...prev, activity
        ? { id: `act_${Date.now()}`, sender: "activity", content: activity.content, emoji: activity.emoji || null, is_canon_event: true, timestamp: new Date().toISOString() }
        : { id: `nar_${Date.now()}`, sender: "narrative", content: narration, is_canon_event: true, timestamp: new Date().toISOString() }]);
    } else if (note) {
      setMessages((prev) => [...prev, activity
        ? { id: `act_${Date.now()}`, sender: "activity", content: activity.content, emoji: activity.emoji || null, is_canon_event: false, timestamp: new Date().toISOString() }
        : { id: `dir_${Date.now()}`, sender: "stage", content: note, timestamp: new Date().toISOString() }]);
    }

    // Words the observer spoke as a character ARE that character's words:
    // shown as their line and remembered by them as something they said.
    const priorLine = appendVoicedLine(speaker, spoken);

    // A sleeping character does not answer, react or take part in the conversation. Nobody
    // else is ever given their lines, and the beat simply has no one to answer it.
    const responders = (priorLine ? cast.filter((c) => c.id !== priorLine.characterId) : cast).filter((c) => !isSleepingCharacter(c));
    // A character who is alone still speaks for themselves: the line is recorded as
    // theirs, and no exchange is invented around it.
    if (responders.length === 0) {
      setIsObservingTurn(false);
      return;
    }
    try {
      const { lines, action } = await generateObserveBeat({
        participants: characterCast, responders, location, activeZone,
        messages: priorLine ? [...messagesRef.current, priorLine] : messagesRef.current,
        direction: note || null, narrative: narration || null, ownerEmail: currentUser?.email,
        // The account holder's world name, so the scene can be told plainly who is not
        // here and whose name is never the person being spoken to.
        observerName: displayName || null,
        actorName: actorName || null,
        // Several people taking part in the same activity at once.
        actorNames: Array.isArray(actorNames) && actorNames.length > 1 ? actorNames : null,
        // A directed interaction: this person starts it, and only then does anyone answer.
        initiatorName: initiatorName || null,
        // Inside one unit of a multi-unit property, the scene stays in that space and the
        // speaker the observer chose keeps their own name.
        unitScope: sceneUnitScope,
        // Speak As: the identified character (their own record ID) is the speaker.
        spokenBy: speaker?.id ? { id: speaker.id, name: speaker.name, content: spoken, role: speaker.isNpc === true ? speaker.role : null } : null,
        ambient: ambientHere,
        npcSpeakers: backgroundCast,
        // A watched court proceeding or ceremony keeps the same established roles and
        // attendance the setup fixed before the scene began.
        venueContext: governmentContextBlock || null,
        watchNote: watchContext
          ? (buildWatchContextLabel(watchContext) || watchContext.linkAnalysisContext || (watchContext.title ? `They are watching "${watchContext.title}" together.` : "They are watching a video together."))
          : null,
      });
      // Something they did on their own, when the moment genuinely led to it. It reads
      // exactly like an activity the observer selected — because it is the same thing.
      if (action) {
        setMessages((prev) => [...prev, { id: action.id, sender: "activity", content: action.content, emoji: action.emoji, is_canon_event: action.is_canon_event, timestamp: new Date().toISOString() }]);
      }
      if (lines.length === 0) {
        if (!action) setMessages((prev) => [...prev, { id: `obs_quiet_${Date.now()}`, sender: "narrative", content: "The moment passes quietly between them.", timestamp: new Date().toISOString() }]);
      } else {
        for (const line of lines) {
          setMessages((prev) => [...prev, line]);
          await new Promise((r) => setTimeout(r, 450));
        }
        recordObserveBeatMemories({ lines, participants: characterCast, priorLine })
          .then(() => queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }))
          .catch(() => {});
        // A narrative is canon: those events are part of what these people lived through.
        if (narration) recordNarrativeMemories({ narrative: narration, participants: characterCast, lines }).catch(() => {});
      }
    } catch {
      setMessages((prev) => [...prev, { id: `obs_err_${Date.now()}`, sender: "narrative", content: "The moment did not continue.", timestamp: new Date().toISOString() }]);
    } finally {
      setIsObservingTurn(false);
      observingTurnRef.current = false;
      // Lines spoken while this beat was running are answered now, in the order they were
      // said: nothing is dropped, and the cast replies once to what it was actually told.
      if (pendingVoicesRef.current > 0) {
        pendingVoicesRef.current = 0;
        runObserveBeat();
      }
    }
  };

  // The first beat of an observed scene opens on its own — no user turn required.
  useEffect(() => {
    if (!observeMode || !location?.id || !participantsReady) return;
    if (observeAutoStartedRef.current) return;
    // One character is enough: the place around them has its own people.
    if (!observeCast.some((c) => c.id && c.isNpc !== true && !String(c.id).startsWith("npc_"))) return;
    observeAutoStartedRef.current = true;
    runObserveBeat();
  }, [observeMode, location?.id, participantsReady, observeCastIdList.join(',')]);

  usePageContext({ page: 'scene', locationId: locationId || null });

  // Who was actually in the scene, and when. Someone who arrives partway through cannot
  // remember what happened before they got there, and someone who leaves does not remember
  // what came after. Recorded against message positions so each person's memory is built
  // from their own part of the scene.
  const presenceWindowsRef = useRef({});
  const messagesLengthRef = useRef(0);
  messagesLengthRef.current = messages.length;
  const participantKey = observeMode
    ? (observeCastIdList || []).join(',')
    : selectedNpcIdList.join(',');
  useEffect(() => {
    const at = messagesLengthRef.current;
    const windows = presenceWindowsRef.current;
    const present = new Set(participantKey ? participantKey.split(',') : []);
    Object.keys(windows).forEach((id) => {
      if (!present.has(id) && !Number.isInteger(windows[id].to)) windows[id].to = at;
    });
    present.forEach((id) => {
      if (!id) return;
      if (!windows[id]) windows[id] = { from: at };
      else if (Number.isInteger(windows[id].to)) delete windows[id].to; // came back
    });
  }, [participantKey, observeMode]);

  // The scene's single completion (Life Journal + exit memory), shared by every exit path.
  const {
    exitMemoryArgs: _exitMemoryArgs,
    writeJournal: _writeSceneJournal,
    completeBeforeTransition: _completeSceneBeforeTransition,
  } = useSceneCompletion({
    broughtCharacters, selectedNpcIdList, selectedNpcs, observeCast, observeMode,
    sceneCharacters, location, messages, displayName,
    ownerEmail: currentUser?.email, presenceWindows: presenceWindowsRef.current,
  });

  const handleLeaveWithCharacters = async () => {
    setShowLeaveModal(false);
    await Promise.all([
      ...broughtCharacters.map((char) => {
        // A companion goes back where they came from — the place they were before this
        // trip — not necessarily home. Someone who was at work, at school or at a
        // friend's place returns there; only a companion with no recorded origin goes home.
        const originId = travelOrigins[char.id];
        if (originId) {
          return base44.functions.invoke('enforceCharacterLocationPresence', {
            character_id: char.id, owner_email: currentUser?.email,
            requested_presence_status: originId === char.current_home_location_id ? 'home' : 'visiting',
            requested_location_id: originId,
            requested_location_name: locationMap[originId]?.name || null,
            requested_source_reason: 'returned_from_trip_with_user', requested_authority: 'SceneExit'
          }).catch(() => {});
        }
        return base44.functions.invoke('enforceCharacterLocationPresence', {
          character_id: char.id, owner_email: currentUser?.email,
          requested_presence_status: 'home',
          requested_source_reason: 'returned_home_with_user', requested_authority: 'SceneExit'
        }).catch(() => {});
      }),
      writeSceneExitMemories(_exitMemoryArgs('left_together')).catch(() => {}),
      _writeSceneJournal('left_together')
    ]);
    // A government proceeding or ceremony ends with the scene: the participants are
    // released to their own schedules instead of staying anchored to the venue.
    releaseGovernmentAttendance?.();
    if (isSharedResidence) setUserAway().catch(() => {});
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }); navigate(exitDestinationRef.current || "/travel");
  };

  const handleLeaveCharactersBehind = async () => {
    setShowLeaveModal(false);
    await Promise.all([
      ...broughtCharacters.map((char) =>
        base44.functions.invoke('enforceCharacterLocationPresence', {
          character_id: char.id, owner_email: currentUser?.email,
          requested_presence_status: residencePresenceStatus(char),
          requested_location_id: location.id, requested_location_name: location.name,
          requested_source_reason: 'user_stay_decision', requested_authority: 'SceneExit',
          requested_stay_lock: true, presence_stay_lock_reason: 'user_scene_stay',
          presence_stay_lock_authority: 'SceneExit', presence_stay_lock_release_condition: 'scene_end',
          presence_stay_lock_created_by: 'user'
        }).catch(() => {})
      ),
      writeSceneExitMemories(_exitMemoryArgs('stayed_behind')).catch(() => {}),
      _writeSceneJournal('stayed_behind')
    ]);
    releaseGovernmentAttendance?.();
    if (isSharedResidence) setUserAway().catch(() => {});
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }); navigate(exitDestinationRef.current || "/travel");
  };

  // Stay Here — the Scenes page closes, the world does not move. The scene is completed
  // through the same journal/memory process, but nobody leaves the place: the user's
  // authoritative presence and every character's location are left exactly as they are.
  const handleStayHere = async () => {
    setShowLeaveModal(false);
    await Promise.all([
      writeSceneExitMemories(_exitMemoryArgs('stayed_here')).catch(() => {}),
      _writeSceneJournal('stayed_here')
    ]);
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    navigate(exitDestinationRef.current || "/travel");
  };

  // The phone's Media Gallery is a Scenes exit like any other: the same physical exit
  // choices, the same journal and memories — only the page that opens afterwards is the
  // Gallery. Watching a scene has nobody to ask about a physical exit, so the scene is
  // completed and the Gallery opens.
  const openMediaGalleryFromPhone = async () => {
    setShowPhone(false);
    exitDestinationRef.current = "/media-gallery";
    if (!observeMode) { setShowLeaveModal(true); return; }
    await Promise.all([
      // The scene is completed before the page changes. A failed write is a failure of the
      // write, never of the exit: the Gallery still opens.
      writeSceneExitMemories(_exitMemoryArgs("stayed_here")).catch(() => {}),
      _writeSceneJournal("stayed_here")
    ]);
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    navigate("/media-gallery");
  };

  useEffect(() => { const el = bottomRef.current; if (!el) return; const container = el.parentElement; if (container) { const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight; if (distFromBottom < 150) el.scrollIntoView({ behavior: "smooth", block: "end" }); } }, [messages.length]);

  useEffect(() => { if (!location) return; const interval = setInterval(() => { setActions(getSceneInteractions(location, activeZone || locationZones[0]?.zone_name, null)); }, 180000); return () => clearInterval(interval); }, [location?.id, activeZone]);

  // ── IMAGE PARTICIPANT SELECTION ──
  // Selects a subset of sceneParticipants by stable ID. The user is already a participant.
  // (The selection rules themselves live in sceneImageParticipants.js.)
  const selectImageParticipants = createImageParticipantSelector({
    sceneParticipants, characters, observeMode, observeCast, isHomeLocation,
    broughtCharacters, selectedNpcIdList, supervisedChildIds, userParticipant,
    selectedNpcIds, presentHereIds,
  });

  // The top picture belongs to the selected scene space — the property, the unit inside it,
  // and the room. A manual change of any of them draws one picture of the new space; the
  // cast follows the selection in both modes, and an activity that draws its own picture
  // never comes through here, so no second, generic picture replaces it.
  const selectionImageKey = observeMode ? observeCastIdList.join(',') : selectedNpcIdList.join(',');
  // The ride, for the space-picture guard below (set from the ride hook further down): while
  // it is a car, no room picture may be cleared or redrawn over it.
  const rideActiveRef = useRef(null);
  const { requestSpaceImage, refreshImage } = useSceneSpaceImage({
    suspendedRef: rideActiveRef,
    locationId: location?.id,
    isRabbitHole: !!location?.is_rabbit_hole,
    spaceKey: `${location?.id || ''}|${activeUnitId || ''}|${activeZone || ''}`,
    selectionKey: selectionImageKey,
    sceneImage,
    setSceneImage,
    isGeneratingImage,
    imageRequested: hasUserRequestedImage,
    setImageRequested: setHasUserRequestedImage,
    participantsReady,
    observeMode,
    observeCastCount: observeCast.length,
    drawImage: (opts) => generateSceneImage({ location, locationZones, activeZone, sceneParticipants, userParticipant, isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap, strictCastOnly: observeMode, ambientPopulation: sceneAmbientPopulation, manualRefresh: opts?.manualRefresh === true }),
  });

  useEffect(() => { if (hasUserRequestedImage) return; if (!location || location.is_rabbit_hole) return; if (characterIds.length > 0 && broughtCharacters.length < characterIds.length) return; setHasUserRequestedImage(true); }, [hasUserRequestedImage, location?.id, location?.is_rabbit_hole, broughtCharacters.length, characterIds.length]);

  // The store this scene is actually inside, and what this visit is for. A property that
  // merely contains a business is not the store, and zones of one store are one destination.
  const shoppingVisit = useShoppingVisit({ location, spaceId: activeUnitId || null });

  const generateFocusedImage = (prompt) => {
    if (isGeneratingImage) return;
    base44.integrations.Core.GenerateImage({ prompt: `${prompt} Photorealistic, high quality, close-up detail.`, existing_image_urls: firstImage ? [firstImage] : undefined }).then((r) => setSceneImage(r.url)).catch(() => {});
  };

  // Inside the car the picture stays the car: a text-triggered room or item picture would
  // replace the vehicle the scene is actually happening in.
  const checkImageTrigger = (text, actionImagePrompt = null, actionCategory = null, explicitPrice = null, purchaseSource = null, isFreeOffering = false, purchaseItemKind = null, purchaseMerchandise = null, payerType = null, payerCharacterId = null, purchasePreferences = null, shopper = null) => { if (ride) return; _checkImageTrigger({ text, actionImagePrompt, actionCategory, explicitPrice, purchaseSource, isFreeOffering, purchaseItemKind, purchaseMerchandise, payerType, payerCharacterId, purchasePreferences, shopper, location, messages, generateFocusedImage, setMessages }); };

  // A narrative is something that has already happened, dialogue included. It is recorded
  // as canon so character replies treat it as a recent lived experience, never as words
  // just spoken to them.
  const sendNarration = (text) => { if (!text.trim()) return; setInputText(""); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: text, is_canon_event: true, timestamp: new Date().toISOString() }]); };

  // `activity` marks a turn that came from the activity strip rather than from something
  // the user said. It is shown as a centered scene activity — never as an outgoing
  // message — and it tells the scene whether the moment has already happened (immediate)
  // or is behavior being carried out now (direct).
  const sendMessage = async (text, fromAction = false, actionImagePrompt = null, actionScenePrompt = null, actionCategory = null, explicitPrice = null, purchaseSource = null, isFreeOffering = false, directedTarget = null, activity = null, purchaseItemKind = null, purchaseMerchandise = null, { continuation = false, payerType = null, payerCharacterId = null, purchasePreferences = null, shopper = null } = {}) => {
    if (!location) return;
    // LET THEM CONTINUE — nobody said anything new. The people here carry the moment on
    // by themselves instead of stopping and waiting for the user's next line.
    if (!continuation && !text.trim()) return;
    setInputText("");
    // A continuation is not a user turn: nothing is put in the user's mouth.
    if (!continuation) {
      const userMsg = activity
        ? { id: Date.now().toString(), sender: "activity", content: activity.content, emoji: activity.emoji || null, is_canon_event: activity.behavior === "immediate", timestamp: new Date().toISOString() }
        : { id: Date.now().toString(), sender: "user", content: text, timestamp: new Date().toISOString() };
      setMessages((prev) => [...prev, userMsg]);
    }

    const wpIntent = detectWorldPhoneIntent(text);
    if (wpIntent && wpIntent.recipient && (privateTarget || (broughtCharacters.filter(c => !c.isNpc).length === 1))) {
      const wpSender = privateTarget || broughtCharacters.find(c => !c.isNpc);
      if (wpSender) base44.functions.invoke('sendWorldPhoneMessage', { sender_character_id: wpSender.id, recipient_identifier: wpIntent.recipient, requested_message: wpIntent.message, user_instruction_context: wpIntent.message ? null : text, source: 'user_instruction', owner_email: currentUser?.email }).catch(err => console.warn('[Scene] World Phone send failed:', err?.message));
    }

    checkImageTrigger(text, actionImagePrompt, actionCategory, explicitPrice, purchaseSource, isFreeOffering, purchaseItemKind, purchaseMerchandise, payerType, payerCharacterId, purchasePreferences, shopper);
    setIsTyping(true);

    // Identity and memory for everyone here, fetched together rather than one group after
    // the other — the same context as before, without the reply waiting twice.
    const { crossMem, canonicalCtx } = await loadSceneResponseContext({ cast: [...broughtCharacters, ...selectedNpcs], characters, ownerEmail: currentUser?.email });

    try {
      // Established events stay canon: a narrative line is something that has ALREADY
      // happened, never a character speaking or a new event.
      const conversationHistory = messages.slice(-12).map((m) => {
        if (m.is_canon_event) return `(already happened, before this moment) ${m.content}`;
        if (m.sender === "narrative") return `(situation) ${m.content}`;
        if (m.sender === "stage") return `(already played out) ${m.content}`;
        if (m.sender === "activity") return `(a directed moment, played out just now) ${m.content}`;
        return `${m.sender === "user" ? displayName : m.senderName || "Character"}: ${m.content}`;
      }).join("\n");
      const privateNote = privateTarget ? `\nNOTE: ${displayName} pulled ${privateTarget.name} aside for a PRIVATE conversation. Only ${privateTarget.name} may respond.` : "";
      const selectedCharIds = selectedNpcIdList;
      // A directed interaction is answered by the chosen person only — never by someone else.
      const directedChar = directedTarget
        ? (sceneCharacters.find((c) => c.id === directedTarget.id) || { id: directedTarget.id, name: directedTarget.name })
        : null;
      const dialogueEligible = directedChar ? [directedChar] : privateTarget ? sceneCharacters.filter((c) => c.id === privateTarget.id || c.name === privateTarget.name) : selectedCharIds.length > 0 ? [...broughtCharacters.filter((c) => selectedCharIds.includes(c.id)), ...selectedNpcs].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i) : [];
      // INFANTS ARE PRESENT, NOT CONVERSATIONAL: age 0 is a newborn — physically in
      // the scene, never capable of speech or an adult conversational response.
      const infantCharacters = dialogueEligible.filter((c) => isInfantCharacter(c));
      // Someone asleep is here but not conversational: they never answer, initiate or react,
      // and their words are never put in anyone else's mouth.
      const speakingEligible = dialogueEligible.filter((c) => !isInfantCharacter(c) && !isSleepingCharacter(c));
      const charSummaries = speakingEligible.map((c) => `${c.name} (${c.personality_summary?.split(".")[0] || c.archetype || "character"}, mood: ${c.emotional_state || "calm"})`).join("; ");
      const eligibleKnownChars = speakingEligible.filter((c) => !c.isNpc);
      const eligibleNpcList = speakingEligible.filter((c) => c.isNpc).map((n) => `${n.name} (${n.role || "NPC"}${n.personality_summary ? ", " + n.personality_summary.split(".")[0] : ""})`).join(", ");
      const npcInstruction = `IMPORTANT: Only these people may respond — no one else, ever:\n- Selected characters: ${[...eligibleKnownChars.map((c) => c.name), ...(eligibleNpcList ? [eligibleNpcList] : [])].join(", ") || "none"}\nResidents, owners, and employees who are present but NOT selected must NOT respond.\nIf no one is listed, return an empty responses array. Do NOT invent responses from unselected people.${privateNote}`;
      // A background person chosen from Who's Here is a real participant: when the line
      // is aimed at them they answer for themselves, in role. They are never puppeted —
      // the user keeps their own person, and this only makes the chosen person answer.
      const selectedBackground = speakingEligible.filter((c) => c.isNpc === true);
      const addressedBackground = findAddressedBackgroundPeople(text, selectedBackground);
      const backgroundRule = buildBackgroundResponderRule({ addressed: addressedBackground, selected: selectedBackground });
      // Inside one apartment / patient room / cell, the property-wide co-presence roster in
      // the canonical context is corrected: it says the whole building is in this space.
      const canonicalSection = eligibleKnownChars.filter((c) => canonicalCtx[c.id]).map((c) => `=== ${c.name} — FULL CANONICAL IDENTITY ===\n${scopeCanonicalContext(canonicalCtx[c.id], sceneUnitScope)}\n=== END ${c.name} ===`).join('\n\n');
      const memSection = eligibleKnownChars.filter((c) => crossMem[c.id]).map((c) => `[${c.name}'s memory]\n${crossMem[c.id]}`).join('\n\n');
      const infantRule = infantCharacters.length > 0
        ? `\nINFANT PRESENT — CANNOT SPEAK (mandatory): ${infantCharacters.map((c) => c.name).join(", ")} ${infantCharacters.length === 1 ? "is a newborn baby" : "are newborn babies"}. They are physically present but non-verbal: they may only be described non-verbally (crying, cooing, babbling, reaching, sleeping). ⛔ Do NOT give them words, sentences, questions, answers, or dialogue of any kind. ⛔ Do NOT include them in the responses array. Other people present may respond and may react to the baby.`
        : "";
      const ageGateRules = speakingEligible.map(childSpeechLimit).filter(Boolean).join('\n');
      const watchContextBlock = watchContext ? `\n=== WATCH PARTY CONTEXT ===\n${displayName} and everyone present are watching a video together right now.\n${buildWatchContextLabel(watchContext) || "A video is playing."}\n\n${watchContext.linkAnalysisContext || `WATCH PARTY RULES (analysis in progress):\n- You know you are watching something together.\n- You MUST NOT pretend to know the video's contents until analysis completes.\n- If asked about the video content, say you can only know what ${displayName} shares.`}\n===\n` : "";

      // An immediate activity has ALREADY happened: it is a lived moment, not a proposal.
      // A direct one is being performed now, and how it is received is still open.
      const directedBlock = directedTarget ? `\n=== DIRECTED INTERACTION ===\n${directedTarget.instruction}\nOnly ${directedTarget.name} answers. React exactly as this character would — given their relationship with ${displayName}, their personality, mood, memories, and what just happened.\n${directedTarget.behavior === "immediate"
        ? `- This has already happened. ${directedTarget.name} has just lived it: respond to having experienced it. Never question whether it happened, never agree to it, and never play it out a second time.`
        : `- It is being carried out now, and it is not a guarantee of how it lands: hesitating, deflecting, being caught off guard, or turning it down is a valid response.`}\n- An argument answers the real friction of this moment — never invent an unrelated conflict.\nDo not narrate ${displayName}'s actions or thoughts.\n` : "";

      // What the scene is responding to this turn. A strip activity is never phrased as
      // something the user said: it is either an event that has happened or a moment being
      // played out, and in both cases it replaces whatever they were doing before it.
      const momentLine = continuation
        ? `Nobody has said anything new. The moment at ${location.name} carries on by itself: the people here keep talking and doing things among themselves, they do not wait for ${displayName}, and they may start something of their own. Never write words, actions, or thoughts for ${displayName}, and never treat them as having just spoken.`
        : activity
        ? (activity.behavior === "immediate"
          ? `This has ALREADY HAPPENED, from the moment it was chosen: ${activity.direction || activity.content}\nIt is a lived event — not a proposal, not a question, not an instruction. Nobody asks whether it should happen, nobody agrees to it, and nobody plays it out again. It is the situation they are in now and it replaces whatever they were doing before it. What they say and do is the consequence of it.`
          : `This is being played out right now: ${activity.direction || activity.content}\nCarry it out through what they actually say and do — never merely acknowledge that it was asked for, and never announce it as a plan.`)
        : `${displayName} just said: "${text}"`;

      // Who is here and why, from their existing records: employment and job title,
      // school enrollment, residence, or genuine visitation. This is what stops an
      // employee speaking like a customer and a student speaking like a loiterer.
      const circumstancesBlock = buildSceneCircumstances({
        location,
        participants: sceneParticipants,
        backgroundPeople: selectedNpcs.filter((n) => n.isNpc === true).map((n) => ({ id: n.id, name: n.name, role: n.role })),
        onShiftAtLocationIds: onShiftIds,
        homeResidentIds,
        locationsById: locationMap,
        ride,
      });

      // The scene stays in the selected space; the rest of the property is elsewhere.
      const unitBoundary = buildUnitBoundaryBlock(sceneUnitScope);

      const responses = await base44.integrations.Core.InvokeLLM({
        prompt: `You are managing a ${privateTarget ? "private one-on-one" : "group"} scene at ${location.name} (${location.category}).\n${eligibleKnownChars.filter((c) => broughtCharacters.find((b) => b.id === c.id)).length > 0 ? `CONTINUITY: ${eligibleKnownChars.filter((c) => broughtCharacters.find((b) => b.id === c.id)).map((c) => c.name).join(", ")} traveled here WITH ${displayName} — do NOT treat them as strangers.` : ''}\nPeople present: ${displayName}, ${charSummaries || "no one they know"}\n${canonicalSection ? `\n=== FULL CANONICAL IDENTITY ===\n${canonicalSection}\n===` : ''}${memSection ? `\n=== CROSS-PAGE MEMORY ===\n${memSection}\n===` : ''}${circumstancesBlock ? `\n${circumstancesBlock}\n` : ''}${unitBoundary ? `\n${unitBoundary}\n` : ''}${governmentContextBlock ? `\n${governmentContextBlock}\n` : ''}\n${watchContextBlock}${directedBlock}\n\nRecent scene conversation:\n${conversationHistory}\n${messages.some((m) => m.is_canon_event) ? `\nA line marked "already happened" is an event these people have lived through, its dialogue included. They experienced it; nobody answers it, replies to it, or treats it as something said to them now.\n` : ''}\n${momentLine}\n${fromAction && !activity ? "(This was from a scene action, not typed directly)" : ""}\n\n${npcInstruction}\n${backgroundRule}\n${infantRule}${ageGateRules ? `\nAGE SPEECH RULES (mandatory):\n${ageGateRules}\n` : ''}\nKeep each response 1-2 sentences, natural and in-character.\nCRITICAL: Do NOT say your character's own name in the response — use "I", "we", "me", or "us" instead.\n\nReturn JSON:\n{\n  "responses": [\n    { "character_name": "...", "content": "..." }\n  ]\n}`,
        response_json_schema: { type: "object", properties: { responses: { type: "array", items: { type: "object", properties: { character_name: { type: "string" }, content: { type: "string" } } } } } }
      });

      setIsTyping(false);
      const responseList = responses?.responses || [];
      for (const resp of responseList) {
        const respNameLower = resp.character_name?.trim().toLowerCase();
        const userNames = [displayName?.trim().toLowerCase(), currentUser?.full_name?.trim().toLowerCase(), currentUser?.email?.split("@")[0]?.toLowerCase(), settings?.fictional_world_name?.trim().toLowerCase(), ...(settings?.user_aliases || []).map((a) => a?.trim().toLowerCase())].filter(Boolean);
        if (userNames.includes(respNameLower)) continue;
        const char = sceneCharacters.find((c) => c.name === resp.character_name)
          || speakingEligible.find((c) => c.name?.trim().toLowerCase() === respNameLower);
        // Infants cannot speak — never render a reply attributed to a newborn.
        if (char && isInfantCharacter(char)) continue;
        let cleanedContent = filterDashes(resp.content);
        if (char) { try { const wpResult = await handleCharacterWorldPhoneAction({ responseText: cleanedContent, character: char, characterId: char.id, conversationId: null, ownerEmail: currentUser?.email, recentMessages: messages.slice(-15) }); cleanedContent = wpResult.responseText || cleanedContent; } catch {} }
        const msg = { id: Date.now().toString() + resp.character_name, sender: "character", senderName: resp.character_name, characterId: char?.id, avatarUrl: char?.avatar_url, content: cleanedContent, timestamp: new Date().toISOString() };
        setMessages((prev) => [...prev, msg]);
        if (char) { const realBrought = broughtCharacters.filter((c) => !c.isNpc && c.id !== char.id); base44.functions.invoke("extractMemoriesFromTurn", { characterId: char.id, userMessage: continuation ? "(no new line — the scene carried on by itself)" : text, characterReply: cleanedContent, playingAsCharacterId: realBrought[0]?.id || null, witnessCharacterIds: realBrought.slice(1).map((c) => c.id) }).catch(() => {}); }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (responseList.length === 0) { const hasAnyone = dialogueEligible.length > 0; setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: hasAnyone ? `The atmosphere at ${location.name} hums quietly. No one responds right away.` : `You take in the surroundings at ${location.name}. Use the "Who's here" button to start talking to someone.`, timestamp: new Date().toISOString() }]); }
    } catch { setIsTyping(false); }
  };

  // ── GOVERNMENT VISIT: SETUP → SCENE ─────────────────────────────────────────
  const {
    governmentVenueType,
    showVenueSetup,
    setShowVenueSetup,
    courtCase,
    cityHallPlan,
    marriageModal,
    setMarriageModal,
    judicialModal,
    setJudicialModal,
    governmentContextBlock,
    beginVisit: beginGovernmentVisit,
    releaseAttendance: releaseGovernmentAttendance,
    handleGovernmentAction,
    handleJudicialResolved,
    handleJudicialNarrative,
    recordMarriageMemories,
    addGovernmentNarrative,
  } = useGovernmentVenueScene({
    location,
    locationId,
    characters: courtCharacters,
    observeMode,
    observeCast,
    displayName,
    currentUser,
    queryClient,
    setMessages,
    sendMessage,
    runObserveBeat,
    // The temporary people of the court and City Hall leave when the event ends.
    onEventConcluded: () => {
      const isTempEventNpc = (id) => String(id).startsWith("npc_court_") || id === "npc_cityhall_officiant";
      const remoteIds = remoteParticipants.map((p) => p.id);
      const drop = (id) => isTempEventNpc(id) || remoteIds.includes(id);
      setExtraNpcs((prev) => prev.filter((n) => !drop(n.id) && n.npcType !== "remote_participant" && n.npcType !== "court_participant"));
      setSelectedNpcIds((prev) => (prev || []).filter((id) => !drop(id)));
      setObserveCastIds((prev) => (prev ? prev.filter((id) => !remoteIds.includes(id)) : prev));
      setRemoteParticipants([]);
    },
  });

  // The setup modal is the preparation stage for the event. Every selected participant is
  // brought to the venue through the existing presence authority before the proceeding
  // begins, and the roles nobody was assigned are filled by the court's own people.
  // Everyone attending joins the scene's cast — being in the cast makes a person able to
  // speak; it never makes them speak.
  const handleBeginGovernmentVisit = async (config) => {
    const prepared = await beginGovernmentVisit(config);
    if (!prepared) return;
    const temps = prepared.tempNpcs || [];
    if (temps.length > 0) {
      setExtraNpcs((prev) => [...prev.filter((n) => !String(n.id).startsWith("npc_court_") && n.id !== "npc_cityhall_officiant"), ...temps]);
    }
    // Participants taking part remotely stay where they actually are. They join the
    // proceeding as remote voices — never as people in the room, never in its picture.
    const remote = prepared.remoteParticipants || [];
    setRemoteParticipants(remote);
    if (remote.length > 0) {
      setExtraNpcs((prev) => [
        ...prev.filter((n) => n.npcType !== "remote_participant"),
        ...remote.map((p) => ({ id: p.id, name: p.name, role: `${p.roleLabel} — appearing remotely`, isNpc: false, npcType: "remote_participant", avatar_url: p.avatar_url })),
      ]);
    }
    // A role held by someone outside the scene pool (a test-flagged regular NPC) still joins the proceeding.
    const courtOnly = (prepared.attendanceIds || []).filter((id) => !characters.some((c) => c.id === id))
      .map((id) => courtCharacters.find((c) => c.id === id)).filter(Boolean)
      .map((c) => ({ id: c.id, name: c.name, role: "Court participant", isNpc: false, npcType: "court_participant", avatar_url: c.avatar_url || null }));
    if (courtOnly.length > 0) setExtraNpcs((prev) => [...prev.filter((n) => n.npcType !== "court_participant"), ...courtOnly]);
    const cast = [...temps.map((n) => n.id), ...(prepared.attendanceIds || [])];
    if (cast.length > 0) setSelectedNpcIds((prev) => [...new Set([...(prev || []), ...cast])]);
    // Watching a proceeding: everyone the case established is in the room for the whole
    // case, whether or not they speak in a given moment — so they are in the watched cast.
    if (observeMode && cast.length > 0) {
      setObserveCastIds((prev) => [...new Set([...(prev || observeDefaultIds), ...cast])]);
    }
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ["activeCharacters", currentUser?.email] });
  };

  // Leaving the Scenes page ends the event: participants are released to their own
  // schedules. The case or ceremony records themselves are untouched.
  const releaseAttendanceRef = useRef(null);
  releaseAttendanceRef.current = releaseGovernmentAttendance;
  useEffect(() => () => { releaseAttendanceRef.current?.(); }, []);

  useEffect(() => { narratorModeRef.current = narratorMode; }, [narratorMode]);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
  useEffect(() => { sendNarrationRef.current = sendNarration; }, [sendNarration]);
  const stableOnSend = useRef((text) => { if (narratorModeRef.current) sendNarrationRef.current?.(text); else sendMessageRef.current?.(text); }).current;
  // LET THEM CONTINUE — available here too, not only while watching: at a location the
  // people keep the conversation going on their own instead of waiting for the user.
  const stableOnContinue = useRef(() => sendMessageRef.current?.("", false, undefined, undefined, undefined, undefined, undefined, false, undefined, undefined, undefined, undefined, { continuation: true })).current;

  const { handleMoveIn, handleMoveOut, handleAskToLeave } = useSceneResidenceActions({
    location, broughtCharacters, setMessages, queryClient, currentUser, setShowMoveInPopup, setIsMoveInLoading,
  });

  // In a watched scene the observer does nothing themselves: choosing something from the
  // strip is what a person IN the scene does. The action belongs to that character — one
  // eligible character acts by default, and with several the observer says which one.
  // Choosing it never puts the observer at the location.
  const handleObserveAction = (action) => {
    if (actionCooldown) return;
    // Only an established adult may take part in an adults-only activity.
    const actors = eligibleForAction(observeActors, action);
    if (actors.length === 0) {
      setMessages((prev) => [...prev, { id: `obs_nobody_${Date.now()}`, sender: "narrative", content: action?.adults_only
        ? "That is only for adults, and no adult is here to take part."
        : "No one is here to do that — pick someone from Who's Here.", timestamp: new Date().toISOString() }]);
      return;
    }
    if (actors.length === 1) { performObserveAction(action, actors[0]); return; }
    // Several people here: the observer chooses exactly who takes part — one of them, or
    // several at once. Nobody is preselected and nobody joins who was not chosen.
    setActorAction({ action, mode: "activity" });
  };

  // The chosen people perform and experience the activity themselves: the picture shows
  // them doing it, the moment is played out between the people here, and an ordinary meal
  // or drink is recorded against each person who actually has it. Several people means one
  // shared moment, not one person acting while the others watch.
  const performObserveAction = async (action, people) => {
    const actors = (Array.isArray(people) ? people : [people]).filter((p) => p?.id);
    if (actionCooldown || actors.length === 0) return;
    // A watched walk is walked by the animal on that character's own profile, or not at all.
    if (action.id === "walk_pet") {
      const pet = (await loadBelongings(currentUser?.email, "character", actors[0].id))?.pet || null;
      if (!hasPet(pet)) { setMissingBelonging({ kind: "pet", ownerName: actors[0].name, isUser: false }); return; }
    }
    const names = actors.map((a) => a.name).filter(Boolean);
    const whoNames = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    // A watched offer opens the same product card — nothing is charged or eaten until it is accepted.
    if (isPurchaseOfferAction(action)) { presentOfferInWatchedScene({ action, names, actorId: actors[0].id, locationName: location?.name, setMessages, checkImageTrigger, activityBehaviorFor, activityFeedLine, preferences: shoppingVisit.preferences, shopper: actors[0] }); return; }
    // An interface-only label never becomes character vocabulary: the scene is given what
    // is actually happening instead of the button's name.
    const inWorld = IN_WORLD_ACTIVITY_TEXT[action.id] || null;
    setActionCooldown(true);
    try {
      const actionImageFn = ACTION_IMAGE_PROMPTS[action.id];
      if (actionImageFn) {
        // The picture is the activity itself, drawn in the room the activity establishes.
        generateSceneImage({ location, locationZones, activeZone: action.suggested_zone_name || activeZone, sceneParticipants, userParticipant, isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap, strictCastOnly: true, ambientPopulation: sceneAmbientPopulation, actionFocusIds: actors.map((a) => a.id), showerState: SHOWER_ACTION_IDS.includes(action.id), actionOverridePrompt: actionImageFn(location?.name || location?.category, whoNames) });
      }
      if (EATING_ACTION_IDS.includes(action.id)) {
        const mealSize = ['buy_round', 'char_buy_round', 'drinks', 'drink'].includes(action.id) ? 'snack' : 'meal';
        actors.forEach((actor) => { base44.functions.invoke('recordEatingEvent', { characterId: actor.id, mealSize, foodDescription: action.label, locationName: location?.name }).catch(() => {}); });
        queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
      }
      // Which mode this activity uses is decided in one place — a meal already on the
      // table is an established event, cooking is behavior carried out now.
      const behavior = activityBehaviorFor(action);
      const activity = {
        content: activityFeedLine({
          actionId: action.id,
          label: action.label,
          verb: behavior === "immediate" ? (action.past_verb || action.verb) : action.verb,
          participants: names,
        }),
        emoji: action.emoji,
        behavior,
      };
      const direction = inWorld ? `[${inWorld.direction} — ${whoNames}]` : `[${action.emoji} ${action.label} — ${whoNames}]`;
      if (observeCast.length >= 2) {
        if (behavior === "immediate") {
          // Already the case: it is canon the moment it is chosen, and it replaces what
          // they were doing before it (eating after cooking is the meal, not more cooking).
          const established = action.past_verb && names.length === 2
            ? `${names[0]} ${action.past_verb} ${names[1]}.`
            : `${whoNames} ${inWorld ? inWorld.past : action.label.toLowerCase()}${location?.name ? ` at ${location.name}` : ""}.`;
          runObserveBeat({ narrative: established, actorName: names.length === 1 ? names[0] : null, actorNames: names, activity });
        } else {
          runObserveBeat({ direction, actorName: names.length === 1 ? names[0] : null, actorNames: names, activity });
        }
      } else {
        setMessages((prev) => [...prev, { id: `obs_act_${Date.now()}`, sender: "activity", content: activity.content, emoji: action.emoji, is_canon_event: behavior === "immediate", timestamp: new Date().toISOString() }]);
      }
    } finally {
      setTimeout(() => setActionCooldown(false), 600);
    }
  };

  // Who performs it: the people the observer picked. A directed interaction still asks for
  // its target afterwards, so the one acting and the one it is aimed at stay distinct.
  const handleActorSelect = (person) => {
    const pending = actorAction;
    setActorAction(null);
    if (!pending || !person?.id) return;
    // Pickpocket is aimed AT someone: the actor is chosen here, the target next. Neither is
    // assumed, and the two are never the same person.
    if (pending.action.id === "pickpocket") { setCrimeTargetAction({ action: pending.action, actor: person }); return; }
    if (CRIME_ACTIVITY_IDS.includes(pending.action.id)) { handleCrimeAction(pending.action, [person]); return; }
    if (pending.mode === "directed") setDirectedAction({ ...pending.action, actorId: person.id, actorName: person.name });
    else if (observeMode) performObserveAction(pending.action, person);
    // The user is present: the chosen person performs it through the normal activity path.
    else handleAction(pending.action, [person]);
  };

  // Several chosen people take part in the same activity, together.
  const handleActorsConfirm = (people) => {
    const pending = actorAction;
    setActorAction(null);
    if (!pending || !people?.length) return;
    if (CRIME_ACTIVITY_IDS.includes(pending.action.id)) { handleCrimeAction(pending.action, people); return; }
    if (observeMode) performObserveAction(pending.action, people);
    else handleAction(pending.action, people);
  };

  // The target of a pickpocket attempt — the people actually in this scene, never the
  // person attempting it, and never someone merely listed in Who's Here.
  const crimeTargetOptions = useMemo(() => {
    const actorId = crimeTargetAction?.actor?.id || null;
    return [...sceneParticipants, ...(observeMode ? observeCast : selectedPeopleHere)]
      .filter((p) => p?.id && p.id !== actorId && !p.isUser && p.id !== currentUser?.id && p.isNpc !== true
        && !String(p.id).startsWith("npc_owner_") && !isInfantCharacter(p)
        && p.life_status !== "deceased" && p.status !== "deceased")
      .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
      .map((p) => ({ id: p.id, name: p.name || p.display_name, avatar_url: p.avatar_url }));
  }, [crimeTargetAction?.actor?.id, sceneParticipants.map((p) => p.id).join(','), observeMode, selectedPeopleHere.map((p) => p.id).join(','), currentUser?.id]);

  const handleCrimeTargetSelect = (target) => {
    const pending = crimeTargetAction;
    setCrimeTargetAction(null);
    if (!pending?.actor?.id || !target?.id) return;
    handleCrimeAction(pending.action, [pending.actor], target);
  };

  const handleDirectedSelect = (directed) => {
    if (actionCooldown) return;
    if (!observeMode) { setDirectedAction(directed); return; }
    // Only someone here can start it, and only toward someone else who is here.
    const actors = directedActorsFor(directed);
    if (actors.length === 0) {
      setMessages((prev) => [...prev, { id: `obs_nopair_${Date.now()}`, sender: "narrative", content: directed.adults_only
        ? "That is only for adults, and no two adults are here for it."
        : "No one else is here to try that with yet — pick someone from Who's Here.", timestamp: new Date().toISOString() }]);
      return;
    }
    if (actors.length === 1) { setDirectedAction({ ...directed, actorId: actors[0].id, actorName: actors[0].name }); return; }
    setActorAction({ action: directed, mode: "directed" });
  };

  // ── COURTROOM AUTHORITY ──
  // The roles the setup assigned decide who may perform each courtroom activity. An
  // established character and the court's own temporary person are equally eligible,
  // because authority comes from the role, never from having a permanent record.
  const runCourtAction = (action, actor, subject = null) => {
    if (!actor?.id) return;
    const subjects = courtSubjects(courtCase, action.id).filter((p) => p.id !== actor.id);
    if (!subject && subjects.length > 0) { setCourtSubjectAction({ action, actor }); return; }
    const line = courtActionLine(action, actor, subject);
    // The proceeding itself is unchanged; only its presentation is: a courtroom action
    // from the strip is a centered scene activity, never an outgoing message, and the
    // court's own wording still reaches the scene through `direction`.
    const courtActivity = {
      content: activityFeedLine({ actionId: action.id, label: action.label, participants: [actor.name] }),
      emoji: action.emoji,
      behavior: activityBehaviorFor(action),
      direction: line,
    };
    if (observeMode) {
      if (observeCast.length >= 2) runObserveBeat({ direction: line, actorName: actor.name, activity: courtActivity });
      else setMessages((prev) => [...prev, { id: `court_${Date.now()}`, sender: "activity", content: courtActivity.content, emoji: action.emoji, is_canon_event: courtActivity.behavior === "immediate", timestamp: new Date().toISOString() }]);
      return;
    }
    sendMessage(line, true, null, null, null, null, null, false, null, courtActivity);
  };

  // A single eligible actor acts directly; several open the existing target picker.
  const startCourtAction = (action) => {
    const actors = courtActors(courtCase, action.id);
    if (actors.length === 0) return;
    if (actors.length === 1) { runCourtAction(action, actors[0]); return; }
    setCourtActorAction(action);
  };

  // ── CRIME ACTIVITIES ─────────────────────────────────────────────────────────
  // Pickpocket, Burglarize and Call the Cops use the same strip, the same actor selector
  // and the same narrative pipeline as every other activity. What actually comes of the
  // attempt is settled from the circumstances that already exist — the thief is not
  // automatically caught, being caught is not automatically an arrest, and calling the
  // police does not guarantee one. When an arrest really happens it is carried out by the
  // existing custody pathway and the modal only decides where the user's view goes.
  const [arrestTransition, setArrestTransition] = useState(null);
  const [arrestVisitors, setArrestVisitors] = useState(null);
  const [isResolvingCrime, setIsResolvingCrime] = useState(false);

  const crimeCast = observeMode ? observeCast : selectedPeopleHere;

  const handleCrimeAction = async (action, people = null, target = null) => {
    if (actionCooldown || isResolvingCrime) return;
    const chosen = (Array.isArray(people) ? people : people ? [people] : []).filter((p) => p?.id);
    const actors = chosen.length > 0 ? chosen : crimeCast.filter((p) => p?.id);
    const names = actors.map((p) => p.name || p.display_name).filter(Boolean);
    if (names.length === 0 && !observeMode) names.push(displayName);
    setActionCooldown(true);
    setIsResolvingCrime(true);
    try {
      const outcome = await resolveCrimeOutcome({
        actionId: action.id,
        actorNames: names,
        // Whose pocket, whose property — only ever the person the user chose.
        targetName: target?.name || target?.display_name || null,
        castNames: crimeCast.map((p) => p.name || p.display_name).filter(Boolean),
        locationName: location?.name,
        locationCategory: location?.category,
        circumstances: buildSceneCircumstances({
          location,
          participants: sceneParticipants,
          backgroundPeople: [],
          onShiftAtLocationIds: onShiftIds,
          homeResidentIds,
          locationsById: locationMap,
        }),
        recentContext: messages.slice(-6).map((m) => m.content).filter(Boolean).join('\n'),
      });

      // Police attendance, when it is actually needed, comes from the app's existing
      // temporary-NPC mechanism — never a new character record.
      if (outcome.officerNeeded && !officerAlreadyHere(crimeCast)) {
        const officer = buildRespondingOfficer();
        setExtraNpcs((prev) => (prev.find((n) => n.id === officer.id) ? prev : [...prev, officer]));
        setSelectedNpcIds((prev) => [...new Set([...(prev || []), officer.id])]);
        if (observeMode) setObserveCastIds((prev) => [...new Set([...(prev || observeDefaultIds), officer.id])]);
      }

      const activity = {
        content: activityFeedLine({ actionId: action.id, label: action.label, participants: names }),
        emoji: action.emoji,
        behavior: "immediate",
        direction: outcome.direction || `${names.join(" and ")} — ${action.label.toLowerCase()}.`,
      };

      if (observeMode) {
        runObserveBeat({ narrative: `${activity.content}. ${outcome.direction}`.trim(), actorNames: names, activity });
      } else {
        await sendMessage(`[${action.emoji} ${action.label} — ${names.join(" and ")}]`, true, null, null, null, null, null, false, null, activity);
      }

      if (outcome.arrested) {
        const arrested = actors.find((p) => (p.name || p.display_name) === outcome.arrestedName) || actors[0];
        const facility = pickCustodyFacility(locationsData);
        // The account holder is never taken into custody as a character record — only an
        // established character of the world is.
        const isRealCharacter = arrested?.id && !arrested.isNpc && !arrested.isUser
          && arrested.id !== currentUser?.id && !String(arrested.id).startsWith("npc_");
        if (isRealCharacter && facility?.id) {
          const res = await base44.functions.invoke('arrestCharacter', {
            character_id: arrested.id,
            facility_id: facility.id,
            offense: action.label,
            notes: outcome.direction,
          });
          const data = res?.data || {};
          if (data?.success && !data.skipped) {
            queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
            queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
            setArrestTransition({
              character: arrested,
              facility: { ...facility, name: data.facility_name || facility.name },
              unitId: data.unit_id || null,
              unitName: data.unit_name || null,
            });
          }
        }
      }
    } catch {
      setMessages((prev) => [...prev, { id: `crime_err_${Date.now()}`, sender: "narrative", content: "That did not go through.", timestamp: new Date().toISOString() }]);
    } finally {
      setIsResolvingCrime(false);
      setTimeout(() => setActionCooldown(false), 600);
    }
  };

  // The arrest has already happened. These only decide where the view goes next.
  const goToCustody = (visitorIds = []) => {
    const arrest = arrestTransition;
    setArrestTransition(null);
    setArrestVisitors(null);
    if (!arrest) return;
    // Following the arrest ends this scene, so it is completed before the custody scene
    // loads — the arrest and what led to it stay part of what happened here.
    _completeSceneBeforeTransition(arrest.facility.name);
    const ids = [arrest.character.id, ...visitorIds].filter(Boolean).join(",");
    const unit = arrest.unitId ? `&unitId=${arrest.unitId}` : "";
    navigate(`/scene?locationId=${arrest.facility.id}&characterIds=${ids}${unit}`);
  };
  const followArrest = () => {
    const arrest = arrestTransition;
    if (!arrest) return;
    // Anyone else from this scene may come along as a visitor — never as an inmate.
    const companions = crimeCast.filter((p) => p?.id
      && p.id !== arrest.character.id
      && p.id !== currentUser?.id
      && !p.isUser
      && p.isNpc !== true
      && !String(p.id).startsWith("npc_"));
    if (companions.length > 0) {
      setArrestVisitors({
        action: { id: "arrest_visitors", label: "Come along", emoji: "🚗" },
        targets: companions.map((p) => ({ id: p.id, name: p.name || p.display_name, avatar_url: p.avatar_url })),
      });
      return;
    }
    goToCustody([]);
  };
  const watchCustody = () => {
    const arrest = arrestTransition;
    setArrestTransition(null);
    setArrestVisitors(null);
    if (!arrest) return;
    // Watching the custody scene still ends this one: it is recorded before the new
    // scene loads, without putting the user in the room.
    _completeSceneBeforeTransition(arrest.facility.name);
    const unit = arrest.unitId ? `&unitId=${arrest.unitId}` : "";
    navigate(`/scene?locationId=${arrest.facility.id}&observe=1&characterIds=${arrest.character.id}${unit}`);
  };
  // Accepting an invitation from inside a scene moves the scene elsewhere, so it ends this
  // one the same way — recorded first, then the destination scene loads.
  const handleAcceptInvite = (invite) => {
    base44.functions.invoke('recordCharacterInviteAccepted', { characterId: invite.characterId, locationId: invite.locationId, inviteType: invite.inviteType }).catch(() => {});
    const remaining = pendingInvitations.filter((i) => i.characterId !== invite.characterId);
    setPendingInvitations(remaining.length > 0 ? remaining : null);
    _completeSceneBeforeTransition(locationMap[invite.locationId]?.name || null);
    const charIds = invite.characterIds ? invite.characterIds.join(",") : invite.characterId;
    navigate(`/scene?locationId=${invite.locationId}&characterIds=${charIds}`);
  };

  // ── SCENE TRANSITION CONTROLS ────────────────────────────────────────────────
  // Arrest uses the same custody pathway as the crime activities; Next Scene moves the
  // scene to another existing location through the existing presence pipeline. Neither is
  // a character activity, and neither adds anyone to the scene.
  const [arrestPicker, setArrestPicker] = useState(null);
  const [showNextScene, setShowNextScene] = useState(false);
  // Take a Ride and the two missing-property conditions. Both are answers, never silence.
  const [showRidePicker, setShowRidePicker] = useState(false);
  const [missingBelonging, setMissingBelonging] = useState(null);
  const { arrestTargets: arrestTargetsFor, handleArrest } = useSceneArrest({ base44, queryClient, currentUser, locationsData, setMessages, setArrestPicker, setArrestTransition });
  const arrestTargets = arrestTargetsFor(crimeCast);
  const nextSceneParticipants = (observeMode ? observeCast : [...traveledWithChars, ...selectedNpcs, ...extraNpcs])
    .filter((c, i, arr) => c?.id && arr.findIndex((x) => x.id === c.id) === i)
    .filter((c) => !c.isNpc && !String(c.id).startsWith("npc_") && c.id !== currentUser?.id)
    .map((c) => ({ id: c.id, name: c.name || c.display_name, avatar_url: c.avatar_url }));

  // The transition itself lives in sceneNextScene.js — the modal only decides where the
  // scene goes next; confirming it is what moves people and opens the destination.
  const handleNextSceneConfirm = (payload) => {
    setShowNextScene(false);
    return runNextSceneTransition(payload, { base44, queryClient, currentUser, observeMode, nextSceneParticipants, setMessages, navigate, completeScene: _completeSceneBeforeTransition });
  };

  // Take a Ride: the car becomes the scene, and the ride ends at the destination already chosen.
  const { ride, handleRideConfirm, handleArriveAtDestination, buildRideShot } = useSceneRide({
    drawImage: (opts) => generateSceneImage({ location, locationZones, activeZone, sceneParticipants, userParticipant, isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap, ...opts }),
    location, nextSceneParticipants, currentUser, displayName, observeMode, setMessages, handleNextSceneConfirm });
  // The space-picture guard reads this: a ride suspends every room redraw.
  rideActiveRef.current = ride;

  // `actors` is the person or people chosen through the existing selector for an activity
  // that asks who performs it (Work). Without a choice, the selected scene cast takes part.
  const handleAction = async (action, actors = null) => {
    // WALK A PET walks the animal registered on the walker's own profile. An actor without
    // one is told exactly that, and the activity does not happen — no invented animal, no
    // picture, and no effect for something nobody did.
    let walkPet = null; let walkPetOwner = null;
    if (action.id === "walk_pet") {
      const walker = (Array.isArray(actors) && actors.length > 0 ? actors : selectedPeopleHere)[0] || null;
      const walkerIsUser = !walker || walker.isUser || walker.id === currentUser?.id;
      walkPet = (await loadBelongings(currentUser?.email, walkerIsUser ? "user" : "character", walkerIsUser ? (currentUser?.id || "user") : walker?.id))?.pet || null;
      walkPetOwner = walkerIsUser ? displayName : walker?.name;
      if (!hasPet(walkPet)) { setMissingBelonging({ kind: "pet", ownerName: walkPetOwner, isUser: walkerIsUser }); return; }
    }
    if (actionCooldown) return; setActionCooldown(true);
    const actingPeople = Array.isArray(actors) && actors.length > 0 ? actors : selectedPeopleHere;
    try {
      const actionClass = action.action_class;
      const payer = action.payer || "user"; const cost = Number(action.cost) || 0;
      const isPaidClass = actionClass && ['purchase', 'service', 'fee'].includes(actionClass);
      // An explicitly paid purchase offers its product card whoever is paying. A character
      // paying for the item is not a reason to skip the interactive offer and charge at
      // once — the card, the Try On and the purchase step stay available either way.
      const isProductCardAction = actionClass === 'purchase' && cost > 0 && !!action.action_category && action.purchase_source != null;
      // WHO PAYS: a character-paid action by that character, and when the user is only
      // viewing, the character present buys with their own funds — never the absent user's.
      const actingCharacter = actingPeople.find((p) => p && p.id && !p.isUser && p.id !== currentUser?.id && !p.isNpc)
        || actingPeople.find((p) => p && p.id && !p.isUser && p.id !== currentUser?.id) || null;
      const payerCharacter = payer === 'character'
        ? (broughtCharacters[0] || actingCharacter || null)
        : (observeMode ? actingCharacter : null);
      const payerType = payer === 'character' || !!payerCharacter ? 'character' : 'user';
      const payerCharacterId = payerType === 'character' ? (payerCharacter?.id || null) : null;
      // WHO IS SHOPPING: for a store offer, the individual chosen to perform the activity is
      // the shopper — the payer offered first on the card. Everyone else present stays a
      // participant without being assigned the same activity, and the user is never charged
      // merely for controlling the interface. Nothing is charged here.
      const shopper = isProductCardAction ? (actingPeople[0] || null) : null;
      const shopperIsUser = !!shopper && (shopper.isUser || shopper.id === currentUser?.id);
      const offerPayerType = shopper ? (shopperIsUser ? 'user' : 'character') : payerType;
      const offerPayerCharacterId = shopper ? (shopperIsUser ? null : shopper.id) : payerCharacterId;
      // Explicitly free food (soup kitchen meal, complimentary bar snack) — shown in the
      // Shopfeed card at no charge, never through the purchase path.
      const isFreeOfferingAction = !!action.free_offering && !!action.action_category;
      const eatingActionIds = EATING_ACTION_IDS;
      if (eatingActionIds.includes(action.id) && broughtCharacters.length > 0) { const mealSize = ['buy_round', 'char_buy_round', 'drinks', 'drink'].includes(action.id) ? 'snack' : 'meal'; const eatingChars = broughtCharacters.filter((c) => !isVickServicioCharacter(c)); eatingChars.forEach((char) => { base44.functions.invoke('recordEatingEvent', { characterId: char.id, mealSize, foodDescription: action.label, locationName: location?.name }).catch(() => {}); }); queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] }); }
      if (isPaidClass && cost > 0 && !isProductCardAction) { base44.functions.invoke('executeSceneTransaction', { action_class: actionClass, is_paid: true, cost, payer_type: payer, action_id: action.id, purchase_source: action.purchase_source || null, service_source: actionClass === 'service' ? location?.name : null, fee_source: actionClass === 'fee' ? location?.name : null, action_label: action.label, location_name: location?.name, character_id: payer === 'character' ? broughtCharacters[0]?.id : null }).then(() => { queryClient.invalidateQueries({ queryKey: ['userSettings'] }); }).catch(() => {}); }
      const actionImageFn = ACTION_IMAGE_PROMPTS[action.id];
      // The room the activity establishes is the room the scene is now in — set here without
      // a generic picture of it, because the activity's own picture, drawn in that room, IS
      // this moment's visual update. Only an activity with no picture asks for the room one.
      const actionZone = (ride ? null : action.suggested_zone_name) || activeZone; const zoneChanged = !ride && !!action.suggested_zone_name && action.suggested_zone_name !== activeZone;
      if (zoneChanged) setActiveZone(action.suggested_zone_name);
      const userActs = actingPeople.some((c) => c.isUser || c.id === currentUser?.id);
      // The picture shows the people taking part — never every resident who happens to be home.
      // Only a moment that has its own picture is redrawn — and inside the car that picture is
      // taken from the vehicle's own view. An activity with no picture leaves the car image be.
      const inCarShot = actionImageFn ? buildRideShot(ride, action, actingPeople.map((c) => c.id).filter(Boolean)) : null;
      if (inCarShot) { generateSceneImage({ location, locationZones, activeZone, sceneParticipants, userParticipant, isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap, ...rideImageRequest(ride, inCarShot) }); }
      else if (actionImageFn) { const whoNames = actingPeople.map((c) => c.name).filter(Boolean); if (HOUSEHOLD_ACTION_IDS.includes(action.id) && userParticipant && !userActs) whoNames.unshift(displayName); const whoDesc = whoNames.length > 0 ? whoNames.join(" and ") : "no one — the space is empty"; const imagePrompt = actionImageFn(location?.name || location?.category, whoDesc); generateSceneImage({ location, locationZones, activeZone: actionZone, sceneParticipants, userParticipant, isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap, strictCastOnly: true, actionFocusIds: actingPeople.map((c) => c.id).filter(Boolean), showerState: SHOWER_ACTION_IDS.includes(action.id), actionOverridePrompt: imagePrompt }); }
      // An activity with no picture of its own that establishes a room (a nap in the bedroom,
      // a shower in the bathroom) shows that room — one picture, and never beside an action image.
      else if (zoneChanged || action.suggested_zone_name) requestSpaceImage();
      // The walk is drawn with the walker's own animal, from that animal's own reference.
      if (walkPet) generateSceneImage({ location, locationZones, activeZone: actionZone, sceneParticipants, userParticipant, isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap, strictCastOnly: true, actionFocusIds: actingPeople.map((c) => c.id).filter(Boolean), actionOverridePrompt: buildWalkPetPrompt(walkPetOwner, walkPet), extraReferenceImages: walkPet.image_url ? [walkPet.image_url] : [] });
      const payerNote = isProductCardAction ? (cost > 0 ? ` — $${cost}` : "") : payer === "character" && broughtCharacters[0] && cost > 0 ? ` (${broughtCharacters[0].name} pays)` : cost > 0 ? ` — $${cost}` : "";
      // The strip is not a text box: choosing an activity is a scene action, shown as a
      // centered activity naming the people taking part — not as an outgoing message.
      const behavior = activityBehaviorFor(action);
      const activityNames = actingPeople.map((c) => c.name).filter(Boolean); if (HOUSEHOLD_ACTION_IDS.includes(action.id) && userParticipant && !userActs) activityNames.unshift(displayName);
      await sendMessage(`[${action.emoji} ${action.label}${payerNote}]`, true, null, null, (isProductCardAction || isFreeOfferingAction) ? action.action_category : null, isProductCardAction ? cost : null, isProductCardAction ? (action.purchase_source || 'menu') : (isFreeOfferingAction ? 'complimentary' : null), isFreeOfferingAction, null, {
        content: activityFeedLine({
          actionId: action.id,
          label: action.label,
          verb: behavior === "immediate" ? (action.past_verb || action.verb) : action.verb,
          participants: activityNames,
        }),
        emoji: action.emoji,
        behavior,
        payerType,
        payerCharacterId,
      }, isProductCardAction ? (action.item_kind || null) : null, isProductCardAction ? (action.merchandise || null) : null, { purchasePreferences: isProductCardAction ? shoppingVisit.preferences : null, shopper: isProductCardAction ? shopper : null, payerType: offerPayerType, payerCharacterId: offerPayerCharacterId });
      setTimeout(() => { setActions(getSceneInteractions(location, activeZone || locationZones[0]?.zone_name, null)); }, 1000);
    } finally { setActionCooldown(false); }
  };

  // TRY ON — the product card's exact merchandise, worn by one chosen person in this scene.
  // The picture is drawn by the existing top-Scenes image pathway, with the card's own image
  // as the merchandise reference. Nothing is charged, no closet entry is created, and the
  // card stays available so the same item can still be bought.
  const handleTryOn = (msg, itemImageUrl) => {
    if (!msg || !itemImageUrl) return;
    const cast = observeMode ? observeCast : selectedPeopleHere;
    if (cast.length > 0) {
      setTryOnRequest({ msg, itemImageUrl, cast });
      return;
    }
    // Nobody else is in the scene: the account holder tries it on themselves.
    if (userParticipant && !observeMode) {
      runTryOn({ msg, itemImageUrl }, { id: userParticipant.id, name: displayName });
    }
  };

  const handleTryOnConfirm = (person) => {
    const request = tryOnRequest;
    setTryOnRequest(null);
    if (request && person) runTryOn(request, person);
  };

  const runTryOn = (request, person) => {
    const { msg, itemImageUrl } = request;
    const merchandiseFamily = msg.item_merchandise || null;
    // An existing zone of this store: its fitting rooms for clothing, its sales floor for
    // footwear. No fitting-room location is ever created for this.
    const zoneName = resolveTryOnZone(location, merchandiseFamily, activeZone || locationZones[0]?.zone_name);
    const prompt = buildTryOnPrompt({
      itemLabel: msg.item_label,
      itemKind: msg.item_kind,
      merchandiseFamily,
      actorName: person.name,
      locationName: location?.name,
      zoneName,
    });
    generateSceneImage({
      location, locationZones, activeZone: zoneName, sceneParticipants, userParticipant,
      isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap,
      actionOverridePrompt: prompt,
      actionFocusIds: [person.id],
      extraReferenceImages: [itemImageUrl],
    });
    // The scene remembers that they tried it on — an ordinary scene activity, not a purchase.
    setMessages((prev) => [...prev, {
      id: `try_on_${Date.now()}`,
      sender: "activity",
      emoji: "🪞",
      content: `${person.name} tries on the ${msg.item_label || "item"}${zoneName ? ` in the ${zoneName}` : ""}.`,
      timestamp: new Date().toISOString(),
    }]);
  };

  // Location-level closing only blocks when the SELECTED environment is also unavailable.
  // An accessible residential environment remains reachable while business operations are closed.
  // Watching a character-only scene is not entering the place: public hours never block it.
  // A dorm room or apartment is where a student lives — the school's hours never close it.
  const locationClosed = isLocationOpen(location) === false && !isEnvironmentAccessibleNow(selectedEnvironment, false) && !isStudentHousingSpace(location, activeUnitId) && !observeMode;

  // The effective selection is the authority: a caregiver the supervision system has on
  // duty in this household is selected from the first render, so Who's Here must show it
  // as selected rather than requiring the user to pick them by hand.
  const renderNpc = (npc) => (
    <SceneNpcRow npc={npc} isSelected={selectedNpcIdList.includes(npc.id)} onToggle={() => { const isSelected = selectedNpcIdList.includes(npc.id); if (isSelected) unitManualDeselectRef.current.add(npc.id); else unitManualDeselectRef.current.delete(npc.id); setSelectedNpcIds((prev) => { const current = prev || []; return isSelected ? current.filter((id) => id !== npc.id) : [...current, npc.id]; }); setShowNpcDropdown(false); }} />
  );

  if (!location) {
    if (isLocationsFetching || isDirectLoading) return (<div className="min-h-screen bg-background flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div></div>);
    return (<div className="min-h-screen bg-background flex items-center justify-center"><div className="text-center space-y-3"><p className="text-sm text-muted-foreground">Location not found</p><Link to="/travel"><Button variant="outline" size="sm">Back to Travel</Button></Link></div></div>);
  }
  if (locationClosed) {
    return (<div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 space-y-4"><div className="text-center space-y-3"><span className="text-4xl">🚫</span><h2 className="text-lg font-bold text-foreground">{location.name} is currently closed</h2><p className="text-sm text-muted-foreground max-w-xs">This location is not open at the moment. Come back during operating hours.</p></div><Link to="/travel" className="w-full max-w-xs"><Button variant="outline" size="lg" className="w-full rounded-xl">Back to Travel</Button></Link></div>);
  }

  // ── RETAIL SHOPPING ROLES ─────────────────────────────────────────────────────
  // The payer is someone actually here shopping; the recipient may be any character on
  // the account, present or not. A cashier or manager on shift is working, not shopping.
  const shoppingPresent = presentShoppingPeople({ observeMode, observeCast, traveledWithChars, selectedNpcs });
  const shoppingOnShiftIds = onShiftEmployeeIds(shoppingPresent, location);
  const shoppingRecipients = accountRecipients(characters, currentUser?.email);

  return (
    <div className="flex flex-col bg-background overflow-hidden w-full" style={{ height: keyboardViewportHeight ? `${keyboardViewportHeight}px` : '100dvh' }}>
      <div className="flex items-center gap-1.5 sm:gap-3 px-2 sm:px-4 py-2 sm:py-3 border-b border-border bg-background/80 backdrop-blur-xl flex-shrink-0 relative z-50">
        <button onClick={() => observeMode ? navigate("/travel") : setShowLeaveModal(true)} className="p-1.5 sm:p-2 rounded-xl text-muted-foreground hover:text-foreground transition-colors flex-shrink-0" title={observeMode ? "Stop watching" : "Leave location"}><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1 min-w-0"><h2 className="text-sm font-bold text-foreground truncate">{location.name}</h2><p className="text-[11px] sm:text-xs text-muted-foreground capitalize truncate">{CATEGORY_EMOJIS[location.category]} {location.category?.replace("_", " ")} · {observeMode ? "watching · " : ""}{activeUnit ? `${getUnitLabel(activeUnit.unit_name, location)} · ` : ""}{new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}</p></div>
        {isHomeLocation && !observeMode && (!isSharedLocation || isGatewayHouse) && <ResidenceOptionsDropdown location={location} sceneCharacters={sceneCharacters} isResident={broughtCharacters.some((c) => c.current_home_location_id === location.id)} currentUser={currentUser} allCharacters={characters} onTour={() => setShowTourModal(true)} onMoveIn={() => setShowMoveInPopup(true)} onMoveOut={handleMoveOut} onAskToLeave={handleAskToLeave} onCharacterPulledHome={() => queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] })} onKickOut={() => setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: "You assert your authority and ask them to leave immediately.", timestamp: new Date().toISOString() }])} />}
        {!observeMode && isSharedResidence && sharedResidenceParticipants.length > 1 && (
          <button onClick={() => { setShowSharedConversation(true); setUserLocation(location.id, location.name).then(() => queryClient.invalidateQueries({ queryKey: ["sharedResidenceParticipants", location.id] })).catch(() => {}); }} className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-primary/10 border border-primary/40 text-primary text-xs font-medium flex-shrink-0" title="Talk with everyone here">
            <UsersIcon className="w-3.5 h-3.5" />{sharedResidenceParticipants.length}
          </button>
        )}
        <div ref={npcDropdownRef} className="flex-shrink-0"><WhosHereDropdown presentParticipants={sceneParticipants} candidateNpcs={selectableNpcCandidates} selectedNpcs={selectedNpcs} onToggleNpc={toggleNpc} showDropdown={showNpcDropdown} onToggleDropdown={setShowNpcDropdown} onInviteClick={() => { setShowNpcDropdown(false); setShowInviteModal(true); }} renderNpc={renderNpc} residentialUnits={location?.residential_units || []} locationCategory={location?.category} /></div>
        <button onClick={() => setShowPhotoModal(true)} className="p-1.5 sm:p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors flex-shrink-0" title="Scene photo"><Camera className="w-4 h-4" /></button>
        <button onClick={() => setWatchVideoActive((v) => !v)} className={`p-1.5 sm:p-2 rounded-xl flex-shrink-0 transition-colors ${watchVideoActive ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`} title="Watch Video"><Tv className="w-4 h-4" /></button>
      </div>

      <ImageLightbox src={lightboxSrc} alt={location.name} onClose={() => setLightboxSrc(null)} />

      {/* Scene media area — extracted component with collapse/expand (no side effects) */}
      <SceneMediaArea location={location} locationZones={locationZones} activeZone={activeZone} ride={ride} onZoneChange={(zoneName) => {
        // Observing the characters does not move the user: the view follows the zone,
        // but no "you move" moment is written into their scene.
        if (!observeMode) return handleZoneChange(zoneName);
        if (zoneName === (activeZone || locationZones[0]?.zone_name)) return;
        setActiveZone(zoneName);
        requestSpaceImage();
      }} sceneImage={sceneImage} isGeneratingImage={isGeneratingImage} onRefresh={refreshImage} onLightbox={setLightboxSrc}
        watchVideoActive={watchVideoActive} onToggleWatchVideo={() => { setWatchVideoActive(false); setWatchContext(null); }} watchContext={watchContext} displayName={displayName}
        onWatchStarted={(ctx) => { setWatchContext(ctx); const who = observeMode ? (observeCast.map((c) => c.name).join(" and ") || "They") : displayName; setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `${who} started watching${ctx.title ? ` "${ctx.title}"` : " a video"} together${observeMode ? "" : " with everyone"}.`, timestamp: new Date().toISOString() }]); }}
        onWatchAnalysisComplete={({ linkAnalysisContext, linkData, title }) => { setWatchContext((prev) => ({ ...prev, linkAnalysisContext, title: title || prev?.title })); if (linkData?.title && !title) setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `Now playing: ${linkData.title}.`, timestamp: new Date().toISOString() }]); }}
        onWatchStopped={() => { setWatchContext(null); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `The watch party ended.`, timestamp: new Date().toISOString() }]); }}
      />

      {/* Character presence strip */}
      <ScenePresenceStrip observeMode={observeMode} displayName={displayName} currentUser={currentUser} observeCast={observeCast} traveledWithChars={traveledWithChars} selectedNpcs={selectedNpcs} extraNpcs={extraNpcs} location={location} locationUnits={locationUnits} locationWorkplaces={locationWorkplaces} activeUnitId={activeUnitId} onSelectUnit={handleUnitChange} />

      {/* Chat area */}
      <SceneChatFeed messages={messages} observeMode={observeMode} observeCast={observeCast} activeWorkspace={activeWorkspace} location={location} activeZone={activeZone} traveledWithChars={traveledWithChars} isWorkspaceScene={isWorkspaceScene} homeResidentsPresent={homeResidentsPresent} familyMemberNpcsPresent={familyMemberNpcsPresent} homeResidentsAway={homeResidentsAway} familyMemberNpcsAway={familyMemberNpcsAway} workerCharacters={workerCharacters} unifiedPresenceEntities={unifiedPresenceEntities} characterIds={characterIds} isTyping={isTyping} isObservingTurn={isObservingTurn} settings={settings} currentUser={currentUser} queryClient={queryClient} base44={base44} setPendingPurchase={setPendingPurchase} setMessages={setMessages} onTryOn={handleTryOn} bottomRef={bottomRef} />

      {/* Action strip — everything available here. In a watched scene it is what they do. */}
      <SceneActionStrip
        actions={actions}
        traitCrimeActions={traitCrimeActions}
        courtCase={courtCase}
        getCourtActionAuthority={getCourtActionAuthority}
        courtActors={courtActors}
        activeZone={activeZone}
        recipientTargets={recipientTargets}
        observeMode={observeMode}
        observeActors={observeActors}
        activityActors={activityActors}
        eligibleForAction={eligibleForAction}
        isGovernmentActionId={isGovernmentActionId}
        handleGovernmentAction={handleGovernmentAction}
        startCourtAction={startCourtAction}
        CRIME_ACTIVITY_IDS={CRIME_ACTIVITY_IDS}
        handleCrimeAction={handleCrimeAction}
        setActorAction={setActorAction}
        setRecipientAction={setRecipientAction}
        handleZoneChange={handleZoneChange}
        setActiveZone={setActiveZone}
        handleObserveAction={handleObserveAction}
        handleAction={handleAction}
        directedAvailable={directedAvailable}
        handleDirectedSelect={handleDirectedSelect}
        directedPickableTargets={directedPickableTargets}
        governmentVenueType={governmentVenueType}
        setShowVenueSetup={setShowVenueSetup}
        onOpenShoppingPreferences={shoppingVisit.destination ? () => shoppingVisit.setOpen(true) : null}
        cityHallPlan={cityHallPlan}
        setShowChangeClothesModal={setShowChangeClothesModal}
        characterInviter={characterInviter}
        setShowInviteModal={setShowInviteModal}
        onSpawnNpc={spawnNpc}
        location={location}
        arrestTargets={arrestTargets}
        setArrestPicker={setArrestPicker}
        setShowNextScene={setShowNextScene}
        actionCooldown={actionCooldown}
        onOpenMoney={(mode) => setMoneyMode(mode)}
        onOpenPhone={() => setShowPhone(true)}
        onTakeARide={() => setShowRidePicker(true)}
        inRide={!!ride}
        onArriveAtDestination={handleArriveAtDestination}
        rideDestinationName={ride?.spaceLabel || ride?.destination?.name || null}
        onCharacterCommand={setCommandAction}
      />

      {/* Go to Sleep / Wake Up / Go Home / Go to Work — asks who, then runs the existing
          sleep, presence and workplace authority for exactly those people. */}
      <SceneCharacterCommands command={commandAction} onClose={() => setCommandAction(null)}
        candidates={observeMode ? observeActors : activityActors} locationMap={locationMap}
        currentUser={currentUser} setMessages={setMessages} queryClient={queryClient} />

      {ride && <SceneRideBar ride={ride} />}{spawnNpcModal}

      {privateTarget && <div className="flex items-center justify-between px-3 py-1.5 bg-primary/10 border-t border-primary/30 flex-shrink-0"><span className="text-xs text-primary font-medium">🤫 Private with {privateTarget.name}</span><button onClick={() => { setPrivateTarget(null); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `You rejoin the group.`, timestamp: new Date().toISOString() }]); }} className="text-[10px] text-primary/70 hover:text-primary underline">End private chat</button></div>}

      {showSharedConversation && isSharedResidence && (
        <SharedResidenceConversation
          location={location}
          currentUser={currentUser}
          onClose={() => setShowSharedConversation(false)}
        />
      )}

      <NPCEvolutionTracker messages={messages} selectedNpcs={selectedNpcs} currentUser={currentUser} locationName={location.name} onNpcSaved={(name) => setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `${name} has been saved to your world.`, timestamp: new Date().toISOString() }])} />
      {observeMode ? (
        <ObserveStageControls
          candidates={observeCandidates}
          castIds={observeCastIdList}
          onToggleCast={toggleObserveCast}
          onDirect={(text) => runObserveBeat({ direction: text })}
          onNarrate={(text) => runObserveBeat({ narrative: text })}
          onVoice={(character, text) => runObserveBeat({ voiceAs: { character, content: text } })}
          onContinue={() => runObserveBeat()}
          isGenerating={isObservingTurn}
          blockedSpeakIds={[...onDutyCaregiverIds, ...observeCast.filter((c) => isInfantCharacter(c)).map((c) => c.id)]}
        />
      ) : (
        <SceneInputBar inputText={inputText} setInputText={setInputText} narratorMode={narratorMode} setNarratorMode={setNarratorMode} onSend={stableOnSend} onContinue={stableOnContinue} isGenerating={isTyping} />
      )}

      <AnimatePresence>{moneyMode && <SceneMoneyModal mode={moneyMode} actors={activityActors} userBalance={settings.user_balance ?? 0} currentUser={currentUser} onClose={() => setMoneyMode(null)} onCompleted={(line) => { setMessages((prev) => [...prev, { id: `${Date.now()}_money`, sender: "narrative", content: line, timestamp: new Date().toISOString() }]); queryClient.invalidateQueries({ queryKey: ["userSettings"] }); }} />}</AnimatePresence>
      {/* Take a Ride answers every time: the owner selector, then either the ride or the
          reason it cannot happen. Cancelling changes nothing about the scene. */}
      <SceneRideFlow open={showRidePicker} onClose={() => setShowRidePicker(false)} currentUser={currentUser} displayName={displayName} userPresent={!observeMode} participants={nextSceneParticipants} locations={locationsData} onConfirm={handleRideConfirm} />
      <MissingBelongingModal open={!!missingBelonging} kind={missingBelonging?.kind} ownerName={missingBelonging?.ownerName} isUser={!!missingBelonging?.isUser} onClose={() => setMissingBelonging(null)} />
      {/* The phone's Map is the Travel page's own map, fed the same account-wide data: the
          same authoritative locations, the same resolved presence, and the same characters.
          It is never limited to the people in this scene. */}
      <AnimatePresence>{showPhone && <OpenPhoneModal
        currentUser={currentUser}
        worldName={displayName}
        locations={locationsData}
        characters={unifiedPresenceEntities}
        allCharacters={characters}
        onOpenScenePhoto={() => { setShowPhone(false); setShowPhotoModal(true); }}
        onOpenMediaGallery={openMediaGalleryFromPhone}
        onClose={() => setShowPhone(false)}
      />}</AnimatePresence>
      <AnimatePresence>{showPhotoModal && <ScenePhotoModal location={location} characters={observeMode ? observeCast : allSceneChars} allPossibleNpcs={allPossibleNpcs} currentUser={currentUser} displayName={displayName} excludeUser={observeMode} activeZone={activeZone} transcript={messages} onClose={() => setShowPhotoModal(false)} allCharacters={characters} onGenerateSceneImage={(actionOverridePrompt) => generateSceneImage({ location, locationZones, activeZone, sceneParticipants, userParticipant, isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap, actionOverridePrompt, ambientPopulation: sceneAmbientPopulation })} isGeneratingImage={isGeneratingImage} />}</AnimatePresence>
      <AnimatePresence>{showTourModal && <RealtorTourModal isOpen={showTourModal} location={location} onClose={() => setShowTourModal(false)} onAddRealtor={(realtorNpc) => { setExtraNpcs((prev) => prev.find((n) => n.id === realtorNpc.id) ? prev : [...prev, realtorNpc]); if (selectedNpcIds === null || !selectedNpcIds.includes(realtorNpc.id)) setSelectedNpcIds((prev) => [...(prev || []), realtorNpc.id]); }} />}</AnimatePresence>
      <AnimatePresence>{showMoveInPopup && (!isSharedLocation || isGatewayHouse) && <MoveInPopup isOpen={showMoveInPopup} character={broughtCharacters[0]} sourceHome={locationsData.find((l) => l.id === broughtCharacters[0]?.current_home_location_id)} destinationHome={location} allCharacters={characters} broughtCharacters={broughtCharacters} onApprove={handleMoveIn} onReject={() => setShowMoveInPopup(false)} onClose={() => setShowMoveInPopup(false)} isLoading={isMoveInLoading} />}</AnimatePresence>

      {/* Every "who" picker in this scene — who does it, who it is aimed at, whose pocket,
          who is involved, who tries the item on, and who holds each courtroom role. */}
      <SceneTargetPickers v={{ actorAction, directedActorsFor, eligibleForAction, observeMode, observeActors, activityActors, handleActorSelect, handleActorsConfirm, setActorAction, directedAction, directedPartnersFor, handleDirectedTarget, setDirectedAction, crimeTargetAction, crimeTargetOptions, handleCrimeTargetSelect, setCrimeTargetAction, recipientAction, recipientTargets, performRecipientAction, setRecipientAction, tryOnRequest, handleTryOnConfirm, setTryOnRequest, courtActorAction, courtCase, courtActors, runCourtAction, setCourtActorAction, courtSubjectAction, courtSubjects, setCourtSubjectAction }} />
      <InviteToSceneModal isOpen={showInviteModal} onClose={() => setShowInviteModal(false)} location={location} characters={characters} userDisplayName={displayName} initiator={characterInviter} onCharacterArrived={(char) => { setExtraNpcs((prev) => prev.find((n) => n.id === char.id) ? prev : [...prev, char]); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `${char.name} arrives at ${location.name}.`, timestamp: new Date().toISOString() }]); queryClient.invalidateQueries({ queryKey: ["activeCharacters", currentUser?.email] }); queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }); }} />
      <ConversationTypeSelector isOpen={!!conversationModal} onClose={() => setConversationModal(null)} onSelect={(conversationType) => { if (conversationType === "one_on_one" && conversationModal?.npcId && conversationModal?.npcName) { setPrivateTarget({ id: conversationModal.npcId, name: conversationModal.npcName }); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `You pull ${conversationModal.npcName} aside for a private conversation.`, timestamp: new Date().toISOString() }]); } else setPrivateTarget(null); }} npcName={conversationModal?.npcName || "them"} hasEmployees={conversationModal?.hasEmployees || false} isGroup={conversationModal?.isGroup || false} />
      <LeaveLocationModal isOpen={showLeaveModal} onClose={() => setShowLeaveModal(false)} locationName={location.name} broughtCharacters={broughtCharacters} onLeaveWithChars={handleLeaveWithCharacters} onLeaveCharactersBehind={handleLeaveCharactersBehind} onStayHere={handleStayHere} />
      <ProductPurchaseModal isOpen={!!pendingPurchase} price={pendingPurchase?.price} productId={pendingPurchase?.productId} preview_image_url={pendingPurchase?.preview_image_url} userBalance={settings.user_balance ?? 6000} userSettings={settings} currentUser={currentUser} traveledWithChars={shoppingPresent} accountCharacters={shoppingRecipients} onShiftEmployeeIds={shoppingOnShiftIds} userPresent={!observeMode} item_label={pendingPurchase?.item_label} item_category={pendingPurchase?.item_category} item_wearable={pendingPurchase?.item_wearable} action_id={pendingPurchase?.action_id} purchase_source={pendingPurchase?.purchase_source} item_kind={pendingPurchase?.item_kind} defaultPayerId={pendingPurchase?.default_payer_id || null} location_name={location?.name} onClose={() => setPendingPurchase(null)} onPurchased={(purchase) => { setPendingPurchase(null); if (purchase.entry) setPendingClosetEntry(purchase); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: purchaseConfirmationLine(purchase), timestamp: new Date().toISOString() }]); }} />

      {/* The paid purchase opens the recipient's real closet entry interface. */}
      <PurchaseClosetEntryModal
        purchase={pendingClosetEntry}
        onClose={() => setPendingClosetEntry(null)}
        onSaved={(saved) => {
          setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `✓ ${saved?.label || "The purchase"} is saved in ${pendingClosetEntry?.recipient?.kind === "character" ? `${pendingClosetEntry.recipient.name}'s ${pendingClosetEntry.kind === "outfit" ? "Outfits" : "Items"}` : "your closet"}.`, timestamp: new Date().toISOString() }]);
          setPendingClosetEntry(null);
        }}
      />
      <ChangeClothesModal isOpen={showChangeClothesModal} onClose={() => setShowChangeClothesModal(false)} settings={settings} isUserSettingsLoading={isUserSettingsLoading} presentCharacters={changeClothesEligibleCharacters} location={location} currentUser={currentUser} userAvatar={currentUser?.generated_avatar_urls?.[0] || currentUser?.avatar_url || null} userName={displayName} onOutfitChanged={(targetType) => { if (targetType === 'user') queryClient.invalidateQueries({ queryKey: ['userSettings', currentUser?.email] }); else queryClient.invalidateQueries({ queryKey: ['activeCharacters', currentUser?.email] }); setOutfitVersion((v) => v + 1); setHasUserRequestedImage(true); setSceneImage(null); }} />
      {/* What this store visit is for. Confirming it buys nothing — it tells the existing
          shopping activities what this shopper is looking for. */}
      <ShoppingPreferencesGate visit={shoppingVisit} />
      {governmentVenueType && (
        <GovernmentVenueSetupModal
          open={showVenueSetup}
          venueType={governmentVenueType}
          location={location}
          characters={governmentVenueType === "courthouse" ? courtCharacters : characters}
          currentUser={currentUser}
          onClose={() => setShowVenueSetup(false)}
          onBegin={handleBeginGovernmentVisit}
        />
      )}
      <MarriageConfirmationModal
        open={!!marriageModal}
        characters={characters}
        currentUser={currentUser}
        initialSpouseIds={marriageModal?.spouseIds || []}
        initialWitnessIds={marriageModal?.witnessIds || []}
        locationName={marriageModal?.locationName || location?.name}
        ceremonyType="civil"
        onClose={() => setMarriageModal(null)}
        onConfirmed={(data) => {
          const names = (data?.spouses || []).map((s) => s.name).filter(Boolean);
          if (names.length === 2) {
            addGovernmentNarrative(`A marriage ceremony is held at ${location?.name}. ${names[0]} and ${names[1]} are married.`);
            addGovernmentNarrative(`${names[0]} and ${names[1]} are now married.`);
          }
          // The couple, their witnesses and everyone who attended keep their own memory
          // of the marriage that was just recorded.
          recordMarriageMemories?.(data).catch(() => {});
          queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
          // The ceremony is over — the event attendance ends with it.
          releaseGovernmentAttendance?.();
          setMarriageModal(null);
        }}
      />
      <JudicialOutcomeModal
        open={!!judicialModal}
        mode={judicialModal?.mode || "sentencing"}
        characters={characters}
        facilities={(locationsData || []).filter((l) => l.category === "jail_prison" || l.is_confinement_facility === true)}
        ownerEmail={currentUser?.email}
        initialDefendantId={judicialModal?.defendantId || ""}
        initialOffense={judicialModal?.offense || ""}
        courtName={location?.name}
        caseType={courtCase?.case_type || "criminal"}
        onClose={() => setJudicialModal(null)}
        onResolved={handleJudicialResolved}
        onNarrativeOnly={handleJudicialNarrative}
      />
      <SceneTransitionModals
        arrestTransition={arrestTransition}
        onFollowArrest={followArrest}
        onWatchCustody={watchCustody}
        onStayArrest={() => { setArrestTransition(null); setArrestVisitors(null); }}
        arrestVisitors={arrestVisitors}
        onVisitorsConfirm={(people) => goToCustody((people || []).map((p) => p.id))}
        onVisitorsSelect={(person) => goToCustody([person.id])}
        onCloseVisitors={() => setArrestVisitors(null)}
        arrestPicker={arrestPicker}
        arrestTargets={arrestTargets}
        onArrestSelect={handleArrest}
        onCloseArrestPicker={() => setArrestPicker(null)}
        showNextScene={showNextScene}
        onCloseNextScene={() => setShowNextScene(false)}
        locationsData={locationsData}
        nextSceneParticipants={nextSceneParticipants}
        userPresent={!observeMode}
        onNextSceneConfirm={handleNextSceneConfirm}
      />
      {pendingInvitations && <InviteOutModal invitations={pendingInvitations} onAccept={handleAcceptInvite} onDecline={(selectedInv) => { base44.functions.invoke('recordCharacterInviteDeclined', { characterId: selectedInv.characterId, locationId: selectedInv.locationId }).catch(() => {}); const remaining = pendingInvitations.filter((i) => i.characterId !== selectedInv.characterId); setPendingInvitations(remaining.length > 0 ? remaining : null); }} onClose={() => { if (settings.id) base44.entities.UserSettings.update(settings.id, { pending_character_invites: [] }).catch(() => {}); setPendingInvitations(null); }} />}
    </div>
  );
}