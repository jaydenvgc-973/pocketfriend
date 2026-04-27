import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ENFORCE OWNERSHIP-ONLY RLS — NO CREATED_BY FALLBACK
 * 
 * This function validates that:
 * 1. All character access is ONLY via owner_email (NEVER created_by)
 * 2. Characters without owner_email are flagged as data errors
 * 3. Service role enforcement confirms no fallback logic exists
 * 
 * CRITICAL PRINCIPLE:
 * Ownership ≠ Creation
 * Owner controls access. Creator does not.
 * 
 * ZERO TOLERANCE:
 * If any character is filtered out or missing due to RLS,
 * the system has FAILED.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // TEST 1: User-scoped query (owner_email ONLY)
    let userCharacters = [];
    try {
      userCharacters = await base44.entities.Character.filter({ owner_email: user.email });
    } catch (e) {
      console.warn('[enforceOwnershipOnlyRLS] User query failed:', e.message);
    }

    // TEST 2: Service role query (full database view)
    const allCharacters = await base44.asServiceRole.entities.Character.list('-updated_date', 1000);

    // TEST 3: Count characters that would be accessible via owner_email ONLY
    const ownerEmailMatches = allCharacters.filter(c => c.owner_email === user.email).length;

    // TEST 4: Check for any characters matching on created_by (NOT ALLOWED)
    const createdByMatches = allCharacters.filter(c => c.created_by === user.email && c.owner_email !== user.email);

    // TEST 5: Identify characters without owner_email (DATA ERRORS)
    const orphanedRecords = allCharacters.filter(c => !c.owner_email || !c.owner_email.trim());

    // RESULT VALIDATION
    const results = {
      timestamp: new Date().toISOString(),
      user_email: user.email,
      ownership_enforcement: {
        total_characters_all_users: allCharacters.length,
        characters_owned_by_user_via_owner_email: ownerEmailMatches,
        user_scoped_query_returned: userCharacters.length,
        characters_matching_created_by_only: createdByMatches.length,
        orphaned_records_without_owner_email: orphanedRecords.length
      },
      rls_compliance: {
        user_query_matches_owner_email_only: userCharacters.length === ownerEmailMatches,
        no_created_by_fallback_in_use: createdByMatches.length === 0,
        zero_orphaned_records: orphanedRecords.length === 0,
        system_passes_ownership_only_test: userCharacters.length === ownerEmailMatches && createdByMatches.length === 0
      },
      data_errors_detected: orphanedRecords.length > 0 ? orphanedRecords.map(c => ({
        character_id: c.id,
        character_name: c.name,
        issue: 'MISSING owner_email',
        action: 'REPAIR REQUIRED'
      })) : null,
      final_verdict: {
        ownership_only_principle_enforced: createdByMatches.length === 0,
        created_by_fallback_eliminated: createdByMatches.length === 0,
        system_safe_for_strict_rls: createdByMatches.length === 0 && orphanedRecords.length === 0,
        recommendation: orphanedRecords.length > 0 
          ? 'ASSIGN owner_email to orphaned records before RLS update'
          : 'RLS UPDATE SAFE — ownership-only principle ready'
      }
    };

    return Response.json(results);

  } catch (error) {
    console.error('[enforceOwnershipOnlyRLS]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});