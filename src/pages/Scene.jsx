import React, { useState, useEffect, useRef, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Camera, DollarSign, RefreshCw, Send, Users, ChevronDown, Check, MapPin, ZoomIn, BookOpen, UserPlus, LogOut, X } from "lucide-react";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import ScenePhotoModal from "@/components/travel/ScenePhotoModal";
import { filterDashes } from "@/lib/dashFilter";
import { isCharacterAtWork } from "@/lib/workScheduleUtils";
import { isCharacterHome } from "@/lib/travelAvailability";
import { isCharacterAsleep } from "@/lib/sleepUtils";
import { isLocationOpen } from "@/lib/locationHoursUtils";
import { generateLocationActions } from "@/lib/actionGenerator";
import { buildUnifiedMemoryContext, formatMemoryForLLM, shouldReferenceMemory, getLocationMemories } from "@/lib/memoryUnity";
import { checkCharacterAvailability, getLocationEmployees, spawnLocationNPCs, shouldNPCApproach } from "@/lib/npcSpawner";
import { getPresenceAtLocation, resolveTravelPresenceEntities } from "@/lib/travelPresenceResolver";
import ConversationTypeSelector from "@/components/scene/ConversationTypeSelector";
import InviteToSceneModal from "@/components/scene/InviteToSceneModal";
import WhosHereDropdown from "@/components/scene/WhosHereDropdown";
import { buildSceneSystemPrompt, maybeInjectMemoryCallback, buildNPCIntroContext } from "@/lib/sceneMemoryInjection";
import { writeSceneExitMemories } from "@/lib/sceneExitMemory";
import ResidenceOptionsDropdown from "@/components/scene/ResidenceOptionsDropdown";
import RealtorTourModal from "@/components/scene/RealtorTourModal";
import MoveInPopup from "@/components/travel/MoveInPopup";
import InviteOutModal from "@/components/home/InviteOutModal";
import LeaveLocationModal from "@/components/scene/LeaveLocationModal";
import ProductPurchaseModal from "@/components/scene/ProductPurchaseModal";
import { isNPCOnShift } from "@/lib/npcShiftUtils";
import SceneInputBar from "@/components/scene/SceneInputBar";
import NPCEvolutionTracker from "@/components/scene/NPCEvolutionTracker";
import { isResidentialLocation, resolveSceneImagePeople, buildResidentialImageConstraint } from "@/lib/residentialSceneFiltering";
import { buildIdentityLockBlock, prioritizeAvatarReferences, validateIdentityLockCompliance, describeIdentityLocks } from "@/lib/characterIdentityLock";
import { enforceZoneLock, buildAvatarIdentityBlock } from "@/lib/sceneImageGenerator";
import { ACTION_IMAGE_PROMPTS, getLocationActions } from "@/lib/sceneActionConfig";
import { buildVisualReferenceStack, buildAvatarIdentityEnforcementBlock } from "@/lib/avatarIdentityEnforcer";
import { useSceneCharacters } from "@/hooks/useSceneCharacters";
import { getLightingDescriptor, buildZoneLockEnvNote, buildActionEnvNote } from "@/lib/sceneImagePromptBuilder";
import { VENUE_NPCS, DEFAULT_VENUE_NPC } from "@/lib/sceneVenueNPCs";

const CATEGORY_EMOJIS = {
  home: "🏠", workplace: "💼", school: "🏫", gym: "🏋️", grocery: "🛒",
  food_drink: "🍽️", outdoor: "🌳", social: "🍸", medical: "🏨",
  bar: "🍸", generic: "📍",
};

// Categories that serve food/drinks
const FOOD_VENUE_CATEGORIES = ["food_drink", "social", "home"];

