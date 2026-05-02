import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const allLocations = await base44.asServiceRole.entities.LocationReference.list('-updated_date', 200);

  // Target locations by name
  const targetNames = allLocations.map(l => l.name); // ALL locations
  const targets = allLocations.filter(l =>
    targetNames.some(n => (l.name || '').toLowerCase().includes(n.toLowerCase()))
  );

  // Also include ANY location where worker_character_ids is non-empty array
  const withWorkers = allLocations.filter(l => Array.isArray(l.worker_character_ids) && l.worker_character_ids.length > 0);

  // Also check characters for their schedule fields — Matt Lopez and Nathan Parker
  const chars = await base44.asServiceRole.entities.Character.list('-updated_date', 100);
  const workerChars = chars.filter(c =>
    ['matt lopez', 'nathan parker', 'andre rivera'].some(n => (c.name || '').toLowerCase().includes(n.toLowerCase()))
  ).map(c => ({
    id: c.id,
    name: c.name,
    owner_email: c.owner_email,
    occupation: c.occupation,
    occupation_location_id: c.occupation_location_id,
    occupation_location_name: c.occupation_location_name,
    additional_occupation_locations: c.additional_occupation_locations || [],
    work_start_time: c.work_start_time || null,
    work_end_time: c.work_end_time || null,
    work_days: c.work_days || null,
    work_details: c.work_details || null,
  }));

  const formatLoc = (l) => ({
    id: l.id,
    name: l.name,
    owner_email: l.owner_email || null,
    category: l.category,
    updated_date: l.updated_date,
    worker_character_ids: l.worker_character_ids,
    worker_shifts: l.worker_shifts,
    worker_job_titles: l.worker_job_titles,
    worker_pay_rates: l.worker_pay_rates,
    worker_pay_type: l.worker_pay_type,
  });

  // Compact: show every location's worker fields
  const compactAll = allLocations.map(l => ({
    id: l.id,
    name: l.name,
    updated_date: l.updated_date,
    worker_character_ids_count: (l.worker_character_ids || []).length,
    worker_character_ids: l.worker_character_ids || [],
    worker_shifts_keys: l.worker_shifts ? Object.keys(l.worker_shifts) : [],
    worker_shifts: l.worker_shifts || null,
    worker_job_titles: l.worker_job_titles || null,
  }));

  // Only show locations that have ANYTHING in worker_shifts or worker_job_titles
  const hasAnyWorkerData = compactAll.filter(l =>
    l.worker_shifts_keys.length > 0 ||
    Object.keys(l.worker_job_titles || {}).length > 0
  );

  return Response.json({
    total_locations_in_db: allLocations.length,
    locations_with_nonempty_worker_character_ids: withWorkers.length,
    locations_with_any_worker_data: hasAnyWorkerData.length,
    // Only return the interesting ones to avoid truncation
    has_worker_data_detail: hasAnyWorkerData,
    worker_characters: workerChars,
  });
});