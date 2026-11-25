import ForwardMessageModal from "@/components/chat/ForwardMessageModal";
import ShareNarrativeModal from "@/components/chat/ShareNarrativeModal";

/**
 * ChatShareModals
 *
 * The two ways a message leaves its own thread:
 *  - Forward, which relays the message as a forwarded copy,
 *  - Share narrative, which delivers a narrative into other chats as a narrative.
 *
 * Purely a pass-through of the chat page's own selection state.
 */
export default function ChatShareModals({
  forwardTarget,
  onCloseForward,
  chatType,
  shareTarget,
  onCloseShare,
  isPhone,
}) {
  return (
    <>
      {forwardTarget && (
        <ForwardMessageModal
          message={forwardTarget}
          chatType={chatType}
          onClose={onCloseForward}
        />
      )}
      {shareTarget && (
        <ShareNarrativeModal
          message={shareTarget}
          channel={isPhone ? "phone" : "direct"}
          onClose={onCloseShare}
        />
      )}
    </>
  );
}