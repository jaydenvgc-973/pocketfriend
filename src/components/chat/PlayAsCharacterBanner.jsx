import { useActiveCharacter } from "@/lib/ActiveCharacterContext";
import { motion, AnimatePresence } from "framer-motion";
import { X, Gamepad2 } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

export default function PlayAsCharacterBanner() {
  const { activeCharacter, setActiveCharacter } = useActiveCharacter();

  return (
    <AnimatePresence>
      {activeCharacter && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          className="fixed top-0 left-0 right-0 z-50 bg-primary text-primary-foreground px-4 py-2 flex items-center gap-3 shadow-lg"
        >
          <Gamepad2 className="w-4 h-4 flex-shrink-0" />
          <CharacterAvatar character={activeCharacter} size="sm" />
          <span className="text-xs font-semibold flex-1">Playing as {activeCharacter.name}</span>
          <button
            onClick={() => setActiveCharacter(null)}
            className="p-1 rounded-full hover:bg-primary-foreground/20 transition-colors"
            title="Stop playing as character"
          >
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}