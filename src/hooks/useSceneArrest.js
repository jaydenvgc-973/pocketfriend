import { pickCustodyFacility } from "@/lib/sceneCrimeOutcome";

/**
 * useSceneArrest — who can be taken into custody from this scene, and the one custody
 * pathway the strip and the modal already used. Extracted from Scene.jsx unchanged.
 */
export function useSceneArrest({ base44, queryClient, currentUser, locationsData, setMessages, setArrestPicker, setArrestTransition }) {
  const arrestTargets = (targets = []) => targets
    .filter((p) => p?.id && !p.isNpc && !String(p.id).startsWith("npc_") && p.id !== currentUser?.id)
    .map((p) => ({ id: p.id, name: p.name || p.display_name, avatar_url: p.avatar_url }));

  const handleArrest = async (person) => {
    setArrestPicker(null);
    const facility = pickCustodyFacility(locationsData);
    if (!person?.id || !facility?.id) return;
    const res = await base44.functions.invoke('arrestCharacter', { character_id: person.id, facility_id: facility.id, offense: 'Arrest', notes: 'Taken into custody from the scene.' });
    const data = res?.data || {};
    if (!data?.success || data.skipped) { setMessages((prev) => [...prev, { id: `arrest_err_${Date.now()}`, sender: "narrative", content: `${person.name || "They"} could not be taken into custody.`, timestamp: new Date().toISOString() }]); return; }
    // The arrest is an established event of this scene, so it is part of what the scene
    // records — not something that only exists in the transition modal.
    setMessages((prev) => [...prev, { id: `arrest_${Date.now()}`, sender: "narrative", content: `${person.name || "They"} is taken into custody and led away.`, timestamp: new Date().toISOString() }]);
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
    setArrestTransition({ character: person, facility: { ...facility, name: data.facility_name || facility.name }, unitId: data.unit_id || null, unitName: data.unit_name || null });
  };

  return { arrestTargets, handleArrest };
}