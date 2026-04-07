import { useState, useEffect } from "react";
import { useActiveCharacter } from "@/lib/ActiveCharacterContext";
import { motion } from "framer-motion";
import { X, Gamepad2, Images, Globe, BookOpen, Settings, Wrench } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import { Link } from "react-router-dom";
import GlobalMediaGallery from "@/components/chat/GlobalMediaGallery";
import NarrativeBuilderPopup from "@/components/chat/NarrativeBuilderPopup";
import WorldContactsPopup from "@/components/chat/WorldContactsPopup";
import TroubleshootingPanelHome from "@/components/home/TroubleshootingPanelHome";
import { base44 } from "@/api/base44Client";

export default function PlayAsCharacterBanner() {
  const { activeCharacter, setActiveCharacter } = useActiveCharacter();
  const [showMediaGallery, setShowMediaGallery] = useState(false);
  const [showNarrative, setShowNarrative] = useState(false);
  const [showWorldContacts, setShowWorldContacts] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState(null);
  // Fetch the most recent conversation for the active character so NarrativeBuilder has a real conversationId
  useEffect(() => {
    if (!activeCharacter?.id) return;
    base44.entities.Conversation.filter(
      { character_ids: [activeCharacter.id] },
      "-updated_date",
      1
    ).then(convos => {
      setActiveConversationId(convos?.[0]?.id || null);
    }).catch(() => {});
  }, [activeCharacter?.id]);

  if (!activeCharacter) return null;

  return (
    <>
      <motion.div
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -40, opacity: 0 }}
        className="fixed top-0 left-0 right-0 z-[60] bg-primary text-primary-foreground px-3 py-2 flex items-center gap-2 shadow-lg pointer-events-auto"
      >
        <Gamepad2 className="w-3.5 h-3.5 flex-shrink-0" />
        <CharacterAvatar character={activeCharacter} size="sm" />
        <span className="text-xs font-semibold flex-1 truncate min-w-0">Playing as {activeCharacter.name}</span>

        {/* Media Grid */}
        <button
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowMediaGallery(true); }}
          onTouchStart={(e) => { e.stopPropagation(); setShowMediaGallery(true); }}
          className="p-2.5 rounded-full active:bg-primary-foreground/30 hover:bg-primary-foreground/20 transition-colors flex-shrink-0 cursor-pointer pointer-events-auto touch-none"
          title="Media from characters"
        >
          <Images className="w-4 h-4" />
        </button>

        {/* World Contacts — speaks as active character */}
        <button
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowWorldContacts(true); }}
          onTouchStart={(e) => { e.stopPropagation(); setShowWorldContacts(true); }}
          className="p-2.5 rounded-full active:bg-primary-foreground/30 hover:bg-primary-foreground/20 transition-colors flex-shrink-0 cursor-pointer pointer-events-auto touch-none"
          title="Speak to NPCs as this character"
        >
          <Globe className="w-4 h-4" />
        </button>

        {/* Narrative Tool */}
        <button
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowNarrative(true); }}
          onTouchStart={(e) => { e.stopPropagation(); setShowNarrative(true); }}
          className="p-2.5 rounded-full active:bg-primary-foreground/30 hover:bg-primary-foreground/20 transition-colors flex-shrink-0 cursor-pointer pointer-events-auto touch-none"
          title="Narrative tool"
        >
          <BookOpen className="w-4 h-4" />
        </button>

        {/* Troubleshooting */}
        <button
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setShowTroubleshooting(true); }}
          onTouchStart={(e) => { e.stopPropagation(); setShowTroubleshooting(true); }}
          className="p-2.5 rounded-full active:bg-primary-foreground/30 hover:bg-primary-foreground/20 transition-colors flex-shrink-0 cursor-pointer pointer-events-auto touch-none"
          title="Troubleshooting"
        >
          <Wrench className="w-4 h-4" />
        </button>

        {/* Settings */}
        <button
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = '/settings'; }}
          onTouchStart={(e) => { e.stopPropagation(); window.location.href = '/settings'; }}
          className="p-2.5 rounded-full active:bg-primary-foreground/30 hover:bg-primary-foreground/20 transition-colors flex-shrink-0 cursor-pointer pointer-events-auto touch-none"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Stop playing */}
        <button
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setActiveCharacter(null); }}
          onTouchStart={(e) => { e.stopPropagation(); setActiveCharacter(null); }}
          className="p-2.5 rounded-full active:bg-primary-foreground/30 hover:bg-primary-foreground/20 transition-colors flex-shrink-0 cursor-pointer pointer-events-auto touch-none"
          title="Stop playing as character"
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>

      <GlobalMediaGallery isOpen={showMediaGallery} onClose={() => setShowMediaGallery(false)} activeCharacterId={activeCharacter?.id} />

      {/* WorldContactsPopup — uses activeCharacter so NPCs respond as if talking to them */}
      <WorldContactsPopup
        isOpen={showWorldContacts}
        onClose={() => setShowWorldContacts(false)}
        character={activeCharacter}
      />

      <NarrativeBuilderPopup
        isOpen={showNarrative}
        onClose={() => setShowNarrative(false)}
        characterId={activeCharacter.id}
        conversationId={activeConversationId}
        chatHistory={[]}
        onNarrativeSubmitted={() => {}}
      />

      <TroubleshootingPanelHome
        isOpen={showTroubleshooting}
        onClose={() => setShowTroubleshooting(false)}
      />
    </>
  );
}