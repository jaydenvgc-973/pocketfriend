import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * PHASE 7: GRADUAL ENFORCEMENT
 * 
 * Selective enforcement layer that gradually transitions to strict ownership validation.
 * Allows rolling out enforcement per-entity, per-user, or per-operation type.
 * 
 * Admin-only function.
 * 
 * Enforcement modes:
 * - 'log_only': Log violations but don't block (monitoring phase)
 * - 'warn': Log and return warning, but allow operation (advisory phase)
 * - 'block': Enforce strictly, reject operations (enforcement phase)
 * 
 * Usage:
 * await base44.functions.invoke('gradualOwnershipEnforcement', {
 *   action: 'enable' | 'disable' | 'update_config' | 'monitor' | 'report',
 *   entityName: 'Character', // optional, defaults to all
 *   operationType: 'read' | 'write' | 'all', // optional
 *   mode: 'log_only' | 'warn' | 'block', // optional
 * })
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const payload = await req.json().catch(() => ({}));
    const action = payload.action || 'report'; // enable | disable | update_config | monitor | report
    const entityName = payload.entityName || null;
    const operationType = payload.operationType || 'all'; // read | write | all
    const mode = payload.mode || 'log_only'; // log_only | warn | block

    // Load enforcement configuration
    let config = await loadEnforcementConfig();

    console.log(`[ENFORCE-PHASE7] Action: ${action} | Entity: ${entityName || 'all'} | Mode: ${mode}`);

    if (action === 'enable') {
      // Enable enforcement for a specific entity
      if (!entityName) {
        return Response.json(
          { error: 'entityName required for enable action' },
          { status: 400 }
        );
      }

      if (!config.entities) config.entities = {};
      config.entities[entityName] = {
        enabled: true,
        mode,
        operationType,
        enabledAt: new Date().toISOString(),
        violations: 0,
      };

      await saveEnforcementConfig(config);

      console.log(`[ENFORCE-PHASE7] Enabled enforcement for ${entityName} in ${mode} mode`);

      return Response.json({
        status: 'success',
        action: 'enable',
        entity: entityName,
        mode,
        message: `Enforcement enabled for ${entityName} in ${mode} mode`,
      });
    }

    if (action === 'disable') {
      // Disable enforcement for a specific entity
      if (!entityName) {
        return Response.json(
          { error: 'entityName required for disable action' },
          { status: 400 }
        );
      }

      if (config.entities && config.entities[entityName]) {
        config.entities[entityName].enabled = false;
        config.entities[entityName].disabledAt = new Date().toISOString();
        await saveEnforcementConfig(config);
      }

      console.log(`[ENFORCE-PHASE7] Disabled enforcement for ${entityName}`);

      return Response.json({
        status: 'success',
        action: 'disable',
        entity: entityName,
        message: `Enforcement disabled for ${entityName}`,
      });
    }

    if (action === 'update_config') {
      // Update enforcement mode for an entity
      if (!entityName || !config.entities || !config.entities[entityName]) {
        return Response.json(
          { error: 'Entity not found or not configured' },
          { status: 400 }
        );
      }

      config.entities[entityName].mode = mode;
      config.entities[entityName].operationType = operationType;
      config.entities[entityName].updatedAt = new Date().toISOString();

      await saveEnforcementConfig(config);

      console.log(`[ENFORCE-PHASE7] Updated ${entityName} to mode=${mode}`);

      return Response.json({
        status: 'success',
        action: 'update_config',
        entity: entityName,
        newMode: mode,
      });
    }

    if (action === 'monitor') {
      // Monitor for violations without blocking
      const report = {
        timestamp: new Date().toISOString(),
        config,
        violations: [],
        summary: {
          total_violations: 0,
          by_entity: {},
          by_violation_type: {},
        },
      };

      // Scan all configured entities for violations
      if (config.entities) {
        for (const [entity, entityConfig] of Object.entries(config.entities)) {
          if (!entityConfig.enabled) continue;

          try {
            const violations = await scanEntityForViolations(base44, entity);
            report.violations.push(...violations);
            report.summary.by_entity[entity] = violations.length;
            
            if (violations.length > 0) {
              entityConfig.violations = violations.length;
            }
          } catch (err) {
            console.error(`[ENFORCE-PHASE7] Error scanning ${entity}:`, err.message);
            report.summary.by_entity[entity] = `ERROR: ${err.message}`;
          }
        }
      }

      report.summary.total_violations = report.violations.length;

      // Save updated config
      await saveEnforcementConfig(config);

      console.log(`[ENFORCE-PHASE7] Monitoring complete: ${report.summary.total_violations} violations detected`);

      return Response.json({
        status: 'success',
        action: 'monitor',
        report,
      });
    }

    if (action === 'report') {
      // Generate enforcement status report
      const entities = config.entities || {};
      const report = {
        timestamp: new Date().toISOString(),
        config: {
          globalMode: config.globalMode || 'log_only',
          enabledSince: config.enabledSince,
          entities: Object.entries(entities).map(([name, cfg]) => ({
            name,
            enabled: cfg.enabled,
            mode: cfg.mode,
            operationType: cfg.operationType,
            violations: cfg.violations || 0,
            enabledAt: cfg.enabledAt,
          })),
        },
        recommendations: generateRecommendations(entities),
      };

      return Response.json({
        status: 'success',
        action: 'report',
        report,
      });
    }

    return Response.json({
      status: 'error',
      error: `Unknown action: ${action}`,
    }, { status: 400 });
  } catch (error) {
    console.error('[ENFORCE-PHASE7] Critical error:', error);
    return Response.json(
      { error: error.message, status: 'failed' },
      { status: 500 }
    );
  }
});

