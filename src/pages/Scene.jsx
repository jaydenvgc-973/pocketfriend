import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Send, RefreshCw, Sparkles, Camera, DollarSign, X, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import { filterDashes } from "@/lib/dashFilter";

const ACTION_COSTS = {
  "Buy a drink": 8,
  "Order food": 15,
  "Buy a round": 25,
  "Pay entry fee": 20,
};

export default function Scene() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const locationId = urlParams.get("locationId");
  const characterIdStr = urlParams.get("characterIds") || "";
  const characterIds = characterIdStr ? characterIdStr.split(",").filter(id => id && id !== "__user__") : [];

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [actions, setActions] = useState([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [actionRotateTimer, setActionRotateTimer] = useState(null);
  const [sceneImage, setSceneImage] = useState(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(true);
  const [balance, setBalance] = useState(null);
  const [costPopup, setCostPopup] = useState(null); // { action, cost }
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const { data: currentUser } = useQuery({ queryKey: ["user"], queryFn: () => base44.auth.me() });
  const { data: settings = [] } = useQuery({ queryKey: ["userSettings"], queryFn: () => base44.entities.UserSettings.list() });
  const userSettings = settings[0] || {};

  const { data: location } = useQuery({
    queryKey: ["location", locationId],
    queryFn: async () => {
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
      return res?.data?.locations?.find(l => l.id === locationId) || null;
    },
    enabled: !!locationId,
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["sceneCharacters", characterIds.join(",")],
    queryFn: async () => {
      if (!characterIds.length) return [];
      const all = await base44.entities.Character.filter({ created_by: currentUser.email, status: "active" });
      return all.filter(c => characterIds.includes(c.id));
    },
    enabled: !!currentUser?.email,
  });

  const userDisplayName = userSettings.fictional_world_name || currentUser?.full_name || "You";
  const userAvatarUrl = currentUser?.generated_avatar_urls?.[0] || currentUser?.reference_image_urls?.[0] || null;
  const includedUser = characterIdStr.includes("__user__");

  // Load balance
  useEffect(() => {
    if (userSettings.id) setBalance(userSettings.user_balance ?? 6000);
  }, [userSettings.id, userSettings.user_balance]);

  // Generate scene image on mount
  useEffect(() => {
    if (!location) return;
    const firstImage = location.zones?.find(z => z.image_urls?.length > 0)?.image_urls?.[0] || null;
    if (firstImage) {
      setSceneImage(firstImage);
      setIsGeneratingImage(false);
    } else {
      generateSceneImage();
    }
  }, [location?.id]);

  const generateSceneImage = async () => {
    if (!location) return;
    setIsGeneratingImage(true);
    const charNames = characters.map(c => c.name).join(", ");
    const prompt = `A realistic scene at ${location.name}. ${location.description || ""} ${charNames ? `Characters present: ${charNames}.` : ""} Cinematic, natural lighting, photorealistic.`;
    const res = await base44.integrations.Core.GenerateImage({ prompt });
    setSceneImage(res?.url || null);
    setIsGeneratingImage(false);
  };

  // Generate contextual actions
  const generateActions = async (recentMsg = "") => {
    if (!location || characters.length === 0) {
      setActions(getDefaultActions(location?.category));
      return;
    }
    setActionsLoading(true);
    const charNames = characters.map(c => c.name).join(", ");
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are generating in-scene action options for a social simulation.

Location: ${location.name} (category: ${location.category})
People present: ${userDisplayName}${charNames ? `, ${charNames}` : ""}
Recent conversation: "${recentMsg || "just arrived"}"

Generate EXACTLY 4 short, contextual action options the user could take right now.
Rules:
- Each action is 2-5 words max
- Mix of positive, neutral, and optionally one negative/risky
- Must fit the location and current context
- If location has drinks/food, include one purchase option
- Return ONLY a JSON array of 4 strings

Example: ["Buy a drink", "Talk to ${charNames?.split(",")[0] || "them"}", "Look around", "Order food"]`,
      response_json_schema: {
        type: "object",
        properties: { actions: { type: "array", items: { type: "string" } } }
      }
    }).catch(() => null);

    const parsed = result?.actions || getDefaultActions(location?.category);
    setActions(parsed.slice(0, 4));
    setActionsLoading(false);
  };

  const getDefaultActions = (category) => {
    const defaults = {
      social: ["Buy a drink", "Start conversation", "Look around", "Find a seat"],
      food_drink: ["Order food", "Ask for menu", "Look around", "Start conversation"],
      outdoor: ["Explore the area", "Sit down", "Take photos", "Start conversation"],
      gym: ["Start workout", "Ask about equipment", "Find a spot", "Stretch"],
      home: ["Sit down", "Look around", "Start conversation", "Relax"],
    };
    return defaults[category] || ["Start conversation", "Look around", "Find a spot", "Explore"];
  };

  useEffect(() => {
    if (location && characters.length >= 0) {
      generateActions();
    }
  }, [location?.id, characters.length]);

  // Auto-rotate actions every 15 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      const lastMsg = messages[messages.length - 1]?.content || "";
      generateActions(lastMsg);
    }, 15000);
    return () => clearInterval(timer);
  }, [messages.length, location?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleAction = (action) => {
    const cost = ACTION_COSTS[action];
    if (cost) {
      setCostPopup({ action, cost });
    } else {
      sendMessage(action);
    }
  };

  const confirmAction = async () => {
    if (!costPopup) return;
    const { action, cost } = costPopup;
    setCostPopup(null);

    // Deduct balance
    const newBalance = (balance || 0) - cost;
    setBalance(newBalance);
    if (userSettings.id) {
      base44.entities.UserSettings.update(userSettings.id, { user_balance: newBalance }).catch(() => {});
    }
    sendMessage(action);
  };

  const sendMessage = async (text) => {
    if (!text?.trim() || isSending) return;
    setInput("");
    setIsSending(true);

    const userMsg = { id: Date.now() + "_u", role: "user", content: text, sender: userDisplayName };
    setMessages(prev => [...prev, userMsg]);

    // Build group chat prompt
    const charNames = characters.map(c => c.name).join(" and ");
    const history = [...messages, userMsg].slice(-20).map(m => `${m.sender}: ${m.content}`).join("\n");

    const locationCtx = location?.description ? `You are at ${location.name}. ${location.description}` : `You are at ${location.name}.`;
    const groupCtx = characters.length > 1
      ? `There are multiple people here: ${charNames}. Characters can respond to each other, not just the user.`
      : "";

    const systemContext = characters.map(c => {
      const personality = c.personality_summary || "";
      const mood = c.emotional_state || "calm";
      return `${c.name}: ${personality} Current mood: ${mood}. Friendship with user: ${c.friendship_level ?? 75}/100.`;
    }).join("\n");

    const prompt = `${locationCtx} ${groupCtx}

CHARACTER PROFILES:
${systemContext}

CONVERSATION SO FAR:
${history}

Now write the next response. Rules:
- Write from the perspective of ${characters.map(c => c.name).join(" or ")} — one or more can respond
- Format: "CharacterName: [their reply]" — one line per character speaking
- Characters can react to each other and the user
- Keep it casual and realistic — this is a real shared moment
- If money was spent ("buy a drink", "order food"), acknowledge it naturally
- 1-3 lines total
- Do NOT start with your name on a meta level, each line IS labeled
- ONLY return the dialogue lines, nothing else`;

    const response = await base44.integrations.Core.InvokeLLM({ prompt });
    const cleaned = typeof response === "string" ? filterDashes(response.trim()) : "";

    if (cleaned) {
      // Parse multi-character responses
      const lines = cleaned.split("\n").filter(l => l.trim());
      for (const line of lines) {
        const colonIdx = line.indexOf(":");
        const sender = colonIdx > 0 ? line.substring(0, colonIdx).trim() : characters[0]?.name || "Character";
        const content = colonIdx > 0 ? line.substring(colonIdx + 1).trim() : line;
        if (content) {
          setMessages(prev => [...prev, { id: Date.now() + "_c_" + Math.random(), role: "character", content, sender }]);
        }
      }
    }

    // Refresh actions based on new context
    generateActions(text);

    // Update relationship levels for each character (fire-and-forget)
    for (const char of characters) {
      base44.functions.invoke("updateRelationshipLevels", {
        characterId: char.id,
        userMessage: text,
        characterReply: cleaned || "",
        recentMessages: messages.slice(-8),
      }).catch(() => {});
    }

    setIsSending(false);
  };

  return (
    <div className="h-screen flex flex-col bg-background pb-[60px]">
      {/* HEADER */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-xl">
        <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{location?.name || "Scene"}</h2>
          <p className="text-xs text-muted-foreground">
            {[...(includedUser ? [userDisplayName] : []), ...characters.map(c => c.name)].join(", ")}
          </p>
        </div>
        <button
          onClick={generateSceneImage}
          disabled={isGeneratingImage}
          className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh scene image"
        >
          <RefreshCw className={`w-4 h-4 ${isGeneratingImage ? "animate-spin" : ""}`} />
        </button>
        {balance !== null && (
          <div className="flex items-center gap-1 text-xs text-green-400 font-medium">
            <DollarSign className="w-3.5 h-3.5" />
            {balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        )}
      </div>

      {/* SCENE IMAGE */}
      <div className="relative h-44 flex-shrink-0 bg-secondary">
        {isGeneratingImage ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span className="text-xs">Setting the scene...</span>
            </div>
          </div>
        ) : sceneImage ? (
          <img src={sceneImage} alt={location?.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl">
            {location?.category === "social" ? "🍸" : location?.category === "outdoor" ? "🌳" : "📍"}
          </div>
        )}
        {/* PRESENCE STRIP overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3">
          <div className="flex items-center gap-2">
            {includedUser && (
              <div className="w-8 h-8 rounded-full border-2 border-primary overflow-hidden bg-primary/20 flex items-center justify-center flex-shrink-0">
                {userAvatarUrl
                  ? <img src={userAvatarUrl} alt={userDisplayName} className="w-full h-full object-cover" />
                  : <User className="w-4 h-4 text-primary" />
                }
              </div>
            )}
            {characters.map(char => (
              <div key={char.id} className="w-8 h-8 rounded-full border-2 border-white/30 overflow-hidden bg-primary/20 flex items-center justify-center flex-shrink-0">
                {char.avatar_url
                  ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                  : <span className="text-xs font-bold text-primary">{char.name?.[0]}</span>
                }
              </div>
            ))}
            <span className="text-xs text-white/70 ml-1">at {location?.name}</span>
          </div>
        </div>
      </div>

      {/* CHAT THREAD */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-6">
            <p className="text-xs text-muted-foreground">You arrived at {location?.name}. What happens next?</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-2`}>
            {msg.role !== "user" && (
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary mt-0.5">
                {msg.sender?.[0]?.toUpperCase() || "?"}
              </div>
            )}
            <div className={`max-w-[80%] ${msg.role === "user" ? "" : ""}`}>
              {msg.role !== "user" && (
                <p className="text-[10px] text-muted-foreground mb-0.5 ml-1">{msg.sender}</p>
              )}
              <div className={`px-3 py-2 rounded-2xl text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border text-foreground"
              }`}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex justify-start gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
              {characters[0]?.name?.[0] || "?"}
            </div>
            <div className="px-3 py-2 rounded-2xl bg-card border border-border">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full typing-dot-1" />
                <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full typing-dot-2" />
                <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full typing-dot-3" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* CONTEXTUAL ACTIONS */}
      {actions.length > 0 && (
        <div className="px-4 py-2 flex gap-2 overflow-x-auto flex-shrink-0 scrollbar-hide">
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={() => handleAction(action)}
              disabled={isSending}
              className="flex-shrink-0 px-3 py-1.5 rounded-full bg-secondary border border-border text-xs font-medium text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {ACTION_COSTS[action] ? `${action} ($${ACTION_COSTS[action]})` : action}
            </button>
          ))}
          {actionsLoading && (
            <div className="flex-shrink-0 px-3 py-1.5 text-xs text-muted-foreground">
              <RefreshCw className="w-3 h-3 animate-spin" />
            </div>
          )}
        </div>
      )}

      {/* INPUT BAR */}
      <div className="px-4 py-2 border-t border-border flex gap-2 flex-shrink-0">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
          placeholder="Say something..."
          className="flex-1 h-10 px-3 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isSending}
          className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50 transition-opacity"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* COST CONFIRMATION POPUP */}
      <AnimatePresence>
        {costPopup && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setCostPopup(null)}>
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-5 space-y-4"
            >
              <p className="text-sm font-semibold text-foreground text-center">{costPopup.action}</p>
              <p className="text-xs text-muted-foreground text-center">
                This will cost <span className="text-foreground font-semibold">${costPopup.cost}</span>. Your balance: ${(balance || 0).toFixed(2)}
              </p>
              {(balance || 0) < costPopup.cost ? (
                <p className="text-xs text-destructive text-center">Not enough balance.</p>
              ) : null}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setCostPopup(null)} className="flex-1 rounded-xl">Cancel</Button>
                <Button
                  onClick={confirmAction}
                  disabled={(balance || 0) < costPopup.cost}
                  className="flex-1 rounded-xl"
                >
                  Confirm (${costPopup.cost})
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <BottomNav />
    </div>
  );
}