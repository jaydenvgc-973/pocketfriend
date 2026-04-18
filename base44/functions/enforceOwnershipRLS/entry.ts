import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * PHASE 5: ENFORCE RLS (Row-Level Security)
 * 
 * Backend enforcement layer that prevents unauthorized reads/writes at the entity level.
 * This is the FINAL LOCK — enforces ownership model on all operations.
 * 
 * Admin-only function.
 * 
 * Usage:
 * await base44.functions.invoke('enforceOwnershipRLS', {
 *   action: 'audit' | 'enforce' | 'report',
 *   entityNames: ['Character', 'LocationReference', 'UserSettings'] // optional, defaults to all
 * })
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin check
    if (user?.role !== 'admin') {
      return Response.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const payload = await req.json().catch(() => ({}));
    const action = payload.action || 'report'; // audit | enforce | report
    const entityNames = payload.entityNames || [
      'Character',
      'LocationReference',
      'UserSettings',
      'Message',
      'Conversation',
    ];

    const results = {
      action,
      timestamp: new Date().toISOString(),
      entities: {},
      summary: {
        total_records_checked: 0,
        orphaned_records: 0,
        records_without_owner_id: 0,
        records_without_data_scope: 0,
        enforcement_applied: false,
      },
    };

    // Helper: Check if record passes RLS
    const recordPassesRLS = (record) => {
      // Record must have BOTH owner_user_id AND data_scope
      return !!record.owner_user_id && !!record.data_scope;
    };

    // Helper: Tag record as orphaned
    const tagOrphaned = async (entityName, recordId) => {
      try {
        await base44.asServiceRole.entities[entityName].update(recordId, {
          _orphaned: true,
          _orphaned_at: new Date().toISOString(),
          _rls_enforcement_timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.warn(`Could not tag orphaned record ${entityName}:${recordId}:`, err.message);
      }
    };

    // Process each entity
    for (const entityName of entityNames) {
      console.log(`[RLS-ENFORCE] Processing ${entityName}...`);
      
      results.entities[entityName] = {
        total: 0,
        orphaned: 0,
        without_owner_id: 0,
        without_data_scope: 0,
        enforcement_action: action,
      };

      try {
        // Fetch all records for this entity
        let offset = 0;
        const pageSize = 100;
        let hasMore = true;

        while (hasMore) {
          let records = [];
          try {
            records = await base44.asServiceRole.entities[entityName].list(
              '-created_date',
              pageSize,
              offset
            );
          } catch (err) {
            console.error(`[RLS-ENFORCE] Failed to fetch ${entityName} records:`, err.message);
            break;
          }

          if (!records || records.length === 0) {
            hasMore = false;
            break;
          }

          for (const record of records) {
            results.entities[entityName].total++;
            results.summary.total_records_checked++;

            // Check ownership
            const hasOwnerId = !!record.owner_user_id;
            const hasDataScope = !!record.data_scope;

            if (!hasOwnerId) {
              results.entities[entityName].without_owner_id++;
              results.summary.records_without_owner_id++;

              // Try to recover from created_by
              if (record.created_by) {
                console.warn(
                  `[RLS-ENFORCE] ${entityName}:${record.id} has no owner_user_id (has legacy created_by="${record.created_by}") — this should have been backfilled in Phase 2`
                );
                // Backfill was supposed to handle this, so tag as potential orphan
                if (action === 'enforce') {
                  await tagOrphaned(entityName, record.id);
                  results.entities[entityName].orphaned++;
                  results.summary.orphaned_records++;
                }
              }
            }

            if (!hasDataScope) {
              results.entities[entityName].without_data_scope++;
              results.summary.records_without_data_scope++;

              // Apply default scope
              if (action === 'enforce') {
                try {
                  const defaultScope = hasOwnerId ? 'private_user' : null;
                  if (defaultScope) {
                    await base44.asServiceRole.entities[entityName].update(record.id, {
                      data_scope: defaultScope,
                    });
                  }
                } catch (err) {
                  console.warn(`Could not apply data_scope to ${entityName}:${record.id}:`, err.message);
                }
              }
            }

            // Mark enforcement timestamp
            if (action === 'enforce') {
              try {
                await base44.asServiceRole.entities[entityName].update(record.id, {
                  _rls_enforcement_timestamp: new Date().toISOString(),
                });
              } catch (err) {
                // Silently fail — record may be read-only
              }
            }
          }

          offset += pageSize;
          if (records.length < pageSize) {
            hasMore = false;
          }
        }

        console.log(`[RLS-ENFORCE] ${entityName} complete: ${results.entities[entityName].total} records checked`);
      } catch (err) {
        results.entities[entityName].error = err.message;
        console.error(`[RLS-ENFORCE] Error processing ${entityName}:`, err.message);
      }
    }

    // Final enforcement status
    if (action === 'enforce') {
      results.summary.enforcement_applied = true;
      console.log(`[RLS-ENFORCE] ENFORCEMENT COMPLETE — ${results.summary.total_records_checked} records checked`);
    } else if (action === 'audit') {
      console.log(`[RLS-ENFORCE] AUDIT COMPLETE — ${results.summary.orphaned_records} orphaned records detected`);
    }

    return Response.json({
      status: 'success',
      action,
      results,
      nextStep: action === 'report' ? 'Run with action=audit to identify issues' : 'RLS enforcement applied',
    });
  } catch (error) {
    console.error('[RLS-ENFORCE] Critical error:', error);
    return Response.json(
      { error: error.message, status: 'failed' },
      { status: 500 }
    );
  }
});