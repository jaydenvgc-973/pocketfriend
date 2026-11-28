import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import {
  getGovernmentVenueType,
  resolveCourtParticipants,
  buildCourtCaseContext,
  buildCityHallContext,
  cityHallPurposeLabel,
  courtCaseTypeLabel,
  courtAttendanceIds,
  cityHallAttendanceIds,
  cityHallOfficiantNpc,
} from "@/lib/governmentVenues";
import { placeEventAttendees, releaseEventAttendees, attendanceRefusalLabel } from "@/lib/governmentAttendance";
import { courtParticipationMode, isRemoteRefusal, actualLocationName } from "@/lib/courtParticipation";
import { recordGovernmentEventMemories, easternDateLabel } from "@/lib/governmentEventMemory";
import { getActiveSceneSpaceId } from "@/lib/activeSceneSpace";
import { getWorkplaceById } from "@/lib/locationWorkspaces";
import { getUnitById } from "@/lib/residentialUnits";

// What each person's own part in a proceeding was. Their memory is written from this,
// never from another participant's private knowledge.
const COURT_ROLE_EXPERIENCE = {
  judge: "You presided over the case.",
  defendant: "You were the defendant in this case.",
  plaintiff: "You were the plaintiff/complainant.",
  prosecutor: "You prosecuted the case.",
  defense_attorney: "You represented the defendant.",
  plaintiff_attorney: "You represented the plaintiff.",
  witnesses: "You were called to give testimony.",
  jurors: "You sat on the jury.",
};

/**
 * Everyone with a character record who took part, each with their own part in it.
 * `experienceFor(assignment)` states that person's part; a remote participant always
 * remembers that they took part remotely, not from inside the room.
 */
function courtMemoryParticipants(court, experienceFor) {
  return (court?.assignments || [])
    .filter((a) => a.characterId)
    .map((a) => {
      const part = experienceFor
        ? experienceFor(a)
        : (COURT_ROLE_EXPERIENCE[a.roleKey] || `You took part as ${a.roleLabel}.`);
      const remote = a.remote
        ? ` You took part remotely from ${a.remote_location_name || "your own location"}.`
        : "";
      return { id: a.characterId, name: a.name, experience: `${part}${remote}` };
    });
}

/**
 * useGovernmentVenueScene — the City Hall / Courthouse layer of the Scenes page.
 *
 * It establishes what a government visit is (setup), brings the selected participants
 * physically to the venue through the existing presence authority, keeps the case or
 * purpose in front of the narrative, and opens the confirmation flows for the two
 * official consequences. It owns no records of its own: marriage goes through
 * commitMarriage, a sentence through applyJudicialSentence, and attendance through
 * enforceCharacterLocationPresence.
 *
 * The setup is the preparation stage: by the time the scene is shown, the app already
 * knows who is participating, what role each holds, and who is actually in the room.
 */
