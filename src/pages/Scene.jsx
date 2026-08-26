import React, { useState, useEffect, useRef, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Camera, Tv } from "lucide-react";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import ScenePhotoModal from "@/components/travel/ScenePhotoModal";
import SceneMediaArea from "@/components/scene/SceneMediaArea";
import { filterDashes } from "@/lib/dashFilter";
import { isCharacterAtWork } from "@/lib/workScheduleUtils";
import { isCharacterHome } from "@/lib/travelAvailability";
import { isCharacterAsleep } from "@/lib/sleepUtils";
import { isLocationOpen } from "@/lib/locationHoursUtils";
import { getPresenceAtLocation, resolveTravelPresenceEntities } from "@/lib/travelPresenceResolver";
import ConversationTypeSelector from "@/components/scene/ConversationTypeSelector";
import InviteToSceneModal from "@/components/scene/InviteToSceneModal";
import WhosHereDropdown from "@/components/scene/WhosHereDropdown";
import { writeSceneExitMemories } from "@/lib/sceneExitMemory";
import ResidenceOptionsDropdown from "@/components/scene/ResidenceOptionsDropdown";
import RealtorTourModal from "@/components/scene/RealtorTourModal";
import MoveInPopup from "@/components/travel/MoveInPopup";
import InviteOutModal from "@/components/home/InviteOutModal";
import LeaveLocationModal from "@/components/scene/LeaveLocationModal";
import ProductPurchaseModal from "@/components/scene/ProductPurchaseModal";
import ChangeClothesModal from "@/components/scene/ChangeClothesModal";
import { isNPCOnShift } from "@/lib/npcShiftUtils";
import SceneInputBar from "@/components/scene/SceneInputBar";
import NPCEvolutionTracker from "@/components/scene/NPCEvolutionTracker";
import { getEnvironmentTypeForZone } from "@/components/location/EnvironmentSelectorModal";
import { ACTION_IMAGE_PROMPTS } from "@/lib/sceneActionConfig";
import { getSceneInteractions, getTemporarySceneStaff } from "@/lib/sceneInteractionEngine";
import { checkImageTrigger as _checkImageTrigger } from "@/lib/sceneCheckImageTrigger";
import { useSceneCharacters } from "@/hooks/useSceneCharacters";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useSceneImageGenerator } from "@/hooks/useSceneImageGenerator";
import { VENUE_NPCS, DEFAULT_VENUE_NPC } from "@/lib/sceneVenueNPCs";
import { usePageContext } from "@/hooks/usePageContext";
import { useAuth } from "@/lib/AuthContext";
import SceneProductCard from "@/components/scene/SceneProductCard";
import { handleCharacterWorldPhoneAction } from "@/lib/worldPhoneActionHandler";
import { detectWorldPhoneIntent } from "@/lib/worldPhoneIntentDetector";
import { buildWatchContextLabel } from "@/lib/videoEmbedSanitizer";
import { isVickServicioCharacter } from "@/lib/vickDiagnosticIntentCheck";
import { resolveSceneRole, isEmployedAtLocation } from "@/lib/sceneRoleResolver";

const CATEGORY_EMOJIS = {
  home: "🏠", workplace: "💼", school: "🏫", gym: "🏋️", grocery: "🛒",
  food_drink: "🍽️", outdoor: "🌳", social: "🍸", medical: "🏨",
  bar: "🍸", generic: "📍", transportation: "🚉"
};

