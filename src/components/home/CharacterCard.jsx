import { motion } from "framer-motion";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import { MessageCircle, Phone, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

const stateLabels = {
  calm: "Calm",
  irritated: "Irritated",
  defensive: "Defensive",
  reflective: "Reflective",
  "closed-off": "Closed off"
};

const stateDots = {
  calm: "bg-emerald-400",
  irritated: "bg-orange-400",
  defensive: "bg-red-400",
  reflective: "bg-blue-400",
  "closed-off": "bg-zinc-500"
};

export default function CharacterCard({ character, onDelete }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-2xl p-4 hover:border-primary/30 transition-all"
    >
      <div className="flex items-start gap-3">
        <CharacterAvatar character={character} size="lg" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate">{character.name}</h3>
          <div className="flex items-center gap-1.5 mt-1">
            <div className={`w-2 h-2 rounded-full ${stateDots[character.emotional_state] || stateDots.calm}`} />
            <span className="text-xs text-muted-foreground">{stateLabels[character.emotional_state] || "Calm"}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{character.personality_summary}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4">
        <Link to={`/chat/${character.id}?type=direct`} className="flex-1">
          <motion.button whileTap={{ scale: 0.97 }} className="w-full flex items-center justify-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl py-2.5 text-sm font-medium transition-colors">
            <MessageCircle className="w-4 h-4" />
            Talk
          </motion.button>
        </Link>
        <Link to={`/chat/${character.id}?type=phone`} className="flex-1">
          <motion.button whileTap={{ scale: 0.97 }} className="w-full flex items-center justify-center gap-2 bg-secondary hover:bg-secondary/80 text-foreground rounded-xl py-2.5 text-sm font-medium transition-colors">
            <Phone className="w-4 h-4" />
            Text
          </motion.button>
        </Link>
        {!character.is_default && onDelete && (
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => onDelete(character.id)} className="p-2.5 rounded-xl bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors">
            <Trash2 className="w-4 h-4" />
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}