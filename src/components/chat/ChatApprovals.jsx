import ApprovalPopup from "@/components/approvals/ApprovalPopup";
import BirthApprovalPopup from "@/components/approvals/BirthApprovalPopup";
import HouseholdChangeApprovalPopup from "@/components/approvals/HouseholdChangeApprovalPopup";

/**
 * ChatApprovals
 *
 * Renders all approval popup modals for life events detected in chat.
 * Extracted from pages/Chat to reduce page size.
 * Preserves all approval types, copy, and button behavior.
 */
export default function ChatApprovals({ pendingApproval, approveEvent, dismissApproval, character }) {
  if (!pendingApproval) return null;

  return (
    <>
      {(pendingApproval.type === 'move_in' || pendingApproval.type === 'move_out') && pendingApproval.data.householdAnalysis && (
        <HouseholdChangeApprovalPopup
          analysis={pendingApproval.data.householdAnalysis}
          character={pendingApproval.data.character}
          onApprove={approveEvent}
          onDeny={dismissApproval}
        />
      )}

      {pendingApproval.type === 'marriage' && (
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

      {pendingApproval.type === 'birth' && (
        <BirthApprovalPopup
          parentCharacter={pendingApproval.data.character}
          otherParentName={pendingApproval.data.otherParentName}
          onApprove={approveEvent}
          onDeny={dismissApproval}
        />
      )}

      {pendingApproval.type === 'education' && (
        <ApprovalPopup
          type="education"
          title="Education Detail Detected"
          description={`${pendingApproval.data.character?.name} mentioned an education detail. Add this to their profile?`}
          details={pendingApproval.data}
          detectedItem={pendingApproval.data.detail}
          sourceSentence={pendingApproval.data.sentence}
          onApprove={approveEvent}
          onDeny={dismissApproval}
          onIgnoreType={() => dismissApproval()}
        >
          <p><span className="text-muted-foreground">Status:</span> {pendingApproval.data.status === 'completed' ? 'Past / Completed' : pendingApproval.data.status === 'ongoing' ? 'Current / Ongoing' : 'Future / Planned'}</p>
        </ApprovalPopup>
      )}

      {pendingApproval.type === 'background_detail' && (
        <ApprovalPopup
          type="background_detail"
          title="Background Detail Detected"
          description={`${pendingApproval.data.character?.name} revealed a background detail. Add this to their profile?`}
          details={pendingApproval.data}
          detectedItem={pendingApproval.data.detail}
          sourceSentence={pendingApproval.data.sentence}
          onApprove={approveEvent}
          onDeny={dismissApproval}
          onIgnoreType={() => dismissApproval()}
        >
          <p><span className="text-muted-foreground">Category:</span> {pendingApproval.data.label}</p>
        </ApprovalPopup>
      )}
    </>
  );
}