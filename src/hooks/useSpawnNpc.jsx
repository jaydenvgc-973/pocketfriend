import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import TemporaryNpcModal from "@/components/scene/TemporaryNpcModal";

/**
 * useSpawnNpc — Spawn NPC for the scene activity strip.
 *
 * One person walks into the scene the user is in. They are created through the app's
 * existing NPC creation (createNPCCharacter, spawn_mode: 'scene'), so they have their own
 * name, avatar, personality and character record — and they join this scene as an
 * ordinary visitor with a 24-hour lifespan until the user makes them permanent.
 *
 * Selecting Spawn NPC opens the informational modal and starts the spawn; Close only
 * dismisses the explanation.
 */
export default function useSpawnNpc({
  location,
  activeZone,
  sceneParticipants,
  setExtraNpcs,
  setMessages,
  queryClient,
  currentUser,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [npcName, setNpcName] = useState(null);
  const [error, setError] = useState(null);

  const spawnNpc = async () => {
    if (!location?.id || status === "spawning") return;
    setIsOpen(true);
    setStatus("spawning");
    setError(null);
    setNpcName(null);
    try {
      const res = await base44.functions.invoke("createNPCCharacter", {
        spawn_mode: "scene",
        location_id: location.id,
        location_name: location.name,
        zone_name: activeZone || null,
        scene_context: `${location.name}${activeZone ? ` — ${activeZone}` : ""}`,
        existing_names: (sceneParticipants || []).map((p) => p.name).filter(Boolean),
      });
      const npc = res?.data?.npc;
      if (!npc?.id) throw new Error(res?.data?.error || "No NPC was created");

      setExtraNpcs((prev) => (prev.find((n) => n.id === npc.id) ? prev : [...prev, npc]));
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        sender: "narrative",
        content: `${npc.name} walks into ${location.name}.`,
        timestamp: new Date().toISOString(),
      }]);
      setNpcName(npc.name);
      setStatus("ready");

      queryClient.invalidateQueries({ queryKey: ["npcCharacters", currentUser?.id] });
      queryClient.invalidateQueries({ queryKey: ["npcFictitiousRls", currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ["npc-characters", currentUser?.id] });
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    } catch (err) {
      setStatus("error");
      setError(err?.response?.data?.error || err?.message);
    }
  };

  const spawnNpcModal = (
    <TemporaryNpcModal
      isOpen={isOpen}
      status={status}
      npcName={npcName}
      error={error}
      onClose={() => setIsOpen(false)}
    />
  );

  return { spawnNpc, spawnNpcModal };
}