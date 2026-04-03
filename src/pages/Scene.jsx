import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Camera, DollarSign, RefreshCw, Send, Users, ChevronDown, Check, MapPin, ZoomIn } from "lucide-react";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import ScenePhotoModal from "@/components/travel/ScenePhotoModal";
import { filterDashes } from "@/lib/dashFilter";
import { isCharacterAtWork } from "@/lib/workScheduleUtils";
import { isCharacterHome } from "@/lib/travelAvailability";
import { isCharacterAsleep } from "@/lib/sleepUtils";
import { generateLocationActions } from "@/lib/actionGenerator";
import { buildUnifiedMemoryContext, formatMemoryForLLM, shouldReferenceMemory, getLocationMemories } from "@/lib/memoryUnity";
import { checkCharacterAvailability, getLocationEmployees, spawnLocationNPCs, shouldNPCApproach } from "@/lib/npcSpawner";
import ConversationTypeSelector from "@/components/scene/ConversationTypeSelector";
import { buildSceneSystemPrompt, maybeInjectMemoryCallback, buildNPCIntroContext } from "@/lib/sceneMemoryInjection";

const CATEGORY_EMOJIS = {
  home: "🏠", workplace: "💼", school: "🏫", gym: "🏋️", grocery: "🛒",
  food_drink: "🍽️", outdoor: "🌳", social: "🍸", medical: "🏨",
  bar: "🍸", generic: "📍",
};

// Categories that serve food/drinks
const FOOD_VENUE_CATEGORIES = ["food_drink", "social", "home"];

// Actions where the image MUST update to reflect the action
const ACTION_IMAGE_PROMPTS = {
  sit:         (loc) => `People sitting comfortably on the couch or chairs in a ${loc} setting, relaxed posture, photorealistic`,
  relax:       (loc) => `People relaxing casually in a ${loc}, laid-back atmosphere, photorealistic`,
  eat:         (loc) => `Homemade meal on a table in a cozy home kitchen, food clearly visible, photorealistic`,
  drink:       (loc) => `Person holding a refreshing drink in a glass in a home kitchen, close-up, photorealistic`,
  order_takeout: () => `Takeout food containers being opened on a coffee table, cozy home setting, photorealistic`,
  lay_down:    (loc) => `Person lying down relaxing on a couch or bed in a ${loc}, comfortable, photorealistic`,
  dance:       ()    => `Two people dancing together on a nightclub dance floor, energetic, bokeh lights, photorealistic`,
  buy_round:   ()    => `Glasses of beer and cocktails being held up for a toast at a bar counter, bokeh lights, photorealistic`,
  flirt:       (loc) => `Two people laughing and leaning toward each other in a ${loc}, flirty chemistry, photorealistic`,
  argue:       (loc) => `Tense confrontational body language between two people at a ${loc}, dramatic, photorealistic`,
  workout:     ()    => `Two people working out together with gym equipment, athletic energy, photorealistic`,
  spot:        ()    => `Person spotting someone on the bench press at the gym, gym setting, photorealistic`,
  challenge:   ()    => `Friendly fitness challenge at the gym, competitive energy, photorealistic`,
  order:       (loc) => `Beautifully plated restaurant meal arriving at a table, warm lighting, photorealistic`,
  drinks:      (loc) => `Colorful cocktails or drinks on a restaurant table, ${loc} setting, photorealistic`,
  check:       ()    => `Person paying the bill at a restaurant table, relaxed end-of-meal, photorealistic`,
  walk:        ()    => `Two people walking together outdoors, relaxed stroll, natural surroundings, photorealistic`,
  sit_outside: ()    => `Two people sitting outside together on a bench or steps, enjoying the fresh air, photorealistic`,
  buy:         (loc) => `Person completing a purchase at a checkout counter, ${loc} setting, photorealistic`,
  checkout:    ()    => `Person checking out at a grocery store register, photorealistic`,
  study:       ()    => `Two people studying together at a desk with books and notes spread out, focused, photorealistic`,
};

