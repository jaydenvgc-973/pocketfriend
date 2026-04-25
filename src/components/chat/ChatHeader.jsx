import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import ChatActionsMenu from "@/components/chat/ChatActionsMenu";
import BackfillNarrativesWrapper from "@/components/chat/BackfillNarrativesWrapper";
import { useRightNow } from "@/components/chat/RightNowButton";

export default function ChatHeader({
  character,
  characterId,
  isPhone,
  conversationId,
  showMediaGallery,
  showGameLauncher,
  showNarrativeAction,
  showWorldContacts,
  showNarrativeBuilder,
  showSendMoney,
  showTroubleshooting,
  onMediaGalleryToggle,
  onGameLauncherToggle,
  onNarrativeActionToggle,
  onWorldContactsToggle,
  onNarrativeBuilderToggle,
  onSendMoneyToggle,
  onTroubleshootingToggle,
  onShoppingToggle,
  onRightNowToggle,
  setMessages,
}) {
  // Right Now — manual trigger of the automatic narrative engine
  // Falls back to prop if provided (Chat page can override), else handles internally
  const { handleRightNow } = useRightNow({ character, characterId, conversationId, setMessages });
  return (
    <>
      <BackfillNarrativesWrapper conversationId={conversationId} characterId={characterId} character={character} />
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 pointer-events-auto">
      <Link to="/home" className="text-muted-foreground hover:text-foreground transition-colors pointer-events-auto cursor-pointer">
        <ArrowLeft className="w-5 h-5" />
      </Link>
      <Link to={`/profile/${characterId}`}>
        {character && <CharacterAvatar character={character} size="sm" />}
      </Link>
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold text-foreground truncate">{character?.name || "Loading..."}</h2>
        <p className="text-xs text-muted-foreground">{isPhone ? "Texting" : "Talking"}</p>
      </div>
      <ChatActionsMenu
        visible={{
          media: !!character,
          game: !!character && !isPhone,
          narrative: !!character && !!conversationId,
          contacts: !!character && (character.fictional_relationships || []).length > 0,
          story: !!character,
          money: !!character,
          shopping: !!character,
          troubleshoot: !!character && !!conversationId,
          right_now: !!character && !!conversationId,
        }}
        onSelect={(id) => {
          if (id === "media") onMediaGalleryToggle();
          if (id === "game") onGameLauncherToggle();
          if (id === "narrative") onNarrativeActionToggle();
          if (id === "contacts") onWorldContactsToggle();
          if (id === "story") onNarrativeBuilderToggle();
          if (id === "money") onSendMoneyToggle();
          if (id === "shopping") onShoppingToggle();
          if (id === "troubleshoot") onTroubleshootingToggle();
          if (id === "right_now") (onRightNowToggle || handleRightNow)();
        }}
      />
      </div>
    </>
  );
}