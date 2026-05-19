/**
 * pages/Text.jsx
 *
 * Thin wrapper that mounts the shared Chat communication shell in phone/text mode.
 *
 * Route:  /text/:characterId
 * Mode:   phone
 * Channel: text
 * Conversation type: "phone"
 *
 * This wrapper passes chatTypeOverride="phone" to the Chat shell so it always
 * enters phone mode regardless of URL search params, giving Text its own stable
 * route identity independent of ?type= query params.
 *
 * Mount isolation: TextChannelMount in App.jsx supplies key={characterId:phone}
 * so this page is always a distinct React instance from /chat/:characterId.
 */
import Chat from "./Chat";

export default function Text({ chatTypeOverride }) {
  return <Chat chatTypeOverride={chatTypeOverride} />;
}