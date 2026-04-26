import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * REPAIR CSV EXPORT ISSUES
 * 
 * 1. Set is_active_character = true for all active_created_character
 * 2. Fix VGC Towers scope from account_global to character_specific (account-scoped)
 * 3. Report Nancy ownership (blank fields require manual review)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const results = {
      is_active_character_updates: 0,
      vgc_towers_scope_updates: 0,
      nancy_status: null,
      errors: []
    };

    // ─────────────────────────────────────────────────────────────────
    // REPAIR 1: Set is_active_character = true for active_created_character
    // ─────────────────────────────────────────────────────────────────
    try {
      const activeChars = await base44.asServiceRole.entities.Character.filter(
        { character_type: 'active_created_character' },
        null,
        500
      );

      for (const char of activeChars) {
        if (char.is_active_character !== true) {
          await base44.asServiceRole.entities.Character.update(char.id, {
            is_active_character: true
          });
          results.is_active_character_updates++;
        }
      }
    } catch (err) {
      results.errors.push(`is_active_character: ${err.message}`);
    }

    // ─────────────────────────────────────────────────────────────────
    // REPAIR 2: Fix VGC Towers scope to character_specific
    // ─────────────────────────────────────────────────────────────────
    try {
      const vgcTowers = await base44.asServiceRole.entities.LocationReference.filter(
        { name: 'VGC Towers' },
        null,
        500
      );

      for (const loc of vgcTowers) {
        if (loc.scope === 'account_global' || loc.location_type === 'global') {
          await base44.asServiceRole.entities.LocationReference.update(loc.id, {
            scope: 'character_specific',
            location_type: 'character_specific'
          });
          results.vgc_towers_scope_updates++;
        }
      }
    } catch (err) {
      results.errors.push(`VGC Towers scope: ${err.message}`);
    }

    // ─────────────────────────────────────────────────────────────────
    // REPORT 3: Nancy ownership review needed
    // ─────────────────────────────────────────────────────────────────
    try {
      const nancy = await base44.asServiceRole.entities.Character.get('69cc3d3c7427c0a3f7423c92');
      if (nancy) {
        results.nancy_status = {
          found: true,
          name: nancy.name,
          character_type: nancy.character_type,
          status: nancy.status,
          owner_email: nancy.owner_email || '[BLANK]',
          owner_user_id: nancy.owner_user_id || '[BLANK]',
          created_by: nancy.created_by || '[SERVICE]',
          action_required: 'Manual review — determine correct owner'
        };
      } else {
        results.nancy_status = { found: false };
      }
    } catch (err) {
      results.errors.push(`Nancy lookup: ${err.message}`);
    }

    return Response.json({
      task: 'REPAIR_CSV_EXPORT_ISSUES',
      results
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});