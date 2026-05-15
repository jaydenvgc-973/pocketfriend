import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useForegroundTask } from "@/hooks/useForegroundTask";
import { FOREGROUND_TASKS } from "@/lib/foregroundPriority";
import ChatHeader from "./ChatHeader";
import MediaGallery from "./MediaGallery";
import NarrativeActionButton from "./NarrativeActionButton";
import GameLauncher from "@/components/games/GameLauncher";
import ShoppingApp from "./ShoppingApp";
import SendMoneyModal from "./SendMoneyModal";
import ChatMessageList from "./ChatMessageList";
import DialogueSelector from "./DialogueSelector";
import ChatInput from "./ChatInput";
import NarrativeBuilderPopup from "./NarrativeBuilderPopup";
import WorldContactsPopup from "./WorldContactsPopup";
import TroubleshootingPanel from "./TroubleshootingPanel";
import DeleteMemoryChoiceModal from "./DeleteMemoryChoiceModal";
import ForwardMessageModal from "./ForwardMessageModal";
import BottomNav from "@/components/BottomNav";
import ChatApprovals from "@/components/chat/ChatApprovals";
import PendingLifeEventApproval from "@/components/approvals/PendingLifeEventApproval";
import LocationAliasResolutionPopup from "@/components/location/LocationAliasResolutionPopup";
import NewPersonDetectedModal from "./NewPersonDetectedModal.jsx";