export default function Scene() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const locationId = urlParams.get("locationId");
  const characterIds = (urlParams.get("characterIds") || "").split(",").filter(Boolean);
  const initialZoneName = urlParams.get("zoneName") || null;

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [hasUserRequestedImage, setHasUserRequestedImage] = useState(false);
  const [actions, setActions] = useState([]);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [actionCooldown, setActionCooldown] = useState(false);
  const [selectedNpcIds, setSelectedNpcIds] = useState(null);
  const [showNpcDropdown, setShowNpcDropdown] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [activeZone, setActiveZone] = useState(initialZoneName);
  const [conversationModal, setConversationModal] = useState(null);
  const [narratorMode, setNarratorMode] = useState(false);
  const [showTourModal, setShowTourModal] = useState(false);
  const [showMoveInPopup, setShowMoveInPopup] = useState(false);
  const [isMoveInLoading, setIsMoveInLoading] = useState(false);
  const [extraNpcs, setExtraNpcs] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [privateTarget, setPrivateTarget] = useState(null);
  const [pendingPurchase, setPendingPurchase] = useState(null);
  const [watchVideoActive, setWatchVideoActive] = useState(false);
  const [watchContext, setWatchContext] = useState(null);
  const [showChangeClothesModal, setShowChangeClothesModal] = useState(false);
  const bottomRef = useRef(null);
  const npcDropdownRef = useRef(null);
  const narratorModeRef = useRef(narratorMode);
  const sendMessageRef = useRef(null);
  const sendNarrationRef = useRef(null);

  const { user: currentUser } = useAuth();
  const { settings, isLoading: isUserSettingsLoading } = useUserSettings(currentUser?.email || null);
  const displayName = settings.fictional_world_name || currentUser?.full_name || "You";

  const userParticipant = useMemo(() => {
    const userAvatar = currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || currentUser?.avatar_url || null;
    if (!userAvatar) return null;
    return {
      id: currentUser?.id || 'user', name: displayName, avatar_url: userAvatar, image_avatar_url: userAvatar,
      reference_image_urls: currentUser?.reference_image_urls || [], appearance_lock: settings?.appearance_lock || null,
      user_race: settings?.user_race || null, gender: settings?.user_gender || currentUser?.gender || null, isUser: true,
    };
  }, [currentUser?.id, currentUser?.generated_avatar_urls, currentUser?.reference_image_urls, currentUser?.avatar_url, displayName, settings?.appearance_lock, settings?.user_gender, currentUser?.gender]);

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

  const { characters, activeChars, backendNpcFictitious, rlsNpcFictitious, familyByCreatedBy, familyByOwner, sharedLocationEmployees } = useSceneCharacters(currentUser);

  const location = locationsData.find((l) => l.id === locationId) || directLocation || null;
  const locationMap = Object.fromEntries(locationsData.map((l) => [l.id, l]));
  const locationZones = location?.zones || [];
  const activeEnvType = getEnvironmentTypeForZone(location, activeZone || locationZones[0]?.zone_name);
  const isRestrictedEnv = activeEnvType === 'restricted';
  const broughtCharacters = characters.filter((c) => characterIds.includes(c.id));

  const unifiedPresenceEntities = useMemo(() => {
    const resolved = resolveTravelPresenceEntities({
      currentUser, userSettings: settings || null, activeCharacters: activeChars,
      npcFictitious: [...backendNpcFictitious, ...rlsNpcFictitious].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i),
      npcFamilyMembers: [...familyByCreatedBy, ...familyByOwner].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i),
      allCharacters: characters, sharedLocationEmployees, locations: locationsData
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
  }, [currentUser?.id, activeChars, backendNpcFictitious, rlsNpcFictitious, familyByCreatedBy, familyByOwner, locationsData, broughtCharacters, locationId, location?.name]);

  const isHomeLocation = location?.category === "home";
  const isSharedLocation = location?.scope === 'shared' || location?.location_type === 'shared';
  const isVGCTowers = location?.name === 'VGC Towers';
  const homeResidents = isHomeLocation ? characters.filter((c) => c.current_home_location_id === location.id) : [];
  const homeResidentsPresent = homeResidents.filter((c) => isCharacterHome(c, locationMap));
  const homeResidentsAway = homeResidents.filter((c) => !isCharacterHome(c, locationMap));

  const getFamilyNpcLocationId = (fm) => {
    for (const char of homeResidents) {
      const rel = char.fictional_relationships?.find((r) => r.person_name?.trim().toLowerCase() === fm.name?.trim().toLowerCase() && !r.related_character_id);
      if (rel) return rel.current_location_id || null;
    }
    return null;
  };
  const familyMemberNpcsAway = isHomeLocation ? (location.resident_family_members || []).filter((fm) => { if (!fm.name) return false; const locId = getFamilyNpcLocationId(fm); return locId && locId !== location.id; }) : [];
  const familyMemberNpcsPresent = isHomeLocation ? (location.resident_family_members || []).filter((fm) => { if (!fm.name) return false; const locId = getFamilyNpcLocationId(fm); return !locId || locId === location.id; }) : [];
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
      if (!isCharacterAtWork(c, location)) return false;
      const canonicalLocId = canonicalLocById[c.id] || c.resolved_current_location_id;
      if (canonicalLocId && canonicalLocId !== locationId) return false;
      return true;
    });
    if (location.is_confinement_facility || location.category === 'jail_prison') return onShift.slice(0, 4);
    return onShift;
  })();

  const onShiftIds = new Set(workerCharacters.map((w) => w.id));
  const homeResidentIds = new Set(homeResidentsPresent.map((r) => r.id));
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
    return getPresenceAtLocation(location, unifiedPresenceEntities).filter((e) => !characterIds.includes(e.id)).map((entity) => ({ id: entity.id, name: entity.display_name, avatar_url: entity.avatar_url, role: entity.resolved_presence_status === 'home' ? 'Resident' : 'Here now', isNpc: false, npcType: 'present', resolved_presence_status: entity.resolved_presence_status, personality_summary: entity.personality_summary, emotional_state: entity.emotional_state }));
  }, [location, unifiedPresenceEntities, characterIds]);

  const allPossibleNpcs = (() => {
    const npcs = [];
    if (isHomeLocation) {
      vgcDistributedNpcs.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push({ id: n.id, name: n.name, role: n.character_type === 'family_npc' ? 'Family' : 'Resident', isNpc: true, npcType: 'resident', avatar_url: n.avatar_url || null, personality_summary: n.personality_summary, emotional_state: n.emotional_state }); });
      homeResidents.forEach((c) => { if (!npcs.find((x) => x.id === c.id) && !characterIds.includes(c.id)) npcs.push({ id: c.id, name: c.name, role: 'Resident', isNpc: false, npcType: 'resident', avatar_url: c.avatar_url || null, personality_summary: c.personality_summary, emotional_state: c.emotional_state }); });
      (location.resident_family_members || []).forEach((fm) => { if (!fm.name) return; const alreadyAdded = npcs.find((x) => x.name?.trim().toLowerCase() === fm.name.trim().toLowerCase()); if (alreadyAdded) return; const sourceChar = fm.source_character_id ? characters.find((c) => c.id === fm.source_character_id) : homeResidents.find((c) => c.family_members?.some((m) => m.name?.trim().toLowerCase() === fm.name.trim().toLowerCase())); const familyMemberRecord = sourceChar?.family_members?.find((m) => m.name?.trim().toLowerCase() === fm.name.trim().toLowerCase()); npcs.push({ id: `npc_${fm.name.replace(/\s+/g, "_")}`, name: fm.name, role: fm.relationship_type || "Family", isNpc: true, npcType: "resident", avatar_url: familyMemberRecord?.photo_url || null }); });
    }
    if (!isHomeLocation && location?.owner_is_npc && location?.owner_npc_name) npcs.push({ id: `npc_owner_${location?.id}`, name: location.owner_npc_name, role: location.owner_role || "Owner", isNpc: true, npcType: "staff", avatar_url: null });
    workerCharacters.forEach((w) => { if (npcs.find((x) => x.id === w.id)) return; if (characterIds.includes(w.id)) return; const jobTitle = location.worker_job_titles?.[w.id] || w.work_details?.job_title || "Employee"; npcs.push({ id: w.id, name: w.name, role: jobTitle, isNpc: false, npcType: "staff", avatar_url: w.avatar_url || null, personality_summary: w.personality_summary, archetype: w.archetype, emotional_state: w.emotional_state, resolved_presence_status: w.resolved_presence_status }); });
    const locationWorkerIds = location?.worker_character_ids || [];
    const canonicalLocByIdWorkerLoop = {};
    unifiedPresenceEntities.forEach((e) => { if (e.id) canonicalLocByIdWorkerLoop[e.id] = e.resolved_current_location_id; });
    locationWorkerIds.forEach((wid) => { if (workerCharacters.find((w) => w.id === wid)) return; if (characterIds.includes(wid)) return; const workerChar = characters.find((c) => c.id === wid); if (!workerChar) return; const canonicalLocId = canonicalLocByIdWorkerLoop[wid] || workerChar.resolved_current_location_id; if (canonicalLocId !== locationId) return; const jobTitle = location.worker_job_titles?.[wid] || workerChar.work_details?.job_title || "Employee"; npcs.push({ id: workerChar.id, name: workerChar.name, role: jobTitle, isNpc: false, npcType: "staff", avatar_url: workerChar.avatar_url, personality_summary: workerChar.personality_summary, archetype: workerChar.archetype, emotional_state: workerChar.emotional_state }); });
    if (isHomeLocation) { hereNowFromPresence.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push(n); }); return npcs.filter((n, i, arr) => arr.findIndex((x) => x.id === n.id) === i); }
    if (!isRestrictedEnv) { const onShiftIdsLocal = workerCharacters.map((w) => w.id); const tempSceneStaff = getTemporarySceneStaff(location, onShiftIdsLocal); tempSceneStaff.forEach((tmpNpc) => { if (!npcs.find((x) => x.id === tmpNpc.id)) npcs.push(tmpNpc); }); }
    if (!isRestrictedEnv) { Object.keys(location?.worker_job_titles || {}).filter((k) => k.startsWith("npc_")).forEach((key) => { if (isNPCOnShift(location, key)) { const npcName = key.replace(/^npc_/, "").replace(/_/g, " "); const jobTitle = location.worker_job_titles[key]; if (!npcs.find((x) => x.id === key)) npcs.push({ id: key, name: npcName, role: jobTitle || "Staff", isNpc: true, npcType: "staff", avatar_url: null }); } }); }
    if (!isRestrictedEnv) { const venueDefaults = VENUE_NPCS[location?.category] || DEFAULT_VENUE_NPC; venueDefaults.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push({ ...n, isNpc: true, avatar_url: null }); }); }
    if (!isRestrictedEnv) { npcsTravelingHere.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push(n); }); }
    if (!isRestrictedEnv) { vgcDistributedNpcs.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push({ id: n.id, name: n.name, role: n.presence_reason === 'vgc_distribution' || n.presence_reason === 'vgc_rotation' ? 'Visiting' : n.character_type === 'family_npc' ? 'Family' : 'NPC', isNpc: true, npcType: 'customer', avatar_url: n.avatar_url || null, personality_summary: n.personality_summary, emotional_state: n.emotional_state }); }); }
    hereNowFromPresence.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push(n); });
    extraNpcs.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push({ ...n, npcType: n.npcType || 'present' }); });
    return npcs.filter((n, i, arr) => arr.findIndex((x) => x.id === n.id) === i);
  })().map((n) => ({ ...n, sceneRole: n.isNpc === true ? (n.npcType === 'staff' ? 'on-shift employee' : n.npcType === 'resident' ? 'home resident' : 'visitor') : resolveSceneRole(n, { onShiftAtLocationIds: onShiftIds, homeResidentIds }) }));

  const selectedNpcs = selectedNpcIds !== null ? allPossibleNpcs.filter((n) => selectedNpcIds.includes(n.id)) : [];
  const traveledWithChars = broughtCharacters;

  const baseSceneParticipants = (() => {
    if (!location) return [];
    const participants = []; const seenIds = new Set();
    const presentEntities = getPresenceAtLocation(location, unifiedPresenceEntities);
    for (const entity of presentEntities) {
      if (!entity || !entity.id || seenIds.has(entity.id)) continue;
      seenIds.add(entity.id);
      const char = characters.find((c) => c.id === entity.id); const full = char || {};
      participants.push({ ...full, id: entity.id, name: full.name || entity.display_name, display_name: entity.display_name, avatar_url: full.avatar_url || entity.avatar_url, image_avatar_url: full.image_avatar_url, reference_image_urls: full.reference_image_urls || [], appearance_lock: full.appearance_lock, ethnicities: full.ethnicities, gender: full.gender, personality_summary: full.personality_summary || entity.personality_summary, emotional_state: full.emotional_state || entity.emotional_state, archetype: full.archetype, age: full.age, age_range: full.age_range, resolved_presence_status: entity.resolved_presence_status, is_home_resident: entity.is_home_resident, isNpc: false, sceneRole: resolveSceneRole({ id: entity.id, resolved_presence_status: entity.resolved_presence_status }, { onShiftAtLocationIds: onShiftIds, homeResidentIds }) });
    }
    if (isHomeLocation) { for (const fn of familyNpcSceneObjects) { if (!fn || !fn.id || seenIds.has(fn.id)) continue; seenIds.add(fn.id); participants.push({ ...fn, sceneRole: 'home resident', isNpc: true }); } }
    for (const n of npcsTravelingHere) { if (!n || !n.id || seenIds.has(n.id)) continue; seenIds.add(n.id); participants.push({ ...n, sceneRole: 'visitor', isNpc: true }); }
    for (const n of selectedNpcs) { if (!n || !n.id || seenIds.has(n.id)) continue; seenIds.add(n.id); participants.push({ ...n, sceneRole: n.sceneRole || 'visitor' }); }
    for (const n of extraNpcs) { if (!n || !n.id || seenIds.has(n.id)) continue; seenIds.add(n.id); participants.push({ ...n, sceneRole: n.sceneRole || 'visitor' }); }
    if (userParticipant && !seenIds.has(userParticipant.id)) { seenIds.add(userParticipant.id); participants.push({ ...userParticipant, sceneRole: 'visitor' }); }
    return participants;
  })();

  const [outfitVersion, setOutfitVersion] = useState(0);
  const [sceneParticipants, setSceneParticipants] = useState(() => baseSceneParticipants.map((p) => ({ ...p, resolvedOutfit: null })));
  const [participantsReady, setParticipantsReady] = useState(false);
  const participantIdsKey = baseSceneParticipants.map((p) => p.id).sort().join(',');

  useEffect(() => {
    if (!location || baseSceneParticipants.length === 0) { setSceneParticipants([]); setParticipantsReady(false); return; }
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

  // ── IMAGE GENERATION HOOK ──
  // Identity authority chain:
  //   participant ID → avatar (primary) + additional reference images (supplements)
  //   + Appearance Lock reinforcement → participant binding → Closet → composition
  // The avatar is the main established image — always included, NOT a fallback.
  // reference_image_urls supplement the avatar with more angles/detail.
  const { sceneImage, setSceneImage, isGeneratingImage, generateSceneImage } = useSceneImageGenerator();

  useEffect(() => {
    if (broughtCharacters.length === 0) return;
    setSelectedNpcIds((prev) => { const existing = prev || []; const broughtIds = broughtCharacters.map((c) => c.id); const merged = [...new Set([...existing, ...broughtIds])]; if (merged.length === existing.length && merged.every((id) => existing.includes(id))) return prev; return merged; });
  }, [broughtCharacters.map((c) => c.id).join(',')]);

  useEffect(() => {
    const handler = (e) => { if (npcDropdownRef.current && !npcDropdownRef.current.contains(e.target)) setShowNpcDropdown(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleZoneChange = (zoneName) => {
    setActiveZone(zoneName);
    setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `You move to the ${zoneName}.`, timestamp: new Date().toISOString() }]);
    setHasUserRequestedImage(true);
    setTimeout(() => setSceneImage(null), 50);
  };

  const toggleNpc = (npcId) => { const current = selectedNpcIds ?? []; setSelectedNpcIds(current.includes(npcId) ? current.filter((id) => id !== npcId) : [...current, npcId]); };

  useEffect(() => { if (location) { setActions(getSceneInteractions(location, activeZone || locationZones[0]?.zone_name, null)); } }, [location?.id, activeZone]);

  useEffect(() => { if (!isHomeLocation || !location?.id || !currentUser?.email) return; base44.functions.invoke('ensureChildCaregiverPresence', { locationId: location.id }).catch(() => {}); }, [isHomeLocation, location?.id, currentUser?.email]);

  useEffect(() => {
    if (!location || broughtCharacters.length === 0) return;
    const _isHomeCat = location.category === 'home';
    broughtCharacters.forEach((char) => {
      base44.functions.invoke('enforceCharacterLocationPresence', {
        character_id: char.id, owner_email: currentUser?.email,
        requested_presence_status: _isHomeCat ? 'home' : 'visiting',
        requested_location_id: location.id, requested_location_name: location.name,
        requested_source_reason: 'user_travel', requested_authority: 'SceneArrival'
      }).catch(() => {});
    });
  }, [location?.id, broughtCharacters.length]);

  usePageContext({ page: 'scene', locationId: locationId || null });

  const _exitMemoryArgs = (outcome) => ({ broughtCharacters, alreadyPresentChars: selectedNpcs, allSceneChars: sceneCharacters, location, messages, userDisplayName: displayName, ownerEmail: currentUser?.email, outcome });

  const handleLeaveWithCharacters = async () => {
    setShowLeaveModal(false);
    await Promise.all([
      ...broughtCharacters.map((char) =>
        base44.functions.invoke('enforceCharacterLocationPresence', {
          character_id: char.id, owner_email: currentUser?.email,
          requested_presence_status: 'home',
          requested_source_reason: 'returned_home_with_user', requested_authority: 'SceneExit'
        }).catch(() => {})
      ),
      writeSceneExitMemories(_exitMemoryArgs('left_together'))
    ]);
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }); navigate("/travel");
  };

  const handleLeaveCharactersBehind = async () => {
    setShowLeaveModal(false);
    const _isHomeCat = location.category === 'home';
    await Promise.all([
      ...broughtCharacters.map((char) =>
        base44.functions.invoke('enforceCharacterLocationPresence', {
          character_id: char.id, owner_email: currentUser?.email,
          requested_presence_status: _isHomeCat ? 'home' : 'visiting',
          requested_location_id: location.id, requested_location_name: location.name,
          requested_source_reason: 'user_stay_decision', requested_authority: 'SceneExit',
          requested_stay_lock: true, presence_stay_lock_reason: 'user_scene_stay',
          presence_stay_lock_authority: 'SceneExit', presence_stay_lock_release_condition: 'scene_end',
          presence_stay_lock_created_by: 'user'
        }).catch(() => {})
      ),
      writeSceneExitMemories(_exitMemoryArgs('stayed_behind'))
    ]);
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }); navigate("/travel");
  };

  useEffect(() => { const el = bottomRef.current; if (!el) return; const container = el.parentElement; if (container) { const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight; if (distFromBottom < 150) el.scrollIntoView({ behavior: "smooth", block: "end" }); } }, [messages.length]);

  useEffect(() => { if (!location) return; const interval = setInterval(() => { setActions(getSceneInteractions(location, activeZone || locationZones[0]?.zone_name, null)); }, 180000); return () => clearInterval(interval); }, [location?.id, activeZone]);

  // ── IMAGE PARTICIPANT SELECTION ──
  // Selects a subset of sceneParticipants by stable ID. The user is already a participant.
  const selectImageParticipants = () => {
    const userId = userParticipant?.id;
    if (isHomeLocation) { const selectedIds = new Set([...broughtCharacters.map((c) => c.id), ...(selectedNpcIds || []), ...(userId ? [userId] : [])]); return sceneParticipants.filter((p) => selectedIds.has(p.id)); }
    if (!isRestrictedEnv && location?.location_type === "global") { const nonUser = sceneParticipants.filter((p) => p.id !== userId); const userP = sceneParticipants.find((p) => p.id === userId); return [...nonUser.slice(0, 3), ...(userP ? [userP] : [])]; }
    const selectedIds = new Set([...broughtCharacters.map((c) => c.id), ...workerCharacters.map((w) => w.id), ...(selectedNpcIds || []), ...(userId ? [userId] : [])]);
    return sceneParticipants.filter((p) => selectedIds.has(p.id)).slice(0, 4);
  };

  // Scene image auto-loads when key data is ready.
  useEffect(() => {
    if (!hasUserRequestedImage) return;
    if (!participantsReady) return;
    if (location && !sceneImage && !isGeneratingImage && !location.is_rabbit_hole) {
      generateSceneImage({ location, locationZones, activeZone, sceneParticipants, userParticipant, isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap });
    }
  }, [location?.id, sceneImage, activeZone, selectedNpcIds, hasUserRequestedImage, participantsReady]);

  useEffect(() => { if (hasUserRequestedImage) return; if (!location || location.is_rabbit_hole) return; if (characterIds.length > 0 && broughtCharacters.length < characterIds.length) return; setHasUserRequestedImage(true); }, [hasUserRequestedImage, location?.id, location?.is_rabbit_hole, broughtCharacters.length, characterIds.length]);

  const generateFocusedImage = (prompt) => {
    if (isGeneratingImage) return;
    base44.integrations.Core.GenerateImage({ prompt: `${prompt} Photorealistic, high quality, close-up detail.`, existing_image_urls: firstImage ? [firstImage] : undefined }).then((r) => setSceneImage(r.url)).catch(() => {});
  };

  const checkImageTrigger = (text, actionImagePrompt = null, actionCategory = null, explicitPrice = null, purchaseSource = null) => { _checkImageTrigger({ text, actionImagePrompt, actionCategory, explicitPrice, purchaseSource, location, messages, generateFocusedImage, setMessages }); };

  const sendNarration = (text) => { if (!text.trim()) return; setInputText(""); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: text, timestamp: new Date().toISOString() }]); };

  const sendMessage = async (text, fromAction = false, actionImagePrompt = null, actionScenePrompt = null, actionCategory = null, explicitPrice = null, purchaseSource = null) => {
    if (!text.trim() || !location) return; setInputText("");
    const userMsg = { id: Date.now().toString(), sender: "user", content: text, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);

    const wpIntent = detectWorldPhoneIntent(text);
    if (wpIntent && wpIntent.recipient && (privateTarget || (broughtCharacters.filter(c => !c.isNpc).length === 1))) {
      const wpSender = privateTarget || broughtCharacters.find(c => !c.isNpc);
      if (wpSender) base44.functions.invoke('sendWorldPhoneMessage', { sender_character_id: wpSender.id, recipient_identifier: wpIntent.recipient, requested_message: wpIntent.message, user_instruction_context: wpIntent.message ? null : text, source: 'user_instruction', owner_email: currentUser?.email }).catch(err => console.warn('[Scene] World Phone send failed:', err?.message));
    }

    checkImageTrigger(text, actionImagePrompt, actionCategory, explicitPrice, purchaseSource);
    setIsTyping(true);

    const _memIds = [...broughtCharacters, ...selectedNpcs].filter((c) => !c.isNpc && c.id).map((c) => c.id);
    const crossMem = {};
    await Promise.all(_memIds.map(async (id) => { try { const r = await base44.functions.invoke('retrieveCrossPageMemory', { characterId: id, limitMessages: 12 }); if (r?.data?.contextText) crossMem[id] = r.data.contextText; } catch {} }));

    const _canonicalCharIds = [...broughtCharacters, ...selectedNpcs].filter((c) => !c.isNpc && c.id).map((c) => c.id);
    const canonicalCtx = {};
    await Promise.all(_canonicalCharIds.map(async (id) => { try { const charRecord = characters.find((c) => c.id === id); const r = await base44.functions.invoke('buildCanonicalCharacterContext', { characterId: id, interactionContext: 'scene', ownerEmailHint: charRecord?.owner_email || currentUser?.email || null }); if (r?.data?.systemPrompt) canonicalCtx[id] = r.data.systemPrompt; } catch {} }));

    try {
      const conversationHistory = messages.slice(-12).map((m) => `${m.sender === "user" ? displayName : m.senderName || "Character"}: ${m.content}`).join("\n");
      const privateNote = privateTarget ? `\nNOTE: ${displayName} pulled ${privateTarget.name} aside for a PRIVATE conversation. Only ${privateTarget.name} may respond.` : "";
      const selectedCharIds = selectedNpcIds || [];
      const dialogueEligible = privateTarget ? sceneCharacters.filter((c) => c.id === privateTarget.id || c.name === privateTarget.name) : selectedCharIds.length > 0 ? [...broughtCharacters.filter((c) => selectedCharIds.includes(c.id)), ...selectedNpcs].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i) : [];
      const charSummaries = dialogueEligible.map((c) => `${c.name} (${c.personality_summary?.split(".")[0] || c.archetype || "character"}, mood: ${c.emotional_state || "calm"})`).join("; ");
      const eligibleKnownChars = dialogueEligible.filter((c) => !c.isNpc);
      const eligibleNpcList = dialogueEligible.filter((c) => c.isNpc).map((n) => `${n.name} (${n.role || "NPC"}${n.personality_summary ? ", " + n.personality_summary.split(".")[0] : ""})`).join(", ");
      const npcInstruction = `IMPORTANT: Only these people may respond — no one else, ever:\n- Selected characters: ${[...eligibleKnownChars.map((c) => c.name), ...(eligibleNpcList ? [eligibleNpcList] : [])].join(", ") || "none"}\nResidents, owners, and employees who are present but NOT selected must NOT respond.\nIf no one is listed, return an empty responses array. Do NOT invent responses from unselected people.${privateNote}`;
      const canonicalSection = eligibleKnownChars.filter((c) => canonicalCtx[c.id]).map((c) => `=== ${c.name} — FULL CANONICAL IDENTITY ===\n${canonicalCtx[c.id]}\n=== END ${c.name} ===`).join('\n\n');
      const memSection = eligibleKnownChars.filter((c) => crossMem[c.id]).map((c) => `[${c.name}'s memory]\n${crossMem[c.id]}`).join('\n\n');
      const ageGateRules = dialogueEligible.map((char) => { const age = char.age || (char.age_range?.match(/\d+/) ? parseInt(char.age_range.match(/\d+/)[0]) : null); if (!age || age >= 6) return null; if (age < 3) return `${char.name} is a baby: speak ONLY 1-2 words max.`; if (age < 6) return `${char.name} is a toddler: max 5 words.`; return null; }).filter(Boolean).join('\n');
      const watchContextBlock = watchContext ? `\n=== WATCH PARTY CONTEXT ===\n${displayName} and everyone present are watching a video together right now.\n${buildWatchContextLabel(watchContext) || "A video is playing."}\n\n${watchContext.linkAnalysisContext || `WATCH PARTY RULES (analysis in progress):\n- You know you are watching something together.\n- You MUST NOT pretend to know the video's contents until analysis completes.\n- If asked about the video content, say you can only know what ${displayName} shares.`}\n===\n` : "";

      const responses = await base44.integrations.Core.InvokeLLM({
        prompt: `You are managing a ${privateTarget ? "private one-on-one" : "group"} scene at ${location.name} (${location.category}).\n${eligibleKnownChars.filter((c) => broughtCharacters.find((b) => b.id === c.id)).length > 0 ? `CONTINUITY: ${eligibleKnownChars.filter((c) => broughtCharacters.find((b) => b.id === c.id)).map((c) => c.name).join(", ")} traveled here WITH ${displayName} — do NOT treat them as strangers.` : ''}\nPeople present: ${displayName}, ${charSummaries || "no one they know"}\n${canonicalSection ? `\n=== FULL CANONICAL IDENTITY ===\n${canonicalSection}\n===` : ''}${memSection ? `\n=== CROSS-PAGE MEMORY ===\n${memSection}\n===` : ''}\n${watchContextBlock}\n\nRecent scene conversation:\n${conversationHistory}\n\n${displayName} just said: "${text}"\n${fromAction ? "(This was from a scene action, not typed directly)" : ""}\n\n${npcInstruction}\n${ageGateRules ? `\nAGE SPEECH RULES (mandatory):\n${ageGateRules}\n` : ''}\nKeep each response 1-2 sentences, natural and in-character.\nCRITICAL: Do NOT say your character's own name in the response — use "I", "we", "me", or "us" instead.\n\nReturn JSON:\n{\n  "responses": [\n    { "character_name": "...", "content": "..." }\n  ]\n}`,
        response_json_schema: { type: "object", properties: { responses: { type: "array", items: { type: "object", properties: { character_name: { type: "string" }, content: { type: "string" } } } } } }
      });

      setIsTyping(false);
      const responseList = responses?.responses || [];
      for (const resp of responseList) {
        const respNameLower = resp.character_name?.trim().toLowerCase();
        const userNames = [displayName?.trim().toLowerCase(), currentUser?.full_name?.trim().toLowerCase(), currentUser?.email?.split("@")[0]?.toLowerCase(), settings?.fictional_world_name?.trim().toLowerCase(), ...(settings?.user_aliases || []).map((a) => a?.trim().toLowerCase())].filter(Boolean);
        if (userNames.includes(respNameLower)) continue;
        const char = sceneCharacters.find((c) => c.name === resp.character_name);
        let cleanedContent = filterDashes(resp.content);
        if (char) { try { const wpResult = await handleCharacterWorldPhoneAction({ responseText: cleanedContent, character: char, characterId: char.id, conversationId: null, ownerEmail: currentUser?.email, recentMessages: messages.slice(-15) }); cleanedContent = wpResult.responseText || cleanedContent; } catch {} }
        const msg = { id: Date.now().toString() + resp.character_name, sender: "character", senderName: resp.character_name, characterId: char?.id, avatarUrl: char?.avatar_url, content: cleanedContent, timestamp: new Date().toISOString() };
        setMessages((prev) => [...prev, msg]);
        if (char) { const realBrought = broughtCharacters.filter((c) => !c.isNpc && c.id !== char.id); base44.functions.invoke("extractMemoriesFromTurn", { characterId: char.id, userMessage: text, characterReply: cleanedContent, playingAsCharacterId: realBrought[0]?.id || null, witnessCharacterIds: realBrought.slice(1).map((c) => c.id) }).catch(() => {}); }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (responseList.length === 0) { const hasAnyone = dialogueEligible.length > 0; setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: hasAnyone ? `The atmosphere at ${location.name} hums quietly. No one responds right away.` : `You take in the surroundings at ${location.name}. Use the "Who's here" button to start talking to someone.`, timestamp: new Date().toISOString() }]); }
    } catch { setIsTyping(false); }
  };

  useEffect(() => { narratorModeRef.current = narratorMode; }, [narratorMode]);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
  useEffect(() => { sendNarrationRef.current = sendNarration; }, [sendNarration]);
  const stableOnSend = useRef((text) => { if (narratorModeRef.current) sendNarrationRef.current?.(text); else sendMessageRef.current?.(text); }).current;

  const handleMoveIn = async ({ moversToMove, npcMovers = [], newHomeName }) => {
    if (!location) return; setIsMoveInLoading(true);
    try { await base44.functions.invoke("moveCharactersToNewHome", { sourceHomeId: broughtCharacters[0]?.current_home_location_id || null, destinationHomeId: location.id, moversToMove, npcMovers, newHomeName }); setShowMoveInPopup(false); queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] }); queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `Move-in complete. ${newHomeName || location.name} is now home.`, timestamp: new Date().toISOString() }]); } catch (err) { console.error("Move-in failed:", err); } finally { setIsMoveInLoading(false); }
  };

  const handleMoveOut = async () => {
    if (!location || broughtCharacters.length === 0) return; const mover = broughtCharacters[0];
    try { await base44.entities.Character.update(mover.id, { current_home_location_id: "" }); queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `${mover.name} has moved out of ${location.name}.`, timestamp: new Date().toISOString() }]); } catch (err) { console.error("Move-out failed:", err); }
  };

  const handleAskToLeave = (type, narrativeText) => { setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: narrativeText || `You ask the ${type} to leave.`, timestamp: new Date().toISOString() }]); };

  const handleAction = async (action) => {
    if (actionCooldown) return; setActionCooldown(true);
    try {
      const actionClass = action.action_class;
      const payer = action.payer || "user"; const cost = Number(action.cost) || 0;
      const isPaidClass = actionClass && ['purchase', 'service', 'fee'].includes(actionClass);
      const isProductCardAction = actionClass === 'purchase' && cost > 0 && payer === 'user' && !!action.action_category && action.purchase_source != null;
      const eatingActionIds = ['eat', 'order', 'drinks', 'char_pays', 'check', 'order_takeout', 'drink', 'buy_round', 'char_buy_round', 'order_breakfast', 'pie', 'milkshake', 'order_late_night', 'dessert', 'hotel_dining', 'school_lunch'];
      if (eatingActionIds.includes(action.id) && broughtCharacters.length > 0) { const mealSize = ['buy_round', 'char_buy_round', 'drinks', 'drink'].includes(action.id) ? 'snack' : 'meal'; const eatingChars = broughtCharacters.filter((c) => !isVickServicioCharacter(c)); eatingChars.forEach((char) => { base44.functions.invoke('recordEatingEvent', { characterId: char.id, mealSize, foodDescription: action.label, locationName: location?.name }).catch(() => {}); }); queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] }); }
      if (isPaidClass && cost > 0 && !isProductCardAction) { base44.functions.invoke('executeSceneTransaction', { action_class: actionClass, is_paid: true, cost, payer_type: payer, action_id: action.id, purchase_source: action.purchase_source || null, service_source: actionClass === 'service' ? location?.name : null, fee_source: actionClass === 'fee' ? location?.name : null, action_label: action.label, location_name: location?.name, character_id: payer === 'character' ? broughtCharacters[0]?.id : null }).then(() => { queryClient.invalidateQueries({ queryKey: ['userSettings'] }); }).catch(() => {}); }
      const actionImageFn = ACTION_IMAGE_PROMPTS[action.id];
      if (actionImageFn) { const presentPeople = [...homeResidentsPresent, ...broughtCharacters].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i); const whoDesc = presentPeople.length > 0 ? presentPeople.map((c) => c.name).join(" and ") : "no one — the space is empty"; const imagePrompt = actionImageFn(location?.name || location?.category, whoDesc); generateSceneImage({ location, locationZones, activeZone, sceneParticipants, userParticipant, isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap, actionOverridePrompt: imagePrompt }); }
      const payerNote = payer === "character" && broughtCharacters[0] && cost > 0 ? ` (${broughtCharacters[0].name} pays)` : cost > 0 ? ` — $${cost}` : "";
      await sendMessage(`[${action.emoji} ${action.label}${payerNote}]`, true, null, null, isProductCardAction ? action.action_category : null, isProductCardAction ? cost : null, isProductCardAction ? (action.purchase_source || 'menu') : null);
      setTimeout(() => { setActions(getSceneInteractions(location, activeZone || locationZones[0]?.zone_name, null)); }, 1000);
    } finally { setActionCooldown(false); }
  };

  const locationClosed = isLocationOpen(location) === false;

  const renderNpc = (npc) => {
    const isSelected = (selectedNpcIds || []).includes(npc.id);
    return (
      <button key={npc.id} onClick={() => { setSelectedNpcIds((prev) => { const current = prev || []; return isSelected ? current.filter((id) => id !== npc.id) : [...current, npc.id]; }); setShowNpcDropdown(false); }} className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary ${isSelected ? "bg-primary/10" : ""}`}>
        <div className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center flex-shrink-0 overflow-hidden">{npc.avatar_url ? <img src={npc.avatar_url} alt={npc.name} className="w-full h-full object-cover" /> : <span className="text-[9px] font-bold text-foreground">{npc.name?.[0]}</span>}</div>
        <div className="flex-1 min-w-0"><p className={`text-xs font-medium truncate ${isSelected ? "text-primary" : "text-foreground"}`}>{npc.name}</p>{npc.mood && <p className="text-[10px] text-muted-foreground truncate">{npc.mood}</p>}</div>
        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
      </button>
    );
  };

  if (!location) {
    if (isLocationsFetching || isDirectLoading) return (<div className="min-h-screen bg-background flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div></div>);
    return (<div className="min-h-screen bg-background flex items-center justify-center"><div className="text-center space-y-3"><p className="text-sm text-muted-foreground">Location not found</p><Link to="/travel"><Button variant="outline" size="sm">Back to Travel</Button></Link></div></div>);
  }
  if (locationClosed) {
    return (<div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 space-y-4"><div className="text-center space-y-3"><span className="text-4xl">🚫</span><h2 className="text-lg font-bold text-foreground">{location.name} is currently closed</h2><p className="text-sm text-muted-foreground max-w-xs">This location is not open at the moment. Come back during operating hours.</p></div><Link to="/travel" className="w-full max-w-xs"><Button variant="outline" size="lg" className="w-full rounded-xl">Back to Travel</Button></Link></div>);
  }

  return (
    <div className="flex flex-col bg-background" style={{ height: '100dvh' }}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-xl flex-shrink-0 relative z-50">
        <button onClick={() => setShowLeaveModal(true)} className="p-2 rounded-xl text-muted-foreground hover:text-foreground transition-colors flex-shrink-0" title="Leave location"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1 min-w-0"><h2 className="text-sm font-bold text-foreground truncate">{location.name}</h2><p className="text-xs text-muted-foreground capitalize">{CATEGORY_EMOJIS[location.category]} {location.category?.replace("_", " ")} · {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}</p></div>
        {isHomeLocation && !isSharedLocation && <ResidenceOptionsDropdown location={location} sceneCharacters={sceneCharacters} isResident={broughtCharacters.some((c) => c.current_home_location_id === location.id)} currentUser={currentUser} allCharacters={characters} onTour={() => setShowTourModal(true)} onMoveIn={() => setShowMoveInPopup(true)} onMoveOut={handleMoveOut} onAskToLeave={handleAskToLeave} onCharacterPulledHome={() => queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] })} onKickOut={() => setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: "You assert your authority and ask them to leave immediately.", timestamp: new Date().toISOString() }])} />}
        <div ref={npcDropdownRef}><WhosHereDropdown presentParticipants={sceneParticipants} candidateNpcs={allPossibleNpcs.filter((n) => !sceneParticipants.some((p) => p.id === n.id))} selectedNpcs={selectedNpcs} onToggleNpc={toggleNpc} showDropdown={showNpcDropdown} onToggleDropdown={setShowNpcDropdown} onInviteClick={() => { setShowNpcDropdown(false); setShowInviteModal(true); }} renderNpc={renderNpc} /></div>
        <button onClick={() => setShowPhotoModal(true)} className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="Scene photo"><Camera className="w-4 h-4" /></button>
        <button onClick={() => setWatchVideoActive((v) => !v)} className={`p-2 rounded-xl transition-colors ${watchVideoActive ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`} title="Watch Video"><Tv className="w-4 h-4" /></button>
      </div>

      <ImageLightbox src={lightboxSrc} alt={location.name} onClose={() => setLightboxSrc(null)} />

      {/* Scene media area — extracted component with collapse/expand (no side effects) */}
      <SceneMediaArea location={location} locationZones={locationZones} activeZone={activeZone} onZoneChange={handleZoneChange} sceneImage={sceneImage} isGeneratingImage={isGeneratingImage} onRefresh={() => { setHasUserRequestedImage(true); setSceneImage(null); }} onLightbox={setLightboxSrc}
        watchVideoActive={watchVideoActive} onToggleWatchVideo={() => { setWatchVideoActive(false); setWatchContext(null); }} watchContext={watchContext} displayName={displayName}
        onWatchStarted={(ctx) => { setWatchContext(ctx); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `${displayName} started watching${ctx.title ? ` "${ctx.title}"` : " a video"} together with everyone.`, timestamp: new Date().toISOString() }]); }}
        onWatchAnalysisComplete={({ linkAnalysisContext, linkData, title }) => { setWatchContext((prev) => ({ ...prev, linkAnalysisContext, title: title || prev?.title })); if (linkData?.title && !title) setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `Now playing: ${linkData.title}.`, timestamp: new Date().toISOString() }]); }}
        onWatchStopped={() => { setWatchContext(null); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `The watch party ended.`, timestamp: new Date().toISOString() }]); }}
      />

      {/* Character presence strip */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/50 flex-shrink-0">
        <div className="flex flex-col items-center gap-1"><div className="w-8 h-8 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center overflow-hidden">{currentUser?.generated_avatar_urls?.[0] ? <img src={currentUser.generated_avatar_urls[0]} alt={displayName} className="w-full h-full object-cover" /> : <span className="text-xs font-bold text-primary">{displayName?.[0]}</span>}</div><span className="text-[9px] text-primary font-medium">{displayName}</span></div>
        {[...traveledWithChars, ...selectedNpcs, ...extraNpcs].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i).map((char) => (<div key={char.id} className="flex flex-col items-center gap-1"><div className="w-8 h-8 rounded-full bg-secondary border-2 border-border flex items-center justify-center overflow-hidden">{char.avatar_url ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" /> : <span className="text-xs font-bold text-foreground">{char.name?.[0]}</span>}</div><span className="text-[9px] text-muted-foreground truncate max-w-[40px]">{char.name.split(" ")[0]}</span></div>))}
        {traveledWithChars.length === 0 && selectedNpcs.length === 0 && extraNpcs.length === 0 && <span className="text-xs text-muted-foreground ml-1">You're here alone</span>}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <div className="text-center space-y-2">
          <span className="text-xs text-muted-foreground bg-secondary px-3 py-1 rounded-full">You arrive at {location.name}{activeZone ? ` · ${activeZone}` : ""}{traveledWithChars.length > 0 ? ` with ${traveledWithChars.map((c) => c.name).join(", ")}` : ""}</span>
          {(homeResidentsPresent.length > 0 || familyMemberNpcsPresent.length > 0) && <div><span className="text-xs text-green-400/80 bg-secondary/50 px-3 py-1 rounded-full">{[...homeResidentsPresent, ...familyMemberNpcsPresent].map((c) => c.name).join(", ")} {homeResidentsPresent.length + familyMemberNpcsPresent.length === 1 ? "is" : "are"} home</span></div>}
          {(homeResidentsAway.length > 0 || familyMemberNpcsAway.length > 0) && <div><span className="text-xs text-muted-foreground/60 bg-secondary/50 px-3 py-1 rounded-full">{homeResidentsAway.map((c) => c.name).concat(familyMemberNpcsAway.map((fm) => fm.name)).join(", ")} {homeResidentsAway.length + familyMemberNpcsAway.length === 1 ? "is" : "are"} away</span></div>}
          {workerCharacters.length > 0 && <div><span className="text-xs text-muted-foreground/70 bg-secondary/50 px-3 py-1 rounded-full">{workerCharacters.map((c) => c.name).join(", ")} {workerCharacters.length === 1 ? "is" : "are"} here working</span></div>}
          {(() => { const presentHere = getPresenceAtLocation(location, unifiedPresenceEntities).filter((e) => !characterIds.includes(e.id)); return presentHere.length > 0 ? <div><span className="text-xs text-blue-400/70 bg-secondary/50 px-3 py-1 rounded-full">{presentHere.map((e) => e.display_name).join(", ")} {presentHere.length === 1 ? "is" : "are"} also here — tap "Who's here" to interact</span></div> : null; })()}
        </div>

        <AnimatePresence>
          {messages.map((msg) => (
            <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-2 ${msg.sender === "user" ? "justify-end" : msg.sender === "narrative" ? "justify-center" : msg.sender === "product" ? "justify-center" : "justify-start"}`}>
              {msg.sender === "narrative" ? <span className="text-xs text-muted-foreground italic bg-secondary/50 px-3 py-1.5 rounded-full max-w-xs text-center">{msg.content}</span> : msg.sender === "product" ? <SceneProductCard msg={msg} settings={settings} location={location} currentUser={currentUser} queryClient={queryClient} base44={base44} setPendingPurchase={setPendingPurchase} setMessages={setMessages} /> : msg.sender === "character" ? <React.Fragment><div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden mt-0.5">{msg.avatarUrl ? <img src={msg.avatarUrl} alt={msg.senderName} className="w-full h-full object-cover" /> : <span className="text-xs font-bold text-foreground">{msg.senderName?.[0]}</span>}</div><div className="max-w-[75%]"><p className="text-[10px] text-muted-foreground mb-0.5">{msg.senderName}</p><div className="bg-card border border-border rounded-2xl rounded-tl-sm px-3 py-2"><p className="text-sm text-foreground">{msg.content}</p></div></div></React.Fragment> : <div className="bg-primary rounded-2xl rounded-tr-sm px-3 py-2 max-w-[75%]"><p className="text-sm text-primary-foreground">{msg.content}</p></div>}
            </motion.div>
          ))}
        </AnimatePresence>

        {isTyping && <div className="flex gap-2"><div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center"><span className="text-xs">...</span></div><div className="bg-card border border-border rounded-2xl px-3 py-2"><div className="flex gap-1"><div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-1" /><div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-2" /><div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-3" /></div></div></div>}
        <div ref={bottomRef} />
      </div>

      {/* Action buttons */}
      <div className="px-3 py-2 border-t border-border bg-card/50 flex-shrink-0 overflow-hidden">
        <div className="flex gap-1.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-hide">
          <button onClick={() => setShowChangeClothesModal(true)} disabled={actionCooldown} className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-center flex-shrink-0 snap-center ${actionCooldown ? "opacity-40 cursor-not-allowed" : "bg-secondary border-border hover:border-primary/30"}`} title="Change your outfit"><span className="text-base leading-none">👕</span><span className="text-[9px] text-foreground font-medium leading-tight whitespace-nowrap">Change Clothes</span></button>
          {actions.map((action) => { const needsZone = action.suggested_zone_name && activeZone !== action.suggested_zone_name; const isDisabled = action.disabled || actionCooldown; return (
            <button key={action.scene_instance_id || action.id} onClick={() => { if (isDisabled) return; if (needsZone) { handleZoneChange(action.suggested_zone_name); setTimeout(() => handleAction(action), 400); } else handleAction(action); }} disabled={isDisabled} title={action.disabledReason || (needsZone ? `Go to ${action.suggested_zone_name}` : undefined)} className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-center flex-shrink-0 snap-center ${isDisabled ? "opacity-40 cursor-not-allowed" : action.type === "negative" ? "bg-destructive/10 border-destructive/30 hover:bg-destructive/20" : action.cost > 0 ? "bg-green-500/10 border-green-500/30 hover:bg-green-500/20" : needsZone ? "bg-primary/5 border-primary/20 hover:border-primary/40" : "bg-secondary border-border hover:border-primary/30"}`}>
              <span className="text-base leading-none">{action.emoji}</span><span className="text-[9px] text-foreground font-medium leading-tight whitespace-nowrap">{action.label}</span>
              {action.cost > 0 && <span className="text-[9px] text-green-500">${action.cost}</span>}{action.no_staff_warning && <span className="text-[8px] text-amber-500 leading-tight">no staff</span>}
            </button>); })}
        </div>
      </div>

      {privateTarget && <div className="flex items-center justify-between px-3 py-1.5 bg-primary/10 border-t border-primary/30 flex-shrink-0"><span className="text-xs text-primary font-medium">🤫 Private with {privateTarget.name}</span><button onClick={() => { setPrivateTarget(null); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `You rejoin the group.`, timestamp: new Date().toISOString() }]); }} className="text-[10px] text-primary/70 hover:text-primary underline">End private chat</button></div>}

      <NPCEvolutionTracker messages={messages} selectedNpcs={selectedNpcs} currentUser={currentUser} locationName={location.name} onNpcSaved={(name) => setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `${name} has been saved to your world.`, timestamp: new Date().toISOString() }])} />
      <SceneInputBar inputText={inputText} setInputText={setInputText} narratorMode={narratorMode} setNarratorMode={setNarratorMode} onSend={stableOnSend} />

      <AnimatePresence>{showPhotoModal && <ScenePhotoModal location={location} characters={allSceneChars} allPossibleNpcs={allPossibleNpcs} currentUser={currentUser} displayName={displayName} onClose={() => setShowPhotoModal(false)} allCharacters={characters} onGenerateSceneImage={(actionOverridePrompt) => generateSceneImage({ location, locationZones, activeZone, sceneParticipants, userParticipant, isHomeLocation, isRestrictedEnv, firstImage, selectImageParticipants, characters, locationMap, actionOverridePrompt })} isGeneratingImage={isGeneratingImage} />}</AnimatePresence>
      <AnimatePresence>{showTourModal && <RealtorTourModal isOpen={showTourModal} location={location} onClose={() => setShowTourModal(false)} onAddRealtor={(realtorNpc) => { setExtraNpcs((prev) => prev.find((n) => n.id === realtorNpc.id) ? prev : [...prev, realtorNpc]); if (selectedNpcIds === null || !selectedNpcIds.includes(realtorNpc.id)) setSelectedNpcIds((prev) => [...(prev || []), realtorNpc.id]); }} />}</AnimatePresence>
      <AnimatePresence>{showMoveInPopup && !isSharedLocation && <MoveInPopup isOpen={showMoveInPopup} character={broughtCharacters[0]} sourceHome={locationsData.find((l) => l.id === broughtCharacters[0]?.current_home_location_id)} destinationHome={location} allCharacters={characters} broughtCharacters={broughtCharacters} onApprove={handleMoveIn} onReject={() => setShowMoveInPopup(false)} onClose={() => setShowMoveInPopup(false)} isLoading={isMoveInLoading} />}</AnimatePresence>

      <InviteToSceneModal isOpen={showInviteModal} onClose={() => setShowInviteModal(false)} location={location} characters={characters} userDisplayName={displayName} onCharacterArrived={(char) => { setExtraNpcs((prev) => prev.find((n) => n.id === char.id) ? prev : [...prev, char]); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `${char.name} arrives at ${location.name}.`, timestamp: new Date().toISOString() }]); queryClient.invalidateQueries({ queryKey: ["activeCharacters", currentUser?.email] }); queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }); }} />
      <ConversationTypeSelector isOpen={!!conversationModal} onClose={() => setConversationModal(null)} onSelect={(conversationType) => { if (conversationType === "one_on_one" && conversationModal?.npcId && conversationModal?.npcName) { setPrivateTarget({ id: conversationModal.npcId, name: conversationModal.npcName }); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `You pull ${conversationModal.npcName} aside for a private conversation.`, timestamp: new Date().toISOString() }]); } else setPrivateTarget(null); }} npcName={conversationModal?.npcName || "them"} hasEmployees={conversationModal?.hasEmployees || false} isGroup={conversationModal?.isGroup || false} />
      <LeaveLocationModal isOpen={showLeaveModal} onClose={() => setShowLeaveModal(false)} locationName={location.name} broughtCharacters={broughtCharacters} onLeaveWithChars={handleLeaveWithCharacters} onLeaveCharactersBehind={handleLeaveCharactersBehind} />
      <ProductPurchaseModal isOpen={!!pendingPurchase} price={pendingPurchase?.price} productId={pendingPurchase?.productId} preview_image_url={pendingPurchase?.preview_image_url} userBalance={settings.user_balance ?? 6000} userSettings={settings} currentUser={currentUser} traveledWithChars={[...traveledWithChars, ...selectedNpcs.filter((n) => !n.isNpc)].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i)} item_label={pendingPurchase?.item_label} item_category={pendingPurchase?.item_category} action_id={pendingPurchase?.action_id} purchase_source={pendingPurchase?.purchase_source} location_name={location?.name} onClose={() => setPendingPurchase(null)} onPurchased={(message) => { const price = pendingPurchase?.price; setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `✓ Purchased for $${price} — ${message}.`, timestamp: new Date().toISOString() }]); setPendingPurchase(null); }} />
      <ChangeClothesModal isOpen={showChangeClothesModal} onClose={() => setShowChangeClothesModal(false)} settings={settings} isUserSettingsLoading={isUserSettingsLoading} presentCharacters={changeClothesEligibleCharacters} location={location} currentUser={currentUser} userAvatar={currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || currentUser?.avatar_url || null} userName={displayName} onOutfitChanged={(targetType) => { if (targetType === 'user') queryClient.invalidateQueries({ queryKey: ['userSettings', currentUser?.email] }); else queryClient.invalidateQueries({ queryKey: ['activeCharacters', currentUser?.email] }); setOutfitVersion((v) => v + 1); setHasUserRequestedImage(true); setSceneImage(null); }} />
      {pendingInvitations && <InviteOutModal invitations={pendingInvitations} onAccept={(invite) => { base44.functions.invoke('recordCharacterInviteAccepted', { characterId: invite.characterId, locationId: invite.locationId, inviteType: invite.inviteType }).catch(() => {}); const remaining = pendingInvitations.filter((i) => i.characterId !== invite.characterId); setPendingInvitations(remaining.length > 0 ? remaining : null); const charIds = invite.characterIds ? invite.characterIds.join(",") : invite.characterId; navigate(`/scene?locationId=${invite.locationId}&characterIds=${charIds}`); }} onDecline={(selectedInv) => { base44.functions.invoke('recordCharacterInviteDeclined', { characterId: selectedInv.characterId, locationId: selectedInv.locationId }).catch(() => {}); const remaining = pendingInvitations.filter((i) => i.characterId !== selectedInv.characterId); setPendingInvitations(remaining.length > 0 ? remaining : null); }} onClose={() => { if (settings.id) base44.entities.UserSettings.update(settings.id, { pending_character_invites: [] }).catch(() => {}); setPendingInvitations(null); }} />}
    </div>
  );
}