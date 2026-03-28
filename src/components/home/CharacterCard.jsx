import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Phone, Trash2, Pencil, X, MapPin, MoreVertical, Sparkles, ImagePlus, BarChart2, User, Moon, Briefcase, BookOpen, Home, Gamepad2 } from "lucide-react";
import { isCharacterAsleep } from "@/lib/sleepUtils";
import { isCharacterAtWork } from "@/lib/workScheduleUtils";
import { useActiveCharacter } from "@/lib/ActiveCharacterContext";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import EditCharacterNameDialog from "@/components/home/EditCharacterNameDialog";
import CharacterStatusPopup from "@/components/character/CharacterStatusPopup";
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

const activityIcons = {
  work: { icon: Briefcase, label: "at work", color: "text-blue-400" },
  school: { icon: BookOpen, label: "at school", color: "text-amber-400" },
  out: { icon: MapPin, label: "out", color: "text-emerald-400" },
  home: { icon: Home, label: "home", color: "text-pink-400" }
};

export default function CharacterCard({ character, onDelete, onMoveAway }) {
  const state = character.emotional_state || "calm";
  const [showPhoto, setShowPhoto] = useState(false);
  const [showEditName, setShowEditName] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [showStatusPopup, setShowStatusPopup] = useState(false);
  const [hasPendingMessage, setHasPendingMessage] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const [unreadPhone, setUnreadPhone] = useState(0);
  const isMovedAway = character.status === "moved_away";
  const queryClient = useQueryClient();
  const { activeCharacter, setActiveCharacter } = useActiveCharacter();

  const { data: pendingMessages = [] } = useQuery({
    queryKey: ['pendingMessages', character.id],
    queryFn: () => base44.entities.PendingMessage.filter({ character_id: character.id, delivered: false }),
    staleTime: 10000,
  });

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations', character.id],
    queryFn: () => base44.entities.Conversation.filter({ character_ids: [character.id] }),
    staleTime: 0,
  });

  useEffect(() => {
    setHasPendingMessage(pendingMessages.length > 0);
  }, [pendingMessages]);

  const countUnread = async () => {
    if (conversations.length === 0) return;
    try {
      const allUnread = await base44.entities.Message.filter({
        sender_type: "character",
        character_id: character.id,
        is_read: false,
      });

      const directConvoIds = conversations.filter(c => c.type === "direct").map(c => c.id);
      const phoneConvoIds = conversations.filter(c => c.type === "phone").map(c => c.id);

      setUnreadChat(allUnread.filter(m => directConvoIds.includes(m.conversation_id)).length);
      setUnreadPhone(allUnread.filter(m => phoneConvoIds.includes(m.conversation_id)).length);
    } catch (err) {
      console.warn('Failed to count unread messages', err);
    }
  };

  useEffect(() => {
    countUnread();
  }, [conversations, character.id]);

  // Re-count when user returns to the tab/window
  useEffect(() => {
    const handleFocus = () => {
      queryClient.invalidateQueries({ queryKey: ['conversations', character.id] });
      countUnread();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [conversations, character.id]);

  // Subscribe to message changes for real-time badge updates
  useEffect(() => {
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.data?.character_id === character.id || event.data?.sender_type === "user") {
        countUnread();
      }
    });
    return () => unsubscribe();
  }, [conversations, character.id]);

  const generateAvatar = async () => {
    setIsGeneratingAvatar(true);
    const ethnicityPart = character.ethnicities?.length > 0
      ? `${character.ethnicities.join(" and ")} descent, clearly reflecting their cultural background`
      : "";
    const prompt = `Portrait photo of a real person. ${character.age_range || "adult"}${ethnicityPart ? ", " + ethnicityPart : ""}. Gender: ${character.gender || "person"}. ${character.personality_traits?.join(", ") || ""} energy. ${character.archetype ? character.archetype + " personality." : ""} Natural lighting, realistic, photographic, candid feel. Not a model, a real everyday person.`;
    const result = await base44.integrations.Core.GenerateImage({ prompt });
    await base44.entities.Character.update(character.id, { avatar_url: result.url });
    queryClient.invalidateQueries({ queryKey: ["characters"] });
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
                const asleep = isCharacterAsleep(character);
                const atWork = isCharacterAtWork(character);
                const activity = character.current_activity?.toLowerCase().trim();
                const activityKey = activity ? Object.keys(activityIcons).find(key => activity.includes(key)) : null;
                
                if (asleep) {
                  return (
                    <div className="flex items-center gap-1.5">
                      <Moon className="w-3 h-3 text-blue-300" />
                      <span className="text-xs text-blue-300">sleeping</span>
                    </div>
                  );
                } else if (atWork) {
                  return (
                    <div className="flex items-center gap-1.5">
                      <Briefcase className="w-3 h-3 text-blue-400" />
                      <span className="text-xs text-blue-400">at work</span>
                    </div>
                  );
                } else if (activityKey) {
                  const ActivityIcon = activityIcons[activityKey].icon;
                  return (
                    <div className="flex items-center gap-1.5">
                      <ActivityIcon className={`w-3 h-3 ${activityIcons[activityKey].color}`} />
                      <span className={`text-xs ${activityIcons[activityKey].color}`}>{activityIcons[activityKey].label}</span>
                    </div>
                  );
                } else {
                  return (
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${stateDots[state] || "bg-zinc-500"}`} />
                      <span className="text-xs text-muted-foreground">{stateLabels[state] || state}</span>
                    </div>
                  );
                }
              })()}
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{character.personality_summary}</p>
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
              {(hasPendingMessage || unreadChat > 0) && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full border-2 border-background flex items-center justify-center">
                  {unreadChat > 0 ? (unreadChat > 9 ? "9+" : unreadChat) : "!"}
                </span>
              )}
            </Link>
            <Link to={`/chat/${character.id}?type=phone`} className="flex-1 relative">
              <button className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
                <Phone className="w-4 h-4" /> Text
              </button>
              {unreadPhone > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full border-2 border-background flex items-center justify-center">
                  {unreadPhone > 9 ? "9+" : unreadPhone}
                </span>
              )}
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
      </motion.div>
    </>
  );
}