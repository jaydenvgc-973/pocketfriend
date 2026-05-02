import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Get all UserSettings records for THIS USER ONLY
  const allSettings = await base44.entities.UserSettings.filter({ owner_email: user.email });

  if (allSettings.length <= 1) {
    return Response.json({ message: 'No duplicates found', count: allSettings.length });
  }

  // Score each record by how complete it is (count non-empty fields)
  const score = (s) => {
    let n = 0;
    if (s.fictional_world_name) n++;
    if (s.user_birthday) n++;
    if (s.user_gender) n++;
    if (s.user_schedule_notes) n++;
    if (s.appearance_lock && Object.keys(s.appearance_lock).some(k => s.appearance_lock[k])) n++;
    if (s.user_aliases?.length) n++;
    if (s.default_character_id) n++;
    if (s.has_completed_onboarding) n++;
    if (s.openai_api_key) n++;
    if (s.user_balance && s.user_balance !== 6000) n++;
    return n;
  };

  // Sort by score descending, then by created_date ascending (oldest = canonical)
  const sorted = [...allSettings].sort((a, b) => {
    const scoreDiff = score(b) - score(a);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(a.created_date) - new Date(b.created_date);
  });

  const canonical = sorted[0];
  const duplicates = sorted.slice(1);

  // Merge any fields from duplicates into canonical that canonical is missing
  const merged = { ...canonical };
  for (const dup of duplicates) {
    if (!merged.fictional_world_name && dup.fictional_world_name) merged.fictional_world_name = dup.fictional_world_name;
    if (!merged.user_birthday && dup.user_birthday) merged.user_birthday = dup.user_birthday;
    if (!merged.user_gender && dup.user_gender) merged.user_gender = dup.user_gender;
    if (!merged.user_schedule_notes && dup.user_schedule_notes) merged.user_schedule_notes = dup.user_schedule_notes;
    if (!merged.default_character_id && dup.default_character_id) merged.default_character_id = dup.default_character_id;
    if (!merged.openai_api_key && dup.openai_api_key) merged.openai_api_key = dup.openai_api_key;
    if (!merged.has_completed_onboarding && dup.has_completed_onboarding) merged.has_completed_onboarding = dup.has_completed_onboarding;
    if (!merged.appearance_lock) {
      merged.appearance_lock = dup.appearance_lock;
    } else if (dup.appearance_lock) {
      // Deep merge appearance_lock to preserve all fields
      merged.appearance_lock = { ...dup.appearance_lock, ...merged.appearance_lock };
    }
    if (!merged.user_aliases?.length && dup.user_aliases?.length) merged.user_aliases = dup.user_aliases;
    if ((!merged.user_balance || merged.user_balance === 6000) && dup.user_balance && dup.user_balance !== 6000) merged.user_balance = dup.user_balance;
    if (!merged.user_relatives && dup.user_relatives) merged.user_relatives = dup.user_relatives;
    if (merged.home_key_holders === undefined && dup.home_key_holders?.length) merged.home_key_holders = dup.home_key_holders;
  }

  // Log merge results for safety verification
  console.log('CONSOLIDATION: Canonical record ID:', canonical.id);
  console.log('CONSOLIDATION: Duplicates to consolidate:', duplicates.length);
  console.log('CONSOLIDATION: Merged data keys:', Object.keys(merged));
  if (merged.appearance_lock) {
    console.log('CONSOLIDATION: Appearance lock preserved:', Object.keys(merged.appearance_lock));
  }

  // Update the canonical record with merged data
  const { id, created_date, updated_date, created_by, ...updateData } = merged;
  await base44.entities.UserSettings.update(canonical.id, updateData);
  console.log('CONSOLIDATION: Canonical record updated successfully');

  // SAFETY CHECK: Verify merged data before deletion
  const verifyMerged = await base44.entities.UserSettings.filter({ id: canonical.id });
  const verifiedRecord = verifyMerged[0];
  
  if (!verifiedRecord || !verifiedRecord.appearance_lock || !Object.keys(verifiedRecord.appearance_lock).some(k => verifiedRecord.appearance_lock[k])) {
    console.error('CONSOLIDATION FAILED: appearance_lock not preserved in merged record. Aborting deletion.');
    return Response.json({
      message: 'Consolidation aborted: data preservation check failed',
      reason: 'appearance_lock not fully preserved',
      canonical_id: canonical.id,
      deleted_count: 0,
    }, { status: 400 });
  }

  console.log('CONSOLIDATION: Safety check passed. Proceeding with duplicate deletion.');

  // Delete all duplicates ONLY after safety verification
  for (const dup of duplicates) {
    await base44.entities.UserSettings.delete(dup.id);
    console.log('CONSOLIDATION: Deleted duplicate record ID:', dup.id);
  }

  return Response.json({
    message: `Consolidated ${allSettings.length} records into 1`,
    canonical_id: canonical.id,
    deleted_count: duplicates.length,
    status: 'success',
  });
});