export default function Scene() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const locationId = urlParams.get("locationId");
  const characterIds = (urlParams.get("characterIds") || "").split(",").filter(Boolean);

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [sceneImage, setSceneImage] = useState(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [actions, setActions] = useState([]);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [actionCooldown, setActionCooldown] = useState(false);
  const [selectedNpcIds, setSelectedNpcIds] = useState(null);
  const [showNpcDropdown, setShowNpcDropdown] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [activeZone, setActiveZone] = useState(null);
  const [showZonePicker, setShowZonePicker] = useState(false);
  const [conversationModal, setConversationModal] = useState(null); // {npcId, npcName, hasEmployees}
  const [narratorMode, setNarratorMode] = useState(false); // toggles between dialogue and narration input
  const [showTourModal, setShowTourModal] = useState(false);
  const [showMoveInPopup, setShowMoveInPopup] = useState(false);
  const [isMoveInLoading, setIsMoveInLoading] = useState(false);
  const [extraNpcs, setExtraNpcs] = useState([]); // realtor + other added NPCs
  const [pendingInvitations, setPendingInvitations] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [privateTarget, setPrivateTarget] = useState(null); // { id, name } — pull aside mode
  const [pendingPurchase, setPendingPurchase] = useState(null); // { price, productId, targetCharacterId }
  const bottomRef = useRef(null);
  const npcDropdownRef = useRef(null);
  const zonPickerRef = useRef(null);
  // Stable refs for send handlers — prevents SceneInputBar from re-rendering on every keystroke
  const narratorModeRef = useRef(narratorMode);
  const sendMessageRef = useRef(null);
  const sendNarrationRef = useRef(null);

  const { data: currentUser = {} } = useQuery({ queryKey: ["user"], queryFn: () => base44.auth.me() });
  const { data: settingsList } = useQuery({
    queryKey: ["userSettings", currentUser?.email],
    queryFn: () => base44.entities.UserSettings.filter({ owner_email: currentUser.email }),
    enabled: !!currentUser?.email,
  });
  const safeSettingsList = Array.isArray(settingsList) ? settingsList : [];
  const settings = safeSettingsList[0] || {};
  // IDENTITY ISOLATION: displayName must always come from the currently authenticated user.
  // Never derive it from shared/cached settings that may belong to another account.
  const displayName = settings.fictional_world_name || currentUser?.full_name || "You";

  const { data: locationsData = [] } = useQuery({
    queryKey: ["locationReferences", currentUser?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke("fetchAllLocationsForUser", {});
      return res?.data?.locations || [];
    },
    enabled: !!currentUser?.email,
  });

  // Multi-source character loading — same strategy as Travel page so Scene sees all NPCs
  const { 
    characters, 
    activeChars, 
    backendNpcFictitious, 
    rlsNpcFictitious, 
    familyByCreatedBy, 
    familyByOwner 
  } = useSceneCharacters(currentUser);

  const location = locationsData.find(l => l.id === locationId);
  const locationMap = Object.fromEntries(locationsData.map(l => [l.id, l]));
  const locationZones = location?.zones || [];

  // Active characters explicitly brought (from URL params) — must be before useMemo that uses it
  const broughtCharacters = characters.filter(c => characterIds.includes(c.id));

  // ── UNIFIED PRESENCE RESOLUTION ─────────────────────────────────────────────
  // SAME resolver as Travel page (Map + popup) — one source of truth for all surfaces
  const unifiedPresenceEntities = useMemo(() => {
    const resolved = resolveTravelPresenceEntities({
      currentUser,
      userSettings: settings || null,
      activeCharacters: activeChars,
      npcFictitious: [...backendNpcFictitious, ...rlsNpcFictitious].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i),
      npcFamilyMembers: [...familyByCreatedBy, ...familyByOwner].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i),
      allCharacters: characters,
      locations: locationsData,
    });

    // CRITICAL: Brought characters MUST appear in presence, even if resolved_current_location_id hasn't synced yet
    // They are explicitly here with the user, so override their presence state
    const withBroughtCharacters = resolved.map(entity => {
      if (broughtCharacters.find(bc => bc.id === entity.id)) {
        return {
          ...entity,
          resolved_current_location_id: locationId,
          is_currently_present: true,
        };
      }
      return entity;
    });

    // Add any brought characters missing from resolved list (e.g., newly arrived)
    broughtCharacters.forEach(brought => {
      if (!withBroughtCharacters.find(e => e.id === brought.id)) {
        withBroughtCharacters.push({
          id: brought.id,
          display_name: brought.display_name || brought.name,
          name: brought.name,
          character_type: brought.character_type,
          avatar_url: brought.avatar_url,
          resolved_current_location_id: locationId,
          resolved_current_location_name: location?.name,
          resolved_presence_status: 'visiting',
          is_currently_present: true,
          is_home_resident: brought.current_home_location_id === locationId,
          personality_summary: brought.personality_summary,
          emotional_state: brought.emotional_state,
        });
      }
    });

    return withBroughtCharacters;
  }, [currentUser?.id, activeChars.length, backendNpcFictitious.length, rlsNpcFictitious.length, familyByCreatedBy.length, familyByOwner.length, locationsData.length, broughtCharacters, locationId, location?.name]);

  // ── AUTHORITATIVE PRESENCE FILTER ────────────────────────────────────────────
  // SINGLE SOURCE OF TRUTH: Only use resolved_current_location_id for scene attendance.
  // Staff assignment is NOT scene presence. Schedule-blocked characters are NOT here.
  // This aligns Scene with Home page and Travel page.

  const isHomeLocation = location?.category === "home";
  const isSharedLocation = location?.scope === 'shared' || location?.location_type === 'shared';
  const isAdmin = currentUser?.role === 'admin';
  const isVGCTowers = location?.name === 'VGC Towers';

  // VALID PRESENCE STATES that indicate real physical presence
  const VALID_PRESENCE_STATES = new Set(['home', 'social_visit', 'work', 'school', 'hospital', 'supervised', null, undefined, '']);

  // Helper: is a character truly present at this location right now?
  const isAuthoritativelyPresent = (char) => {
    // GATE 1: resolved_current_location_id must match exactly
    if (char.resolved_current_location_id && char.resolved_current_location_id !== locationId) {
      return false; // LOCATION_MISMATCH — they are somewhere else
    }
    // GATE 2: If sleeping, exclude from public/social scenes (only home scenes show sleepers)
    if (isCharacterAsleep(char) && !isHomeLocation) return false;
    // GATE 3: in_transit means not arrived yet
    if (char.presence_state === 'in_transit') return false;
    return true;
  };

  // Active characters home at a home location
  const homeResidents = isHomeLocation
    ? characters.filter(c => c.current_home_location_id === location.id)
    : [];
  // VGC Towers: residents are selectable but not auto-shown in the presence strip
  const homeResidentsPresent = homeResidents.filter(c => isCharacterHome(c, locationMap));
  const homeResidentsAway = homeResidents.filter(c => !isCharacterHome(c, locationMap));

  // Family NPCs for home scenes.
  // A family NPC is "present" if their current_location_id is unset (default = home) or === this location.
  // A family NPC is "away" if their current_location_id is set to a DIFFERENT location.
  // We do NOT require fictional_relationships lookup — resident_family_members is the source of truth.
  const getFamilyNpcLocationId = (fm) => {
    // Check source character's fictional_relationships for current_location_id
    for (const char of homeResidents) {
      const rel = char.fictional_relationships?.find(
        r => r.person_name?.trim().toLowerCase() === fm.name?.trim().toLowerCase() && !r.related_character_id
      );
      if (rel) return rel.current_location_id || null;
    }
    return null; // no location set = home by default
  };

  const familyMemberNpcsAway = isHomeLocation
    ? (location.resident_family_members || []).filter(fm => {
        if (!fm.name) return false;
        const locId = getFamilyNpcLocationId(fm);
        return locId && locId !== location.id;
      })
    : [];

  const familyMemberNpcsPresent = isHomeLocation
    ? (location.resident_family_members || []).filter(fm => {
        if (!fm.name) return false;
        const locId = getFamilyNpcLocationId(fm);
        return !locId || locId === location.id;
      })
    : [];

  // Build NPC pseudo-characters for family members present (for sceneCharacters roster)
  const familyNpcSceneObjects = familyMemberNpcsPresent.map(fm => {
    // Look up photo_url from source character's family_members array
    let photoUrl = null;
    for (const char of homeResidents) {
      const match = char.family_members?.find(
        m => m.name?.trim().toLowerCase() === fm.name?.trim().toLowerCase()
      );
      if (match?.photo_url) { photoUrl = match.photo_url; break; }
    }
    return {
      id: `npc_family_${fm.name.replace(/\s+/g, '_')}`,
      name: fm.name,
      role: fm.relationship_type || 'Family',
      isNpc: true,
      character_type: 'family_npc',
      avatar_url: photoUrl,
    };
  });

  // Workers: ONLY if they have a valid resolved presence at this location (not just assignment)
  // HARD RULE: isCharacterAtWork checks schedule; PLUS we require resolved presence if set
  const workerCharacters = location
    ? characters.filter(c => {
        if (characterIds.includes(c.id)) return false;
        if (isCharacterAsleep(c)) return false;
        if (!isCharacterAtWork(c, location)) return false;
        // If resolved_current_location_id is set to somewhere else, they are NOT here
        if (c.resolved_current_location_id && c.resolved_current_location_id !== locationId) return false;
        return true;
      })
    : [];

  // VGC Towers NPC characters distributed to this location (authoritative presence)
  // These are Character entity records with resolved_current_location_id === locationId
  const vgcDistributedNpcs = characters.filter(c => {
    if (!c.character_type) return false;
    const isNpcType = ['npc', 'family_npc', 'background', 'promoted_npc'].includes(c.character_type);
    if (!isNpcType) return false;
    if (characterIds.includes(c.id)) return false;
    // Must have authoritative resolved presence at this exact location
    if (c.resolved_current_location_id !== locationId) return false;
    // Must be in a valid presence state (social_visit, home, work)
    if (c.presence_state === 'in_transit') return false;
    return true;
  });

  // PRESENCE SYNC: Scan all characters for NPCs currently at this location (legacy fictional_relationships)
  const npcsTravelingHere = (() => {
    const traveling = [];
    characters.forEach(char => {
      if (!char.fictional_relationships) return;
      char.fictional_relationships.forEach(rel => {
        if (!rel.related_character_id && rel.person_name && rel.current_location_id === locationId) {
          traveling.push({
            id: `npc_${rel.person_name.replace(/\s+/g, "_")}_${char.id}`,
            name: rel.person_name,
            role: rel.relationship_type || "NPC",
            isNpc: true,
            avatar_url: null,
          });
        }
      });
    });
    return traveling;
  })();

  // "Here Now" real characters from unified presence resolver — must be selectable in Who's Here
  const hereNowFromPresence = useMemo(() => {
    if (!location) return [];
    return getPresenceAtLocation(location, unifiedPresenceEntities)
      .filter(e => !characterIds.includes(e.id)) // exclude already-traveled-with
      .map(entity => ({
        id: entity.id,
        name: entity.display_name,
        avatar_url: entity.avatar_url,
        role: entity.resolved_presence_status === 'home' ? 'Resident' : 'Here now',
        isNpc: false,
        npcType: 'present',
        personality_summary: entity.personality_summary,
        emotional_state: entity.emotional_state,
      }));
  }, [location, unifiedPresenceEntities, characterIds]);

  // Build the full pool of possible NPCs for ANY venue
  const allPossibleNpcs = (() => {
    const npcs = [];

    // Home: build resident NPC list with correct hierarchy:
    // 1. Fictitious NPC Character entities (highest priority)
    // 2. Real Character residents
    // 3. NPC family members (resident_family_members)
    if (isHomeLocation) {
      // FIRST: fictional NPC Character records (vgcDistributedNpcs / Character entities)
      vgcDistributedNpcs.forEach(n => {
        if (!npcs.find(x => x.id === n.id)) {
          npcs.push({
            id: n.id,
            name: n.name,
            role: n.character_type === 'family_npc' ? 'Family' : 'Resident',
            isNpc: true,
            npcType: 'resident',
            avatar_url: n.avatar_url || null,
            personality_summary: n.personality_summary,
            emotional_state: n.emotional_state,
          });
        }
      });

      // SECOND: real Character entities living here
      homeResidents.forEach(c => {
        if (!npcs.find(x => x.id === c.id) && !characterIds.includes(c.id)) {
          npcs.push({
            id: c.id,
            name: c.name,
            role: 'Resident',
            isNpc: false,
            npcType: 'resident',
            avatar_url: c.avatar_url || null,
            personality_summary: c.personality_summary,
            emotional_state: c.emotional_state,
          });
        }
      });

      // THIRD: NPC family members from resident_family_members (lowest priority)
      (location.resident_family_members || []).forEach(fm => {
        if (!fm.name) return;
        // Skip if already represented by a real Character entity above
        const alreadyAdded = npcs.find(x => x.name?.trim().toLowerCase() === fm.name.trim().toLowerCase());
        if (alreadyAdded) return;
        const sourceChar = fm.source_character_id
          ? characters.find(c => c.id === fm.source_character_id)
          : homeResidents.find(c =>
              c.family_members?.some(m => m.name?.trim().toLowerCase() === fm.name.trim().toLowerCase())
            );
        const familyMemberRecord = sourceChar?.family_members?.find(
          m => m.name?.trim().toLowerCase() === fm.name.trim().toLowerCase()
        );
        const avatarUrl = familyMemberRecord?.photo_url || null;
        npcs.push({
          id: `npc_${fm.name.replace(/\s+/g, "_")}`,
          name: fm.name,
          role: fm.relationship_type || "Family",
          isNpc: true,
          npcType: "resident",
          avatar_url: avatarUrl,
        });
      });
    }

    // Any venue: NPC owner/operator — ONLY add if live presence confirms they are on-site.
    // RULE: Ownership is NOT presence. owner_is_npc alone never adds them to the scene.
    // They appear here only as a selectable "Who's here" option if the user explicitly engages them.
    // (We keep them in the picker so the user can choose to interact if owner happens to be present,
    //  but they are NOT auto-added to the scene roster or traveled-with.)
    if (!isHomeLocation && location?.owner_is_npc && location?.owner_npc_name) {
      npcs.push({ id: `npc_owner_${location?.id}`, name: location.owner_npc_name, role: location.owner_role || "Owner", isNpc: true, npcType: "staff", avatar_url: null });
    }

    // Real named workers from the location record (worker_character_ids + worker_job_titles)
    // RULE: A worker assigned to a location is NOT automatically present.
    // They must have live presence confirmed (resolved_current_location_id === locationId).
    // Only add to the selectable "Who's here" list if live presence is confirmed.
    const locationWorkerIds = location?.worker_character_ids || [];
    locationWorkerIds.forEach(wid => {
      // Skip characters already auto-shown as "on shift" workers
      if (workerCharacters.find(w => w.id === wid)) return;
      // Skip characters brought by user
      if (characterIds.includes(wid)) return;
      const workerChar = characters.find(c => c.id === wid);
      if (!workerChar) return;
      // OWNERSHIP/ASSIGNMENT ≠ PRESENCE: only show if live presence confirmed at this location
      if (workerChar.resolved_current_location_id !== locationId) return;
      const jobTitle = location.worker_job_titles?.[wid] || workerChar.work_details?.job_title || "Employee";
      npcs.push({
        id: workerChar.id,
        name: workerChar.name,
        role: jobTitle,
        isNpc: false, // real character
        npcType: "staff",
        avatar_url: workerChar.avatar_url,
        personality_summary: workerChar.personality_summary,
        archetype: workerChar.archetype,
        emotional_state: workerChar.emotional_state,
      });
    });

    // For home locations, stop here — no generic venue NPCs, no strangers, no locals.
    // Only residents explicitly listed on the location record are ever present in a home.
    // BUT still include "Here Now" real characters so they can be selected.
    if (isHomeLocation) {
      hereNowFromPresence.forEach(n => {
        if (!npcs.find(x => x.id === n.id)) npcs.push(n);
      });
      return npcs.filter((n, i, arr) => arr.findIndex(x => x.id === n.id) === i);
    }

    // NPC staff workers defined on the location record — check if on shift
    const npcWorkerKeys = Object.keys(location?.worker_job_titles || {}).filter(k => k.startsWith("npc_"));
    npcWorkerKeys.forEach(key => {
      // Only add if on shift at this location
      if (isNPCOnShift(location, key)) {
        const npcName = key.replace(/^npc_/, "").replace(/_/g, " ");
        const jobTitle = location.worker_job_titles[key];
        if (!npcs.find(x => x.id === key)) {
          npcs.push({
            id: key,
            name: npcName,
            role: jobTitle || "Staff",
            isNpc: true,
            npcType: "staff",
            avatar_url: null,
          });
        }
      }
    });

    // Generic venue NPCs — loaded from extracted constant (lib/sceneVenueNPCs.js)
    const venueDefaults = VENUE_NPCS[location?.category] || DEFAULT_VENUE_NPC;
    venueDefaults.forEach(n => {
      if (!npcs.find(x => x.id === n.id)) npcs.push({ ...n, isNpc: true, avatar_url: null });
    });

    // Add NPCs currently traveling to this location (presence sync — legacy fictional_relationships)
    npcsTravelingHere.forEach(n => {
      if (!npcs.find(x => x.id === n.id)) npcs.push(n);
    });

    // Add VGC Towers distributed NPC Character entities at this location
    // These have authoritative resolved_current_location_id === locationId
    vgcDistributedNpcs.forEach(n => {
      if (!npcs.find(x => x.id === n.id)) {
        npcs.push({
          id: n.id,
          name: n.name,
          role: n.presence_reason === 'vgc_distribution' || n.presence_reason === 'vgc_rotation'
            ? 'Visiting'
            : (n.character_type === 'family_npc' ? 'Family' : 'NPC'),
          isNpc: true,
          npcType: 'customer',
          avatar_url: n.avatar_url || null,
          personality_summary: n.personality_summary,
          emotional_state: n.emotional_state,
        });
      }
    });

    // Add "Here Now" real characters from unified presence resolver
    // These MUST be in allPossibleNpcs so selectedNpcIds can find them
    hereNowFromPresence.forEach(n => {
      if (!npcs.find(x => x.id === n.id)) npcs.push(n);
    });

    // Dedupe by id
    return npcs.filter((n, i, arr) => arr.findIndex(x => x.id === n.id) === i);
  })();

  // Selected NPCs — default: none selected until user picks
  const selectedNpcs = selectedNpcIds !== null
    ? allPossibleNpcs.filter(n => selectedNpcIds.includes(n.id))
    : [];

  // ── SINGLE SHARED PEOPLE RESOLUTION PIPELINE ───────────────────────────────────
  // CRITICAL: Build the resolved people list ONCE. Use it for BOTH Who's Here AND image generation.
  // No re-resolution. No duplication. No separate avatar lookups.

  // traveled-with = only URL-param companions + invite-joined extras
  const traveledWithChars = broughtCharacters; // strictly from characterIds URL param

  // BUILD FUNCTION: resolvedWhosHereList — the authoritative people data
  // This is used by Who's Here dropdown AND passed to generateSceneImage()
  const buildResolvedWhosHereList = () => {
    const list = [
      // Section 1: Traveled-with companions (explicit selection only)
      ...traveledWithChars,
      // Section 2: Home residents physically present (home scenes only) — NOT traveled-with
      ...(isHomeLocation ? homeResidentsPresent.filter(r => !traveledWithChars.find(t => t.id === r.id)) : []),
      // Section 3: Family NPCs physically present (home scenes only) — enriched with avatar_url
      ...familyNpcSceneObjects.filter(fn => !traveledWithChars.find(b => b.name === fn.name)),
      // Section 4: Workers on-shift with confirmed live presence — NOT traveled-with
      ...workerCharacters.filter(w => !traveledWithChars.find(t => t.id === w.id)),
      // Section 5: VGC Towers / traveling NPCs — excluded from auto-scene, require explicit pick
      ...(isVGCTowers ? [] : vgcDistributedNpcs.filter(n =>
        !traveledWithChars.find(b => b.id === n.id) &&
        !workerCharacters.find(w => w.id === n.id)
      )),
      ...(isVGCTowers ? [] : npcsTravelingHere.filter(n =>
        !traveledWithChars.find(b => b.id === n.id) &&
        !familyNpcSceneObjects.find(fn => fn.name === n.name)
      )),
      // Section 6: Explicitly selected NPCs from "Who's here" picker
      ...selectedNpcs,
      // Section 7: Invite-joined extras (these ARE valid traveled-with equivalents)
      ...extraNpcs.filter(e => !traveledWithChars.find(t => t.id === e.id)),
    ].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i); // dedupe

    // VALIDATION: Block if avatars are missing from selected residents
    const missingAvatars = list.filter(c => !c.avatar_url && !c.image_avatar_url && c.name);
    if (missingAvatars.length > 0) {
      console.warn(
        `[Scene] ⚠️ MISSING AVATARS in Who's Here list:`,
        missingAvatars.map(c => `${c.name} (${c.id})`).join(', ')
      );
    }

    return list;
  };

  const resolvedWhosHereList = buildResolvedWhosHereList();
  const allSceneChars = resolvedWhosHereList;

  // Apply 10-character limit for VGC Towers scene display (data not affected, only display)
  const displayCharacters = isVGCTowers && allSceneChars.length > 10 ? allSceneChars.slice(0, 10) : allSceneChars;
  const sceneCharacters = allSceneChars; // Keep full roster available for NPC spawning logic

  const firstImage = location?.zones?.find(z => z.image_urls?.length > 0)?.image_urls?.[0]
    || location?.image_urls?.[0]
    || null;

  // Close NPC dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (npcDropdownRef.current && !npcDropdownRef.current.contains(e.target)) {
        setShowNpcDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleZoneChange = (zoneName) => {
    setActiveZone(zoneName);
    setShowZonePicker(false);
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      sender: "narrative",
      content: `You move to the ${zoneName}.`,
      timestamp: new Date().toISOString(),
    }]);
    // Regenerate the scene image for the new zone
    setTimeout(() => setSceneImage(null), 50);
  };

  const toggleNpc = (npcId) => {
    const current = selectedNpcIds ?? [];
    setSelectedNpcIds(
      current.includes(npcId) ? current.filter(id => id !== npcId) : [...current, npcId]
    );
  };

  // Initialize actions dynamically
  useEffect(() => {
    if (location) {
      const hour = new Date().getHours();
      const newActions = generateLocationActions(
        location,
        activeZone || locationZones[0]?.zone_name,
        hour,
        sceneCharacters,
        0
      );
      setActions(newActions);
    }
  }, [location?.id, activeZone]);

  // CHILD SAFETY: When entering a home scene, ensure a caregiver is present if a child is alone.
  useEffect(() => {
    if (!location || location.category !== 'home') return;
    base44.functions.invoke('ensureChildCaregiverPresence', { locationId: location.id }).catch(() => {});
  }, [location?.id]);

  // PRESENCE ENFORCEMENT: When characters arrive at a scene, write to the AUTHORITATIVE resolved fields.
  // This is the single location truth that propagates across ALL UI surfaces:
  // Home page card, Travel page, Travel pop-ups, Chat/Narrative, Image generation.
  // RULE: One character = one location. No overlap. No stale state.
  useEffect(() => {
    if (!location || broughtCharacters.length === 0) return;
    
    // Update brought characters — they have traveled here, so this IS their current location now.
    broughtCharacters.forEach(char => {
      base44.entities.Character.update(char.id, {
        // AUTHORITATIVE fields — these are what every UI surface reads
        resolved_current_location_id: location.id,
        resolved_current_location_name: location.name,
        resolved_location_type: location.category === 'home' ? 'home' : 'visit',
        resolved_presence_status: location.category === 'home' ? 'home' : 'visiting',
        resolved_source_reason: 'user_travel',
        resolved_last_updated_at: new Date().toISOString(),
        // Clear any stale travel transit state
        travel_status: 'not_traveling',
        travel_destination_location_id: null,
      }).catch(() => {});
    });
  }, [location?.id, broughtCharacters.length]);

  // Shared helper: build the exit memory args (same for both exit paths)
  const _exitMemoryArgs = (outcome) => ({
    broughtCharacters,
    alreadyPresentChars: selectedNpcs,
    allSceneChars: sceneCharacters,
    location,
    messages,
    userDisplayName: displayName,
    ownerEmail: currentUser?.email,
    outcome,
  });

  const handleLeaveWithCharacters = async () => {
    setShowLeaveModal(false);
    const homeNow = new Date().toISOString();
    await Promise.all([
      ...broughtCharacters.map(char =>
        base44.entities.Character.update(char.id, {
          resolved_current_location_id: char.current_home_location_id || char.home_location_id || null,
          resolved_current_location_name: (char.current_home_location_id || char.home_location_id) ? (char.resolved_current_location_name || 'Home') : null,
          resolved_location_type: 'home',
          resolved_presence_status: 'home',
          resolved_source_reason: 'returned_home_with_user',
          resolved_last_updated_at: homeNow,
          presence_stay_lock: false,
          presence_stay_lock_location_id: null,
          presence_stay_lock_set_at: null,
          travel_status: 'not_traveling',
          travel_destination_location_id: null,
        }).catch(() => {})
      ),
      writeSceneExitMemories(_exitMemoryArgs('left_together')),
    ]);
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    navigate("/travel");
  };

  const handleLeaveCharactersBehind = async () => {
    setShowLeaveModal(false);
    const now = new Date().toISOString();
    await Promise.all([
      ...broughtCharacters.map(char =>
        base44.entities.Character.update(char.id, {
          resolved_current_location_id: location.id,
          resolved_current_location_name: location.name,
          resolved_presence_status: location.category === 'home' ? 'home' : 'visiting',
          resolved_source_reason: 'user_stay_decision',
          resolved_last_updated_at: now,
          presence_stay_lock: true,
          presence_stay_lock_location_id: location.id,
          presence_stay_lock_set_at: now,
          travel_status: 'not_traveling',
          travel_destination_location_id: null,
        }).catch(() => {})
      ),
      writeSceneExitMemories(_exitMemoryArgs('stayed_behind')),
    ]);
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    navigate("/travel");
  };

  // Check for pending invitations on first mount only — NEVER on the Scene page itself
  // Invites should not interrupt an active scene
  useEffect(() => {
    // Scene page: skip all invite checks
    return;
  }, [currentUser?.email]);

  // Auto-scroll — only scroll if user is near the bottom, never steal focus
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    // Only auto-scroll if we're already near the bottom (within 150px)
    const container = el.parentElement;
    if (container) {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distFromBottom < 150) {
        el.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    }
  }, [messages.length]);

  // Rotate actions every 3 minutes
  useEffect(() => {
    if (!location) return;
    const interval = setInterval(() => {
      const hour = new Date().getHours();
      const newActions = generateLocationActions(
        location,
        activeZone || locationZones[0]?.zone_name,
        hour,
        sceneCharacters,
        0
      );
      setActions(newActions);
    }, 180000);
    return () => clearInterval(interval);
  }, [location?.id, activeZone]);

  // Generate scene image on load or when zone changes (sceneImage set to null)
  // RABBIT HOLE MODE: Skip scene generation for real-world locations
  useEffect(() => {
    if (location && !sceneImage && !isGeneratingImage && !location.is_rabbit_hole) {
      generateSceneImage();
    }
  // NOTE: resolvedWhosHereList is intentionally NOT in the dep array — it's a new array every render
  // and would cause infinite re-generation loops. Image regeneration is triggered by:
  // - location change (location?.id)
  // - sceneImage set to null (null = explicit regen request)
  // - zone change (activeZone)
  // - selectedNpcIds change (explicit user selection changes who appears)
  }, [location?.id, sceneImage, activeZone, selectedNpcIds]);

  // Ensure child caregiver presence on home location load
  useEffect(() => {
    if (!isHomeLocation || !location?.id || !currentUser?.email) return;
    base44.functions.invoke('ensureChildCaregiverPresence', {
      locationId: location.id,
      userEmail: currentUser.email,
    }).then(() => queryClient.invalidateQueries({ queryKey: ['characters', currentUser.email] })).catch(() => {});
  }, [isHomeLocation, location?.id, currentUser?.email]);

  const generateSceneImage = async (actionOverridePrompt = null) => {
    if (!location || isGeneratingImage) return;
    setIsGeneratingImage(true);

    // CRITICAL: Use resolvedWhosHereList directly — no re-resolution, no duplication
    // Log validation before proceeding
    const avatarCheckList = resolvedWhosHereList.map(p => ({
      name: p.name,
      id: p.id,
      avatar_url: p.avatar_url,
      image_avatar_url: p.image_avatar_url,
      hasAvatar: !!(p.avatar_url || p.image_avatar_url)
    }));
    console.log(
      `[Scene generateSceneImage] VALIDATION:`,
      `who's here count: ${resolvedWhosHereList.length} |`,
      `avatars present: ${resolvedWhosHereList.filter(p => p.avatar_url || p.image_avatar_url).length} |`,
      'avatars:', avatarCheckList
    );

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const lightingDesc = getLightingDescriptor(hour);

    // Build outfit descriptions for brought characters from their closet
    const getCharacterOutfitDesc = (char) => {
      const outfit = char.current_outfit;
      const closet = char.character_closet || [];
      const closetOutfits = closet.filter(item => item.type === "outfit" || (!item.piece_type && item.outfit_id));
      let activeOutfit = outfit?.label ? outfit : (closetOutfits[closetOutfits.length - 1] || null);
      if (!activeOutfit) return null;
      const parts = [activeOutfit.top, activeOutfit.bottom, activeOutfit.shoes, activeOutfit.outerwear, activeOutfit.accessories].filter(Boolean);
      return activeOutfit.full_description || parts.join(', ') || null;
    };

    const outfitLines = broughtCharacters
      .map(c => {
        const desc = getCharacterOutfitDesc(c);
        return desc ? `${c.name} is wearing: ${desc}` : null;
      })
      .filter(Boolean);

    // Also inject user's current outfit if set
    const userCurrentOutfit = settings?.user_current_outfit;
    if (userCurrentOutfit?.label) {
      const parts = [userCurrentOutfit.top, userCurrentOutfit.bottom, userCurrentOutfit.shoes, userCurrentOutfit.outerwear, userCurrentOutfit.accessories].filter(Boolean);
      const desc = userCurrentOutfit.full_description || parts.join(', ');
      if (desc) outfitLines.push(`${displayName} is wearing: ${desc}`);
    }

    const outfitSuffix = outfitLines.length > 0 ? ` OUTFIT REQUIREMENT: ${outfitLines.join('. ')}. Reproduce these exact outfits — do NOT use avatar/reference photo clothing.` : '';

    // ── REFERENCE IMAGE ASSEMBLY: AVATARS FIRST (IDENTITY SOURCE) ──────────────
    // Prioritize character avatars for identity locking, then location environment refs
    const currentZoneForAction = locationZones.find(z => z.zone_name === activeZone) || locationZones[0];
    const allZoneImagesFlat = locationZones.flatMap(z => z.image_urls || []);
    const activeZoneImagesForAction = currentZoneForAction?.image_urls || [];
    const envRefs = activeZoneImagesForAction.length > 0
      ? [...activeZoneImagesForAction, ...allZoneImagesFlat.filter(u => !activeZoneImagesForAction.includes(u))].slice(0, 4)
      : allZoneImagesFlat.length > 0
        ? allZoneImagesFlat.slice(0, 4)
        : (firstImage ? [firstImage] : []);
    
    // Use resolvedWhosHereList directly — no re-query, no re-matching by name
    const visiblePeopleForScene = resolvedWhosHereList;
    
    // Extract avatar URLs from all characters — prioritize avatar_url first, fallback to image_avatar_url
    const allCharacterAvatars = visiblePeopleForScene
      .map(c => c.avatar_url || c.image_avatar_url)
      .filter(url => url && url.trim().length > 0);
    
    console.log('[Scene] Character avatars extracted:', allCharacterAvatars);
    
    // Prioritize avatars (identity lock) before environment images
    const authoratativeEnvRefs = prioritizeAvatarReferences(visiblePeopleForScene, envRefs);

    // If an action triggered this, use the action's specific prompt
    if (actionOverridePrompt) {
      let finalPrompt = actionOverridePrompt;
      // isGlobal must NEVER be true for residential/home locations
      const isGlobal = !isHomeLocation && location.location_type === "global";

      if (!isGlobal) {
        // Use resolvedWhosHereList directly — already properly resolved with avatars
        const physicallyPresent = isHomeLocation
          ? resolveSceneImagePeople(location, resolvedWhosHereList, currentUser, true)
          : resolvedWhosHereList;

        if (physicallyPresent.length === 0) {
          finalPrompt += ` CRITICAL: This space is empty. There are absolutely NO people in this image — no humans, no silhouettes, no background figures, no one. Only the room/space itself.`;
        } else {
          finalPrompt += ` CRITICAL: Only these people may appear: ${physicallyPresent.map(c => c.name).join(", ")}. No other people, no strangers, no random background figures under any circumstances.`;
          if (isHomeLocation) {
            finalPrompt += buildResidentialImageConstraint(location, physicallyPresent);
            finalPrompt += buildIdentityLockBlock(physicallyPresent, currentUser);
          }
        }
      }
      if (authoratativeEnvRefs.length > 0) {
        finalPrompt += ` ` + buildActionEnvNote(currentZoneForAction?.zone_name || "this area", true, lightingDesc);
      }
      // AVATAR IDENTITY LOCK: enforce full identity matching for all visible people
      if (visiblePeopleForScene.length > 0) {
        finalPrompt += buildAvatarIdentityEnforcementBlock(visiblePeopleForScene);
      }
      try {
        // AVATAR IDENTITY LOCK: avatars FIRST (identity authority), env images SECOND
        const actionVisualRefs = buildVisualReferenceStack(visiblePeopleForScene, authoratativeEnvRefs);
        console.log('[Scene action] Passing visual references:', actionVisualRefs);
        const result = await base44.integrations.Core.GenerateImage({
          prompt: `${finalPrompt} Photorealistic, high quality, authentic.`,
          existing_image_urls: actionVisualRefs.length > 0 ? actionVisualRefs : undefined,
        });
        setSceneImage(result.url);
      } catch { setSceneImage(firstImage); }
      finally { setIsGeneratingImage(false); }
      return;
    }

    // authoratativeEnvRefs already computed above — zone images are the ONLY environment source
    const zoneSuffix = currentZoneForAction?.zone_name ? ` — ${currentZoneForAction.zone_name}` : "";
    const activeZoneName = currentZoneForAction?.zone_name || "this area";
    // isGlobal must NEVER be true for residential locations — home scenes always use the strict resident path
    const isGlobal = !isHomeLocation && location.location_type === "global";
    const envNote = buildZoneLockEnvNote(activeZoneName, authoratativeEnvRefs.length > 0, lightingDesc);

    let prompt;
    if (isHomeLocation) {
      // ── RESIDENTIAL SCENE — SINGLE SOURCE OF TRUTH ────────────────────────────
      // Use allPossibleNpcs (WHO'S HERE SOURCE) + selectedNpcIds to resolve final render list
      // This ensures IDENTICAL people objects and avatars as Who's Here dropdown
      
      // Build residential people using SAME pipeline as Who's Here:
      // - Resolve selected IDs → full objects from allPossibleNpcs
      // - Add brought characters (user travel companions)
      // - No limit, no silent filtering
      const selectedNpcsFull = (selectedNpcIds || [])
        .map(npcId => allPossibleNpcs.find(n => n.id === npcId))
        .filter(Boolean);

      const residentialPeople = [
        ...broughtCharacters,
        ...selectedNpcsFull,
      ].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);

      // DIAGNOSTIC LOG: Show WHO'S HERE count vs scene count
      console.log(
        `[Scene] RESIDENTIAL GENERATION:`,
        `allPossibleNpcs: ${allPossibleNpcs.length} total |`,
        `selectedNpcIds: ${(selectedNpcIds || []).length} selected |`,
        `broughtCharacters: ${broughtCharacters.length} |`,
        `residentialPeople for render: ${residentialPeople.length} |`,
        `people: ${residentialPeople.map(p => `${p.name}(id:${p.id},avatar:${!!(p.avatar_url || p.image_avatar_url)})`).join(', ')}`
      );

      // VALIDATION: Verify all selected people have avatars
      const missingAvatars = residentialPeople.filter(p => !p.avatar_url && !p.image_avatar_url);
      if (missingAvatars.length > 0) {
        console.error(
          `[Scene] MISSING AVATARS — Generation will fail:`,
          missingAvatars.map(p => `${p.name} (id: ${p.id})`).join(', ')
        );
      }

      const visibleNames = residentialPeople.map(c => c.name);
      
      const identityLockBlock = buildIdentityLockBlock(residentialPeople, currentUser);
      
      const strictPeopleRule = visibleNames.length > 0
        ? `STRICT RULE: The ONLY people who may appear are: ${visibleNames.join(", ")}. No other residents, no unselected family members, no NPCs. ONLY those named above.`
        : `STRICT RULE: This space is completely empty — nobody is present. Do not render any people, no silhouettes, no background figures. Empty room only.`;

      const atmosphereSuffix = residentialPeople.length > 0
        ? " The home is clearly lived-in: warm, fully furnished, decorated with personal belongings."
        : "";

      // IDENTITY LOCK ENFORCEMENT: Each character's avatar is the sole visual source of truth
      const avatarRefInstructions = buildAvatarIdentityEnforcementBlock(residentialPeople);

      // Build the residential constraint using the correct people list
      const residentialConstraint = buildResidentialImageConstraint(location, residentialPeople);

      // Extract avatar URLs DIRECTLY from resolved people (allPossibleNpcs matched)
      const residentAvatarUrls = residentialPeople
        .map(c => c.avatar_url || c.image_avatar_url)
        .filter(url => url && url.trim().length > 0);
      
      console.log('[Scene] Avatar URLs from allPossibleNpcs source:', residentAvatarUrls);

      // Build final visual refs: avatar images FIRST (identity authority), then environment
      const residentialVisualRefs = [
        ...residentAvatarUrls,
        ...envRefs.filter(u => !residentAvatarUrls.includes(u))
      ];

      prompt = `${envNote} Scene: ${location.name}${zoneSuffix}.${atmosphereSuffix} ${strictPeopleRule}${residentialConstraint}${identityLockBlock}${avatarRefInstructions}${outfitSuffix} Photorealistic.`;

      // ── SEND with COMPLETE resolved visual refs from allPossibleNpcs ────────────────
      try {
        console.log('[Scene residential] Avatar refs:', residentialVisualRefs.length, '| people:', residentialPeople.map(p => p.name).join(', ') || 'none');
        const result = await base44.integrations.Core.GenerateImage({
          prompt,
          existing_image_urls: residentialVisualRefs.length > 0 ? residentialVisualRefs : undefined,
        });
        setSceneImage(result.url);
      } catch {
        setSceneImage(firstImage);
      } finally {
        setIsGeneratingImage(false);
      }
      return; // ← exit early, do NOT fall through to the generic path below
    }

    // ── NON-RESIDENTIAL SCENE ────────────────────────────────────────────────
    {
      if (isGlobal) {
        const charNames = sceneCharacters.slice(0, 3).map(c => c.name).join(", ");
        const peopleDesc = charNames ? `with ${charNames} among other patrons` : "with other people around";
        const charIdentityLocks = buildIdentityLockBlock(sceneCharacters.slice(0, 3), currentUser);
        const avatarRefInstructions = buildAvatarIdentityEnforcementBlock(sceneCharacters.slice(0, 3));
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${peopleDesc}.${charIdentityLocks}${avatarRefInstructions}${outfitSuffix} Photorealistic.`;
      } else {
        const physicallyPresent = [
          ...broughtCharacters,
          ...(selectedNpcIds ? selectedNpcs : []),
        ].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i).slice(0, 3); // cap at 3

        const peopleDesc = physicallyPresent.length > 0
          ? `Only these specific people are present: ${physicallyPresent.map(c => c.name).join(", ")}. No other people, no strangers, no background figures.`
          : `The space is completely empty — no silhouettes, no background figures, nobody.`;

        const charIdentityLocks = buildIdentityLockBlock(physicallyPresent, currentUser);
        const avatarRefInstructions = buildAvatarIdentityEnforcementBlock(physicallyPresent);
        prompt = `${envNote} Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting. ${peopleDesc}${charIdentityLocks}${avatarRefInstructions}${outfitSuffix} Photorealistic.`;
      }
    }

    try {
      // AVATAR IDENTITY LOCK: avatars FIRST (identity authority), env images SECOND
      const finalVisualRefs = buildVisualReferenceStack(visiblePeopleForScene, authoratativeEnvRefs);
      console.log('[Scene main] Passing visual references:', finalVisualRefs, 'for characters:', visiblePeopleForScene.map(c => c.name));
      const result = await base44.integrations.Core.GenerateImage({
        prompt,
        existing_image_urls: finalVisualRefs.length > 0 ? finalVisualRefs : undefined,
      });
      setSceneImage(result.url);
    } catch {
      setSceneImage(firstImage);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // Generate a focused image for food, drinks, or "show me X"
  const generateFocusedImage = async (prompt) => {
    if (isGeneratingImage) return;
    setIsGeneratingImage(true);
    try {
      const result = await base44.integrations.Core.GenerateImage({
        prompt: `${prompt} Photorealistic, high quality, close-up detail.`,
        existing_image_urls: firstImage ? [firstImage] : undefined,
      });
      setSceneImage(result.url);
    } catch {
      // ignore
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // Detect if a message/action should trigger an image update OR a purchase intent
  const checkImageTrigger = (text, actionImagePrompt = null) => {
    if (actionImagePrompt) {
      generateFocusedImage(actionImagePrompt);
      return;
    }
    const t = text.toLowerCase();

    // ── PURCHASE INTENT DETECTION (AT BUSINESS VENUES) ────────────────────────────
    // Detect when user wants to buy: "I'll take it", "I like it", "how much", "price", etc.
    const isBusinessVenue = ["business", "workplace", "grocery"].includes(location?.category);
    if (isBusinessVenue) {
      const purchaseIntentMatch = t.match(/(?:i'll take it|i like it|i love it|how much|what's the price|what is the price|how much does it cost|what's the cost|i want it|can i buy|i'll buy it|i'll take|i want to buy|i'd like to buy|i want to get|i'll get it|price)/);
      if (purchaseIntentMatch) {
        const randomPrice = Math.floor(Math.random() * (150 - 25 + 1)) + 25; // $25-$150
        setMessages(prev => [...prev, {
          id: `product_${Date.now()}`,
          sender: "product",
          price: randomPrice,
          locationName: location.name,
          timestamp: new Date().toISOString(),
        }]);
        return true; // signal to sendMessage: purchase handled, skip LLM
      }
    }

    // ── BUSINESS ITEM REQUEST DETECTION ────────────────────────────────────────
    // At a business/workplace, detect when the user is asking to see or find an item.
    // Triggers a worker NPC to "show" the item by generating a focused product image.
    if (isBusinessVenue) {
      // Pattern 1: "show me X", "can you show me X", "can I see X", "I want to see X"
      const showMatch = t.match(/(?:show me|can you show me|can i see|i want to see|let me see|could i see)\s+(?:a |an |the )?(.+)/);
      if (showMatch) {
        const item = showMatch[1].replace(/[?.!]+$/, "").trim();
        generateFocusedImage(`${item} displayed on a retail shelf or counter at ${location.name}, product close-up, professional lighting,`);
        return;
      }
      // Pattern 2: "I'm looking for a/an/the X", "looking for X"
      const lookingMatch = t.match(/(?:i'm looking for|i am looking for|looking for)\s+(?:a |an |the )?(.+)/);
      if (lookingMatch) {
        const item = lookingMatch[1].replace(/[?.!]+$/, "").trim();
        generateFocusedImage(`${item} displayed on a retail shelf or counter at ${location.name}, product close-up, professional lighting,`);
        return;
      }
      // Pattern 3: "do you have X", "do you carry X", "do you sell X"
      const haveMatch = t.match(/(?:do you have|do you carry|do you sell|got any|have any)\s+(?:a |an |the )?(.+)/);
      if (haveMatch) {
        const item = haveMatch[1].replace(/[?.!]+$/, "").trim();
        generateFocusedImage(`${item} displayed on a retail shelf or counter at ${location.name}, product close-up, professional lighting,`);
        return;
      }
    }

    // "show me X" or "look at X" or "what does X look like" — general (non-business)
    const showMatch = t.match(/(?:show me|look at|what does|can i see|i want to see)\s+(.+)/);
    if (showMatch) {
      generateFocusedImage(`${showMatch[1]} at ${location.name},`);
      return;
    }
    // Food order detection
    const foodKeywords = ["order", "ordered", "i'll have", "i'll get", "can i get", "give me", "burger", "pizza", "pasta", "salad", "sandwich", "steak", "sushi", "tacos", "wings"];
    const drinkKeywords = ["drink", "beer", "wine", "cocktail", "shot", "whiskey", "vodka", "juice", "soda", "coffee", "latte", "water"];
    const hasFoodOrder = foodKeywords.some(k => t.includes(k));
    const hasDrinkOrder = drinkKeywords.some(k => t.includes(k));
    // At home, only trigger food images for explicit takeout — not generic eating
    const isTakeoutContext = t.includes("takeout") || t.includes("take out") || t.includes("delivery") || t.includes("order takeout");
    const nonHomeFood = FOOD_VENUE_CATEGORIES.includes(location.category) && !isHomeLocation;
    if (hasFoodOrder && (nonHomeFood || isTakeoutContext)) {
      const item = showMatch?.[1] || text.replace(/[[\]]/g, "").trim();
      const setting = isTakeoutContext ? "takeout containers on a coffee table, home setting" : "restaurant setting";
      generateFocusedImage(`${item}, served on a plate, ${setting}, close-up,`);
    } else if (hasDrinkOrder && nonHomeFood) {
      const item = text.replace(/[[\]]/g, "").trim();
      generateFocusedImage(`${item}, drink in a glass, bar or restaurant setting, close-up,`);
    }
  };

  const sendNarration = (text) => {
    if (!text.trim()) return;
    setInputText("");
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      sender: "narrative",
      content: text,
      timestamp: new Date().toISOString(),
    }]);
  };

  const sendMessage = async (text, fromAction = false, actionImagePrompt = null, actionScenePrompt = null) => {
    if (!text.trim() || !location) return;
    setInputText("");

    const userMsg = { id: Date.now().toString(), sender: "user", content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    // Check if we should update the scene image — returns true if it was a purchase intent (skip LLM)
    const wasPurchaseIntent = checkImageTrigger(text, actionImagePrompt, actionScenePrompt);
    if (wasPurchaseIntent) {
      setIsTyping(false);
      return;
    }

    setIsTyping(true);
    setActions(getLocationActions(location.category, text));

    // Cross-page memory — fetch in parallel, non-blocking
    const _memIds = [...broughtCharacters, ...selectedNpcs].filter(c => !c.isNpc && c.id).map(c => c.id);
    const crossMem = {};
    await Promise.all(_memIds.map(async id => {
      try { const r = await base44.functions.invoke('retrieveCrossPageMemory', { characterId: id, limitMessages: 12 }); if (r?.data?.contextText) crossMem[id] = r.data.contextText; } catch {}
    }));

    try {
      const conversationHistory = messages.slice(-12).map(m =>
        `${m.sender === "user" ? displayName : m.senderName || "Character"}: ${m.content}`
      ).join("\n");

      const privateNote = privateTarget ? `\nNOTE: ${displayName} pulled ${privateTarget.name} aside for a PRIVATE conversation. Only ${privateTarget.name} may respond.` : "";

      // SPEAKER SELECTION: Only dialogue-eligible characters may respond.
      // This is the SOLE source of truth for who speaks — it must drive BOTH charSummaries AND npcInstruction.
      // displayCharacters (full scene roster) is intentionally NOT used here — it is for image generation only.
      const dialogueEligible = privateTarget
        ? sceneCharacters.filter(c => c.id === privateTarget.id || c.name === privateTarget.name)
        : selectedNpcs.length > 0
          ? selectedNpcs
          : [];

      // charSummaries MUST come from dialogueEligible, not displayCharacters.
      // Passing the full roster as "People present" causes the LLM to override the npcInstruction gate.
      const charSummaries = dialogueEligible.map(c =>
        `${c.name} (${c.personality_summary?.split(".")[0] || c.archetype || "character"}, mood: ${c.emotional_state || "calm"})`
      ).join("; ");

      const knownChars = dialogueEligible.filter(c => !c.isNpc);

      const eligibleKnownChars = dialogueEligible.filter(c => !c.isNpc);
      const eligibleNpcList = dialogueEligible
        .filter(c => c.isNpc)
        .map(n => `${n.name} (${n.role || "NPC"}${n.personality_summary ? ", " + n.personality_summary.split(".")[0] : ""})`)
        .join(", ");

      const npcInstruction = `IMPORTANT: Only these people may respond — no one else, ever:
- Companions who traveled here with the user: ${eligibleKnownChars.map(c => c.name).join(", ") || "none"}
- NPCs explicitly selected by the user to talk to: ${eligibleNpcList || "none"}
Residents, location owners, and employees who are merely present but NOT in the above lists must NOT respond.
If no one is listed, return an empty responses array. Do NOT invent responses from ambient strangers, unselected residents, or unselected staff.${privateNote}`;

      const memSection = eligibleKnownChars.filter(c => crossMem[c.id]).map(c => `[${c.name}'s memory]\n${crossMem[c.id]}`).join('\n\n');

      // AGE GATING: Babies (<3) only 1-2 words; toddlers (3-5) max 5-word phrases
      const ageGateRules = dialogueEligible.map(char => {
        const age = char.age || (char.age_range?.match(/\d+/) ? parseInt(char.age_range.match(/\d+/)[0]) : null);
        if (!age || age >= 6) return null;
        if (age < 3) return `${char.name} is a baby: speak ONLY 1-2 words max (e.g., "mama", "no", "up"). Never full sentences.`;
        if (age < 6) return `${char.name} is a toddler: max 5 words, missing words (e.g., "want juice", "go play").`;
        return null;
      }).filter(Boolean).join('\n');

      const responses = await base44.integrations.Core.InvokeLLM({
        prompt: `You are managing a ${privateTarget ? "private one-on-one" : "group"} scene at ${location.name} (${location.category}).

People present: ${displayName}, ${charSummaries || "no one they know"}
${memSection ? `\n=== CROSS-PAGE MEMORY (Chat/Text/Scene/GroupChat) — use this for continuity, do NOT act like strangers ===\n${memSection}\n===` : ''}

Recent scene conversation:
${conversationHistory}

${displayName} just said: "${text}"
${fromAction ? "(This was from a scene action, not typed directly)" : ""}

${npcInstruction}
${ageGateRules ? `\nAGE SPEECH RULES (mandatory):\n${ageGateRules}\n` : ''}
Keep each response 1-2 sentences, natural and in-character.
CRITICAL: Do NOT say your character's own name in the response — never speak about yourself in third person. Use "I", "we", "me", or "us" instead. Only mention your name if ${displayName} directly asks for it.

Return JSON:
{
  "responses": [
    { "character_name": "...", "content": "..." }
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            responses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  character_name: { type: "string" },
                  content: { type: "string" },
                },
              },
            },
          },
        },
      });

      setIsTyping(false);

      const responseList = responses?.responses || [];
      for (const resp of responseList) {
        // IDENTITY PROTECTION: never render an AI response under the real user's identity
        const respNameLower = resp.character_name?.trim().toLowerCase();
        const userNames = [
          displayName?.trim().toLowerCase(),
          currentUser?.full_name?.trim().toLowerCase(),
          currentUser?.email?.split("@")[0]?.toLowerCase(),
          settings?.fictional_world_name?.trim().toLowerCase(),
          ...(settings?.user_aliases || []).map(a => a?.trim().toLowerCase()),
        ].filter(Boolean);
        if (userNames.includes(respNameLower)) continue; // BLOCKED — AI tried to speak as the user

        const char = sceneCharacters.find(c => c.name === resp.character_name);
        const msg = {
          id: Date.now().toString() + resp.character_name,
          sender: "character",
          senderName: resp.character_name,
          characterId: char?.id,
          avatarUrl: char?.avatar_url,
          content: filterDashes(resp.content),
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, msg]);

        // Fire-and-forget: persist to group conversation if character exists
        if (char) {
          base44.functions.invoke("extractMemoriesFromTurn", {
            characterId: char.id,
            userMessage: text,
            characterReply: resp.content,
          }).catch(() => {});
        }

        await new Promise(r => setTimeout(r, 400));
      }

      if (responseList.length === 0) {
        const hasAnyone = knownChars.length > 0 || selectedNpcs.length > 0;
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          sender: "narrative",
          content: hasAnyone
            ? `The atmosphere at ${location.name} hums quietly. No one responds right away.`
            : `You take in the surroundings at ${location.name}. Use the "Who's here" button to start talking to someone.`,
          timestamp: new Date().toISOString(),
        }]);
      }
    } catch {
      setIsTyping(false);
    }
  };

  // Keep refs current so SceneInputBar's stable onSend callback always calls the latest versions
  useEffect(() => { narratorModeRef.current = narratorMode; }, [narratorMode]);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
  useEffect(() => { sendNarrationRef.current = sendNarration; }, [sendNarration]);

  // Stable onSend — never changes identity, so SceneInputBar never re-renders due to prop change
  const stableOnSend = useRef((text) => {
    if (narratorModeRef.current) {
      sendNarrationRef.current?.(text);
    } else {
      sendMessageRef.current?.(text);
    }
  }).current;

  const handleMoveIn = async ({ moversToMove, npcMovers = [], newHomeName }) => {
    if (!location) return;
    setIsMoveInLoading(true);
    try {
      await base44.functions.invoke("moveCharactersToNewHome", {
        sourceHomeId: broughtCharacters[0]?.current_home_location_id || null,
        destinationHomeId: location.id,
        moversToMove,
        npcMovers,
        newHomeName,
      });
      setShowMoveInPopup(false);
      // Refresh location + character data so resident list updates immediately
      queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: "narrative",
        content: `Move-in complete. ${newHomeName || location.name} is now home.`,
        timestamp: new Date().toISOString(),
      }]);
    } catch (err) {
      console.error("Move-in failed:", err);
    } finally {
      setIsMoveInLoading(false);
    }
  };

  const handleMoveOut = async () => {
    if (!location || broughtCharacters.length === 0) return;
    const mover = broughtCharacters[0];
    try {
      // AUTHORITATIVE: Only update the character's home location
      // Do NOT write to occupancy arrays — they are computed only
      await base44.entities.Character.update(mover.id, { current_home_location_id: "" });
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: "narrative",
        content: `${mover.name} has moved out of ${location.name}.`,
        timestamp: new Date().toISOString(),
      }]);
    } catch (err) {
      console.error("Move-out failed:", err);
    }
  };

  const handleAskToLeave = (type, narrativeText) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      sender: "narrative",
      content: narrativeText || `You ask the ${type} to leave.`,
      timestamp: new Date().toISOString(),
    }]);
  };

  const handleAction = async (action) => {
    if (actionCooldown) return;
    setActionCooldown(true);
    setTimeout(() => setActionCooldown(false), 3000);

    const eatingActionIds = ['eat', 'order', 'drinks', 'char_pays', 'check', 'order_takeout', 'drink', 'buy_round', 'char_buy_round'];
    if (eatingActionIds.includes(action.id) && broughtCharacters.length > 0) {
      const mealSize = ['buy_round', 'char_buy_round', 'drinks', 'drink'].includes(action.id) ? 'snack'
        : action.id === 'check' || action.id === 'order' ? 'meal'
        : 'meal';
      broughtCharacters.forEach(char => {
        base44.functions.invoke('recordEatingEvent', {
          characterId: char.id,
          mealSize,
          foodDescription: action.label,
          locationName: location?.name,
        }).catch(() => {});
      });
      queryClient.invalidateQueries({ queryKey: ['characters', currentUser?.email] });
    }

    const payer = action.payer || "user"; // "user" | "character"
    const cost = action.cost || 0;

    if (cost > 0) {
      if (payer === "user") {
        const newBalance = Math.max(0, (settings.user_balance ?? 6000) - cost);
        if (settings.id) {
          base44.entities.UserSettings.update(settings.id, { user_balance: newBalance }).catch(() => {});
          queryClient.invalidateQueries({ queryKey: ["userSettings"] });
        }
      } else if (payer === "character") {
        // Deduct from first brought character's financial record
        const payingChar = broughtCharacters[0];
        if (payingChar) {
          base44.functions.invoke("calculateCharacterExpenses", {
            characterId: payingChar.id,
            expenseAmount: cost,
            expenseLabel: action.label,
          }).catch(() => {});
        }
      }
    }

    // Determine if this action should trigger a scene image update
    const actionImageFn = ACTION_IMAGE_PROMPTS[action.id];
    if (actionImageFn) {
      // Build a description of only the people physically present
      const presentPeople = [
        ...homeResidentsPresent,
        ...broughtCharacters,
      ].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);
      // If no one else is present, the user is alone — describe as "the space" not a person,
      // since the user is the camera POV and we never want to generate random strangers
      const whoDesc = presentPeople.length > 0
        ? presentPeople.map(c => c.name).join(" and ")
        : "no one — the space is empty";
      const imagePrompt = actionImageFn(location?.name || location?.category, whoDesc);
      generateSceneImage(imagePrompt);
    }

    const payerNote = payer === "character" && broughtCharacters[0] && cost > 0
      ? ` (${broughtCharacters[0].name} pays)`
      : cost > 0 ? ` — $${cost}` : "";

    await sendMessage(`[${action.emoji} ${action.label}${payerNote}]`, true, null, null);

    setTimeout(() => {
      const hour = new Date().getHours();
      const newActions = generateLocationActions(
        location,
        activeZone || locationZones[0]?.zone_name,
        hour,
        sceneCharacters,
        0
      );
      setActions(newActions);
    }, 1000);
  };

  // Check if location is closed
  const locationClosed = isLocationOpen(location) === false;

  const renderNpc = (npc) => {
    const isSelected = selectedNpcs.some(s => s.id === npc.id);
    return (
      <button
        key={npc.id}
        onClick={() => {
          setSelectedNpcIds(prev => {
            const current = prev || [];
            return isSelected ? current.filter(id => id !== npc.id) : [...current, npc.id];
          });
          setShowNpcDropdown(false);
        }}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary ${
          isSelected ? "bg-primary/10" : ""
        }`}
      >
        <div className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center flex-shrink-0 overflow-hidden">
          {npc.avatar_url
            ? <img src={npc.avatar_url} alt={npc.name} className="w-full h-full object-cover" />
            : <span className="text-[9px] font-bold text-foreground">{npc.name?.[0]}</span>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-medium truncate ${isSelected ? "text-primary" : "text-foreground"}`}>{npc.name}</p>
          {npc.mood && <p className="text-[10px] text-muted-foreground truncate">{npc.mood}</p>}
        </div>
        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
      </button>
    );
  };

  if (!location) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">Location not found</p>
          <Link to="/travel"><Button variant="outline" size="sm">Back to Travel</Button></Link>
        </div>
      </div>
    );
  }

  // If location is closed, show a closure message
  if (locationClosed) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 space-y-4">
        <div className="text-center space-y-3">
          <span className="text-4xl">🚫</span>
          <h2 className="text-lg font-bold text-foreground">{location.name} is currently closed</h2>
          <p className="text-sm text-muted-foreground max-w-xs">This location is not open at the moment. Come back during operating hours.</p>
        </div>
        <Link to="/travel" className="w-full max-w-xs">
          <Button variant="outline" size="lg" className="w-full rounded-xl">Back to Travel</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-background" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-xl flex-shrink-0 relative z-50">
        <button
          onClick={() => setShowLeaveModal(true)}
          className="p-2 rounded-xl text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          title="Leave location"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-foreground truncate">{location.name}</h2>
          <p className="text-xs text-muted-foreground capitalize">
            {CATEGORY_EMOJIS[location.category]} {location.category?.replace("_", " ")} ·{" "}
            {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
          </p>
        </div>

        {/* Residence Options — only for home locations, not shared */}
        {isHomeLocation && !isSharedLocation && (
          <ResidenceOptionsDropdown
            location={location}
            sceneCharacters={sceneCharacters}
            isResident={broughtCharacters.some(c => c.current_home_location_id === location.id)}
            currentUser={currentUser}
            allCharacters={characters}
            onTour={() => setShowTourModal(true)}
            onMoveIn={() => setShowMoveInPopup(true)}
            onMoveOut={handleMoveOut}
            onAskToLeave={handleAskToLeave}
            onCharacterPulledHome={() => queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] })}
            onKickOut={() => setMessages(prev => [...prev, {
              id: Date.now().toString(),
              sender: "narrative",
              content: "You assert your authority and ask them to leave immediately.",
              timestamp: new Date().toISOString(),
            }])}
          />
        )}

        {/* NPC Dropdown — uses unified presence resolver (same as Map + Travel popup) */}
        <div ref={npcDropdownRef}>
          <WhosHereDropdown
            allPossibleNpcs={allPossibleNpcs}
            unifiedPresenceEntities={unifiedPresenceEntities}
            location={location}
            selectedNpcs={selectedNpcs}
            onToggleNpc={toggleNpc}
            showDropdown={showNpcDropdown}
            onToggleDropdown={setShowNpcDropdown}
            onInviteClick={() => { setShowNpcDropdown(false); setShowInviteModal(true); }}
            renderNpc={renderNpc}
          />
        </div>

        <button
          onClick={() => setShowPhotoModal(true)}
          className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Scene photo"
        >
          <Camera className="w-4 h-4" />
        </button>
      </div>

      <ImageLightbox src={lightboxSrc} alt={location.name} onClose={() => setLightboxSrc(null)} />

      {/* Scene image */}
      <div className="relative h-32 flex-shrink-0" style={{ zIndex: 0 }}>
        {isGeneratingImage ? (
          <div className="w-full h-full bg-secondary flex items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span className="text-xs">Setting the scene...</span>
            </div>
          </div>
        ) : sceneImage ? (
          <button onClick={() => setLightboxSrc(sceneImage)} className="w-full h-full block group relative">
            <img src={sceneImage} alt={location.name} className="w-full h-full object-cover" style={{ imageOrientation: 'from-image' }} />
            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <ZoomIn className="w-6 h-6 text-white drop-shadow" />
            </div>
          </button>
        ) : (
          <div className="w-full h-full bg-secondary flex items-center justify-center">
            <span className="text-5xl">{CATEGORY_EMOJIS[location.category]}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/60" />

        {/* Zone picker */}
        {locationZones.length > 1 && (
          <div className="absolute top-2 left-2 z-[200]" ref={zonPickerRef}>
            <button
              onClick={() => setShowZonePicker(v => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/50 text-white text-xs font-medium hover:bg-black/70 transition-colors"
            >
              <MapPin className="w-3 h-3" />
              <span>{activeZone || locationZones[0]?.zone_name || "Zone"}</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showZonePicker ? "rotate-180" : ""}`} />
            </button>
            <AnimatePresence>
              {showZonePicker && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  className="absolute left-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl overflow-hidden min-w-[140px] z-[200]"
                >
                  {locationZones.map(zone => (
                    <button
                      key={zone.zone_name}
                      onClick={() => handleZoneChange(zone.zone_name)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-secondary transition-colors ${
                        activeZone === zone.zone_name ? "text-primary font-medium" : "text-foreground"
                      }`}
                    >
                      {activeZone === zone.zone_name && <Check className="w-3 h-3 flex-shrink-0" />}
                      <span className={activeZone === zone.zone_name ? "" : "ml-5"}>{zone.zone_name}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <button
          onClick={() => { setSceneImage(null); }}
          disabled={isGeneratingImage}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60 transition-colors"
          title="Refresh scene image"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingImage ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Character presence strip — only shows characters the user explicitly traveled with or selected */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/50 flex-shrink-0">
        {/* User */}
        <div className="flex flex-col items-center gap-1">
          <div className="w-8 h-8 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center overflow-hidden">
            {currentUser?.generated_avatar_urls?.[0]
              ? <img src={currentUser.generated_avatar_urls[0]} alt={displayName} className="w-full h-full object-cover" />
              : <span className="text-xs font-bold text-primary">{displayName?.[0]}</span>
            }
          </div>
          <span className="text-[9px] text-primary font-medium">{displayName}</span>
        </div>
        {[...traveledWithChars, ...selectedNpcs, ...extraNpcs]
          .filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)
          .map(char => (
          <div key={char.id} className="flex flex-col items-center gap-1">
            <div className="w-8 h-8 rounded-full bg-secondary border-2 border-border flex items-center justify-center overflow-hidden">
              {char.avatar_url
                ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                : <span className="text-xs font-bold text-foreground">{char.name?.[0]}</span>
              }
            </div>
            <span className="text-[9px] text-muted-foreground truncate max-w-[40px]">{char.name.split(" ")[0]}</span>
          </div>
        ))}
        {traveledWithChars.length === 0 && selectedNpcs.length === 0 && extraNpcs.length === 0 && (
          <span className="text-xs text-muted-foreground ml-1">You're here alone</span>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Arrival narrative */}
        <div className="text-center space-y-2">
          <span className="text-xs text-muted-foreground bg-secondary px-3 py-1 rounded-full">
            You arrive at {location.name}
            {traveledWithChars.length > 0 ? ` with ${traveledWithChars.map(c => c.name).join(", ")}` : ""}
          </span>
          {(homeResidentsPresent.length > 0 || familyMemberNpcsPresent.length > 0) && (
            <div><span className="text-xs text-green-400/80 bg-secondary/50 px-3 py-1 rounded-full">
              {[...homeResidentsPresent, ...familyMemberNpcsPresent].map(c => c.name).join(", ")} {homeResidentsPresent.length + familyMemberNpcsPresent.length === 1 ? "is" : "are"} home
            </span></div>
          )}
          {(homeResidentsAway.length > 0 || familyMemberNpcsAway.length > 0) && (
            <div><span className="text-xs text-muted-foreground/60 bg-secondary/50 px-3 py-1 rounded-full">
              {homeResidentsAway.map(c => c.name).concat(familyMemberNpcsAway.map(fm => fm.name)).join(", ")} {homeResidentsAway.length + familyMemberNpcsAway.length === 1 ? "is" : "are"} away
            </span></div>
          )}
          {workerCharacters.length > 0 && (
            <div><span className="text-xs text-muted-foreground/70 bg-secondary/50 px-3 py-1 rounded-full">
              {workerCharacters.map(c => c.name).join(", ")} {workerCharacters.length === 1 ? "is" : "are"} here working
            </span></div>
          )}
          {(() => {
            // Show real characters present at this location from unified resolver (same as map)
            const presentHere = getPresenceAtLocation(location, unifiedPresenceEntities).filter(
              e => !characterIds.includes(e.id)
            );
            return presentHere.length > 0 ? (
              <div><span className="text-xs text-blue-400/70 bg-secondary/50 px-3 py-1 rounded-full">
                {presentHere.map(e => e.display_name).join(", ")} {presentHere.length === 1 ? "is" : "are"} also here — tap "Who's here" to interact
              </span></div>
            ) : null;
          })()}

        </div>

        <AnimatePresence>
          {messages.map(msg => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2 ${msg.sender === "user" ? "justify-end" : msg.sender === "narrative" ? "justify-center" : msg.sender === "product" ? "justify-center" : "justify-start"}`}
            >
              {msg.sender === "narrative" ? (
                <span className="text-xs text-muted-foreground italic bg-secondary/50 px-3 py-1.5 rounded-full max-w-xs text-center">{msg.content}</span>
              ) : msg.sender === "product" ? (
                <button
                  onClick={() => setPendingPurchase({ price: msg.price, productId: msg.id })}
                  className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-card border-2 border-primary/40 hover:border-primary/80 hover:shadow-lg transition-all max-w-[75%]"
                >
                  <div className="w-32 h-32 bg-primary/10 rounded-lg flex items-center justify-center">
                    <span className="text-4xl">👔</span>
                  </div>
                  <p className="text-sm font-bold text-foreground">${msg.price}</p>
                  <p className="text-xs text-muted-foreground">Click to buy</p>
                </button>
              ) : msg.sender === "character" ? (
                <>
                  <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden mt-0.5">
                    {msg.avatarUrl
                      ? <img src={msg.avatarUrl} alt={msg.senderName} className="w-full h-full object-cover" />
                      : <span className="text-xs font-bold text-foreground">{msg.senderName?.[0]}</span>
                    }
                  </div>
                  <div className="max-w-[75%]">
                    <p className="text-[10px] text-muted-foreground mb-0.5">{msg.senderName}</p>
                    <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-3 py-2">
                      <p className="text-sm text-foreground">{msg.content}</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-primary rounded-2xl rounded-tr-sm px-3 py-2 max-w-[75%]">
                  <p className="text-sm text-primary-foreground">{msg.content}</p>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {isTyping && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
              <span className="text-xs">...</span>
            </div>
            <div className="bg-card border border-border rounded-2xl px-3 py-2">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-1" />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-2" />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground typing-dot-3" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Action buttons — horizontal scroll */}
      <div className="px-3 py-2 border-t border-border bg-card/50 flex-shrink-0 overflow-hidden">
        <div className="flex gap-1.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-hide">
          {actions.map(action => (
            <button
              key={action.id}
              onClick={() => handleAction(action)}
              disabled={actionCooldown}
              className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-center disabled:opacity-50 flex-shrink-0 snap-center ${
                action.type === "negative"
                  ? "bg-destructive/10 border-destructive/30 hover:bg-destructive/20"
                  : action.cost > 0
                  ? "bg-green-500/10 border-green-500/30 hover:bg-green-500/20"
                  : "bg-secondary border-border hover:border-primary/30"
              }`}
            >
              <span className="text-base leading-none">{action.emoji}</span>
              <span className="text-[9px] text-foreground font-medium leading-tight whitespace-nowrap">{action.label}</span>
              {action.cost > 0 && (
                <span className="text-[9px] text-green-500">
                  {action.payer === "character" ? "they pay" : `$${action.cost}`}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Private conversation banner */}
      {privateTarget && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-primary/10 border-t border-primary/30 flex-shrink-0">
          <span className="text-xs text-primary font-medium">🤫 Private with {privateTarget.name}</span>
          <button
            onClick={() => {
              setPrivateTarget(null);
              setMessages(prev => [...prev, {
                id: Date.now().toString(),
                sender: "narrative",
                content: `You rejoin the group.`,
                timestamp: new Date().toISOString(),
              }]);
            }}
            className="text-[10px] text-primary/70 hover:text-primary underline"
          >
            End private chat
          </button>
        </div>
      )}

      {/* NPC Evolution Tracker — watches venue NPC interactions, surfaces Level 4 promotion prompt */}
      <NPCEvolutionTracker
        messages={messages}
        selectedNpcs={selectedNpcs}
        currentUser={currentUser}
        locationName={location.name}
        onNpcSaved={(name) => setMessages(prev => [...prev, {
          id: Date.now().toString(),
          sender: "narrative",
          content: `${name} has been saved to your world.`,
          timestamp: new Date().toISOString(),
        }])}
      />

      {/* Input bar — stable, never remounts. Uses stable callbacks to prevent re-renders. */}
      <SceneInputBar
        inputText={inputText}
        setInputText={setInputText}
        narratorMode={narratorMode}
        setNarratorMode={setNarratorMode}
        onSend={stableOnSend}
      />

      {/* Photo modal */}
      <AnimatePresence>
        {showPhotoModal && (
          <ScenePhotoModal
            location={location}
            characters={allSceneChars}
            currentUser={currentUser}
            displayName={displayName}
            onClose={() => setShowPhotoModal(false)}
            allCharacters={characters}
          />
        )}
      </AnimatePresence>

      {/* Realtor Tour Modal */}
      <AnimatePresence>
        {showTourModal && (
          <RealtorTourModal
            isOpen={showTourModal}
            location={location}
            onClose={() => setShowTourModal(false)}
            onAddRealtor={(realtorNpc) => {
              setExtraNpcs(prev => prev.find(n => n.id === realtorNpc.id) ? prev : [...prev, realtorNpc]);
              if (selectedNpcIds === null || !selectedNpcIds.includes(realtorNpc.id)) {
                setSelectedNpcIds(prev => [...(prev || []), realtorNpc.id]);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Move-In Popup */}
      <AnimatePresence>
        {showMoveInPopup && !isSharedLocation && (
          <MoveInPopup
            isOpen={showMoveInPopup}
            character={broughtCharacters[0]}
            sourceHome={locationsData.find(l => l.id === broughtCharacters[0]?.current_home_location_id)}
            destinationHome={location}
            allCharacters={characters}
            broughtCharacters={broughtCharacters}
            onApprove={handleMoveIn}
            onReject={() => setShowMoveInPopup(false)}
            onClose={() => setShowMoveInPopup(false)}
            isLoading={isMoveInLoading}
          />
        )}
      </AnimatePresence>

      {/* Invite to scene modal */}
      <InviteToSceneModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        location={location}
        characters={characters}
        userDisplayName={displayName}
        onCharacterArrived={(char) => {
          // Add arrived character to the scene immediately
          setExtraNpcs(prev => prev.find(n => n.id === char.id) ? prev : [...prev, char]);
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            sender: "narrative",
            content: `${char.name} arrives at ${location.name}.`,
            timestamp: new Date().toISOString(),
          }]);
          queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
        }}
      />

      {/* Conversation type selector */}
      <ConversationTypeSelector
        isOpen={!!conversationModal}
        onClose={() => setConversationModal(null)}
        onSelect={(conversationType) => {
          if (conversationType === "one_on_one" && conversationModal?.npcId && conversationModal?.npcName) {
            setPrivateTarget({ id: conversationModal.npcId, name: conversationModal.npcName });
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              sender: "narrative",
              content: `You pull ${conversationModal.npcName} aside for a private conversation.`,
              timestamp: new Date().toISOString(),
            }]);
          } else {
            // Any other conversation type clears private mode
            setPrivateTarget(null);
          }
        }}
        npcName={conversationModal?.npcName || "them"}
        hasEmployees={conversationModal?.hasEmployees || false}
        isGroup={conversationModal?.isGroup || false}
      />

      {/* Leave Location Modal */}
      <LeaveLocationModal
        isOpen={showLeaveModal}
        onClose={() => setShowLeaveModal(false)}
        locationName={location.name}
        broughtCharacters={broughtCharacters}
        onLeaveWithChars={handleLeaveWithCharacters}
        onLeaveCharactersBehind={handleLeaveCharactersBehind}
      />

      {/* Product Purchase Modal */}
      <ProductPurchaseModal
        isOpen={!!pendingPurchase}
        price={pendingPurchase?.price}
        productId={pendingPurchase?.productId}
        userBalance={settings.user_balance ?? 6000}
        userSettings={settings}
        currentUser={currentUser}
        traveledWithChars={[...traveledWithChars, ...selectedNpcs.filter(n => !n.isNpc)].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)}
        onClose={() => setPendingPurchase(null)}
        onPurchased={(message) => {
          const price = pendingPurchase?.price;
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            sender: "narrative",
            content: `✓ Purchased for $${price} — ${message}.`,
            timestamp: new Date().toISOString(),
          }]);
          setPendingPurchase(null);
        }}
      />

      {/* Invite notifications */}
      {pendingInvitations && (
        <InviteOutModal
          invitations={pendingInvitations}
          onAccept={(invite) => {
            base44.functions.invoke('recordCharacterInviteAccepted', {
              characterId: invite.characterId,
              locationId: invite.locationId,
              inviteType: invite.inviteType,
            }).catch(() => {});
            const remaining = pendingInvitations.filter(i => i.characterId !== invite.characterId);
            setPendingInvitations(remaining.length > 0 ? remaining : null);
            const charIds = invite.characterIds ? invite.characterIds.join(",") : invite.characterId;
            navigate(`/scene?locationId=${invite.locationId}&characterIds=${charIds}`);
          }}
          onDecline={(selectedInv) => {
            base44.functions.invoke('recordCharacterInviteDeclined', {
              characterId: selectedInv.characterId,
              locationId: selectedInv.locationId,
            }).catch(() => {});
            const remaining = pendingInvitations.filter(i => i.characterId !== selectedInv.characterId);
            setPendingInvitations(remaining.length > 0 ? remaining : null);
            // CHARACTER MUST STILL GO — do NOT navigate to scene, user stays on current screen
          }}
          onClose={() => {
            if (settings.id) {
              base44.entities.UserSettings.update(settings.id, {
                pending_character_invites: [],
              }).catch(() => {});
            }
            setPendingInvitations(null);
          }}
        />
      )}
    </div>
  );
}