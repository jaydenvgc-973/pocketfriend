import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // ETHAN - hardcoded ID from diagnostic functions
    const ethanId = "69c0d59d7e382cc866ded9c9";
    
    // Fetch Ethan
    const ethanList = await base44.asServiceRole.entities.Character.filter({ id: ethanId }, null, 1);
    const ethan = ethanList[0];
    
    if (!ethan) {
      return Response.json({ error: `Ethan not found (id: ${ethanId})` }, { status: 404 });
    }

    console.log(`\n========== ETHAN CHARACTER ANALYSIS ==========\n`);
    console.log(`Name: ${ethan.name}`);
    console.log(`ID: ${ethan.id}`);
    console.log(`Created By: ${ethan.created_by}`);
    console.log(`Owner Email: ${ethan.owner_email}`);
    console.log(`Status: ${ethan.status}`);
    console.log(`Character Type: ${ethan.character_type}`);
    console.log(`Data Scope: ${ethan.data_scope}`);
    console.log(`Visibility Scope: ${ethan.visibility_scope}`);
    console.log(`Is Protected: ${ethan.is_protected}`);
    console.log(`Is Photogenic: ${ethan.is_photogenic}`);
    console.log(`System Prompt URL: ${ethan.system_prompt_url || 'NONE'}`);
    console.log(`Reference Images: ${(ethan.reference_image_urls || []).length}`);
    console.log(`Home Location ID: ${ethan.current_home_location_id || ethan.home_location_id || 'NONE'}`);
    console.log(`Avatar URL: ${ethan.avatar_url ? 'YES' : 'NO'}`);
    console.log(`Avatar Description: ${ethan.avatar_description_text || 'NONE'}`);
    console.log(`Avatar Generation Prompt: ${ethan.avatar_generation_prompt || 'NONE'}`);
    console.log(`Appearance Lock: ${ethan.appearance_lock ? 'YES' : 'NO'}`);
    console.log(`Voice Enabled: ${ethan.voice_enabled}`);
    console.log(`Is Active Character: ${ethan.is_active_character}`);
    console.log(`Created Date: ${ethan.created_date}`);
    console.log(`Updated Date: ${ethan.updated_date}`);

    // Now fetch OTHER active characters that have successfully generated images
    // Look for characters with image_url in their recent messages
    console.log(`\n========== FETCHING WORKING CHARACTERS ==========\n`);
    
    const otherChars = await base44.asServiceRole.entities.Character.filter({
      status: "active",
      character_type: "active_created_character",
      id: { $ne: ethanId }
    }, '-created_date', 50);

    console.log(`Found ${otherChars.length} other active characters\n`);

    // Check which have messages with images
    const workingChars = [];
    for (const char of otherChars.slice(0, 10)) {
      const messages = await base44.asServiceRole.entities.Message.filter({
        character_id: char.id,
        image_url: { $exists: true }
      }, '-created_date', 1);
      
      if (messages.length > 0) {
        workingChars.push({ char, messageCount: messages.length });
      }
    }

    console.log(`Characters with successful image generation: ${workingChars.length}\n`);

    // Compare Ethan to first working character
    if (workingChars.length > 0) {
      const working = workingChars[0].char;
      
      console.log(`\n========== SIDE-BY-SIDE COMPARISON ==========\n`);
      console.log(`FIELD | ETHAN | ${working.name.toUpperCase()}`);
      console.log(`------|-------|-------`);
      console.log(`Status | ${ethan.status} | ${working.status}`);
      console.log(`Character Type | ${ethan.character_type} | ${working.character_type}`);
      console.log(`Owner Email | ${ethan.owner_email || 'NONE'} | ${working.owner_email || 'NONE'}`);
      console.log(`Created By | ${ethan.created_by?.substring(0, 20)}... | ${working.created_by?.substring(0, 20)}...`);
      console.log(`Data Scope | ${ethan.data_scope} | ${working.data_scope}`);
      console.log(`Visibility Scope | ${ethan.visibility_scope} | ${working.visibility_scope}`);
      console.log(`Is Protected | ${ethan.is_protected} | ${working.is_protected}`);
      console.log(`Is Photogenic | ${ethan.is_photogenic} | ${working.is_photogenic}`);
      console.log(`Reference Images | ${(ethan.reference_image_urls || []).length} | ${(working.reference_image_urls || []).length}`);
      console.log(`Home Location | ${ethan.current_home_location_id || ethan.home_location_id || 'NONE'} | ${working.current_home_location_id || working.home_location_id || 'NONE'}`);
      console.log(`Avatar URL | ${ethan.avatar_url ? 'YES' : 'NO'} | ${working.avatar_url ? 'YES' : 'NO'}`);
      console.log(`System Prompt URL | ${ethan.system_prompt_url ? 'YES' : 'NO'} | ${working.system_prompt_url ? 'YES' : 'NO'}`);
      console.log(`Voice Enabled | ${ethan.voice_enabled} | ${working.voice_enabled}`);
      console.log(`Is Active Character | ${ethan.is_active_character} | ${working.is_active_character}`);

      // Check RLS
      console.log(`\n========== RLS & ACCESS CHECK ==========\n`);
      console.log(`Ethan Owner Email: ${ethan.owner_email}`);
      console.log(`Working Char Owner Email: ${working.owner_email}`);
      console.log(`Ethan Created By: ${ethan.created_by}`);
      console.log(`Working Char Created By: ${working.created_by}`);
      console.log(`Are they the same owner? ${ethan.owner_email === working.owner_email ? 'YES' : 'NO'}`);
      console.log(`Are they the same creator? ${ethan.created_by === working.created_by ? 'YES' : 'NO'}`);

      // Check location access
      const ethanLocId = ethan.current_home_location_id || ethan.home_location_id;
      const workingLocId = working.current_home_location_id || working.home_location_id;
      
      if (ethanLocId) {
        const ethanLoc = await base44.asServiceRole.entities.LocationReference.filter({ id: ethanLocId }, null, 1);
        if (ethanLoc[0]) {
          console.log(`\nEthan's Location: ${ethanLoc[0].name}`);
          console.log(`  Owner Email: ${ethanLoc[0].owner_email}`);
          console.log(`  Scope: ${ethanLoc[0].scope}`);
          console.log(`  Zone Count: ${(ethanLoc[0].zones || []).length}`);
        }
      }

      if (workingLocId) {
        const workingLoc = await base44.asServiceRole.entities.LocationReference.filter({ id: workingLocId }, null, 1);
        if (workingLoc[0]) {
          console.log(`\n${working.name}'s Location: ${workingLoc[0].name}`);
          console.log(`  Owner Email: ${workingLoc[0].owner_email}`);
          console.log(`  Scope: ${workingLoc[0].scope}`);
          console.log(`  Zone Count: ${(workingLoc[0].zones || []).length}`);
        }
      }
    }

    return Response.json({
      ethan: {
        name: ethan.name,
        id: ethan.id,
        owner: ethan.owner_email,
        createdBy: ethan.created_by,
        status: ethan.status,
        characterType: ethan.character_type,
        dataScope: ethan.data_scope,
        visibilityScope: ethan.visibility_scope,
        isProtected: ethan.is_protected,
        isPhotogenic: ethan.is_photogenic,
        referenceImages: (ethan.reference_image_urls || []).length,
        homeLocationId: ethan.current_home_location_id || ethan.home_location_id,
        hasAvatar: !!ethan.avatar_url,
        hasSystemPrompt: !!ethan.system_prompt_url,
      },
      workingCharactersFound: workingChars.length,
      comparisonCharacter: workingChars.length > 0 ? {
        name: workingChars[0].char.name,
        owner: workingChars[0].char.owner_email,
        createdBy: workingChars[0].char.created_by,
        status: workingChars[0].char.status,
        characterType: workingChars[0].char.character_type,
        dataScope: workingChars[0].char.data_scope,
        visibilityScope: workingChars[0].char.visibility_scope,
      } : null,
    });

  } catch (error) {
    console.error('Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});