import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Phone, Trash2, Pencil, X, MapPin, MoreVertical, Sparkles, ImagePlus, BarChart2 } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import EditCharacterNameDialog from "@/components/home/EditCharacterNameDialog";
import CharacterStatusPopup from "@/components/character/CharacterStatusPopup";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const stateLabels = {
  calm: "calm", irritated: "irritated", defensive: "defensive",
  reflective: "reflective", "closed-off": "closed off"
};

const stateDots = {
  calm: "bg-emerald-400", irritated: "bg-orange-400", defensive: "bg-red-400",
  reflective: "bg-blue-400", "closed-off": "bg-zinc-500"
};

export default function CharacterCard({ character, onDelete, onMoveAway }) {
  const state = character.emotional_state || "calm";
  const [showPhoto, setShowPhoto] = useState(false);
  const [showEditName, setShowEditName] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [showStatusPopup, setShowStatusPopup] = useState(false);
  const isMovedAway = character.status === "moved_away";
  const queryClient = useQueryClient();

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
              {!isMovedAway && (
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${stateDots[state]}`} />
                  <span className="text-xs text-muted-foreground">{stateLabels[state]}</span>
                </div>
              )}
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
            <Link to={`/chat/${character.id}`} className="flex-1">
              <button className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors">
                <MessageCircle className="w-4 h-4" /> Chat
              </button>
            </Link>
            <Link to={`/chat/${character.id}?type=phone`} className="flex-1">
              <button className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
                <Phone className="w-4 h-4" /> Text
              </button>
            </Link>
            <button
              onClick={() => setShowStatusPopup(true)}
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
                  <DropdownMenuItem onClick={() => setShowEditName(true)} className="gap-2 text-muted-foreground">
                    <Pencil className="w-4 h-4" /> Edit name
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/edit-default" className="flex items-center gap-2 text-muted-foreground">
                      <Pencil className="w-4 h-4" /> Edit photos
                    </Link>
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
                  <DropdownMenuItem onClick={() => setShowEditName(true)} className="gap-2 text-muted-foreground">
                    <Pencil className="w-4 h-4" /> Edit name
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