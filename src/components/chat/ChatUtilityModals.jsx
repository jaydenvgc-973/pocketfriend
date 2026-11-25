import NarrativeBuilderPopup from "@/components/chat/NarrativeBuilderPopup";
import WorldContactsPopup from "@/components/chat/WorldContactsPopup";
import TroubleshootingPanel from "@/components/chat/TroubleshootingPanel";

/**
 * ChatUtilityModals
 *
 * The three side tools of the chat shell, grouped so the page itself stays
 * focused on the conversation: writing a narrative, browsing world contacts,
 * and the troubleshooting panel. Purely a pass-through of the page's own state.
 */
export default function ChatUtilityModals({
  showNarrativeBuilder,
  onCloseNarrativeBuilder,
  characterId,
  conversationId,
  chatHistory,
  currentUser,
  userSettings,
  onNarrativeSubmitted,
  showWorldContacts,
  onCloseWorldContacts,
  character,
  showTroubleshooting,
  onCloseTroubleshooting,
}) {
  return (
    <>
      <NarrativeBuilderPopup
        isOpen={showNarrativeBuilder}
        onClose={onCloseNarrativeBuilder}
        characterId={characterId}
        conversationId={conversationId}
        chatHistory={chatHistory}
        currentUser={currentUser}
        userSettings={userSettings}
        onNarrativeSubmitted={onNarrativeSubmitted}
      />
      <WorldContactsPopup
        isOpen={showWorldContacts}
        onClose={onCloseWorldContacts}
        character={character}
      />
      <TroubleshootingPanel
        isOpen={showTroubleshooting}
        onClose={onCloseTroubleshooting}
        conversationId={conversationId}
        characterId={characterId}
      />
    </>
  );
}