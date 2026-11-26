/**
 * sceneNextScene.js — what a confirmed Next Scene (or a confirmed ride) actually does.
 *
 * It moves only the chosen people, through the app's existing presence call, records the
 * scene being left, and opens the destination scene. A ride is the same transition taken
 * inside a vehicle, so the destination scene is told which car it opened in and whose.
 */
export async function runNextSceneTransition(payload, deps) {
  const { destination, zoneName, unitId, environmentId, spaceLabel, travelerIds, mode } = payload || {};
  const { base44, queryClient, currentUser, observeMode, nextSceneParticipants, setMessages, navigate, completeScene } = deps;
  if (!destination?.id) return;
  // A chosen workspace or on-site residence is a space of this same property: the
  // property stays the destination, and the space is what the scene opens in.
  const placeName = spaceLabel || destination.name;
  const travelers = nextSceneParticipants.filter((p) => (travelerIds || []).includes(p.id));
  const moving = mode === "watch" ? [] : travelers;
  // Each chosen person moves through the same teleportation call the app already
  // uses to place a character at a location. Whoever it refuses stays exactly where
  // they are — and is never shown in the new scene as if they had traveled.
  const results = await Promise.all(moving.map(async (p) => {
    try {
      const res = await base44.functions.invoke('updateCharacterLocation', { characterId: p.id, locationId: destination.id, locationName: destination.name, presenceStatus: 'visiting', locationType: 'visit', sourceReason: 'next_scene' });
      const data = res?.data || res;
      return { ...p, moved: data?.success !== false };
    } catch {
      return { ...p, moved: false };
    }
  }));
  const arrived = results.filter((r) => r.moved);
  const refused = results.filter((r) => !r.moved);
  if (moving.length > 0 && arrived.length === 0) {
    setMessages((prev) => [...prev, { id: `next_scene_err_${Date.now()}`, sender: "narrative", content: `Nobody could get to ${placeName}. The scene stays here.`, timestamp: new Date().toISOString() }]);
    return;
  }
  queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
  const refusedNote = refused.length > 0 ? ` ${refused.map((r) => r.name).join(", ")} ${refused.length === 1 ? "stays" : "stay"} behind.` : "";
  // Sending them ahead from a scene you are in leaves you here — nobody moves you.
  if (mode === "send" && !observeMode) {
    if (moving.length > 0) setMessages((prev) => [...prev, { id: `next_scene_${Date.now()}`, sender: "narrative", content: `${arrived.map((t) => t.name).join(", ")} head to ${placeName}.${refusedNote}`, timestamp: new Date().toISOString() }]);
    return;
  }
  // The scene being left is recorded before the next one begins.
  completeScene(placeName);
  const params = new URLSearchParams({ locationId: destination.id });
  const ids = arrived.map((t) => t.id).join(",");
  if (ids) params.set("characterIds", ids);
  if (zoneName) params.set("zoneName", zoneName);
  if (unitId) params.set("unitId", unitId);
  // The residence environment is carried so its own access rules apply — a property's
  // business hours never close the living space inside it.
  if (environmentId) params.set("environmentId", environmentId);
  if (observeMode || mode === "watch") params.set("observe", "1");
  // Marks this as a scene of its own even when it happens to share the same place and
  // cast — a confirmed transition always starts the destination scene.
  params.set("started", String(Date.now()));
  navigate(`/scene?${params.toString()}`);
}