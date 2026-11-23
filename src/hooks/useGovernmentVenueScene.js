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
  // The participants whose attendance this session established. Kept in a ref so the
  // release runs from wherever the event ends — including leaving the page.
  const attendanceRef = useRef([]);
  const placedForRef = useRef(null);

  const governmentVenueType = getGovernmentVenueType(location);
  const storageKey = locationId ? `gov_scene_${locationId}` : null;

  const persist = (payload) => {
    try { if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify(payload)); } catch { /* session only */ }
  };

  const nameOf = (id) => characters.find((c) => c.id === id)?.name || null;

  // Returning to an already active proceeding restores its established context and puts
  // its participants back in the room, rather than starting a different case.
  useEffect(() => {
    if (!storageKey || !location?.id) return;
    let saved = null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch { /* no stored context */ }
    if (!saved) return;
    const restored = saved.courtCase || saved.cityHallPlan || null;
    if (!restored) return;
    if (saved.courtCase) setCourtCase(saved.courtCase);
    else setCityHallPlan(saved.cityHallPlan);
    promptedRef.current = locationId;

    const ids = restored.attendance_ids || [];
    if (ids.length === 0) return;
    const eventKey = `${location.id}:${restored.case_id || 'plan'}`;
    if (placedForRef.current === eventKey) return;
    placedForRef.current = eventKey;
    attendanceRef.current = ids;
    placeEventAttendees({ location, characterIds: ids, ownerEmail: currentUser?.email })
      .then(() => queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] }))
      .catch(() => {});
  }, [storageKey, location?.id]);

  // A new visit asks what it is for — once, before the scene begins.
  useEffect(() => {
    if (!location?.id || !governmentVenueType) return;
    if (promptedRef.current === location.id) return;
    promptedRef.current = location.id;
    setShowVenueSetup(true);
  }, [location?.id, governmentVenueType]);

  const addNarrative = (content) => setMessages((prev) => [...prev, {
    id: `gov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sender: "narrative",
    content,
    timestamp: new Date().toISOString(),
  }]);

  const governmentContextBlock = courtCase
    ? buildCourtCaseContext(courtCase, { userPresent: !observeMode, userName: displayName })
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

    if (config.venue === "courthouse") {
      const selected = courtAttendanceIds(config);
      const { attendingIds, refused } = await placeEventAttendees({
        location, characterIds: selected, ownerEmail: currentUser?.email,
      });
      const resolved = resolveCourtParticipants(config, characters, { attendingIds });
      const nextCase = {
        ...config,
        case_id: `${location.id}_${Date.now()}`,
        assignments: resolved.assignments,
        temp_npcs: resolved.tempNpcs,
        attendance_ids: resolved.attendanceIds,
        refused_attendance: refused.map((r) => ({ characterId: r.id, name: nameOf(r.id), reason: r.reason })),
      };
      attendanceRef.current = nextCase.attendance_ids;
      placedForRef.current = `${location.id}:${nextCase.case_id}`;
      setCourtCase(nextCase);
      setCityHallPlan(null);
      persist({ courtCase: nextCase });
      const roleLine = resolved.assignments.map((a) => `${a.roleLabel}: ${a.name}`).join(" · ");
      addNarrative(`${courtCaseTypeLabel(config.case_type)} at ${location.name}. ${config.description}${roleLine ? ` — ${roleLine}` : ""}.`);
      const missing = refusedLine(refused);
      if (missing) addNarrative(missing);
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
      return { attendanceIds: nextCase.attendance_ids, tempNpcs: resolved.tempNpcs };
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
      location, characterIds: selected, ownerEmail: currentUser?.email,
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
    await releaseEventAttendees({ characterIds: ids, ownerEmail: currentUser.email });
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
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

  const handleJudicialResolved = (data) => {
    if (!data) return;
    addNarrative(data.incarceration
      ? `${data.character_name} is sentenced to ${data.incarceration.sentence_label} at ${data.incarceration.facility_name}.`
      : `${data.character_name}'s sentence has been recorded in their criminal history.`);
    addNarrative("The proceeding is concluded — everyone not held in custody is free to go.");
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
    // Sentencing and custody were already applied by the existing judicial system; the
    // event attendance itself ends here.
    releaseAttendance();
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
    handleGovernmentAction,
    handleJudicialResolved,
    addGovernmentNarrative: addNarrative,
  };
}