import { NarrativeBuilderPopup } from "@/components/chat/NarrativeBuilderPopup";
import { WorldContactsPopup } from "@/components/chat/WorldContactsPopup";
import { TroubleshootingPanel } from "@/components/chat/TroubleshootingPanel";
import { DeleteMemoryChoiceModal } from "@/components/chat/DeleteMemoryChoiceModal";
import { ForwardMessageModal } from "@/components/chat/ForwardMessageModal";
import { ApprovalPopup } from "@/components/approvals/ApprovalPopup";
import { BirthApprovalPopup } from "@/components/approvals/BirthApprovalPopup";
import { PendingLifeEventApproval } from "@/components/approvals/PendingLifeEventApproval";
import { LocationAliasResolutionPopup } from "@/components/location/LocationAliasResolutionPopup";
import { NewPersonDetectedModal } from "@/components/chat/NewPersonDetectedModal";
import { SendMoneyModal } from "@/components/chat/SendMoneyModal";

export function ChatModals({
  showNarrativeBuilder,
  setShowNarrativeBuilder,
  characterId,
  conversationId,
  messages,
  queryClient,
  showWorldContacts,
  setShowWorldContacts,
  character,
  showTroubleshooting,
  setShowTroubleshooting,
  deleteTarget,
  setDeleteTarget,
  handleDeleteRemember,
  handleDeleteForget,
  forwardTarget,
  setForwardTarget,
  pendingApproval,
  approveEvent,
  dismissApproval,
  pendingAliasResolution,
  setPendingAliasResolution,
  newPeopleDetected,
  setNewPeopleDetected,
  showSendMoney,
  setShowSendMoney,
  isSendingMoney,
  setIsSendingMoney,
  userSettings,
  characterFinancial,
  currentUser,
}) {
  return (
    <>
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
        characterId={characterId}
        conversationId={conversationId}
        onRemember={handleDeleteRemember}
        onForget={handleDeleteForget}
        onCancel={() => setDeleteTarget(null)}
      />
      {forwardTarget && (
        <ForwardMessageModal
          message={forwardTarget}
          onClose={() => setForwardTarget(null)}
        />
      )}

      {pendingApproval?.type === 'move_in' && (
        <ApprovalPopup type="move_in" title="Moving In Together?" description={`It looks like ${pendingApproval.data.character?.name} may be moving in${pendingApproval.data.otherCharName ? ` with ${pendingApproval.data.otherCharName}` : ' with someone'}. Approve this household change?`} details={pendingApproval.data} onApprove={approveEvent} onDeny={dismissApproval}>
          <p><span className="text-muted-foreground">Character:</span> {pendingApproval.data.character?.name}</p>
          {pendingApproval.data.otherCharName && <p><span className="text-muted-foreground">Moving in with:</span> {pendingApproval.data.otherCharName}</p>}
        </ApprovalPopup>
      )}

      {pendingApproval?.type === 'marriage' && (
        <ApprovalPopup
          type="marriage"
          title="Marriage Event Detected"
          description={`It looks like ${pendingApproval.data.character?.name} may be getting married${pendingApproval.data.otherCharName ? ` to ${pendingApproval.data.otherCharName}` : ''}. Approve this?`}
          details={pendingApproval.data}
          onApprove={approveEvent}
          onDeny={dismissApproval}
        >
          <p><span className="text-muted-foreground">Character:</span> {pendingApproval.data.character?.name}</p>
          {pendingApproval.data.otherCharName && <p><span className="text-muted-foreground">Partner:</span> {pendingApproval.data.otherCharName}</p>}
        </ApprovalPopup>
      )}

      {pendingApproval?.type === 'birth' && (
        <BirthApprovalPopup
          parentCharacter={pendingApproval.data.character}
          otherParentName={pendingApproval.data.otherParentName}
          onApprove={approveEvent}
          onDeny={dismissApproval}
        />
      )}

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

      {showSendMoney && character && (
        <SendMoneyModal
          character={character}
          userBalance={userSettings.user_balance ?? 0}
          isSending={isSendingMoney}
          onClose={() => setShowSendMoney(false)}
          onSend={async (amount, reason, direction) => {
            setIsSendingMoney(true);
            try {
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
          characterBalance={characterFinancial?.current_balance ?? 0}
        />
      )}
    </>
  );
}