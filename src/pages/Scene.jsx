import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Camera, DollarSign, RefreshCw, Send } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import ScenePhotoModal from "@/components/travel/ScenePhotoModal";
import { filterDashes } from "@/lib/dashFilter";
import { isCharacterAtWork } from "@/lib/workScheduleUtils";
import { isCharacterHome } from "@/lib/travelAvailability";

const CATEGORY_EMOJIS = {
  home: "🏠", workplace: "💼", school: "🏫", gym: "🏋️", grocery: "🛒",
  food_drink: "🍽️", outdoor: "🌳", social: "🍸", medical: "🏨",
  bar: "🍸", generic: "📍",
};

function getLocationActions(category, recentChat = "") {
  const chat = recentChat.toLowerCase();

  // Context-aware overrides
  if (chat.includes("hungry") || chat.includes("eat") || chat.includes("food")) {
    return [
      { id: "order_food", label: "Order food", emoji: "🍔", cost: 15, type: "positive" },
      { id: "buy_drink", label: "Buy a drink", emoji: "🥤", cost: 8, type: "positive" },
      { id: "talk", label: "Keep talking", emoji: "💬", cost: 0, type: "neutral" },
      { id: "ask", label: "Ask something", emoji: "🤔", cost: 0, type: "neutral" },
    ];
  }

  const base = {
    home: [
      { id: "sit", label: "Sit down", emoji: "🛋️", cost: 0, type: "neutral" },
      { id: "eat", label: "Eat something", emoji: "🍽️", cost: 10, type: "positive" },
      { id: "relax", label: "Just relax", emoji: "😌", cost: 0, type: "positive" },
      { id: "talk", label: "Start talking", emoji: "💬", cost: 0, type: "neutral" },
    ],
    social: [
      { id: "buy_round", label: "Buy a round", emoji: "🥂", cost: 25, type: "positive" },
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
      { id: "order", label: "Order food", emoji: "🍔", cost: 18, type: "positive" },
      { id: "drinks", label: "Get drinks", emoji: "🍹", cost: 12, type: "positive" },
      { id: "talk", label: "Good conversation", emoji: "💬", cost: 0, type: "neutral" },
      { id: "check", label: "Pick up the check", emoji: "💳", cost: 40, type: "positive" },
    ],
    outdoor: [
      { id: "walk", label: "Go for a walk", emoji: "🚶", cost: 0, type: "positive" },
      { id: "sit_outside", label: "Sit outside", emoji: "🌤️", cost: 0, type: "positive" },
      { id: "photo", label: "Take a picture", emoji: "📸", cost: 0, type: "positive" },
      { id: "talk", label: "Talk it out", emoji: "💬", cost: 0, type: "neutral" },
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
  const [selectedNpcIds, setSelectedNpcIds] = useState(null); // null = not yet shown selector
  const bottomRef = useRef(null);

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

  // Characters explicitly brought + any active characters who work here during their shift
  const workerCharacters = location
    ? characters.filter(c =>
        !characterIds.includes(c.id) &&
        (c.occupation_location_id === locationId ||
          c.additional_occupation_locations?.some(j => j.location_id === locationId)) &&
        isCharacterAtWork(c, location)
      )
    : [];

  // At a home location: separate home residents into "home" vs "away"
  const isHomeLocation = location?.category === "home";
  const homeResidents = isHomeLocation
    ? characters.filter(c => location.resident_character_ids?.includes(c.id))
    : [];
  const homeResidentsPresent = homeResidents.filter(c => isCharacterHome(c, locationMap));
  const homeResidentsAway = homeResidents.filter(c => !isCharacterHome(c, locationMap));

  // NPC family members from residents who are away (use family_members field)
  const npcFamilyMembers = isHomeLocation
    ? homeResidentsAway.flatMap(c =>
        (c.family_members || []).map(fm => ({
          id: `npc_${fm.name?.replace(/\s+/g, "_")}`,
          name: fm.name,
          relationship: fm.relationship_type,
          isNpc: true,
          avatar_url: null,
        }))
      ).filter((fm, i, arr) => arr.findIndex(x => x.id === fm.id) === i) // dedupe
    : [];

  // Also include NPC owner if present and no residents are home
  const npcOwner = (isHomeLocation && location.owner_is_npc && location.owner_npc_name && homeResidentsPresent.length === 0)
    ? [{ id: `npc_owner_${location.id}`, name: location.owner_npc_name, relationship: location.owner_role || "resident", isNpc: true, avatar_url: null }]
    : [];

  const allNpcResidents = [...npcFamilyMembers, ...npcOwner];

  // Active characters explicitly brought (from URL params)
  const broughtCharacters = characters.filter(c => characterIds.includes(c.id));

  // Scene characters = brought + home residents who are home + workers on shift
  // At a home: also include selected NPCs from allNpcResidents
  const selectedNpcs = selectedNpcIds !== null
    ? allNpcResidents.filter(n => selectedNpcIds.includes(n.id))
    : allNpcResidents; // default: all NPCs present

  const sceneCharacters = [
    ...broughtCharacters,
    ...(isHomeLocation ? homeResidentsPresent : []),
    ...workerCharacters,
    ...(isHomeLocation ? selectedNpcs : []),
  ].filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i); // dedupe

  const firstImage = location?.zones?.find(z => z.image_urls?.length > 0)?.image_urls?.[0]
    || location?.image_urls?.[0]
    || null;

  // Initialize actions
  useEffect(() => {
    if (location) {
      setActions(getLocationActions(location.category));
    }
  }, [location?.id]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Rotate actions every 3 minutes
  useEffect(() => {
    if (!location) return;
    const interval = setInterval(() => {
      const recentText = messages.slice(-3).map(m => m.content).join(" ");
      setActions(getLocationActions(location.category, recentText));
    }, 180000);
    return () => clearInterval(interval);
  }, [location?.id, messages.length]);

  // Generate scene image on load
  useEffect(() => {
    if (location && !sceneImage && !isGeneratingImage) {
      generateSceneImage();
    }
  }, [location?.id]);

  const generateSceneImage = async () => {
    if (!location || isGeneratingImage) return;
    setIsGeneratingImage(true);
    const hour = new Date().getHours();
    const timeOfDay = hour < 6 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    const charNames = sceneCharacters.map(c => c.name).join(", ");
    const peopleDesc = sceneCharacters.length > 0 ? `with ${charNames}` : "with people";
    try {
      const result = await base44.integrations.Core.GenerateImage({
        prompt: `Realistic scene at ${location.name}, ${location.category} setting, ${timeOfDay} lighting. ${peopleDesc} present. Immersive, cinematic, photorealistic. Natural and authentic atmosphere.`,
        existing_image_urls: firstImage ? [firstImage] : undefined,
      });
      setSceneImage(result.url);
    } catch {
      // fallback to location reference image
      setSceneImage(firstImage);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const sendMessage = async (text, fromAction = false) => {
    if (!text.trim() || !location) return;
    setInputText("");

    const userMsg = { id: Date.now().toString(), sender: "user", content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    // Update actions based on new message context
    setActions(getLocationActions(location.category, text));

    try {
      const charSummaries = sceneCharacters.map(c =>
        `${c.name} (${c.personality_summary?.split(".")[0] || c.archetype || "character"}, mood: ${c.emotional_state || "calm"})`
      ).join("; ");

      const conversationHistory = messages.slice(-12).map(m =>
        `${m.sender === "user" ? displayName : m.senderName || "Character"}: ${m.content}`
      ).join("\n");

      // Build NPC context
      const npcNames = selectedNpcs.map(n => n.name);
      const npcContext = npcNames.length > 0
        ? `NPC family/residents present: ${npcNames.join(", ")}. They live here and respond naturally as family members or housemates would.`
        : "";

      const knownChars = sceneCharacters.filter(c => !c.isNpc);
      const isAlone = knownChars.length === 0 && selectedNpcs.length === 0;
      const npcInstruction = isAlone
        ? `There are no friends present. A single staff member or worker at ${location.name} can briefly respond if relevant (e.g. a cashier, bartender, employee). Use their role as their name (e.g. "Cashier", "Bartender"). Only respond if it makes sense contextually — most of the time return an empty responses array.`
        : `Write short, natural responses from the relevant characters.
Known characters: ${knownChars.map(c => c.name).join(", ") || "none"}.
${npcContext}
Workers (${workerCharacters.map(c => c.name).join(", ") || "none"}) are staff — they respond briefly and professionally unless directly addressed.
Characters should react naturally to each other and the user.`;

      const responses = await base44.integrations.Core.InvokeLLM({
        prompt: `You are managing a group scene at ${location.name} (${location.category}).

People present: ${displayName} (the user), ${charSummaries || "no one the user knows"}

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
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          sender: "narrative",
          content: `The atmosphere at ${location.name} feels alive. No one responds right away.`,
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

    // Deduct cost from user balance
    if (action.cost > 0) {
      const newBalance = Math.max(0, (settings.user_balance ?? 6000) - action.cost);
      if (settings.id) {
        base44.entities.UserSettings.update(settings.id, { user_balance: newBalance }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["userSettings"] });
      }
    }

    await sendMessage(`[${action.emoji} ${action.label}${action.cost > 0 ? ` — $${action.cost}` : ""}]`, true);

    // Update actions to reflect progression
    setTimeout(() => {
      setActions(getLocationActions(location?.category, action.label));
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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-xl flex-shrink-0">
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
        <button
          onClick={() => setShowPhotoModal(true)}
          className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Scene photo"
        >
          <Camera className="w-4 h-4" />
        </button>
      </div>

      {/* Scene image */}
      <div className="relative h-40 flex-shrink-0 overflow-hidden">
        {isGeneratingImage ? (
          <div className="w-full h-full bg-secondary flex items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span className="text-xs">Setting the scene...</span>
            </div>
          </div>
        ) : sceneImage ? (
          <img src={sceneImage} alt={location.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-secondary flex items-center justify-center">
            <span className="text-5xl">{CATEGORY_EMOJIS[location.category]}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/60" />
        <button
          onClick={generateSceneImage}
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
          <span className="text-[9px] text-primary font-medium">You</span>
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
          {/* NPC resident selector */}
          {allNpcResidents.length > 0 && (
            <div className="mt-2 bg-card border border-border rounded-xl p-3 text-left space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Who's around to talk to?</p>
              <div className="flex flex-wrap gap-1.5">
                {allNpcResidents.map(npc => {
                  const isSelected = selectedNpcIds === null || selectedNpcIds.includes(npc.id);
                  return (
                    <button
                      key={npc.id}
                      onClick={() => {
                        const current = selectedNpcIds ?? allNpcResidents.map(n => n.id);
                        setSelectedNpcIds(
                          current.includes(npc.id)
                            ? current.filter(id => id !== npc.id)
                            : [...current, npc.id]
                        );
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                        isSelected ? "bg-primary/10 border-primary text-primary" : "bg-card border-border text-muted-foreground"
                      }`}
                    >
                      {npc.name}
                      {npc.relationship && <span className="opacity-60">· {npc.relationship}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
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
              {action.cost > 0 && <span className="text-[9px] text-green-500">${action.cost}</span>}
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
    </div>
  );
}