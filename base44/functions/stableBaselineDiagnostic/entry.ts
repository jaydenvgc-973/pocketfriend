import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * STABLE BASELINE DIAGNOSTIC
 * 
 * Logs every parameter explicitly to ensure consistent, repeatable results.
 * Must return identical results when run 3 times with same account.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const runTimestamp = new Date().toISOString();

    // EXPLICIT PARAMETERS
    const queryParams = {
      entity_name: 'Character',
      method: 'asServiceRole.entities.Character.list',
      sort_by: '-updated_date',
      limit: 500,
      filters: 'NONE',
      service_role: true,
      user_role: false,
      pagination: 'single batch, no offset',
    };

    // Execute exact query
    const results = await base44.asServiceRole.entities.Character.list('-updated_date', 500);

    // Extract full record list
    const recordList = results.map(r => ({
      id: r.id,
      name: r.name,
      owner_email: r.owner_email,
      created_by: r.created_by,
      owner_user_id: r.owner_user_id,
      character_type: r.character_type,
      status: r.status,
    }));

    // Search for specific known names
    const targetNames = [
      'Melody Jackson Perry',
      'Andre Rivera',
      'Jonathan Anthony Smith',
      'Nathan Parker',
      'Ethan Thompson',
    ];

    const foundRecords = {};
    for (const name of targetNames) {
      const match = recordList.find(r => r.name === name);
      foundRecords[name] = match || { found: false };
    }

    return Response.json({
      baseline_diagnostic: 'STABLE_BASELINE_V1',
      timestamp: runTimestamp,
      user_email: user.email,
      user_id: user.id,

      query_parameters: queryParams,

      total_records_returned: recordList.length,
      
      record_list: recordList,

      target_name_search_results: foundRecords,

      summary: {
        melody_jackson_perry_found: !!foundRecords['Melody Jackson Perry'].found,
        total_names_found: Object.values(foundRecords).filter(r => r.found).length,
        total_names_not_found: Object.values(foundRecords).filter(r => !r.found).length,
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});