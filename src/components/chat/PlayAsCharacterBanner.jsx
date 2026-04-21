import { useState, useEffect } from "react";
import { useActiveCharacter } from "@/lib/ActiveCharacterContext";
import { motion } from "framer-motion";
import { X, Gamepad2 } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import { Link } from "react-router-dom";
import GlobalMediaGallery from "@/components/chat/GlobalMediaGallery";
import NarrativeBuilderPopup from "@/components/chat/NarrativeBuilderPopup";
import WorldContactsPopup from "@/components/chat/WorldContactsPopup";
import TroubleshootingPanelHome from "@/components/home/TroubleshootingPanelHome";
import ChatActionsMenu from "@/components/chat/ChatActionsMenu";
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
        className="fixed top-0 left-0 right-0 z-[9999] bg-primary text-primary-foreground px-3 py-2 flex items-center gap-2 shadow-lg pointer-events-auto"
      >
        <Gamepad2 className="w-3.5 h-3.5 flex-shrink-0" />
        <CharacterAvatar character={activeCharacter} size="sm" />
        <span className="text-xs font-semibold flex-1 truncate min-w-0">Playing as {activeCharacter.name}</span>

        <ChatActionsMenu
          visible={{
            media: true,
            game: false,
            narrative: !!activeConversationId,
            contacts: (activeCharacter.fictional_relationships || []).length > 0,
            story: true,
            money: false,
            shopping: false,
            troubleshoot: !!activeConversationId,
          }}
          onSelect={(id) => {
            if (id === "media") setShowMediaGallery(true);
            if (id === "contacts") setShowWorldContacts(true);
            if (id === "story") setShowNarrative(true);
            if (id === "troubleshoot") setShowTroubleshooting(true);
          }}
        />

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