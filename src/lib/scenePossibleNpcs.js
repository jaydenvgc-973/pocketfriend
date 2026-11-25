/**
 * The people a space offers in Who's Here.
 *
 * Pure: it reads the records it is handed and returns the deduplicated candidate list —
 * presence, household, staff, and the venue's own people. Nothing is selected here;
 * selection stays in the Scene page.
 */
export function buildPossibleNpcs({
  location,
  locationId,
  characterIds,
  characters,
  homeResidents,
  vgcDistributedNpcs,
  workerCharacters,
  unifiedPresenceEntities,
  hereNowFromPresence,
  npcsTravelingHere,
  extraNpcs,
  locationUnits,
  isResidentialSpace,
  isRestrictedEnv,
  isAssignedCaregiverHere,
  getUnitForCharacter,
  getUnitLabel,
  getTemporarySceneStaff,
  isNPCOnShift,
  getVenueNpcDefaults,
  isJailOrPrison,
  isIncarceratedCharacter,
  getPresenceAtLocation,
}) {
  const npcs = [];
  if (isResidentialSpace) {
    vgcDistributedNpcs.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push({ id: n.id, name: n.name, role: n.character_type === 'family_npc' ? 'Family' : 'Resident', isNpc: true, npcType: 'resident', avatar_url: n.avatar_url || null, personality_summary: n.personality_summary, emotional_state: n.emotional_state }); });
    homeResidents.forEach((c) => { if (!npcs.find((x) => x.id === c.id) && !characterIds.includes(c.id)) npcs.push({ id: c.id, name: c.name, role: isAssignedCaregiverHere(c) ? 'Caregiver' : 'Resident', isNpc: false, npcType: 'resident', avatar_url: c.avatar_url || null, personality_summary: c.personality_summary, emotional_state: c.emotional_state, unit_name: locationUnits.length > 0 ? getUnitLabel(getUnitForCharacter(location, c.id)?.unit_name, location) || null : null }); });
    (location.resident_family_members || []).forEach((fm) => { if (!fm.name) return; const alreadyAdded = npcs.find((x) => x.name?.trim().toLowerCase() === fm.name.trim().toLowerCase()); if (alreadyAdded) return; const sourceChar = fm.source_character_id ? characters.find((c) => c.id === fm.source_character_id) : homeResidents.find((c) => c.family_members?.some((m) => m.name?.trim().toLowerCase() === fm.name.trim().toLowerCase())); const familyMemberRecord = sourceChar?.family_members?.find((m) => m.name?.trim().toLowerCase() === fm.name.trim().toLowerCase()); npcs.push({ id: `npc_${fm.name.replace(/\s+/g, "_")}`, name: fm.name, role: fm.relationship_type || "Family", isNpc: true, npcType: "resident", avatar_url: familyMemberRecord?.photo_url || null }); });
  }
  if (!isResidentialSpace && location?.owner_is_npc && location?.owner_npc_name) npcs.push({ id: `npc_owner_${location?.id}`, name: location.owner_npc_name, role: location.owner_role || "Owner", isNpc: true, npcType: "staff", avatar_url: null });
  workerCharacters.forEach((w) => { if (npcs.find((x) => x.id === w.id)) return; if (characterIds.includes(w.id)) return; const jobTitle = location.worker_job_titles?.[w.id] || w.work_details?.job_title || "Employee"; npcs.push({ id: w.id, name: w.name, role: jobTitle, isNpc: false, npcType: "staff", avatar_url: w.avatar_url || null, personality_summary: w.personality_summary, archetype: w.archetype, emotional_state: w.emotional_state, resolved_presence_status: w.resolved_presence_status }); });
  const locationWorkerIds = location?.worker_character_ids || [];
  const canonicalLocByIdWorkerLoop = {};
  unifiedPresenceEntities.forEach((e) => { if (e.id) canonicalLocByIdWorkerLoop[e.id] = e.resolved_current_location_id; });
  locationWorkerIds.forEach((wid) => { if (workerCharacters.find((w) => w.id === wid)) return; if (characterIds.includes(wid)) return; const workerChar = characters.find((c) => c.id === wid); if (!workerChar) return; const canonicalLocId = canonicalLocByIdWorkerLoop[wid] || workerChar.resolved_current_location_id; if (canonicalLocId !== locationId) return; const jobTitle = location.worker_job_titles?.[wid] || workerChar.work_details?.job_title || "Employee"; npcs.push({ id: workerChar.id, name: workerChar.name, role: jobTitle, isNpc: false, npcType: "staff", avatar_url: workerChar.avatar_url, personality_summary: workerChar.personality_summary, archetype: workerChar.archetype, emotional_state: workerChar.emotional_state }); });
  if (isResidentialSpace) { hereNowFromPresence.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push(n); }); return npcs.filter((n, i, arr) => arr.findIndex((x) => x.id === n.id) === i); }
  if (!isRestrictedEnv) { const onShiftIdsLocal = workerCharacters.map((w) => w.id); const tempSceneStaff = getTemporarySceneStaff(location, onShiftIdsLocal); tempSceneStaff.forEach((tmpNpc) => { if (!npcs.find((x) => x.id === tmpNpc.id)) npcs.push(tmpNpc); }); }
  if (!isRestrictedEnv) { Object.keys(location?.worker_job_titles || {}).filter((k) => k.startsWith("npc_")).forEach((key) => { if (isNPCOnShift(location, key)) { const npcName = key.replace(/^npc_/, "").replace(/_/g, " "); const jobTitle = location.worker_job_titles[key]; if (!npcs.find((x) => x.id === key)) npcs.push({ id: key, name: npcName, role: jobTitle || "Staff", isNpc: true, npcType: "staff", avatar_url: null }); } }); }
  if (!isRestrictedEnv) {
    // A confined character always has the facility's own population to interact with.
    // Only when another established inmate is already here do they have each other.
    const establishedInmatesHere = getPresenceAtLocation(location, unifiedPresenceEntities)
      .filter((e) => isIncarceratedCharacter(characters.find((c) => c.id === e.id) || e, location))
      .length;
    // A confinement facility is a prison/jail whatever its category says: it keeps the
    // facility's own people (officers, court officer, inmate) instead of a venue's.
    const venueDefaults = getVenueNpcDefaults(location, isJailOrPrison(location));
    venueDefaults.forEach((n) => {
      if (n.npcType === 'inmate' && establishedInmatesHere >= 2) return;
      if (!npcs.find((x) => x.id === n.id)) npcs.push({ ...n, isNpc: true, avatar_url: null });
    });
  }
  if (!isRestrictedEnv) { npcsTravelingHere.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push(n); }); }
  if (!isRestrictedEnv) { vgcDistributedNpcs.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push({ id: n.id, name: n.name, role: n.presence_reason === 'vgc_distribution' || n.presence_reason === 'vgc_rotation' ? 'Visiting' : n.character_type === 'family_npc' ? 'Family' : 'NPC', isNpc: true, npcType: 'customer', avatar_url: n.avatar_url || null, personality_summary: n.personality_summary, emotional_state: n.emotional_state }); }); }
  hereNowFromPresence.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push(n); });
  extraNpcs.forEach((n) => { if (!npcs.find((x) => x.id === n.id)) npcs.push({ ...n, npcType: n.npcType || 'present' }); });
  return npcs.filter((n, i, arr) => arr.findIndex((x) => x.id === n.id) === i);
}