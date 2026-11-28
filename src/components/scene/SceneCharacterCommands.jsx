import { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import SceneTargetPicker from "@/components/scene/SceneTargetPicker";

/**
 * A character who is asleep is present but not conversational: sleeping, napping or
 * passed out. `isCharacterAsleep` is the app's existing sleep state — this only names it
 * in one place so the scene, the Who's Here row and the commands agree.
 */
export const isSleepingCharacter = (c) =>
  ["sleeping", "napping", "passed_out"].includes(c?.resolved_presence_status);

/**
 * The workplace a person already has. Their own established employment decides it — a
 * scene never picks an employer for them. Multiple jobs keep the order the character
 * record already holds.
 */
export const resolveCommandWorkplace = (person, locationMap) => {
  const primary = person?.occupation_location_id
    ? {
        id: person.occupation_location_id,
        name: person.occupation_location_name || locationMap?.[person.occupation_location_id]?.name || "work",
      }
    : null;
  const others = (Array.isArray(person?.additional_occupation_locations) ? person.additional_occupation_locations : [])
    .filter((job) => job?.location_id)
    .map((job) => ({
      id: job.location_id,
      name: job.location_name || locationMap?.[job.location_id]?.name || "work",
    }));
  return primary || others[0] || null;
};

/**
 * SceneCharacterCommands — Go to Sleep, Wake Up, Go Home, Go to Work.
 *
 * Each command asks WHO through the same selector every activity in the strip uses, then
 * runs the existing authoritative functionality for exactly the people chosen: the
 * established user-directed sleep/wake path, the sole canonical presence writer, and the
 * workplace that person already has. Nobody is moved by being listed, nobody who was not
 * chosen is affected, and a refused request is reported plainly rather than shown as a
 * success. The scene re-reads who is actually here through its existing participant
 * synchronization once the request has been answered.
 */
export default function SceneCharacterCommands({ command, onClose, candidates = [], locationMap, currentUser, setMessages, queryClient }) {
  const people = useMemo(
    () => (candidates || []).filter((p) => p?.id && !p.isUser && p.id !== currentUser?.id),
    [candidates.map((p) => p.id).join(","), currentUser?.id]
  );

  const config = useMemo(() => {
    if (!command) return null;
    if (command === "sleep") {
      // Someone already asleep is not offered again: their sleep is never restarted and
      // their recovery is never doubled by choosing the command a second time.
      return { label: "Go to Sleep", emoji: "😴", heading: "Go to Sleep — who?", hint: "Who is going to sleep now.", targets: people.filter((p) => !isSleepingCharacter(p)), unavailable: null, confirmLabel: "Go to Sleep" };
    }
    if (command === "wake") {
      return { label: "Wake Up", emoji: "☀️", heading: "Wake Up — who?", hint: "Who is waking up now.", targets: people.filter((p) => isSleepingCharacter(p)), unavailable: null, confirmLabel: "Wake Up" };
    }
    if (command === "home") {
      return { label: "Go Home", emoji: "🏠", heading: "Go Home — who?", hint: "Who is going home now.", targets: people, unavailable: null, confirmLabel: "Go Home" };
    }
    // Go to Work — someone with no employment stays listed with the reason.
    const unavailable = {};
    for (const person of people) {
      if (!resolveCommandWorkplace(person, locationMap)) unavailable[person.id] = "No assigned employment";
    }
    return { label: "Go to Work", emoji: "💼", heading: "Go to Work — who?", hint: "Who is going to work now.", targets: people, unavailable, confirmLabel: "Go to Work" };
  }, [command, people, locationMap]);

  const run = async (chosen) => {
    const type = command;
    onClose?.();
    const picked = (chosen || []).filter((p) => p?.id);
    if (!type || picked.length === 0) return;
    const lines = [];

    for (const person of picked) {
      try {
        if (type === "sleep" || type === "wake") {
          const asleep = isSleepingCharacter(person);
          if (type === "sleep" && asleep) { lines.push(`${person.name} is already asleep.`); continue; }
          if (type === "wake" && !asleep) { lines.push(`${person.name} is already awake.`); continue; }
          // The same user-directed sleep and nap the app already offers — six hours of
          // sleep, two hours of nap — committed by the same presence authority.
          const res = await base44.functions.invoke("scheduleNap", type === "sleep"
            ? { characterId: person.id, napStartTime: new Date().toISOString(), napDurationMinutes: 360, sleepMode: true }
            : { characterId: person.id, action: "wake", sleepMode: person.resolved_presence_status === "sleeping" });
          const data = res?.data || {};
          if (data.success === false) {
            lines.push(`${person.name} could not ${type === "sleep" ? "fall asleep" : "wake up"}${data.reason ? ` (${String(data.reason).replace(/_/g, " ")})` : ""}.`);
          } else {
            lines.push(type === "sleep" ? `${person.name} goes to sleep.` : `${person.name} wakes up.`);
          }
        } else if (type === "home") {
          const res = await base44.functions.invoke("enforceCharacterLocationPresence", {
            character_id: person.id,
            owner_email: currentUser?.email,
            requested_presence_status: "home",
            requested_source_reason: "user_directed_go_home",
            requested_authority: "SceneActivity",
          });
          const data = res?.data || {};
          lines.push(["accepted", "no_change"].includes(data.disposition)
            ? `${person.name} heads home.`
            : `${person.name} cannot go home right now${data.reason ? ` (${String(data.reason).replace(/_/g, " ")})` : ""}.`);
        } else if (type === "work") {
          const workplace = resolveCommandWorkplace(person, locationMap);
          if (!workplace) { lines.push(`${person.name} has no assigned employment.`); continue; }
          const res = await base44.functions.invoke("enforceCharacterLocationPresence", {
            character_id: person.id,
            owner_email: currentUser?.email,
            requested_presence_status: "at_work",
            requested_location_id: workplace.id,
            requested_source_reason: "user_directed_go_to_work",
            requested_authority: "SceneActivity",
          });
          const data = res?.data || {};
          lines.push(["accepted", "no_change"].includes(data.disposition)
            ? `${person.name} heads to work.`
            : `${person.name} cannot go to work right now${data.reason ? ` (${String(data.reason).replace(/_/g, " ")})` : ""}.`);
        }
      } catch (err) {
        lines.push(`${person.name} could not be moved (${err?.message || "unknown error"}).`);
      }
    }

    if (lines.length) {
      setMessages?.((prev) => [...prev, { id: `cmd_${Date.now()}`, sender: "narrative", content: lines.join(" "), timestamp: new Date().toISOString() }]);
    }
    // Existing participant synchronization re-reads who is actually here: whoever left is
    // no longer present.
    queryClient?.invalidateQueries({ queryKey: ["characters"] });
    queryClient?.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    queryClient?.invalidateQueries({ queryKey: ["activeCharacters"] });
  };

  if (!config) return null;

  return (
    <SceneTargetPicker
      action={{ label: config.label, emoji: config.emoji }}
      targets={config.targets}
      heading={config.heading}
      hint={config.hint}
      multiple
      unavailable={config.unavailable}
      confirmLabel={config.confirmLabel}
      onConfirm={run}
      onClose={() => onClose?.()}
    />
  );
}