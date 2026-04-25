import ChatHeader from "./ChatHeader";

/**
 * Wrapper to ensure setMessages is passed to ChatHeader for Right Now functionality
 */
export default function ChatHeaderWrapper({
  character,
  characterId,
  isPhone,
  conversationId,
  onMediaGalleryToggle,
  onGameLauncherToggle,
  onNarrativeActionToggle,
  onWorldContactsToggle,
  onNarrativeBuilderToggle,
  onSendMoneyToggle,
  onShoppingToggle,
  onTroubleshootingToggle,
  setMessages,
}) {
  return (
    <ChatHeader
      character={character}
      characterId={characterId}
      isPhone={isPhone}
      conversationId={conversationId}
      onMediaGalleryToggle={onMediaGalleryToggle}
      onGameLauncherToggle={onGameLauncherToggle}
      onNarrativeActionToggle={onNarrativeActionToggle}
      onWorldContactsToggle={onWorldContactsToggle}
      onNarrativeBuilderToggle={onNarrativeBuilderToggle}
      onSendMoneyToggle={onSendMoneyToggle}
      onShoppingToggle={onShoppingToggle}
      onTroubleshootingToggle={onTroubleshootingToggle}
      setMessages={setMessages}
    />
  );
}