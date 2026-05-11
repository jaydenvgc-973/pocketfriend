import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Phone, Trash2, Pencil, X, MapPin, MoreVertical, Sparkles, ImagePlus, BarChart2, User, Moon, Briefcase, BookOpen, Home, Gamepad2, Dumbbell, Wine, Music, ShoppingBag, AlertTriangle, DollarSign } from "lucide-react";
// Note: Sparkles is reused for prayer icon
import { getCharacterLivePresence } from "@/lib/locationResolutionEngine";
import { getCharacterSleepState } from "@/lib/characterSleepState";
import { useActiveCharacter } from "@/lib/ActiveCharacterContext";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import EditCharacterNameDialog from "@/components/home/EditCharacterNameDialog";
import CharacterStatusPopup from "@/components/character/CharacterStatusPopup";
import CharacterMovementStatus from "@/components/home/CharacterMovementStatus";
import CharacterTeleportPicker from "@/components/home/CharacterTeleportPicker";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const stateLabels = {
  calm: "calm",
  irritated: "irritated",
  defensive: "defensive",
  reflective: "reflective",
  "closed-off": "closed off",
  flirtatious: "flirtatious",
  bored: "bored",
  "burnt out": "burnt out",
  joyful: "joyful",
  anxious: "anxious",
  sad: "sad",
  excited: "excited",
  overwhelmed: "overwhelmed",
  content: "content",
  frustrated: "frustrated"
};

const stateDots = {
  calm: "bg-emerald-400",
  irritated: "bg-orange-400",
  defensive: "bg-red-400",
  reflective: "bg-blue-400",
  "closed-off": "bg-zinc-500",
  flirtatious: "bg-pink-500",
  bored: "bg-slate-500",
  "burnt out": "bg-orange-600",
  joyful: "bg-yellow-500",
  anxious: "bg-purple-500",
  sad: "bg-blue-600",
  excited: "bg-amber-400",
  overwhelmed: "bg-rose-500",
  content: "bg-teal-400",
  frustrated: "bg-red-600"
};



