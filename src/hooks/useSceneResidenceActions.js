import { base44 } from '@/api/base44Client';

/**
 * useSceneResidenceActions — the three residence actions the Scenes page already performed
 * (move in, move out, ask to leave). Moved out of the page unchanged so it stays readable;
 * the same calls, the same records, the same messages.
 */
export default function useSceneResidenceActions({
  location,
  broughtCharacters = [],
  setMessages,
  queryClient,
  currentUser,
  setShowMoveInPopup,
  setIsMoveInLoading,
}) {
  const handleMoveIn = async ({ moversToMove, npcMovers = [], newHomeName, destinationUnitId = null }) => {
    if (!location) return; setIsMoveInLoading(true);
    try {
      const res = await base44.functions.invoke("moveCharactersToNewHome", {
        sourceHomeId: broughtCharacters[0]?.current_home_location_id || null,
        destinationHomeId: location.id,
        moversToMove,
        npcMovers,
        newHomeName,
        destinationUnitId,
      });
      const failures = (res?.data?.per_character_results || []).filter(r => r.status === 'failed');
      setShowMoveInPopup(false);
      queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
      if (res?.data?.success === false && failures.length > 0) {
        // A refused move is reported plainly — the character did not move.
        setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: failures.map(f => f.error).filter(Boolean).join(" ") || "That move could not be completed.", timestamp: new Date().toISOString() }]);
      } else {
        setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `Move-in complete. ${newHomeName || location.name} is now home.`, timestamp: new Date().toISOString() }]);
      }
    } catch (err) { console.error("Move-in failed:", err); } finally { setIsMoveInLoading(false); }
  };

  const handleMoveOut = async () => {
    if (!location || broughtCharacters.length === 0) return; const mover = broughtCharacters[0];
    try { await base44.entities.Character.update(mover.id, { current_home_location_id: "" }); queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }); setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: `${mover.name} has moved out of ${location.name}.`, timestamp: new Date().toISOString() }]); } catch (err) { console.error("Move-out failed:", err); }
  };

  const handleAskToLeave = (type, narrativeText) => { setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "narrative", content: narrativeText || `You ask the ${type} to leave.`, timestamp: new Date().toISOString() }]); };

  return { handleMoveIn, handleMoveOut, handleAskToLeave };
}