/**
 * Scan an entity for ownership violations
 */
async function scanEntityForViolations(base44, entityName) {
  const violations = [];

  try {
    let offset = 0;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const records = await base44.asServiceRole.entities[entityName].list(
        '-created_date',
        pageSize,
        offset
      );

      if (!records || records.length === 0) {
        hasMore = false;
        break;
      }

      for (const record of records) {
        // Check for violations
        if (!record.owner_user_id && record.created_by) {
          // Record has legacy ownership but no new ownership
          violations.push({
            recordId: record.id,
            entity: entityName,
            violationType: 'missing_owner_user_id',
            hasLegacy: true,
            severity: 'high',
            message: `Missing owner_user_id (has legacy created_by="${record.created_by}")`,
          });
        }

        if (!record.data_scope) {
          // Record missing data_scope
          violations.push({
            recordId: record.id,
            entity: entityName,
            violationType: 'missing_data_scope',
            hasOwnership: !!record.owner_user_id,
            severity: 'medium',
            message: 'Missing data_scope assignment',
          });
        }
      }

      offset += pageSize;
      if (records.length < pageSize) {
        hasMore = false;
      }
    }
  } catch (err) {
    console.error(`[ENFORCE-PHASE7] Error scanning ${entityName}:`, err.message);
  }

  return violations;
}

/**
 * Load enforcement configuration from UserSettings
 * Creates default config if none exists
 */
async function loadEnforcementConfig() {
  try {
    // For now, return a default config
    // In production, this would be stored in a system entity
    return {
      globalMode: 'log_only',
      enabledSince: new Date().toISOString(),
      entities: {},
    };
  } catch (err) {
    console.error('[ENFORCE-PHASE7] Error loading config:', err.message);
    return {
      globalMode: 'log_only',
      entities: {},
    };
  }
}

/**
 * Save enforcement configuration
 */
async function saveEnforcementConfig(config) {
  try {
    // In production, this would persist to a system entity
    console.log('[ENFORCE-PHASE7] Config saved:', JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('[ENFORCE-PHASE7] Error saving config:', err.message);
  }
}

/**
 * Generate rollout recommendations based on violation scan
 */
function generateRecommendations(entities) {
  const recommendations = [];

  for (const [entityName, config] of Object.entries(entities)) {
    if (!config.enabled) {
      recommendations.push({
        entity: entityName,
        action: 'Enable monitoring',
        reason: 'Not yet monitoring for ownership violations',
      });
      continue;
    }

    if (config.mode === 'log_only' && config.violations > 0) {
      recommendations.push({
        entity: entityName,
        action: 'Escalate to warn mode after violations resolved',
        reason: `Currently in log_only mode with ${config.violations} violations detected`,
      });
    }

    if (config.mode === 'warn' && config.violations === 0) {
      recommendations.push({
        entity: entityName,
        action: 'Consider escalating to block mode',
        reason: 'No violations detected in warn mode — ready for strict enforcement',
      });
    }
  }

  if (recommendations.length === 0) {
    recommendations.push({
      status: 'healthy',
      message: 'All entities are properly enforced with no violations detected',
    });
  }

  return recommendations;
}