export default function CharacterCard({ character, onDelete, onMoveAway, locationMap = {} }) {
  // OWNERSHIP GUARD: owner_email is the sole ownership source of truth.
  // If missing, log visibly so data integrity issues surface rather than silently fail.
  if (!character.owner_email) {
    console.error(`[CharacterCard] MISSING owner_email on character id=${character.id} name="${character.name}". Cache invalidation and ownership scoping will be incorrect.`);
  }

  const state = character.emotional_state || "calm";
  const [showPhoto, setShowPhoto] = useState(false);
  const [showEditName, setShowEditName] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [showStatusPopup, setShowStatusPopup] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const [unreadPhone, setUnreadPhone] = useState(0);
  const isMovedAway = character.status === "moved_away";
  const isDefault = character.is_default;
  const queryClient = useQueryClient();
  const { activeCharacter, setActiveCharacter } = useActiveCharacter();

  // Mount-delay gate: stagger queries so N cards don't fire simultaneously on Home mount.
  // Each card waits 600ms after mounting before enabling its queries.
  const [queryReady, setQueryReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQueryReady(true), 600);
    return () => clearTimeout(t);
  }, []);

  const { data: financialRecords = [] } = useQuery({
    queryKey: ['characterFinancial', character.id],
    queryFn: () => base44.entities.CharacterFinancial.filter({ character_id: character.id }),
    // Financial balance changes infrequently — 10 min stale time prevents re-fetch storms
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: !!character.id && queryReady,
  });
  const balance = financialRecords[0]?.current_balance;

  const { data: conversations = [] } = useQuery({
    // owner_email is the ownership source of truth. Both fields are required in the filter.
    // Backfill (backfillConversationOwnerEmail) has been run — existing records are stamped.
    // Orphaned conversations from deleted characters are unresolvable and excluded by design.
    queryKey: ['conversations', character.id, character.owner_email],
    queryFn: () => {
      if (!character.owner_email) {
        // Fail visibly — do not silently fall back to an under-scoped query.
        console.error(`[CharacterCard] Cannot query conversations for character id=${character.id} name="${character.name}": owner_email is missing. This character record is invalid for ownership-scoped queries.`);
        return [];
      }
      return base44.entities.Conversation.filter({
        owner_email: character.owner_email,
        character_ids: [character.id],
      });
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    enabled: !!character.id && !!character.owner_email && queryReady,
  });



  // Single batched query: fetch ALL unread character messages for this character at once
  // instead of N queries per conversation (which caused 429 rate limit storms)
  const debounceRef = useRef(null);
  const countUnread = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (conversations.length === 0) {
        setUnreadChat(0);
        setUnreadPhone(0);
        return;
      }
      try {
        const directIds = new Set(conversations.filter(c => c.type === "direct").map(c => c.id));
        const phoneIds = new Set(conversations.filter(c => c.type === "phone").map(c => c.id));
        // One single query for all unread character messages for this character
        const allUnread = await base44.entities.Message.filter({
          character_id: character.id,
          sender_type: "character",
          is_read: false,
        });
        let chatTotal = 0;
        let phoneTotal = 0;
        for (const msg of allUnread) {
          if (directIds.has(msg.conversation_id)) chatTotal++;
          else if (phoneIds.has(msg.conversation_id)) phoneTotal++;
        }
        setUnreadChat(chatTotal);
        setUnreadPhone(phoneTotal);
      } catch {
        setUnreadChat(0);
        setUnreadPhone(0);
      }
    }, 800); // debounce 800ms so rapid invalidations don't pile up
  }, [conversations, character.id]);

  useEffect(() => {
    countUnread();
  }, [conversations.length, character.id]);

  // Re-count when user returns to the tab/window
  useEffect(() => {
    const handleFocus = () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', character.id, character.owner_email] });
      countUnread();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [conversations, character.id, character.owner_email, queryClient]);

  // Real-time: recount when a relevant message changes for this character.
  // Only subscribe after queryReady — prevents firing before conversations are loaded.
  useEffect(() => {
    if (!queryReady) return;
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      const isForThisChar = event.data?.character_id === character.id;
      if (isForThisChar && (event.type === "create" || event.type === "update")) {
        countUnread();
      }
    });
    return () => unsubscribe();
  }, [character.id, countUnread, queryReady]);



  const generateAvatar = async () => {
    setIsGeneratingAvatar(true);
    const ethnicityPart = character.ethnicities?.length > 0
      ? `${character.ethnicities.join(" and ")} descent, clearly reflecting their cultural background`
      : "";
    const prompt = `Portrait photo of a real person. ${character.age_range || "adult"}${ethnicityPart ? ", " + ethnicityPart : ""}. Gender: ${character.gender || "person"}. ${character.personality_traits?.join(", ") || ""} energy. ${character.archetype ? character.archetype + " personality." : ""} Natural lighting, realistic, photographic, candid feel. Not a model, a real everyday person.`;
    const result = await base44.integrations.Core.GenerateImage({ prompt });
    await base44.entities.Character.update(character.id, { avatar_url: result.url });
    queryClient.invalidateQueries({ queryKey: ["characters", character.owner_email] });
    setIsGeneratingAvatar(false);
    setShowAvatarModal(false);
  };

  return (
    <>
      <AnimatePresence>
        {showPhoto && character.avatar_url && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
            onClick={() => setShowPhoto(false)}
          >
            <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors" onClick={() => setShowPhoto(false)}>
              <X className="w-5 h-5" />
            </button>
            <motion.img
              initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.85, opacity: 0 }}
              src={character.avatar_url} alt={character.name}
              className="max-w-full max-h-full w-screen h-screen object-contain"
              onClick={e => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showEditName && (
          <EditCharacterNameDialog character={character} onClose={() => setShowEditName(false)} />
        )}
      </AnimatePresence>

      {showStatusPopup && (
        <CharacterStatusPopup character={character} onClose={() => setShowStatusPopup(false)} />
      )}

      <AnimatePresence>
        {showAvatarModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
            onClick={() => !isGeneratingAvatar && setShowAvatarModal(false)}
          >
            <motion.div
              initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Add avatar for {character.name}</h3>
                {!isGeneratingAvatar && (
                  <button onClick={() => setShowAvatarModal(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">AI will generate an avatar based on {character.name}'s personality, archetype, and backstory.</p>
              <button
                onClick={generateAvatar}
                disabled={isGeneratingAvatar}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                <Sparkles className="w-4 h-4" />
                {isGeneratingAvatar ? "Generating..." : "Generate AI Avatar"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div whileTap={{ scale: 0.99 }} className={`bg-card border border-border rounded-2xl p-4 ${isMovedAway ? "opacity-60" : ""}`}>
        <div className="flex items-start gap-3">
          <div className={character.avatar_url ? "cursor-pointer" : ""} onClick={() => character.avatar_url && setShowPhoto(true)}>
            <CharacterAvatar character={character} size="lg" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">{character.name}</h3>
                {isMovedAway && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                    <MapPin className="w-3 h-3" /> moved away
                  </span>
                )}
              </div>
              {!isMovedAway && (() => {
                const presence = getCharacterLivePresence(character, locationMap);

                // STRICT HOME VALIDATION: Character can only show "home" if they have a valid home location
                const hasValidHome = !!(character.current_home_location_id || character.home_location_id || character.temporary_housing_location_id);
                const shouldShowHome = presence.status === 'home' && hasValidHome;

                // SLEEP DISPLAY OVERRIDE: use canonical multi-field resolver.
                // Priority 1: sleeping overrides At home / Idle / Available / current location.
                const sleepState = getCharacterSleepState(character);
                const derivedAsleep = sleepState.isSleeping;
                const isNapping = sleepState.isNapping;

                // Rabbit hole — not teleportable, show static
                if (presence.status === 'rabbit_hole') {
                  return (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3 h-3 text-violet-400" />
                      <span className="text-xs text-violet-400">{presence.label}</span>
                    </div>
                  );
                }

                let IconComponent = null;
                let color = 'text-muted-foreground';
                let label = presence.label;

                if (derivedAsleep || isNapping || presence.isSleeping) {
                  IconComponent = Moon;
                  color = 'text-blue-300';
                  label = isNapping ? 'napping' : 'sleeping';
                } else if (presence.status === 'at_work') {
                  IconComponent = Briefcase;
                  color = 'text-blue-400';
                } else if (presence.status === 'at_school') {
                  IconComponent = BookOpen;
                  color = 'text-amber-400';
                } else if (presence.status === 'in_transit' || presence.isTransit) {
                  IconComponent = MapPin;
                  color = 'text-orange-400';
                } else if (shouldShowHome) {
                  IconComponent = Home;
                  color = 'text-pink-400';
                } else if (presence.status === 'home' && !hasValidHome) {
                  // No valid home — show Away
                  IconComponent = MapPin;
                  color = 'text-muted-foreground';
                  label = 'Away';
                } else if (presence.status === 'health_critical') {
                  IconComponent = AlertTriangle;
                  color = 'text-red-400';
                } else if (presence.status === 'visiting' || presence.status === 'at_location') {
                  const loc = locationMap[character.resolved_current_location_id];
                  const category = loc?.category;
                  if (category === 'gym') { IconComponent = Dumbbell; color = 'text-cyan-400'; }
                  else if (category === 'food_drink') { IconComponent = Wine; color = 'text-amber-400'; }
                  else if (category === 'home') { IconComponent = Home; color = 'text-pink-400'; }
                  else if (category === 'school' || category === 'education') { IconComponent = BookOpen; color = 'text-amber-400'; }
                  else { IconComponent = MapPin; color = 'text-blue-400'; }
                }

                return (
                  <CharacterTeleportPicker
                    character={character}
                    currentLabel={label}
                    currentColor={color}
                    IconComponent={IconComponent}
                    onTeleported={() => queryClient.invalidateQueries({ queryKey: ["character", character.id] })}
                  />
                );
              })()}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stateDots[state] || "bg-zinc-500"}`} />
              <span className="text-xs text-muted-foreground capitalize">{stateLabels[state] || state}</span>
              {balance !== undefined && (
                <span className="ml-auto flex items-center gap-0.5 text-xs text-green-400 font-medium">
                  <DollarSign className="w-3 h-3" />{balance.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>

        {isMovedAway ? (
           <div className="mt-4 flex gap-2">
             {onMoveAway && (
               <button onClick={() => onMoveAway()} className="flex-1 px-3 py-2 rounded-xl bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors">
                 They can move back
               </button>
             )}
             {!onMoveAway && (
               <div className="flex-1 px-3 py-2 rounded-xl bg-secondary text-xs text-muted-foreground text-center">
                 They moved on. Still out there somewhere.
               </div>
             )}
           </div>
         ) : (
          <div className="flex items-center gap-2 mt-4">
            <Link to={`/chat/${character.id}`} className="flex-1 relative">
              <button className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors">
                <MessageCircle className="w-4 h-4" /> Chat
              </button>
              <AnimatePresence>
                {unreadChat > 0 && (
                  <motion.span
                    key="chat-badge"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full border-2 border-background flex items-center justify-center">
                    {unreadChat > 9 ? "9+" : unreadChat}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
            <Link to={`/chat/${character.id}?type=phone`} className="flex-1 relative">
              <button className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
                <Phone className="w-4 h-4" /> Text
              </button>
              <AnimatePresence>
                {unreadPhone > 0 && (
                  <motion.span
                    key="phone-badge"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full border-2 border-background flex items-center justify-center">
                    {unreadPhone > 9 ? "9+" : unreadPhone}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
            <button
              onClick={(e) => { e.stopPropagation(); setShowStatusPopup(true); }}
              className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="View relationship status"
            >
              <BarChart2 className="w-4 h-4" />
            </button>
            {character.is_default ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem asChild>
                    <Link to={`/profile/${character.id}`} className="flex items-center gap-2 text-muted-foreground">
                      <User className="w-4 h-4" /> View Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowEditName(true)} className="gap-2 text-muted-foreground">
                    <Pencil className="w-4 h-4" /> Edit name
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/edit-default" className="flex items-center gap-2 text-muted-foreground">
                      <Pencil className="w-4 h-4" /> Edit photos
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setActiveCharacter(activeCharacter?.id === character.id ? null : character)}
                    className="gap-2 text-muted-foreground"
                  >
                    <Gamepad2 className="w-4 h-4" />
                    {activeCharacter?.id === character.id ? "Stop playing as" : "Play as"} {character.name}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (onDelete || onMoveAway) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem asChild>
                    <Link to={`/profile/${character.id}`} className="flex items-center gap-2 text-muted-foreground">
                      <User className="w-4 h-4" /> View Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowEditName(true)} className="gap-2 text-muted-foreground">
                    <Pencil className="w-4 h-4" /> Edit name
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setActiveCharacter(activeCharacter?.id === character.id ? null : character)}
                    className="gap-2 text-muted-foreground"
                  >
                    <Gamepad2 className="w-4 h-4" />
                    {activeCharacter?.id === character.id ? "Stop playing as" : "Play as"} {character.name}
                  </DropdownMenuItem>
                  {!character.avatar_url && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowAvatarModal(true)} className="gap-2 text-muted-foreground">
                        <ImagePlus className="w-4 h-4" /> Add avatar
                      </DropdownMenuItem>
                    </>
                  )}
                  {onMoveAway && <DropdownMenuSeparator />}
                  {onMoveAway && (
                    <DropdownMenuItem onClick={() => onMoveAway(character.id)} className="gap-2 text-muted-foreground">
                      <MapPin className="w-4 h-4" /> They moved away
                    </DropdownMenuItem>
                  )}
                  {onDelete && onMoveAway && <DropdownMenuSeparator />}
                  {onDelete && (
                    <DropdownMenuItem onClick={() => onDelete(character.id)} className="gap-2 text-destructive focus:text-destructive">
                      <Trash2 className="w-4 h-4" /> Delete character
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        {!isMovedAway && !isDefault && (
          <CharacterMovementStatus character={character} userEmail={character.owner_email} />
        )}
      </motion.div>
    </>
  );
}