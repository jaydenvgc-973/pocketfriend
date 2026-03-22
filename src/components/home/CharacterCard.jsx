import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { MessageCircle, Phone, Trash2, Pencil } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

const stateLabels = {
  calm: "calm",
  irritated: "irritated",
  defensive: "defensive",
  reflective: "reflective",
  "closed-off": "closed off"
};

const stateDots = {
  calm: "bg-emerald-400",
  irritated: "bg-orange-400",
  defensive: "bg-red-400",
  reflective: "bg-blue-400",
  "closed-off": "bg-zinc-500"
};

export default function CharacterCard({ character, onDelete }) {
  const state = character.emotional_state || "calm";

  return (
    <motion.div whileTap={{ scale: 0.99 }} className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <CharacterAvatar character={character} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">{character.name}</h3>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${stateDots[state]}`} />
              <span className="text-xs text-muted-foreground">{stateLabels[state]}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{character.personality_summary}</p>
        </div>
      </div>
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
        {character.is_default ? (
          <Link to="/edit-default">
            <button className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors">
              <Pencil className="w-4 h-4" />
            </button>
          </Link>
        ) : onDelete && (
          <button onClick={() => onDelete(character.id)} className="p-2 rounded-xl bg-secondary text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
}