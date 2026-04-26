import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * COMPARE USER VS SERVICE ROLE SCOPE
 * 
 * Explicitly compares the same entity queried with different roles.
 * This identifies whether role scope difference is causing the contradiction.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const targetName = 'Melody Jackson Perry';

    // QUERY 1: User role
    const userRoleList = await base44.entities.Character.list('-updated_date', 500);
    
    // QUERY 2: Service role
    const serviceRoleList = await base44.asServiceRole.entities.Character.list('-updated_date', 500);

    // Extract record names
    const userRoleNames = new Set(userRoleList.map(c => c.name));
    const serviceRoleNames = new Set(serviceRoleList.map(c => c.name));

    // Find target in each
    const foundInUserRole = userRoleList.find(c => c.name === targetName);
    const foundInServiceRole = serviceRoleList.find(c => c.name === targetName);

    return Response.json({
      diagnostic: 'COMPARE_USER_VS_SERVICE_ROLE',
      user_email: user.email,
      target_name: targetName,

      scope_comparison: {
        user_role: {
          method: 'base44.entities.Character.list()',
          total_records: userRoleList.length,
          target_found: !!foundInUserRole,
          target_record: foundInUserRole ? {
            id: foundInUserRole.id.slice(0, 8),
            owner_email: foundInUserRole.owner_email,
            character_type: foundInUserRole.character_type,
            status: foundInUserRole.status,
          } : null,
        },
        service_role: {
          method: 'base44.asServiceRole.entities.Character.list()',
          total_records: serviceRoleList.length,
          target_found: !!foundInServiceRole,
          target_record: foundInServiceRole ? {
            id: foundInServiceRole.id.slice(0, 8),
            owner_email: foundInServiceRole.owner_email,
            character_type: foundInServiceRole.character_type,
            status: foundInServiceRole.status,
          } : null,
        },
      },

      set_analysis: {
        records_in_user_role_only: Array.from(userRoleNames).filter(n => !serviceRoleNames.has(n)),
        records_in_service_role_only: Array.from(serviceRoleNames).filter(n => !userRoleNames.has(n)),
        records_in_both: Array.from(userRoleNames).filter(n => serviceRoleNames.has(n)).length,
      },

      CONTRADICTION_EXPLANATION: {
        both_found_target: foundInUserRole && foundInServiceRole ? 'NO CONTRADICTION — target found in both roles' : 'TARGET MISSING FROM ONE OR BOTH ROLES',
        user_role_found: !!foundInUserRole,
        service_role_found: !!foundInServiceRole,
        difference_source: foundInUserRole && !foundInServiceRole ? 'User role has visibility that service role does not' : foundInServiceRole && !foundInUserRole ? 'Service role has visibility that user role does not' : 'Both agree on target visibility',
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});