export default function useGovernmentVenueScene({
  location,
  locationId,
  characters,
  observeMode,
  observeCast,
  displayName,
  currentUser,
  queryClient,
  setMessages,
  sendMessage,
  runObserveBeat,
  onEventConcluded,
}) {
  const [showVenueSetup, setShowVenueSetup] = useState(false);
  const [cityHallPlan, setCityHallPlan] = useState(null);
  const [courtCase, setCourtCase] = useState(null);
  const [marriageModal, setMarriageModal] = useState(null);
  const [judicialModal, setJudicialModal] = useState(null);
  const promptedRef = useRef(null);
  const marriedRef = useRef(new Set());
  // The proceeding that has already been concluded, so a second Adjourn Court click does
  // not narrate the end twice.
  const concludedRef = useRef(null);
  const adjournedRef = useRef(false);
  // The participants whose attendance this session established. Kept in a ref so the
  // release runs from wherever the event ends — including leaving the page.
  const attendanceRef = useRef([]);
  const placedForRef = useRef(null);

  // The destination actually on screen: the residence or workplace selected inside the
  // property, when there is one. It — not the property that merely contains it — decides
  // whether this is a courthouse or City Hall. Published by the Scenes page on the same
  // render, before this runs.
  const destinationSpaceId = getActiveSceneSpaceId();
  const destinationSpace = destinationSpaceId
    ? (getWorkplaceById(location, destinationSpaceId) || getUnitById(location, destinationSpaceId))
    : null;
  const governmentVenueType = getGovernmentVenueType(location, destinationSpace);
  // The destination itself — the venue and the space inside it that is on screen. Moving
  // from an apartment to the courthouse within the same property is a new arrival at a
  // new destination; changing zones inside one venue is not.
  const destinationKey = locationId ? `${locationId}|${destinationSpaceId || ''}` : null;
  const storageKey = destinationKey ? `gov_scene_${destinationKey}` : null;

  const persist = (payload) => {
    try { if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify(payload)); } catch { /* session only */ }
  };

  const nameOf = (id) => characters.find((c) => c.id === id)?.name || null;

  // Every arrival at City Hall or the Courthouse begins with the setup. It is what selects
  // the people meant to be there and places them, so a context left over from an earlier
  // visit is never carried into this one — it could otherwise stand in for the setup and
  // keep the modal from ever appearing.
  useEffect(() => {
    if (!storageKey) return;
    try { sessionStorage.removeItem(storageKey); } catch { /* session only */ }
  }, [storageKey]);

  // A new visit asks what it is for — once per arrival. The arrival is the destination
  // actually selected, so entering the courthouse from an apartment in the same property
  // asks again, while dismissing the setup and staying there never reopens it.
  useEffect(() => {
    if (!destinationKey) return;
    // Anywhere that is not a government venue releases the arrival, so coming back to the
    // courthouse or City Hall later is a new visit and asks again.
    if (!governmentVenueType) { promptedRef.current = null; return; }
    if (promptedRef.current === destinationKey) return;
    promptedRef.current = destinationKey;
    setShowVenueSetup(true);
  }, [destinationKey, governmentVenueType]);

  // These lines are events the room has already lived through, so they stay canon:
  // every later continuation builds on them instead of discovering them again.
  const addNarrative = (content) => setMessages((prev) => [...prev, {
    id: `gov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sender: "narrative",
    content,
    is_canon_event: true,
    timestamp: new Date().toISOString(),
  }]);

  const governmentContextBlock = courtCase
    ? buildCourtCaseContext(courtCase, { userPresent: !observeMode, userName: displayName, venueName: location?.name })
    : cityHallPlan
      ? buildCityHallContext(cityHallPlan, { userPresent: !observeMode, userName: displayName })
      : "";

  const refusedLine = (refused = []) => refused
    .map((r) => attendanceRefusalLabel(r.reason, nameOf(r.id)))
    .join(" ");

  /**
   * The setup is the preparation stage. Attendance is established here, through the
   * existing presence authority, so the scene opens with the participant roster already
   * in place — nobody has to be re-selected once it loads.
   */
  const beginVisit = async (config) => {
    if (!location) return null;
    adjournedRef.current = false;

    if (config.venue === "courthouse") {
      const selected = courtAttendanceIds(config);
      // Who can actually be brought into the room. A hospitalized or incarcerated person
      // stays exactly where they are — their treatment, custody and sentence are never
      // altered by the court — and takes part remotely in the role they were given.
      const remote = new Map();
      const toPlace = selected.filter((id) => {
        const c = characters.find((x) => x.id === id);
        if (courtParticipationMode(c) === "physical") return true;
        remote.set(id, { location_name: actualLocationName(c) });
        return false;
      });
      const { attendingIds, refused } = await placeEventAttendees({
        location, characterIds: toPlace, ownerEmail: currentUser?.email, characters,
      });
      // If the presence authority keeps someone where they are, that is custody or care,
      // not absence: they keep their role and appear remotely instead of being dropped.
      const unavailableRefusals = [];
      refused.forEach((r) => {
        if (isRemoteRefusal(r.reason)) remote.set(r.id, { location_name: actualLocationName(characters.find((c) => c.id === r.id)) });
        else unavailableRefusals.push(r);
      });
      const resolved = resolveCourtParticipants(config, characters, { attendingIds, remoteById: remote });
      const remoteParticipants = resolved.assignments
        .filter((a) => a.remote)
        .map((a) => ({
          id: a.characterId,
          name: a.name,
          roleLabel: a.roleLabel,
          locationName: a.remote_location_name,
          avatar_url: characters.find((c) => c.id === a.characterId)?.avatar_url || null,
        }));
      const nextCase = {
        ...config,
        case_id: `${location.id}_${Date.now()}`,
        assignments: resolved.assignments,
        temp_npcs: resolved.tempNpcs,
        attendance_ids: resolved.attendanceIds,
        refused_attendance: unavailableRefusals.map((r) => ({ characterId: r.id, name: nameOf(r.id), reason: r.reason })),
      };
      // Only the people actually placed at the venue hold this event's presence lock.
      attendanceRef.current = attendingIds;
      placedForRef.current = `${location.id}:${nextCase.case_id}`;
      setCourtCase(nextCase);
      setCityHallPlan(null);
      persist({ courtCase: nextCase });
      const roleLine = resolved.assignments.map((a) => `${a.roleLabel}: ${a.name}`).join(" · ");
      addNarrative(`${courtCaseTypeLabel(config.case_type)} at ${location.name}. ${config.description}${roleLine ? ` — ${roleLine}` : ""}.`);
      if (remoteParticipants.length > 0) {
        const who = remoteParticipants.map((p) => `${p.name} (${p.roleLabel}, from ${p.locationName})`);
        addNarrative(`${who.join(" and ")} ${who.length === 1 ? "is" : "are"} taking part remotely. Their location, treatment and custody are unchanged.`);
      }
      const missing = refusedLine(unavailableRefusals);
      if (missing) addNarrative(missing);
      // Being part of this proceeding becomes part of each participant's own history,
      // written from the role they actually hold. Nobody who could not attend is written.
      await recordGovernmentEventMemories({
        key: nextCase.case_id,
        title: `${courtCaseTypeLabel(config.case_type)} at ${location.name}`,
        summary: `A ${courtCaseTypeLabel(config.case_type).toLowerCase()} proceeding was held at ${location.name} on ${easternDateLabel()}. The case: ${config.description}`,
        participants: courtMemoryParticipants(nextCase),
        location,
        ownerEmail: currentUser?.email,
      });
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
      return { attendanceIds: nextCase.attendance_ids, tempNpcs: resolved.tempNpcs, remoteParticipants };
    }

    const names = (ids = []) => ids.map((id) => nameOf(id)).filter(Boolean);
    const plan = {
      ...config,
      marriage: config.marriage ? {
        ...config.marriage,
        spouse_a_name: nameOf(config.marriage.spouse_a_id),
        spouse_b_name: nameOf(config.marriage.spouse_b_id),
        witness_names: names(config.marriage.witness_ids),
      } : null,
    };
    const selected = cityHallAttendanceIds(plan);
    const { attendingIds, refused } = await placeEventAttendees({
      location, characterIds: selected, ownerEmail: currentUser?.email, characters,
    });
    const officiant = cityHallOfficiantNpc(plan);
    const attendingSet = new Set(attendingIds);
    const nextPlan = {
      ...plan,
      // Only witnesses who are actually in the room are witnesses of this ceremony.
      marriage: plan.marriage ? {
        ...plan.marriage,
        witness_ids: (plan.marriage.witness_ids || []).filter((id) => attendingSet.has(id)),
        witness_names: names((plan.marriage.witness_ids || []).filter((id) => attendingSet.has(id))),
      } : null,
      plan_id: `${location.id}_${Date.now()}`,
      attendance_ids: attendingIds,
      officiant_npc: officiant,
      refused_attendance: refused.map((r) => ({ characterId: r.id, name: nameOf(r.id), reason: r.reason })),
    };
    attendanceRef.current = attendingIds;
    placedForRef.current = `${location.id}:plan`;
    setCityHallPlan(nextPlan);
    setCourtCase(null);
    persist({ cityHallPlan: nextPlan });
    addNarrative(`City Hall — ${cityHallPurposeLabel(plan.purpose)}${plan.marriage?.spouse_a_name ? `: ${plan.marriage.spouse_a_name} and ${plan.marriage.spouse_b_name}` : ""}.`);
    const missing = refusedLine(refused);
    if (missing) addNarrative(missing);
    // Coming here for this purpose is part of each attendee's own day. A marriage is
    // remembered as the ceremony itself once it actually takes place — never before.
    const purposeLabel = cityHallPurposeLabel(plan.purpose);
    const wedding = nextPlan.marriage;
    await recordGovernmentEventMemories({
      key: nextPlan.plan_id,
      title: `City Hall — ${purposeLabel}`,
      summary: `${purposeLabel} at ${location.name} on ${easternDateLabel()}.`,
      participants: attendingIds.map((id) => ({
        id,
        name: nameOf(id),
        experience: wedding && (id === wedding.spouse_a_id || id === wedding.spouse_b_id)
          ? `You came to ${location.name} for your civil marriage ceremony with ${id === wedding.spouse_a_id ? wedding.spouse_b_name : wedding.spouse_a_name}.`
          : wedding && (wedding.witness_ids || []).includes(id)
            ? `You came to ${location.name} as a witness to the civil marriage of ${wedding.spouse_a_name} and ${wedding.spouse_b_name}.`
            : `You were at ${location.name} for ${String(purposeLabel).toLowerCase()}.`,
      })),
      location,
      ownerEmail: currentUser?.email,
    });
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    return { attendanceIds: attendingIds, tempNpcs: officiant ? [officiant] : [] };
  };

  /**
   * The event is over: the participants' temporary event assignment ends. Their own
   * schedule, needs and home decide what happens next — nothing is anchored here and
   * nothing about the case, the ceremony or its records is undone.
   */
  const releaseAttendance = async () => {
    const ids = attendanceRef.current || [];
    attendanceRef.current = [];
    placedForRef.current = null;
    onEventConcluded?.();
    if (ids.length === 0 || !currentUser?.email) return;
    await releaseEventAttendees({ characterIds: ids, ownerEmail: currentUser.email, characters });
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
  };

  /**
   * The event is over. The participants are released to their own schedules through the
   * existing release, the court's temporary people leave, and the case stops being the
   * active proceeding. Everything already narrated, and any official outcome, is untouched.
   */
  const concludeProceeding = async (closingLine = null) => {
    const key = courtCase?.case_id || cityHallPlan?.purpose || 'event';
    if (concludedRef.current === key) return;
    concludedRef.current = key;
    if (closingLine) addNarrative(closingLine);
    setCourtCase(null);
    setCityHallPlan(null);
    try { if (storageKey) sessionStorage.removeItem(storageKey); } catch { /* session only */ }
    await releaseAttendance();
  };

  /**
   * Adjourn Court ends this proceeding. The adjournment is played out through the existing
   * scene pathways first, so the people in the room react to it, and only then does the
   * event end.
   */
  const adjournCourt = async () => {
    if (adjournedRef.current) return;
    adjournedRef.current = true;
    const line = `Court is adjourned — the proceeding at ${location?.name} is concluded.`;
    if (observeMode) {
      if ((observeCast || []).length >= 2) await runObserveBeat({ direction: line });
      else addNarrative(line);
    } else {
      await sendMessage(`[🚪 Adjourn Court]`, true);
    }
    await concludeProceeding('Everyone not held in custody is free to go.');
  };

  /**
   * The marriage is official: the record and the participants' own memories say the
   * same thing. Both spouses remember marrying each other, the witnesses remember
   * witnessing it, and anyone else who attended remembers the ceremony.
   * `data` is what commitMarriage returned — the marriage that was actually recorded.
   */
  const recordMarriageMemories = async (data) => {
    const spouses = (data?.spouses || []).filter((s) => s?.id && s?.name);
    if (spouses.length !== 2) return;
    const [a, b] = spouses;
    const witnessIds = (data?.witness_ids || []).filter(Boolean);
    const witnessNames = witnessIds.map((id) => nameOf(id)).filter(Boolean);
    const venueName = data?.location_name || location?.name;
    const witnessLine = witnessNames.length > 0 ? `, with ${witnessNames.join(" and ")} as witnesses` : "";
    const others = (cityHallPlan?.attendance_ids || [])
      .filter((id) => id !== a.id && id !== b.id && !witnessIds.includes(id));

    await recordGovernmentEventMemories({
      key: `${cityHallPlan?.plan_id || location?.id}_marriage`,
      title: `Marriage ceremony at ${venueName}`,
      summary: `${a.name} and ${b.name} were married in a civil ceremony at ${venueName} on ${easternDateLabel()}${witnessLine}.`,
      participants: [
        { id: a.id, name: a.name, experience: `You married ${b.name}${witnessLine}. You and ${b.name} are married.` },
        { id: b.id, name: b.name, experience: `You married ${a.name}${witnessLine}. You and ${a.name} are married.` },
        ...witnessIds.map((id) => ({ id, name: nameOf(id), experience: `You witnessed the civil marriage of ${a.name} and ${b.name}.` })),
        ...others.map((id) => ({ id, name: nameOf(id), experience: `You attended the civil marriage ceremony of ${a.name} and ${b.name}.` })),
      ],
      location: location ? { id: location.id, name: venueName } : null,
      ownerEmail: currentUser?.email,
    });
  };

  // The ceremony is an event that actually takes place in the scene. Only then is the
  // marriage recorded, through the same pipeline every other marriage uses.
  const performMarriageCeremony = async (plan) => {
    const aName = nameOf(plan.spouse_a_id);
    const bName = nameOf(plan.spouse_b_id);
    if (!aName || !bName) return;
    const pairKey = [plan.spouse_a_id, plan.spouse_b_id].sort().join(":");
    if (marriedRef.current.has(pairKey)) {
      addNarrative(`${aName} and ${bName} are already married.`);
      return;
    }
    // A ceremony needs both people in the room. Attendance was settled at setup; if the
    // presence authority could not bring one of them, the ceremony does not pretend.
    const attending = new Set(cityHallPlan?.attendance_ids || []);
    if (attending.size > 0 && (!attending.has(plan.spouse_a_id) || !attending.has(plan.spouse_b_id))) {
      const absent = !attending.has(plan.spouse_a_id) ? aName : bName;
      addNarrative(`The ceremony cannot go ahead — ${absent} is not at City Hall.`);
      return;
    }
    const witnessNames = (plan.witness_ids || []).map((id) => nameOf(id)).filter(Boolean);
    const ceremony = `A marriage ceremony is held at ${location.name}. ${aName} and ${bName} are married${witnessNames.length > 0 ? `, with ${witnessNames.join(" and ")} as witnesses` : ", with no witnesses present"}.`;
    if (observeMode) {
      if (observeCast.length >= 2) await runObserveBeat({ direction: ceremony });
      else addNarrative(ceremony);
    } else {
      await sendMessage(`[💍 Marriage ceremony — ${aName} and ${bName}]`, true);
    }
    marriedRef.current.add(pairKey);
    try {
      const res = await base44.functions.invoke("commitMarriage", {
        spouse_a_id: plan.spouse_a_id,
        spouse_b_id: plan.spouse_b_id,
        witness_ids: plan.witness_ids || [],
        location_name: location.name,
        ceremony_type: "civil",
      });
      if (res?.data?.error) throw new Error(res.data.error);
      addNarrative(`${aName} and ${bName} are now married.`);
      // The marriage that was just recorded is what they remember — the couple, the
      // witnesses and everyone who attended the ceremony.
      await recordMarriageMemories(res.data);
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
      addNarrative("The ceremony is over — everyone is free to return to their day.");
      await releaseAttendance();
    } catch (err) {
      marriedRef.current.delete(pairKey);
      addNarrative(`The ceremony took place, but the marriage could not be recorded: ${err?.message || "unknown error"}.`);
    }
  };

  // Choosing a consequence action is what opens its confirmation. Merely being in the
  // building never marries or sentences anyone.
  const handleGovernmentAction = (action) => {
    if (action.id === "court_adjourn") { adjournCourt(); return; }
    if (action.id === "gov_marry") {
      const planned = cityHallPlan?.marriage;
      if (planned?.spouse_a_id && planned?.spouse_b_id) { performMarriageCeremony(planned); return; }
      setMarriageModal({ spouseIds: [], witnessIds: [], locationName: location?.name });
      return;
    }
    if (action.id === "gov_sentence") {
      setJudicialModal({ mode: "sentencing", defendantId: courtCase?.roles?.defendant || "", offense: "" });
      return;
    }
    if (action.id === "gov_contempt") {
      setJudicialModal({ mode: "contempt", defendantId: "", offense: "" });
    }
  };

  const handleJudicialResolved = async (data) => {
    if (!data) return;
    addNarrative(data.incarceration
      ? `${data.character_name} is sentenced to ${data.incarceration.sentence_label} at ${data.incarceration.facility_name}.`
      : `${data.character_name}'s sentence has been recorded in their criminal history.`);
    // The confirmed outcome becomes part of what everyone in the proceeding knows. It is
    // stated exactly as the judicial system recorded it — never upgraded into a
    // conviction that was not recorded, and never softened.
    const historyLine = String(data.criminal_record || "")
      .split("\n").map((l) => l.trim()).filter(Boolean).pop();
    const outcomeText = data.incarceration
      ? `${data.character_name} was sentenced to ${data.incarceration.sentence_label} at ${data.incarceration.facility_name}.`
      : (historyLine || `${data.character_name}'s sentence was recorded in their criminal history.`);
    await recordGovernmentEventMemories({
      key: `${courtCase?.case_id || location?.id}_outcome_${data.character_id || data.character_name}`,
      title: `Court outcome — ${data.character_name}`,
      summary: `${outcomeText}${historyLine && historyLine !== outcomeText ? ` The court's record: ${historyLine}` : ""}`,
      participants: courtMemoryParticipants(courtCase, (a) => {
        if (a.roleKey === "defendant") return `The outcome applies to you: ${outcomeText}`;
        if (a.remote) return "You took part in this proceeding remotely and heard the outcome given.";
        if (a.roleKey === "judge") return "You presided over this proceeding and delivered the ruling.";
        if (a.roleKey === "jurors") return "You sat on the jury and heard this outcome delivered in the courtroom.";
        if (a.roleKey === "witnesses") return "You testified in this proceeding and were present when the outcome was delivered.";
        if (["prosecutor", "defense_attorney", "plaintiff_attorney"].includes(a.roleKey)) return "You appeared as counsel and were present when the outcome was delivered.";
        return "You were present when the outcome was delivered.";
      }),
      location,
      ownerEmail: currentUser?.email,
    });
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
    // Sentencing and custody were already applied by the existing judicial system; the
    // event itself ends here and everyone else resumes their own day.
    concludeProceeding("The proceeding is concluded — everyone not held in custody is free to go.");
  };

  /**
   * A ruling played out rather than recorded (a contempt warning, removal from the
   * courtroom) is still something the room experienced, so it becomes memory too —
   * for the person it was directed at and for everyone who heard it delivered.
   */
  const handleJudicialNarrative = async (payload) => {
    if (!payload?.text) return;
    addNarrative(payload.text);
    await recordGovernmentEventMemories({
      key: `${courtCase?.case_id || location?.id}_ruling_${payload.characterId || "court"}_${payload.outcome || "ruling"}`,
      title: `Court ruling — ${courtCaseTypeLabel(courtCase?.case_type || "criminal")}`,
      summary: `${payload.text} This ruling was delivered at ${location?.name}.`,
      participants: courtMemoryParticipants(courtCase, (a) => {
        if (a.characterId === payload.characterId) return "This ruling was directed at you.";
        if (a.remote) return "You took part in this proceeding remotely and heard the ruling.";
        if (a.roleKey === "judge") return "You presided over this proceeding and delivered the ruling.";
        return "You were present in the courtroom when the ruling was delivered.";
      }),
      location,
      ownerEmail: currentUser?.email,
    });
  };

  return {
    governmentVenueType,
    showVenueSetup,
    setShowVenueSetup,
    cityHallPlan,
    courtCase,
    marriageModal,
    setMarriageModal,
    judicialModal,
    setJudicialModal,
    governmentContextBlock,
    beginVisit,
    releaseAttendance,
    performMarriageCeremony,
    recordMarriageMemories,
    handleGovernmentAction,
    handleJudicialResolved,
    handleJudicialNarrative,
    addGovernmentNarrative: addNarrative,
  };
}