import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import * as csvParse from 'npm:csv-parse/sync';

/**
 * VERIFY EXPORT RECORDS VIA CSV IDs
 * 
 * 1. Read Character_export.csv (user-provided upload)
 * 2. Extract 8 target records with their CSV IDs
 * 3. Lookup each ID directly in backend (bypasses list filtering)
 * 4. Verify ownership fields match CSV
 * 5. Identify query vs. data issues
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const TARGET_RECORDS = [
      { name: 'Rick Taylor', account: 'murqart@gmail.com' },
      { name: 'Nancy', account: 'murqart@gmail.com' },
      { name: 'Ken', account: 'adobevgc@gmail.com' },
      { name: 'Chris Brown', account: 'adobevgc@gmail.com' },
      { name: 'Alden Spencer', account: 'adobevgc@gmail.com' },
      { name: 'Jayden Jackson', account: 'adobevgc@gmail.com' },
      { name: 'Mark', account: 'adobevgc@gmail.com' },
      { name: 'Leo', account: 'adobevgc@gmail.com' }
    ];

    // CSV data provided by user (paste content below if needed)
    // For now, try to fetch from uploaded file if available
    const csvData = `id,name,owner_email,owner_user_id,created_by,character_type,is_active_character
69e3f96fd9761e3f08fcd4f9,Rick Taylor,murqart@gmail.com,69c08d3a9227ca62c30b2c29,murqart@gmail.com,npc_fictitious,false
69cc3d3c7427c0a3f7423c92,Nancy,,,,npc_family_member,false
69dc124ddcbb6c398e71c40b,Ken,adobevgc@gmail.com,69dc11160b6a8c4e19937fac,adobevgc@gmail.com,active_created_character,true
69dfcd6c96f06a0babbef844,Chris Brown,adobevgc@gmail.com,69dc11160b6a8c4e19937fac,adobevgc@gmail.com,active_created_character,true
69e1cbaf2dae540ad7f9042a,Alden Spencer,adobevgc@gmail.com,69dc11160b6a8c4e19937fac,adobevgc@gmail.com,active_created_character,true
69e723823c06d08253e79c94,Jayden  Jackson,adobevgc@gmail.com,69dc11160b6a8c4e19937fac,adobevgc@gmail.com,active_created_character,true`;

    // Parse CSV
    const records = csvParse.parse(csvData, {
      columns: true,
      skip_empty_lines: true
    });

    // Build ID map from CSV
    const csvIdMap = {};
    for (const rec of records) {
      csvIdMap[rec.id] = rec;
    }

    // ─────────────────────────────────────────────────────────────────
    // LOOKUP EACH CSV RECORD BY ID IN BACKEND
    // ─────────────────────────────────────────────────────────────────

    const verificationResults = {};

    for (const target of TARGET_RECORDS) {
      // Find CSV record
      const csvRecord = records.find(r => {
        const csvName = r.name.trim().toLowerCase();
        const targetName = target.name.toLowerCase();
        return csvName === targetName;
      });

      if (!csvRecord) {
        verificationResults[target.name] = {
          status: 'NOT_IN_CSV',
          target,
          csv_record: null,
          backend_record: null
        };
        continue;
      }

      // Try to get from backend by ID
      let backendRecord = null;
      try {
        backendRecord = await base44.asServiceRole.entities.Character.get(csvRecord.id);
      } catch (err) {
        // Record not found by ID
      }

      verificationResults[target.name] = {
        status: backendRecord ? 'FOUND_IN_BACKEND' : 'NOT_FOUND_IN_BACKEND',
        csv_id: csvRecord.id,
        csv_owner_email: csvRecord.owner_email || null,
        csv_owner_user_id: csvRecord.owner_user_id || null,
        csv_created_by: csvRecord.created_by || null,
        csv_character_type: csvRecord.character_type,
        csv_is_active_character: csvRecord.is_active_character,
        backend_found: !!backendRecord,
        backend_owner_email: backendRecord?.owner_email || null,
        backend_owner_user_id: backendRecord?.owner_user_id || null,
        backend_created_by: backendRecord?.created_by || null,
        backend_character_type: backendRecord?.character_type || null,
        backend_is_active_character: backendRecord?.is_active_character || null,
        backend_status: backendRecord?.status || null,
        ownership_match: backendRecord && csvRecord.owner_email && backendRecord.owner_email === csvRecord.owner_email ? 'MATCH' : 'MISMATCH_OR_MISSING'
      };
    }

    // ─────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────

    const found = Object.values(verificationResults).filter(r => r.status === 'FOUND_IN_BACKEND').length;
    const notFound = Object.values(verificationResults).filter(r => r.status === 'NOT_FOUND_IN_BACKEND').length;
    const notInCsv = Object.values(verificationResults).filter(r => r.status === 'NOT_IN_CSV').length;

    return Response.json({
      task: 'VERIFY_EXPORT_RECORDS_VIA_CSV_IDS',
      target_records_count: TARGET_RECORDS.length,
      found_in_backend: found,
      not_found_in_backend: notFound,
      not_in_csv: notInCsv,
      verification_results: verificationResults,
      issues_found: {
        records_with_missing_ownership: Object.entries(verificationResults)
          .filter(([_, r]) => r.csv_owner_email === null || r.csv_owner_email === '')
          .map(([name]) => name),
        double_spaced_names: Object.entries(verificationResults)
          .filter(([_, r]) => r.csv_id && csvIdMap[r.csv_id]?.name?.includes('  '))
          .map(([name]) => name),
        is_active_character_mismatch: Object.entries(verificationResults)
          .filter(([_, r]) => r.csv_character_type === 'active_created_character' && r.csv_is_active_character === 'false')
          .map(([name]) => name)
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});