export default function ChatPageLayout({
  character,
  characterId,
  isPhone,
  conversationId,
  showMediaGallery,
  setShowMediaGallery,
  showGameLauncher,
  setShowGameLauncher,
  showNarrativeAction,
  setShowNarrativeAction,
  showWorldContacts,
  setShowWorldContacts,
  showNarrativeBuilder,
  setShowNarrativeBuilder,
  showSendMoney,
  setShowSendMoney,
  isSendingMoney,
  setIsSendingMoney,
  showShopping,
  setShowShopping,
  showTroubleshooting,
  setShowTroubleshooting,
  messages,
  setMessages,
  conversationIdRef,
  deleteTarget,
  setDeleteTarget,
  forwardTarget,
  setForwardTarget,
  newPeopleDetected,
  setNewPeopleDetected,
  pendingAliasResolution,
  setPendingAliasResolution,
  isTyping,
  sendError,
  setSendError,
  playingAudioId,
  voiceErrors,
  bottomRef,
  character_Financial,
  currentUser,
  userSettings,
  queryClient,
  activeCharacter,
  onHousingChangeToggle,
  pendingApproval,
  approveEvent,
  dismissApproval,
  handleReact,
  handleDeleteMessage,
  handleDeleteRemember,
  handleDeleteForget,
  handleNonsenseNarrative,
  handleSleepViolationNarrative,
  isRegeneratingNarrative,
  handleDeleteImage,
  playCharacterVoice,
  sendMessage,
}) {
  // Register chat as a foreground task so all background simulation systems yield
  useForegroundTask(isPhone ? FOREGROUND_TASKS.CHAT_LOADING : FOREGROUND_TASKS.CHAT_LOADING, !!characterId);

  return (
    <div className={`h-screen flex flex-col bg-background pb-[60px] ${isPhone ? "max-w-lg mx-auto" : ""}`}>
      <ChatHeader
        character={character}
        characterId={characterId}
        isPhone={isPhone}
        conversationId={conversationId}
        onMediaGalleryToggle={() => setShowMediaGallery(true)}
        onGameLauncherToggle={() => setShowGameLauncher(true)}
        onNarrativeActionToggle={() => setShowNarrativeAction(true)}
        onWorldContactsToggle={() => setShowWorldContacts(true)}
        onNarrativeBuilderToggle={() => setShowNarrativeBuilder(true)}
        onSendMoneyToggle={() => setShowSendMoney(true)}
        onShoppingToggle={() => setShowShopping(true)}
        onTroubleshootingToggle={() => setShowTroubleshooting(true)}
        onHousingChangeToggle={onHousingChangeToggle}
        setMessages={setMessages}
      />

      {character && <MediaGallery messages={messages} onDeleteImage={handleDeleteImage} character={character} conversationId={conversationId} onImageGenerated={(newMsg) => setMessages(prev => prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg])} externalTrigger={showMediaGallery} onExternalClose={() => setShowMediaGallery(false)} />}
      {character && conversationId && (
        <NarrativeActionButton
          character={character}
          conversationId={conversationId}
          recentMessages={messages}
          onNarrativeCreated={(msg) => setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])}
          externalTrigger={showNarrativeAction}
          onExternalClose={() => setShowNarrativeAction(false)}
        />
      )}
      {character && !isPhone && (
        <GameLauncher
          character={character}
          conversationId={conversationId}
          onGameEnd={() => queryClient.invalidateQueries({ queryKey: ["character", characterId] })}
          externalTrigger={showGameLauncher}
          onExternalClose={() => setShowGameLauncher(false)}
        />
      )}

      {showShopping && character && (
        <ShoppingApp
          conversationId={conversationId}
          characterId={characterId}
          character={character}
          onClose={() => setShowShopping(false)}
          currentUser={currentUser}
        />
      )}

      {showSendMoney && character && (
        <SendMoneyModal
          character={character}
          userBalance={userSettings.user_balance ?? 0}
          isSending={isSendingMoney}
          onClose={() => setShowSendMoney(false)}
          onSend={async (amount, reason, direction) => {
            setIsSendingMoney(true);
            try {
              const { base44 } = await import("@/api/base44Client");
              await base44.functions.invoke('sendMoneyToCharacter', {
                characterId,
                conversationId,
                amount,
                reason,
                direction,
              });
              setShowSendMoney(false);
              queryClient.invalidateQueries({ queryKey: ['userSettings'] });
              queryClient.invalidateQueries({ queryKey: ['character', characterId] });
            } finally {
              setIsSendingMoney(false);
            }
          }}
          characterBalance={character_Financial?.current_balance ?? 0}
        />
      )}
      <ChatMessageList
        messages={messages}
        conversationId={conversationId}
        characterId={characterId}
        character={character}
        userSettings={userSettings}
        isTyping={isTyping}
        sendError={sendError}
        setSendError={setSendError}
        playingAudioId={playingAudioId}
        voiceErrors={voiceErrors}
        bottomRef={bottomRef}
        onReact={handleReact}
        onDelete={handleDeleteMessage}
        onDeleteImage={handleDeleteImage}
        onPlayVoice={playCharacterVoice}
        onForward={(msg) => setForwardTarget(msg)}
        onImageLoaded={(msgId, url) => setMessages(prev => prev.map(m => m.id === msgId ? { ...m, image_url: url } : m))}
      />
      {activeCharacter && character ? (
        <DialogueSelector
          playingAs={activeCharacter}
          targetCharacter={character}
          recentMessages={messages}
          onSelect={(text) => sendMessage(text, null)}
        />
      ) : (
        <ChatInput onSend={sendMessage} draftKey={characterId} />
      )}
      <NarrativeBuilderPopup
        isOpen={showNarrativeBuilder}
        onClose={() => setShowNarrativeBuilder(false)}
        characterId={characterId}
        conversationId={conversationId}
        chatHistory={messages}
        onNarrativeSubmitted={() => queryClient.invalidateQueries({ queryKey: ["character", characterId] })}
      />
      <WorldContactsPopup
        isOpen={showWorldContacts}
        onClose={() => setShowWorldContacts(false)}
        character={character}
      />
      <TroubleshootingPanel
        isOpen={showTroubleshooting}
        onClose={() => setShowTroubleshooting(false)}
        conversationId={conversationId}
        characterId={characterId}
      />
      <DeleteMemoryChoiceModal
        message={deleteTarget}
        isOpen={!!deleteTarget}
        onRemember={handleDeleteRemember}
        onForget={handleDeleteForget}
        onCancel={() => setDeleteTarget(null)}
        onNonsense={() => { const t = deleteTarget; setDeleteTarget(null); handleNonsenseNarrative(t); }}
        onSleepViolation={() => { const t = deleteTarget; setDeleteTarget(null); handleSleepViolationNarrative(t); }}
        isRegenerating={isRegeneratingNarrative}
      />
      {forwardTarget && (
        <ForwardMessageModal
          message={forwardTarget}
          onClose={() => setForwardTarget(null)}
        />
      )}
      <BottomNav />

      <ChatApprovals
        pendingApproval={pendingApproval}
        approveEvent={approveEvent}
        dismissApproval={dismissApproval}
        character={character}
      />

      {character && <PendingLifeEventApproval characterId={characterId} character={character} />}
      {pendingAliasResolution && (
        <LocationAliasResolutionPopup
          phrase={pendingAliasResolution.phrase}
          characterId={pendingAliasResolution.characterId}
          characterName={pendingAliasResolution.characterName}
          onResolved={() => { setPendingAliasResolution(null); queryClient.invalidateQueries({ queryKey: ["character", characterId] }); }}
          onDismiss={() => setPendingAliasResolution(null)}
        />
      )}
      {newPeopleDetected && character && (
        <NewPersonDetectedModal
          people={newPeopleDetected}
          characterId={characterId}
          characterName={character.name}
          onDone={() => { setNewPeopleDetected(null); queryClient.invalidateQueries({ queryKey: ["character", characterId] }); }}
        />
      )}
    </div>
  );
}