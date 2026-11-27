// TEMPORARY verification probe — deleted after the check.
import fs from 'fs';
import { getPresenceAtLocation, resolveTravelPresenceEntities } from '@/lib/travelPresenceResolver';
import { getResidentialUnits, getUnitById, getUnitPresentOccupantIds, getUnitForCharacter } from '@/lib/residentialUnits';
import { getWorkplaceById, getWorkplaceSpaces } from '@/lib/locationWorkspaces';
import { isCharacterAtWork } from '@/lib/workScheduleUtils';
import { isCharacterAsleep } from '@/lib/sleepUtils';
import { isEmployedAtLocation } from '@/lib/sceneRoleResolver';

const { locs, chars, users } = JSON.parse(fs.readFileSync('/tmp/scene-data.json', 'utf8'));
const viewer = users[Number(process.env.VIEWER_INDEX || 2)];
const viewerEmail = viewer.email;
const mine = chars.filter((c) => c.owner_email === viewerEmail);
const activeChars = mine.filter((c) => c.status === 'active' && c.character_type === 'active_created_character');
const npcFictitious = mine.filter((c) => c.character_type === 'npc_fictitious');
const npcFamily = mine.filter((c) => c.character_type === 'npc_family_member');
const npcRegular = mine.filter((c) => c.character_type === 'npc_regular');
const sharedLocs = locs.filter((l) => l.scope === 'shared');
const sharedIds = new Set(sharedLocs.map((l) => l.id));
const workerIds = new Set();
sharedLocs.forEach((l) => (l.worker_character_ids || []).forEach((id) => workerIds.add(id)));
const sharedEmployees = chars.filter((c) => workerIds.has(c.id) && c.owner_email !== viewerEmail);
const empIds = new Set(sharedEmployees.map((c) => c.id));
const sharedVisitors = chars.filter((c) => c.owner_email !== viewerEmail && sharedIds.has(c.resolved_current_location_id) && !empIds.has(c.id));
const characters = [...activeChars, ...npcFictitious, ...npcFamily, ...npcRegular, ...sharedEmployees, ...sharedVisitors];
const presence = resolveTravelPresenceEntities({
  currentUser: viewer, userSettings: null, activeCharacters: activeChars,
  npcFictitious, npcFamilyMembers: npcFamily, npcRegular, allCharacters: characters,
  locations: locs, sharedLocationEmployees: sharedEmployees, sharedLocationVisitors: sharedVisitors,
});

const location = locs.find((l) => l.name === (process.env.LOC || 'Gateway House'));
const locationId = location.id;
const space = process.env.SPACE || '';
const activeUnit = getUnitById(location, space) || getResidentialUnits(location).find((u) => u.unit_name === space) || null;
const activeWorkspace = getWorkplaceSpaces(location).find((w) => w.name === space || w.workplace_id === space) || null;
const unitId = activeUnit?.unit_id || activeWorkspace?.workplace_id || '';
const workspaceEmployeeIds = new Set(activeWorkspace?.worker_character_ids || []);
const unitPresent = getUnitPresentOccupantIds(location, unitId, characters);
const present = getPresenceAtLocation(location, presence).filter((e) => !String(e.id).startsWith('user_'));
const locationUnits = getResidentialUnits(location);

let ids;
if (activeUnit) ids = unitPresent;
else if (activeWorkspace) {
  ids = present.filter((e) => {
    if (!workspaceEmployeeIds.has(e.id)) return false;
    const c = characters.find((x) => x.id === e.id) || e;
    return isEmployedAtLocation(c, location) && (isCharacterAtWork(c, location) || (c.resolved_presence_status === 'at_work' && c.resolved_current_location_id === locationId)) && !isCharacterAsleep(c);
  }).map((e) => e.id);
} else {
  ids = present.map((e) => e.id);
}
const nameOf = (id) => (characters.find((c) => c.id === id) || present.find((p) => p.id === id) || {}).name || id;
console.log(JSON.stringify({
  location: location.name, space: space || '(whole property)',
  units: locationUnits.map((u) => `${u.unit_name}: ${(u.occupant_character_ids || []).map(nameOf).join(', ')}`),
  workplaces: getWorkplaceSpaces(location).map((w) => `${w.name}: ${(w.worker_character_ids || []).map(nameOf).join(', ')}`),
  presentAtProperty: present.map((e) => `${e.display_name}(${e.resolved_presence_status})`),
  preselectedInThisSpace: ids.map(nameOf),
}, null, 1));