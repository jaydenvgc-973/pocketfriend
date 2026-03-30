import { useState } from "react";
import { useActiveCharacter } from "@/lib/ActiveCharacterContext";
import { motion, AnimatePresence } from "framer-motion";
import { X, Gamepad2, Images, Globe, BookOpen, Settings } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import { Link } from "react-router-dom";
import GlobalMediaGallery from "@/components/chat/GlobalMediaGallery";
import NarrativeBuilderPopup from "@/components/chat/NarrativeBuilderPopup";
import WorldContactsPopup from "@/components/chat/WorldContactsPopup";

export default function PlayAsCharacterBanner() {
  const { activeCharacter, setActiveCharacter } = useActiveCharacter();
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [showNarrative, setShowNarrative] = useState(false);
  const [showWorldContacts, setShowWorldContacts] = useState(false);

  if (!activeCharacter) return null;

  return (
    <>
      <AnimatePresence>
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          className="fixed top-0 left-0 right-0 z-50 bg-primary text-primary-foreground px-3 py-1.5 flex items-center gap-2 shadow-lg"
        >
          <Gamepad2 className="w-3.5 h-3.5 flex-shrink-0" />
          <CharacterAvatar character={activeCharacter} size="sm" />
          <span className="text-xs font-semibold flex-1 truncate">Playing as {activeCharacter.name}</span>

          {/* Action buttons */}
          <button
            onClick={() => setShowMediaGallery(true)}
            className="p-1 rounded-full hover:bg-primary-foreground/20 transition-colors"
            title="Media from characters"
          >
            <Images className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setShowWorldContacts(true)}
            className="p-1 rounded-full hover:bg-primary-foreground/20 transition-colors"
            title="World contacts"
          >
            <Globe className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setShowNarrative(true)}
            className="p-1 rounded-full hover:bg-primary-foreground/20 transition-colors"
            title="Narrative tool"
          >
            <BookOpen className="w-3.5 h-3.5" />
          </button>

          <Link to="/settings">
            <button
              className="p-1 rounded-full hover:bg-primary-foreground/20 transition-colors"
              title="Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </Link>

          <button
            onClick={() => setActiveCharacter(null)}
            className="p-1 rounded-full hover:bg-primary-foreground/20 transition-colors"
            title="Stop playing as character"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      </AnimatePresence>

      <GlobalMediaGallery isOpen={showMediaGallery} onClose={() => setShowMediaGallery(false)} />

      <NarrativeBuilderPopup
        isOpen={showNarrative}
        onClose={() => setShowNarrative(false)}
        characterId={activeCharacter.id}
        conversationId={null}
        chatHistory={[]}
        onNarrativeSubmitted={() => {}}
      />

      <WorldContactsPopup
        isOpen={showWorldContacts}
        onClose={() => setShowWorldContacts(false)}
        character={activeCharacter}
      />
    </>
  );
}