function getLocationActions(category, isHome = false) {
  const base = {
    home: [
      { id: "sit", label: "Sit down", emoji: "🛋️", cost: 0, type: "neutral" },
      { id: "eat", label: "Eat something", emoji: "🍽️", cost: 0, type: "positive" },
      { id: "drink", label: "Get a drink", emoji: "🥤", cost: 0, type: "positive" },
      { id: "relax", label: "Just relax", emoji: "😌", cost: 0, type: "positive" },
      { id: "talk", label: "Start talking", emoji: "💬", cost: 0, type: "neutral" },
      { id: "order_takeout", label: "Order takeout", emoji: "🥡", cost: 20, type: "positive", payer: "user" },
    ],
    social: [
      { id: "buy_round", label: "Buy a round", emoji: "🥂", cost: 25, type: "positive", payer: "user" },
      { id: "char_buy_round", label: "Let them buy", emoji: "🎁", cost: 25, type: "positive", payer: "character" },
      { id: "flirt", label: "Flirt a little", emoji: "😏", cost: 0, type: "positive" },
      { id: "dance", label: "Hit the floor", emoji: "🕺", cost: 0, type: "positive" },
      { id: "argue", label: "Start drama", emoji: "🔥", cost: 0, type: "negative" },
    ],
    gym: [
      { id: "workout", label: "Work out together", emoji: "💪", cost: 0, type: "positive" },
      { id: "spot", label: "Spot them", emoji: "🏋️", cost: 0, type: "positive" },
      { id: "challenge", label: "Challenge them", emoji: "🏆", cost: 0, type: "positive" },
      { id: "observe", label: "Watch quietly", emoji: "👀", cost: 0, type: "neutral" },
    ],
    food_drink: [
      { id: "order", label: "Order food", emoji: "🍔", cost: 18, type: "positive", payer: "user" },
      { id: "drinks", label: "Get drinks", emoji: "🍹", cost: 12, type: "positive", payer: "user" },
      { id: "char_pays", label: "Let them cover it", emoji: "💳", cost: 30, type: "positive", payer: "character" },
      { id: "talk", label: "Good conversation", emoji: "💬", cost: 0, type: "neutral" },
      { id: "check", label: "Pick up the check", emoji: "🧾", cost: 40, type: "positive", payer: "user" },
    ],
    outdoor: [
      { id: "walk", label: "Go for a walk", emoji: "🚶", cost: 0, type: "positive" },
      { id: "sit_outside", label: "Sit outside", emoji: "🌤️", cost: 0, type: "positive" },
      { id: "photo", label: "Take a picture", emoji: "📸", cost: 0, type: "positive" },
      { id: "talk", label: "Talk it out", emoji: "💬", cost: 0, type: "neutral" },
    ],
    business: [
      { id: "browse", label: "Browse items", emoji: "🛍️", cost: 0, type: "neutral" },
      { id: "try_on", label: "Try something on", emoji: "👗", cost: 0, type: "positive" },
      { id: "ask_help", label: "Ask for help", emoji: "🙋", cost: 0, type: "neutral" },
      { id: "buy", label: "Buy something", emoji: "💳", cost: 35, type: "positive", payer: "user" },
    ],
    grocery: [
      { id: "shop", label: "Grab items", emoji: "🛒", cost: 0, type: "neutral" },
      { id: "checkout", label: "Check out", emoji: "💳", cost: 60, type: "positive", payer: "user" },
      { id: "ask_aisle", label: "Ask where something is", emoji: "🙋", cost: 0, type: "neutral" },
      { id: "talk", label: "Small talk", emoji: "💬", cost: 0, type: "neutral" },
    ],
    school: [
      { id: "study", label: "Study together", emoji: "📚", cost: 0, type: "positive" },
      { id: "ask_question", label: "Ask a question", emoji: "✋", cost: 0, type: "neutral" },
      { id: "pass_note", label: "Pass a note", emoji: "📝", cost: 0, type: "positive" },
      { id: "chat", label: "Chat between class", emoji: "💬", cost: 0, type: "neutral" },
    ],
  };

  const defaults = [
    { id: "talk", label: "Talk", emoji: "💬", cost: 0, type: "neutral" },
    { id: "observe", label: "Look around", emoji: "👀", cost: 0, type: "neutral" },
    { id: "joke", label: "Crack a joke", emoji: "😂", cost: 0, type: "positive" },
    { id: "ask", label: "Ask something", emoji: "🤔", cost: 0, type: "neutral" },
  ];

  return base[category] || defaults;
}

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
  const bottomRef = useRef(null);
  const npcDropdownRef = useRef(null);
  const zonPickerRef = useRef(null);

  const { data: currentUser = {} } = useQuery({ queryKey: ["user"], queryFn: () => base44.auth.me() });
  const { data: settingsList = [] } = useQuery({ queryKey: ["userSettings"], queryFn: () => base44.entities.UserSettings.list() });
  const settings = settingsList[0] || {};
  const displayName = settings.fictional_world_name || currentUser?.full_name || "You";

  const { data: locationsData = [] } = useQuery({
    queryKey: ["locationReferences", currentUser?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke("fetchAllLocationsForUser", {});
      return res?.data?.locations || [];
    },
    enabled: !!currentUser?.email,
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => base44.entities.Character.filter({ created_by: currentUser.email, status: "active" }),
    enabled: !!currentUser?.email,
  });

  const location = locationsData.find(l => l.id === locationId);
  const locationMap = Object.fromEntries(locationsData.map(l => [l.id, l]));
  const locationZones = location?.zones || [];

  // Characters explicitly brought + any active characters who work here during their shift
  // INCLUDES: explicitly linked workers + any character assigned as worker on the location
  const workerCharacters = location
    ? characters.filter(c => {
        // Skip if user brought them
        if (characterIds.includes(c.id)) return false;
        // Skip if asleep
        if (isCharacterAsleep(c)) return false;
        // Include if occupation location matches and they're on shift
        if ((c.occupation_location_id === locationId ||
             c.additional_occupation_locations?.some(j => j.location_id === locationId)) &&
            isCharacterAtWork(c, location)) {
          return true;
        }
        // Include if listed in location's worker_character_ids and on shift
        if (location.worker_character_ids?.includes(c.id) && isCharacterAtWork(c, location)) {
          return true;
        }
        return false;
      })
    : [];

  // At a home location: separate home residents into "home" vs "away"
  const isHomeLocation = location?.category === "home";
  const homeResidents = isHomeLocation
    ? characters.filter(c => location.resident_character_ids?.includes(c.id))
    : [];
  const homeResidentsPresent = homeResidents.filter(c => isCharacterHome(c, locationMap));
  const homeResidentsAway = homeResidents.filter(c => !isCharacterHome(c, locationMap));

  // Build the full pool of possible NPCs for ANY venue
  const allPossibleNpcs = (() => {
    const npcs = [];

    // Home: family members of away residents
    if (isHomeLocation) {
      homeResidentsAway.forEach(c => {
        (c.family_members || []).forEach(fm => {
          if (fm.name) npcs.push({
            id: `npc_${fm.name.replace(/\s+/g, "_")}`,
            name: fm.name,
            role: fm.relationship_type || "Family",
            isNpc: true,
            avatar_url: null,
          });
        });
      });
      // NPC owner when no one is home
      if (location.owner_is_npc && location.owner_npc_name && homeResidentsPresent.length === 0) {
        npcs.push({ id: `npc_owner_${location.id}`, name: location.owner_npc_name, role: location.owner_role || "Resident", isNpc: true, avatar_url: null });
      }
    }

    // Any venue: NPC owner/operator
    if (!isHomeLocation && location?.owner_is_npc && location?.owner_npc_name) {
      npcs.push({ id: `npc_owner_${location?.id}`, name: location.owner_npc_name, role: location.owner_role || "Owner", isNpc: true, npcType: "staff", avatar_url: null });
    }

    // Real named workers from the location record (worker_character_ids + worker_job_titles)
    // These are actual characters linked on the Locations page as employees
    const locationWorkerIds = location?.worker_character_ids || [];
    locationWorkerIds.forEach(wid => {
      // Skip characters already auto-shown as "on shift" workers
      if (workerCharacters.find(w => w.id === wid)) return;
      // Skip characters brought by user
      if (characterIds.includes(wid)) return;
      const workerChar = characters.find(c => c.id === wid);
      if (workerChar) {
        const jobTitle = location.worker_job_titles?.[wid] || workerChar.work_details?.job_title || "Employee";
        npcs.push({
          id: workerChar.id,
          name: workerChar.name,
          role: jobTitle,
          isNpc: false, // real character
          npcType: "staff",
          avatar_url: workerChar.avatar_url,
          // carry full character data so LLM gets personality context
          personality_summary: workerChar.personality_summary,
          archetype: workerChar.archetype,
          emotional_state: workerChar.emotional_state,
        });
      }
    });

    // Generic venue NPCs — fill in any staff roles not covered by real workers, plus customers
    const venueNpcs = {
      food_drink: [
        { id: "npc_waiter", name: "Waiter", role: "Server", npcType: "staff" },
        { id: "npc_bartender", name: "Bartender", role: "Bartender", npcType: "staff" },
        { id: "npc_diner_1", name: "Diner", role: "Customer", npcType: "customer" },
        { id: "npc_diner_2", name: "Couple nearby", role: "Customers", npcType: "customer" },
      ],
      social: [
        { id: "npc_bartender", name: "Bartender", role: "Bartender", npcType: "staff" },
        { id: "npc_bouncer", name: "Bouncer", role: "Security", npcType: "staff" },
        { id: "npc_bar_patron_1", name: "Guy at the bar", role: "Patron", npcType: "customer" },
        { id: "npc_bar_patron_2", name: "Woman nearby", role: "Patron", npcType: "customer" },
        { id: "npc_group", name: "Group of friends", role: "Patrons", npcType: "customer" },
      ],
      gym: [
        { id: "npc_trainer", name: "Personal Trainer", role: "Trainer", npcType: "staff" },
        { id: "npc_gym_front_desk", name: "Front Desk", role: "Staff", npcType: "staff" },
        { id: "npc_gym_goer_1", name: "Guy lifting weights", role: "Member", npcType: "customer" },
        { id: "npc_gym_goer_2", name: "Woman on treadmill", role: "Member", npcType: "customer" },
      ],
      grocery: [
        { id: "npc_cashier", name: "Cashier", role: "Cashier", npcType: "staff" },
        { id: "npc_stock_worker", name: "Stock Worker", role: "Staff", npcType: "staff" },
        { id: "npc_shopper_1", name: "Shopper", role: "Customer", npcType: "customer" },
        { id: "npc_shopper_2", name: "Mom with cart", role: "Customer", npcType: "customer" },
      ],
      business: [
        { id: "npc_store_clerk", name: "Store Clerk", role: "Sales Associate", npcType: "staff" },
        { id: "npc_store_manager", name: "Manager", role: "Manager", npcType: "staff" },
        { id: "npc_shopper_clothing_1", name: "Shopper", role: "Customer", npcType: "customer" },
        { id: "npc_shopper_clothing_2", name: "Woman browsing", role: "Customer", npcType: "customer" },
      ],
      medical: [
        { id: "npc_nurse", name: "Nurse", role: "Nurse", npcType: "staff" },
        { id: "npc_receptionist", name: "Receptionist", role: "Staff", npcType: "staff" },
        { id: "npc_patient", name: "Patient in waiting room", role: "Patient", npcType: "customer" },
      ],
      outdoor: [
        { id: "npc_jogger", name: "Jogger", role: "Passerby", npcType: "customer" },
        { id: "npc_dog_walker", name: "Dog walker", role: "Passerby", npcType: "customer" },
        { id: "npc_stranger", name: "Stranger on bench", role: "Passerby", npcType: "customer" },
      ],
      workplace: [
        { id: "npc_coworker", name: "Coworker", role: "Colleague", npcType: "staff" },
        { id: "npc_manager_work", name: "Manager", role: "Manager", npcType: "staff" },
      ],
      school: [
        { id: "npc_teacher", name: "Teacher", role: "Teacher", npcType: "staff" },
        { id: "npc_classmate", name: "Classmate", role: "Student", npcType: "customer" },
        { id: "npc_classmate_2", name: "Student nearby", role: "Student", npcType: "customer" },
      ],
    };
    const venueDefaults = venueNpcs[location?.category] || [
      { id: "npc_local", name: "Local", role: "Nearby person", npcType: "customer" },
    ];
    venueDefaults.forEach(n => {
      if (!npcs.find(x => x.id === n.id)) npcs.push({ ...n, isNpc: true, avatar_url: null });
    });

    // Dedupe by id
    return npcs.filter((n, i, arr) => arr.findIndex(x => x.id === n.id) === i);
  })();

  // Active characters explicitly brought (from URL params)
  const broughtCharacters = characters.filter(c => characterIds.includes(c.id));

  // Selected NPCs — default: none selected until user picks
  const selectedNpcs = selectedNpcIds !== null
    ? allPossibleNpcs.filter(n => selectedNpcIds.includes(n.id))
    : [];

  const sceneCharacters = [
    ...broughtCharacters,
    ...(isHomeLocation ? homeResidentsPresent : []),
    ...workerCharacters,
    ...selectedNpcs,
  ].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i); // dedupe

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

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
  useEffect(() => {
    if (location && !sceneImage && !isGeneratingImage) {
      generateSceneImage();
    }
  }, [location?.id, sceneImage]);

  const generateSceneImage = async (actionOverridePrompt = null) => {
    if (!location || isGeneratingImage) return;
    setIsGeneratingImage(true);
    const hour = new Date().getHours();
    const timeOfDay = hour < 6 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";

    // If an action triggered this, use the action's specific prompt
    if (actionOverridePrompt) {
      try {
        const result = await base44.integrations.Core.GenerateImage({
          prompt: `${actionOverridePrompt} ${timeOfDay} lighting. Photorealistic, high quality, authentic.`,
          existing_image_urls: firstImage ? [firstImage] : undefined,
        });
        setSceneImage(result.url);
      } catch { setSceneImage(firstImage); }
      finally { setIsGeneratingImage(false); }
      return;
    }

    let prompt;
    if (isHomeLocation) {
      const homeKnownPeople = [
        ...broughtCharacters,
        ...homeResidentsPresent,
      ].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);

      let peopleDesc;
      if (homeKnownPeople.length > 0) {
        peopleDesc = `Only these specific people are present: ${homeKnownPeople.map(c => c.name).join(", ")}. No other people, no strangers, no background figures.`;
      } else {
        peopleDesc = `A person relaxing alone in the space. No other people visible — no strangers, no background figures.`;
      }
      const currentZone = locationZones.find(z => z.zone_name === activeZone) || locationZones[0];
      const zoneSuffix = currentZone?.zone_name ? ` in the ${currentZone.zone_name}` : "";
      prompt = `Realistic interior scene inside ${location.name}${zoneSuffix}, cozy home setting, ${timeOfDay} lighting. ${peopleDesc} Photorealistic, warm, authentic atmosphere. IMPORTANT: Do NOT generate any random or unrecognized people in this image.`;

      // Gather reference images: location + resident avatars + family member photos for face grounding
      const residentAvatars = homeKnownPeople.map(c => c.avatar_url).filter(Boolean);
      const familyFaceRefs = homeKnownPeople.flatMap(c =>
        (c.family_members || []).filter(fm => fm.photo_url).map(fm => fm.photo_url)
      );
      const refs = [...(firstImage ? [firstImage] : []), ...residentAvatars, ...familyFaceRefs].slice(0, 4);
      try {
        const result = await base44.integrations.Core.GenerateImage({
          prompt,
          existing_image_urls: refs.length > 0 ? refs : undefined,
        });
        setSceneImage(result.url);
      } catch { setSceneImage(firstImage); }
      finally { setIsGeneratingImage(false); }
      return;
    } else {
      const currentZone = locationZones.find(z => z.zone_name === activeZone) || locationZones[0];
      const zoneSuffix = currentZone?.zone_name ? ` — ${currentZone.zone_name} area` : "";
      const charNames = sceneCharacters.map(c => c.name).join(", ");
      const peopleDesc = sceneCharacters.length > 0 ? `with ${charNames}` : "with people";
      prompt = `Realistic scene at ${location.name}${zoneSuffix}, ${location.category} setting, ${timeOfDay} lighting. ${peopleDesc} present. Immersive, cinematic, photorealistic. Natural and authentic atmosphere.`;
    }

    try {
      const result = await base44.integrations.Core.GenerateImage({
        prompt,
        existing_image_urls: firstImage ? [firstImage] : undefined,
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

  // Detect if a message/action should trigger an image update
  const checkImageTrigger = (text, actionImagePrompt = null) => {
    if (actionImagePrompt) {
      generateFocusedImage(actionImagePrompt);
      return;
    }
    const t = text.toLowerCase();
    // "show me X" or "look at X" or "what does X look like"
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

  const sendMessage = async (text, fromAction = false, actionImagePrompt = null, actionScenePrompt = null) => {
    if (!text.trim() || !location) return;
    setInputText("");

    const userMsg = { id: Date.now().toString(), sender: "user", content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    // Check if we should update the scene image
    checkImageTrigger(text, actionImagePrompt, actionScenePrompt);

    // Update actions based on new message context
    setActions(getLocationActions(location.category, text));

    try {
      const charSummaries = sceneCharacters.map(c =>
        `${c.name} (${c.personality_summary?.split(".")[0] || c.archetype || "character"}, mood: ${c.emotional_state || "calm"})`
      ).join("; ");

      const conversationHistory = messages.slice(-12).map(m =>
        `${m.sender === "user" ? displayName : m.senderName || "Character"}: ${m.content}`
      ).join("\n");

      const knownChars = sceneCharacters.filter(c => !c.isNpc);
      // Only selected NPCs should ever respond — never ambient/unselected ones
      const selectedNpcList = selectedNpcs.map(n => `${n.name} (${n.role || "NPC"}${n.personality_summary ? ", " + n.personality_summary.split(".")[0] : ""})`).join(", ");

      const npcInstruction = `IMPORTANT: Only these people may respond — no one else, ever:
- Known characters present: ${knownChars.map(c => c.name).join(", ") || "none"}
- Selected NPCs the user is talking to: ${selectedNpcList || "none"}
Workers on shift (${workerCharacters.map(c => c.name).join(", ") || "none"}) respond only if they are also listed above.
If no one is listed, return an empty responses array. Do NOT invent responses from ambient strangers or unselected staff.`;

      const responses = await base44.integrations.Core.InvokeLLM({
        prompt: `You are managing a group scene at ${location.name} (${location.category}).

People present: ${displayName}, ${charSummaries || "no one they know"}

Recent conversation:
${conversationHistory}

${displayName} just said: "${text}"
${fromAction ? "(This was from a scene action, not typed directly)" : ""}

${npcInstruction}
Keep each response 1-2 sentences, natural and in-character.

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

  const handleAction = async (action) => {
    if (actionCooldown) return;
    setActionCooldown(true);
    setTimeout(() => setActionCooldown(false), 3000);

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
    const imagePrompt = actionImageFn ? actionImageFn(location?.name || location?.category) : null;
    if (imagePrompt) {
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

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-xl flex-shrink-0 relative z-50">
        <Link to="/travel" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-foreground truncate">{location.name}</h2>
          <p className="text-xs text-muted-foreground capitalize">
            {CATEGORY_EMOJIS[location.category]} {location.category?.replace("_", " ")} ·{" "}
            {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>

        {/* NPC Dropdown */}
        <div className="relative z-50" ref={npcDropdownRef}>
          <button
            onClick={() => setShowNpcDropdown(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
              selectedNpcs.length > 0
                ? "bg-primary/10 border-primary/40 text-primary"
                : "bg-secondary border-border text-muted-foreground hover:text-foreground"
            }`}
            title="NPCs nearby"
          >
            <Users className="w-3.5 h-3.5" />
            <span>Who's here{selectedNpcs.length > 0 ? ` · ${selectedNpcs.length}` : ""}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showNpcDropdown ? "rotate-180" : ""}`} />
          </button>

          <AnimatePresence>
            {showNpcDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-1.5 w-52 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden"
              >
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Talk to someone nearby</p>
                </div>
                <div className="max-h-72 overflow-y-auto py-1">
                  {(() => {
                    const staffNpcs = allPossibleNpcs.filter(n => n.npcType === "staff" || (!n.npcType && n.role));
                    const customerNpcs = allPossibleNpcs.filter(n => n.npcType === "customer");
                    const ungrouped = allPossibleNpcs.filter(n => !n.npcType);

                    const renderNpc = (npc) => {
                      const isSelected = selectedNpcIds?.includes(npc.id) ?? false;
                      return (
                        <button
                          key={npc.id}
                          onClick={() => {
                            toggleNpc(npc.id);
                            // Open conversation type selector when selecting an NPC
                            setTimeout(() => {
                              const employees = getLocationEmployees(location, characters);
                              setConversationModal({
                                npcId: npc.id,
                                npcName: npc.name,
                                hasEmployees: employees.some(e => e.characterId === npc.id || e.name === npc.name),
                                isGroup: selectedNpcs.length > 0,
                              });
                            }, 100);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-secondary transition-colors text-left"
                        >
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            isSelected ? "bg-primary border-primary" : "border-border"
                          }`}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{npc.name}</p>
                            {npc.role && <p className="text-[10px] text-muted-foreground">{npc.role}</p>}
                          </div>
                          {npc.npcType === "staff" && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium flex-shrink-0">Staff</span>
                          )}
                        </button>
                      );
                    };

                    return (
                      <>
                        {staffNpcs.length > 0 && (
                          <>
                            <div className="px-3 py-1.5 border-b border-border/50">
                              <p className="text-[9px] font-semibold text-blue-400/80 uppercase tracking-wider">Employees</p>
                            </div>
                            {staffNpcs.map(renderNpc)}
                          </>
                        )}
                        {customerNpcs.length > 0 && (
                          <>
                            <div className="px-3 py-1.5 border-b border-border/50 mt-1">
                              <p className="text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-wider">People here</p>
                            </div>
                            {customerNpcs.map(renderNpc)}
                          </>
                        )}
                        {ungrouped.map(renderNpc)}
                      </>
                    );
                  })()}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
      <div className="relative h-40 flex-shrink-0 overflow-hidden" style={{ zIndex: 0 }}>
        {isGeneratingImage ? (
          <div className="w-full h-full bg-secondary flex items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span className="text-xs">Setting the scene...</span>
            </div>
          </div>
        ) : sceneImage ? (
          <button onClick={() => setLightboxSrc(sceneImage)} className="w-full h-full block group relative">
            <img src={sceneImage} alt={location.name} className="w-full h-full object-cover" />
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
          <div className="absolute top-2 left-2 z-10" ref={zonPickerRef}>
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
                  className="absolute left-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl overflow-hidden min-w-[140px]"
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
          onClick={() => generateSceneImage()}
          disabled={isGeneratingImage}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white hover:bg-black/60 transition-colors"
          title="Refresh scene image"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingImage ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Character presence strip */}
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
        {sceneCharacters.map(char => (
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
        {sceneCharacters.length === 0 && (
          <span className="text-xs text-muted-foreground ml-1">You're here alone</span>
        )}
        {settings.user_balance !== undefined && (
          <div className="ml-auto flex items-center gap-1">
            <DollarSign className="w-3 h-3 text-green-500" />
            <span className="text-xs text-green-500 font-medium">${(settings.user_balance ?? 6000).toFixed(0)}</span>
          </div>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Arrival narrative */}
        <div className="text-center space-y-2">
          <span className="text-xs text-muted-foreground bg-secondary px-3 py-1 rounded-full">
            You arrive at {location.name}
            {broughtCharacters.length > 0 ? ` with ${broughtCharacters.map(c => c.name).join(", ")}` : ""}
          </span>
          {homeResidentsPresent.length > 0 && (
            <div><span className="text-xs text-green-400/80 bg-secondary/50 px-3 py-1 rounded-full">
              {homeResidentsPresent.map(c => c.name).join(", ")} {homeResidentsPresent.length === 1 ? "is" : "are"} home
            </span></div>
          )}
          {homeResidentsAway.length > 0 && (
            <div><span className="text-xs text-muted-foreground/60 bg-secondary/50 px-3 py-1 rounded-full">
              {homeResidentsAway.map(c => c.name).join(", ")} {homeResidentsAway.length === 1 ? "is" : "are"} away
            </span></div>
          )}
          {workerCharacters.length > 0 && (
            <div><span className="text-xs text-muted-foreground/70 bg-secondary/50 px-3 py-1 rounded-full">
              {workerCharacters.map(c => c.name).join(", ")} {workerCharacters.length === 1 ? "is" : "are"} here working
            </span></div>
          )}

        </div>

        <AnimatePresence>
          {messages.map(msg => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2 ${msg.sender === "user" ? "justify-end" : msg.sender === "narrative" ? "justify-center" : "justify-start"}`}
            >
              {msg.sender === "narrative" ? (
                <span className="text-xs text-muted-foreground italic bg-secondary/50 px-3 py-1.5 rounded-full max-w-xs text-center">{msg.content}</span>
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

      {/* Action buttons */}
      <div className="px-3 py-2 border-t border-border bg-card/50 flex-shrink-0">
        <div className="grid grid-cols-4 gap-1.5">
          {actions.slice(0, 4).map(action => (
            <button
              key={action.id}
              onClick={() => handleAction(action)}
              disabled={actionCooldown}
              className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-center disabled:opacity-50 ${
                action.type === "negative"
                  ? "bg-destructive/10 border-destructive/30 hover:bg-destructive/20"
                  : action.cost > 0
                  ? "bg-green-500/10 border-green-500/30 hover:bg-green-500/20"
                  : "bg-secondary border-border hover:border-primary/30"
              }`}
            >
              <span className="text-base leading-none">{action.emoji}</span>
              <span className="text-[9px] text-foreground font-medium leading-tight">{action.label}</span>
              {action.cost > 0 && (
                <span className="text-[9px] text-green-500">
                  {action.payer === "character" ? "they pay" : `$${action.cost}`}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Input bar */}
      <div className="px-3 py-2 border-t border-border flex gap-2 flex-shrink-0 pb-safe">
        <input
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage(inputText)}
          placeholder="Say something..."
          className="flex-1 h-10 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
        />
        <button
          onClick={() => sendMessage(inputText)}
          disabled={!inputText.trim()}
          className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 transition-opacity"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Photo modal */}
      <AnimatePresence>
        {showPhotoModal && (
          <ScenePhotoModal
            location={location}
            characters={sceneCharacters}
            currentUser={currentUser}
            displayName={displayName}
            onClose={() => setShowPhotoModal(false)}
            allCharacters={characters}
          />
        )}
      </AnimatePresence>

      {/* Conversation type selector */}
      <ConversationTypeSelector
        isOpen={!!conversationModal}
        onClose={() => setConversationModal(null)}
        onSelect={(conversationType) => {
          // Log the selected conversation type (can be used for memory context, tone adjustment, etc)
          console.log(`Selected conversation type: ${conversationType} with ${conversationModal?.npcName}`);
          // Future: adjust NPC response tone based on conversation type
        }}
        npcName={conversationModal?.npcName || "them"}
        hasEmployees={conversationModal?.hasEmployees || false}
        isGroup={conversationModal?.isGroup || false}
      />
    </div>
  );
}