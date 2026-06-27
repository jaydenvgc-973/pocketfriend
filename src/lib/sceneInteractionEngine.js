/**
 * sceneInteractionEngine.js — THIN ADAPTER (no action catalog)
 *
 * This file is NOT an activity catalog. It is an adapter that:
 *   1. Calls generateLocationActions() from actionGenerator.js (the only activity source)
 *   2. Enriches each action with zone validation, staff checks, and payment routing
 *   3. Returns the final interaction list ready for the Scene UI
 *
 * To add, change, or remove Scene activities → edit actionGenerator.js only.
 */

import { generateLocationActions } from './actionGenerator.js';
import { REQUIRED_STAFF_ROLES, VGC_YARD_REQUIRED_STAFF } from './sceneVenueNPCs.js';

/**
 * Get scene interactions for a location.
 * Returns the full contextual action list enriched with scene metadata.
 *
 * @param {Object} location - LocationReference record
 * @param {string|null} activeZone - Currently active zone name
 * @param {Object|null} character - Main character in scene (used for sleep context)
 * @param {Object} options
 * @param {number} options.hour - Current Eastern Time hour (0-23); defaults to actual ET hour
 * @param {number} options.sleepStartHour - Character's scheduled sleep start
 */
export function getSceneInteractions(location, activeZone, character, options = {}) {
  if (!location) return [];

  // Use Eastern Time as authoritative hour
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = typeof options.hour === 'number' ? options.hour : nowET.getHours();

  const sleepStartHour = options.sleepStartHour
    ?? character?.sleep_start_time?.split(':').map(Number)[0]
    ?? 23;

  const isAsleep = character
    ? (character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'passed_out')
    : false;

  // Get the authoritative action list from the single source of truth
  const rawActions = generateLocationActions(location, activeZone, hour, {
    isCharacterAsleep: isAsleep,
    sleepStartHour,
  });

  if (!rawActions || rawActions.length === 0) return [];

  // Real zones on this location record
  const realZones = (location.zones || []).map(z => z.zone_name);
  const assignedWorkerIds = location.worker_character_ids || [];
  const workerJobTitles = location.worker_job_titles || {};
  const workerShifts = location.worker_shifts || {};

  // Determine which workers are currently on shift (Eastern Time)
  const dayOfWeek = nowET.getDay();
  const nowMinutes = nowET.getHours() * 60 + nowET.getMinutes();

  const onShiftWorkerIds = assignedWorkerIds.filter(workerId => {
    const shift = workerShifts[workerId];
    if (!shift) return false;
    if (!(shift.days || []).includes(dayOfWeek)) return false;
    const [startH, startM] = (shift.start || '09:00').split(':').map(Number);
    const [endH, endM] = (shift.end || '17:00').split(':').map(Number);
    return nowMinutes >= startH * 60 + startM && nowMinutes < endH * 60 + endM;
  });

  // Enrich each action with zone and staff metadata
  const enriched = rawActions.map(action => {
    const result = { ...action, id: `${action.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };

    // Zone hint: if the action declares a preferred zone and it exists on the location, attach it
    if (action.suggested_zone) {
      if (realZones.includes(action.suggested_zone)) {
        result.suggested_zone_name = action.suggested_zone;
      }
      // If zone doesn't exist, action is still available — just not zone-locked
    }

    // Staff check: if action requires staff but none are on shift, flag it (still visible)
    if (action.requires_staff) {
      if (onShiftWorkerIds.length > 0) {
        result.workers_on_shift = onShiftWorkerIds;
      } else {
        result.workers_on_shift = [];
        result.no_staff_warning = true;
      }
    }

    return result;
  });

  // No arbitrary cap — return all enriched actions. Scene.jsx strip is overflow-x scrollable.
  return enriched;
}

/**
 * Get location staff presence for "Who's Here" section.
 * Returns only assigned workers currently on shift.
 */
export function getLocationStaffPresence(location) {
  if (!location) return [];

  const assignedWorkerIds = location.worker_character_ids || [];
  const workerJobTitles = location.worker_job_titles || {};
  const workerShifts = location.worker_shifts || {};

  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = nowET.getDay();
  const nowMinutes = nowET.getHours() * 60 + nowET.getMinutes();

  return assignedWorkerIds
    .filter(workerId => {
      const shift = workerShifts[workerId];
      if (!shift) return false;
      if (!(shift.days || []).includes(dayOfWeek)) return false;
      const [startH, startM] = (shift.start || '09:00').split(':').map(Number);
      const [endH, endM] = (shift.end || '17:00').split(':').map(Number);
      return nowMinutes >= startH * 60 + startM && nowMinutes < endH * 60 + endM;
    })
    .map(workerId => ({
      character_id: workerId,
      job_title: workerJobTitles[workerId] || 'Staff',
      shift: workerShifts[workerId] || {},
    }));
}

/**
 * Get temporary scene staff for roles not covered by real on-shift workers.
 * Uses REQUIRED_STAFF_ROLES from sceneVenueNPCs — not an action catalog.
 */
export function getTemporarySceneStaff(location, onShiftWorkerIds = []) {
  if (!location) return [];

  const category = location.category || 'generic';

  // VGC Recovery Yard special handling
  const isRecoveryYard = location.name === 'VGC Recovery Yard';
  if (isRecoveryYard) {
    const tempStaff = [];
    for (const zone of (location.zones || [])) {
      const zoneRoles = VGC_YARD_REQUIRED_STAFF[zone.zone_name];
      if (!zoneRoles) continue;
      for (const roleTemplate of zoneRoles) {
        if (zone.zone_name === 'Residential Suite') continue;
        tempStaff.push({
          ...roleTemplate,
          id: `${roleTemplate.id}_tmp_${location.id}`,
          isTemporary: true,
          temporaryLabel: 'Yard Assistant',
        });
      }
    }
    return tempStaff;
  }

  const requiredRoles = REQUIRED_STAFF_ROLES[category];
  if (!requiredRoles || requiredRoles.length === 0 || category === 'home') return [];

  const assignedWorkerIds = location.worker_character_ids || [];
  const workerJobTitles = location.worker_job_titles || {};
  const offShiftWorkerIds = assignedWorkerIds.filter(id => !onShiftWorkerIds.includes(id));
  const coveredRoles = new Set(
    onShiftWorkerIds.map(id => (workerJobTitles[id] || '').toLowerCase()).filter(Boolean)
  );

  return requiredRoles
    .filter(template => !coveredRoles.has(template.role.toLowerCase()))
    .map(template => {
      const offShiftCovers = offShiftWorkerIds.some(id => {
        const title = (workerJobTitles[id] || '').toLowerCase();
        return title === template.role.toLowerCase() || title.includes(template.role.toLowerCase());
      });
      return {
        ...template,
        id: `${template.id}_tmp_${location.id}`,
        isTemporary: true,
        temporaryLabel: offShiftCovers ? 'Filling in' : 'On duty',
      };
    });
}

/**
 * Resolve zone target for an action.
 * Exact match only — no zone invention.
 */
export function resolveSceneInteractionTargetZone(location, action) {
  if (!location || !action.suggested_zone_name) return null;
  const realZones = (location.zones || []).map(z => z.zone_name);
  return realZones.includes(action.suggested_zone_name) ? action.suggested_zone_name : null;
}