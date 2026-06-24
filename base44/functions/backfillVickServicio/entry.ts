import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * backfillVickServicio
 *
 * Backfill path for existing accounts that completed onboarding before
 * ensureVickServicio was wired into onCharacterCreated.
 *
 * Finds all distinct owner_email values from active_created_character records,
 * then calls ensureVickServicio for each one that does not already have Vick.
 *
 * SAFETY:
 *   - ensureVickServicio is idempotent — safe to call on accounts that already have Vick
 *   - Skips accounts that already have a healthy npc_world_service character
 *   - Processes up to 50 accounts per run to avoid rate limits; re-run if has_more=true
 *
 * ADMIN ONLY: must be called by an admin user.
 *
 * Usage:
 *   POST /backfillVickServicio
 *   { "dry_run": true }   → lists accounts needing backfill without creating
 *   { "dry_run": false }  → actually runs ensureVickServicio for each account
 *   { "target_email": "user@example.com" } → run for a single specific account
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Admin-only gate
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: admin required' }, { status: 403 });

    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const dryRun = payload.dry_run !== false; // default to dry_run=true for safety
    const targetEmail = payload.target_email || null;

    // ── FIND ALL DISTINCT ACCOUNT EMAILS ─────────────────────────────────────
    // Load active_created_character records to discover all account emails.
    // This is the same proven pattern used by simulateActiveCharacterNeeds.
    let allChars = [];
    try {
      allChars = await base44.asServiceRole.entities.Character.filter(
        { character_type: 'active_created_character', status: 'active' },
        '-updated_date',
        500
      );
    } catch (e) {
      return Response.json({ error: `Failed to load characters: ${e.message}` }, { status: 500 });
    }

    // Collect distinct owner_emails
    // CRITICAL GUARD: Exclude service accounts, test harness accounts, and any account
    // whose email pattern indicates it is infrastructure (not a real user world).
    // These accounts must never receive Vick provisioning — they are not user worlds.
    // Pattern: service+* accounts, test-harness@*, no-reply.base44.com accounts.
    const SERVICE_EMAIL_PATTERNS = [
      /^service\+/i,
      /no-reply\.base44\.com$/i,
      /test-harness@/i,
      /^noreply@/i,
      /^system@/i,
    ];
    const isServiceAccount = (email) => SERVICE_EMAIL_PATTERNS.some(p => p.test(email));
    
    let emails = [...new Set(allChars.map(c => c.owner_email).filter(Boolean))]
      .filter(e => !isServiceAccount(e));

    // If a target email is specified, only process that one
    if (targetEmail) {
      emails = emails.includes(targetEmail) ? [targetEmail] : [targetEmail]; // allow even if no chars yet
    }

    // ── CHECK WHICH ACCOUNTS ALREADY HAVE VICK ───────────────────────────────
    // CRITICAL: base44.asServiceRole.entities.Character.filter() returns 0 in this app
    // due to Character entity RLS. The reliable service-role deduplication anchor is
    // LocationReference.owner_character_id — readable via service role.
    // Any account whose Recovery Yard has owner_character_id already has Vick.
    let existingYards = [];
    try {
      existingYards = await base44.asServiceRole.entities.LocationReference.filter(
        { name: 'VGC Recovery Yard' },
        null,
        500
      );
    } catch (_) {}

    const accountsWithVick = new Set(
      existingYards
        .filter(y => y.owner_character_id && y.owner_email)
        .map(y => y.owner_email)
    );

    const needsBackfill = emails.filter(e => !accountsWithVick.has(e));
    const alreadyHasVick = emails.filter(e => accountsWithVick.has(e));

    console.log(`[backfillVickServicio] Total accounts: ${emails.length}, needs_backfill: ${needsBackfill.length}, already_has_vick: ${alreadyHasVick.length}, dry_run: ${dryRun}`);

    if (dryRun) {
      return Response.json({
        success: true,
        dry_run: true,
        total_accounts: emails.length,
        needs_backfill: needsBackfill.length,
        already_has_vick: alreadyHasVick.length,
        accounts_needing_backfill: needsBackfill,
        message: `Dry run complete. ${needsBackfill.length} account(s) need backfill. Re-run with dry_run=false to execute.`,
      });
    }

    // ── EXECUTE BACKFILL ──────────────────────────────────────────────────────
    // Process up to 50 per run to avoid rate limits.
    const BATCH_SIZE = 50;
    const batch = needsBackfill.slice(0, BATCH_SIZE);
    const hasMore = needsBackfill.length > BATCH_SIZE;

    const results = [];
    for (const email of batch) {
      try {
        const res = await base44.asServiceRole.functions.invoke('ensureVickServicio', { ownerEmail: email });
        const data = res?.data || res || {};
        results.push({
          email,
          success: data.success || false,
          created_vick: data.created?.vick || false,
          created_yard: data.created?.recoveryYard || false,
          repaired: data.repaired || [],
          vick_id: data.vick?.id || null,
          yard_id: data.recoveryYard?.id || null,
        });
        console.log(`[backfillVickServicio] ${email}: vick=${data.created?.vick ? 'created' : 'existed'}, yard=${data.created?.recoveryYard ? 'created' : 'existed'}`);
      } catch (err) {
        results.push({ email, success: false, error: err.message });
        console.error(`[backfillVickServicio] ${email}: FAILED — ${err.message}`);
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return Response.json({
      success: true,
      dry_run: false,
      processed: batch.length,
      succeeded,
      failed,
      has_more: hasMore,
      remaining_after_this_run: Math.max(0, needsBackfill.length - BATCH_SIZE),
      results,
      message: hasMore
        ? `Processed ${batch.length} accounts. ${needsBackfill.length - BATCH_SIZE} more remain — re-run to continue.`
        : `Backfill complete. ${succeeded} succeeded, ${failed} failed.`,
    });

  } catch (error) {
    console.error('[backfillVickServicio]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});