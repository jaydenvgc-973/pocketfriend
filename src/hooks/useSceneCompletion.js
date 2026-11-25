/**
 * useSceneCompletion
 *
 * The scene's single completion: the Life Journal entry and the exit memory that the
 * people who actually took part keep. Extracted unchanged from Scene.jsx so every exit
 * path — Leave Together, Leave Them Here, Stay Here, and moving on to another scene —
 * writes it exactly once, through the same existing generators.
 */
import { useRef, useEffect } from "react";
import { writeSceneExitMemories } from "@/lib/sceneExitMemory";
import { writeSceneLifeEvents } from "@/lib/sceneLifeJournal";

export function useSceneCompletion({
  broughtCharacters = [],
  selectedNpcIdList = [],
  selectedNpcs = [],
  observeCast = [],
  observeMode = false,
  sceneCharacters = [],
  location,
  messages = [],
  displayName,
  ownerEmail,
  presenceWindows = null,
}) {
  // Only the people who were actually taking part keep a memory of the scene: a character
  // the user deselected is not a participant, so the exit is not written for them.
  const exitMemoryArgs = (outcome, destinationName = null) => ({
    broughtCharacters: broughtCharacters.filter((c) => selectedNpcIdList.includes(c.id)),
    alreadyPresentChars: selectedNpcs,
    allSceneChars: sceneCharacters,
    location,
    messages,
    userDisplayName: displayName,
    ownerEmail,
    outcome,
    destinationName,
    userPresent: !observeMode,
  });

  // Scene journal: what the people here actually lived through belongs in their Life
  // Journal. Written once per scene — whether it ends through the leave modal or by
  // leaving the page — for everyone who was really taking part.
  const journalArgsRef = useRef(null);
  const journalDoneRef = useRef(false);
  journalArgsRef.current = {
    participants: observeMode
      ? observeCast
      : [...selectedNpcs, ...broughtCharacters.filter((c) => selectedNpcIdList.includes(c.id))],
    location,
    messages,
    userDisplayName: displayName,
    ownerEmail,
    // Each person's own part of the scene, so nobody remembers what they did not witness.
    presenceWindows,
    // Watching means the account holder is not in the scene: their journal entry must not
    // place them there or describe anything as their instruction.
    userPresent: !observeMode,
  };

  const writeJournal = (outcome) => {
    if (journalDoneRef.current || !journalArgsRef.current) return Promise.resolve();
    journalDoneRef.current = true;
    return writeSceneLifeEvents({ ...journalArgsRef.current, outcome });
  };

  // Moving the scene on is the scene ending: the one being left is completed through the
  // same process the leave paths use, once, before the next scene begins. The guard above
  // is the scene's single completion, so a transition can never journal it twice.
  const completeBeforeTransition = (destinationName = null) => {
    if (journalDoneRef.current) return;
    writeJournal("moved_on");
    writeSceneExitMemories(exitMemoryArgs("moved_on", destinationName));
  };

  useEffect(() => () => { writeJournal(null); }, []);

  return { exitMemoryArgs, writeJournal, completeBeforeTransition };
}