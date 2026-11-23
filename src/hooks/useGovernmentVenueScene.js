import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import {
  getGovernmentVenueType,
  resolveCourtParticipants,
  buildCourtCaseContext,
  buildCityHallContext,
  cityHallPurposeLabel,
  courtCaseTypeLabel,
} from "@/lib/governmentVenues";

/**
 * useGovernmentVenueScene — the City Hall / Courthouse layer of the Scenes page.
 *
 * It establishes what a government visit is (setup), keeps the case or purpose in
 * front of the narrative, and opens the confirmation flows for the two official
 * consequences. It owns no records itself: marriage goes through commitMarriage,
 * a sentence through applyJudicialSentence.
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
}) {
  const [showVenueSetup, setShowVenueSetup] = useState(false);
  const [cityHallPlan, setCityHallPlan] = useState(null);
  const [courtCase, setCourtCase] = useState(null);
  const [marriageModal, setMarriageModal] = useState(null);
  const [judicialModal, setJudicialModal] = useState(null);
  const promptedRef = useRef(null);
  const marriedRef = useRef(new Set());

  const governmentVenueType = getGovernmentVenueType(location);
  const storageKey = locationId ? `gov_scene_${locationId}` : null;

  // Returning to an already active proceeding restores its established context rather
  // than starting a different case or re-opening the setup.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.courtCase) { setCourtCase(saved.courtCase); promptedRef.current = locationId; }
      else if (saved?.cityHallPlan) { setCityHallPlan(saved.cityHallPlan); promptedRef.current = locationId; }
    } catch { /* no stored context */ }
  }, [storageKey]);

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

  const beginVisit = (config) => {
    if (!location) return;
    if (config.venue === "courthouse") {
      const resolved = resolveCourtParticipants(config, characters);
      const nextCase = { ...config, case_id: `${location.id}_${Date.now()}`, assignments: resolved.assignments, temp_npcs: resolved.tempNpcs };
      setCourtCase(nextCase);
      setCityHallPlan(null);
      try { if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify({ courtCase: nextCase })); } catch { /* session only */ }
      const roleLine = resolved.assignments.map((a) => `${a.roleLabel}: ${a.name}`).join(" · ");
      addNarrative(`${courtCaseTypeLabel(config.case_type)} at ${location.name}. ${config.description}${roleLine ? ` — ${roleLine}` : ""}.`);
      return;
    }
    const names = (ids = []) => ids.map((id) => characters.find((c) => c.id === id)?.name).filter(Boolean);
    const plan = {
      ...config,
      marriage: config.marriage ? {
        ...config.marriage,
        spouse_a_name: characters.find((c) => c.id === config.marriage.spouse_a_id)?.name || null,
        spouse_b_name: characters.find((c) => c.id === config.marriage.spouse_b_id)?.name || null,
        witness_names: names(config.marriage.witness_ids),
      } : null,
    };
    setCityHallPlan(plan);
    setCourtCase(null);
    try { if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify({ cityHallPlan: plan })); } catch { /* session only */ }
    addNarrative(`City Hall — ${cityHallPurposeLabel(plan.purpose)}${plan.marriage?.spouse_a_name ? `: ${plan.marriage.spouse_a_name} and ${plan.marriage.spouse_b_name}` : ""}.`);
  };

  /** The temporary people of the court for roles the user left unassigned. */
  const courtTempNpcs = (config) => resolveCourtParticipants(config, characters).tempNpcs;

  // The ceremony is an event that actually takes place in the scene. Only then is the
  // marriage recorded, through the same pipeline every other marriage uses.
  const performMarriageCeremony = async (plan) => {
    const aName = characters.find((c) => c.id === plan.spouse_a_id)?.name;
    const bName = characters.find((c) => c.id === plan.spouse_b_id)?.name;
    if (!aName || !bName) return;
    const pairKey = [plan.spouse_a_id, plan.spouse_b_id].sort().join(":");
    if (marriedRef.current.has(pairKey)) {
      addNarrative(`${aName} and ${bName} are already married.`);
      return;
    }
    const witnessNames = (plan.witness_ids || []).map((id) => characters.find((c) => c.id === id)?.name).filter(Boolean);
    const ceremony = `A civil marriage ceremony is held at ${location.name}. ${aName} and ${bName} are married${witnessNames.length > 0 ? `, with ${witnessNames.join(" and ")} as witnesses` : ", with no witnesses present"}.`;
    if (observeMode) {
      if (observeCast.length >= 2) await runObserveBeat({ direction: ceremony });
      else addNarrative(ceremony);
    } else {
      await sendMessage(`[💍 Civil marriage ceremony — ${aName} and ${bName}]`, true);
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
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
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
    performMarriageCeremony,
    handleGovernmentAction,
    handleJudicialResolved,
    addGovernmentNarrative: addNarrative,
    courtTempNpcs,
  };
}