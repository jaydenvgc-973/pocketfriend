import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    console.log(`\n========== UNIFIED CAMERA SYSTEM DIAGNOSTIC ==========\n`);
    
    // Fetch recent image messages from various characters
    const allMessages = await base44.asServiceRole.entities.Message.filter({
      image_url: { $exists: true }
    }, '-created_date', 100);

    console.log(`Total image messages found: ${allMessages.length}\n`);

    // Group by character
    const byCharacter = {};
    for (const msg of allMessages) {
      if (!byCharacter[msg.character_id]) {
        byCharacter[msg.character_id] = [];
      }
      byCharacter[msg.character_id].push(msg);
    }

    console.log(`========== CHARACTER COVERAGE ==========\n`);
    for (const [charId, msgs] of Object.entries(byCharacter)) {
      console.log(`Character ${charId}: ${msgs.length} images`);
    }

    // Analyze generation context from messages
    console.log(`\n========== GENERATION CONTEXT ANALYSIS ==========\n`);
    
    const contextAnalysis = [];
    for (const msg of allMessages.slice(0, 30)) {
      if (msg.generation_context) {
        const ctx = msg.generation_context;
        contextAnalysis.push({
          messageId: msg.id,
          characterId: msg.character_id,
          characterName: msg.character_name,
          prompt: ctx.prompt,
          subjectType: ctx.subject_type,
          locationName: ctx.location_name,
          zoneName: ctx.zone_name,
          hasCharacterRefs: (ctx.character_reference_images || []).length > 0,
          hasLocationRefs: (ctx.location_reference_images || []).length > 0,
        });
      }
    }

    console.log(`Messages with generation_context: ${contextAnalysis.length}\n`);
    
    for (const analysis of contextAnalysis.slice(0, 5)) {
      console.log(`\n--- Message: ${analysis.messageId.substring(0, 12)}...`);
      console.log(`Character: ${analysis.characterName}`);
      console.log(`Subject Type: ${analysis.subjectType}`);
      console.log(`Location: ${analysis.locationName} (zone: ${analysis.zoneName || 'none'})`);
      console.log(`Prompt: "${analysis.prompt?.substring(0, 150)}..."`);
      console.log(`Has Char Refs: ${analysis.hasCharacterRefs}`);
      console.log(`Has Location Refs: ${analysis.hasLocationRefs}`);
    }

    console.log(`\n========== CAMERA SYSTEM COMPLIANCE CHECK ==========\n`);
    console.log(`CHECKING FOR:`);
    console.log(`1. Camera position changes between consecutive messages`);
    console.log(`2. Distance/proximity changes (close-up vs wide)`);
    console.log(`3. Height variation (eye level, low angle, elevated)`);
    console.log(`4. Angle/orientation changes`);
    console.log(`5. Environmental response (background elements shift)`);
    console.log(`6. Perspective consistency`);
    console.log(`7. Framing diversity across messages\n`);

    // Check for conversation threads
    const conversations = new Map();
    for (const msg of allMessages) {
      if (!conversations.has(msg.conversation_id)) {
        conversations.set(msg.conversation_id, []);
      }
      conversations.get(msg.conversation_id).push(msg);
    }

    const threadAnalysis = [];
    for (const [convoId, msgs] of conversations.entries()) {
      if (msgs.length >= 2) {
        const sorted = msgs.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        threadAnalysis.push({
          conversationId: convoId,
          characterId: sorted[0].character_id,
          characterName: sorted[0].character_name,
          imageCount: sorted.length,
          messages: sorted.map(m => ({
            id: m.id.substring(0, 12),
            prompt: m.generation_context?.prompt?.substring(0, 100),
            created: m.created_date,
          }))
        });
      }
    }

    console.log(`Conversations with multiple images: ${threadAnalysis.length}\n`);
    
    for (const thread of threadAnalysis.slice(0, 3)) {
      console.log(`\nThread: ${thread.conversationId.substring(0, 12)}...`);
      console.log(`Character: ${thread.characterName}`);
      console.log(`Images: ${thread.imageCount}\n`);
      for (const msg of thread.messages) {
        console.log(`  [${msg.id}] "${msg.prompt}"`);
      }
    }

    console.log(`\n========== PROMPT ANALYSIS FOR CAMERA DIRECTIVES ==========\n`);
    
    let promptsWithCameraInstructions = 0;
    let promptsWithPositionChanges = 0;
    let promptsWithDistanceChanges = 0;
    let promptsWithHeightChanges = 0;
    let promptsWithAngleChanges = 0;

    for (const analysis of contextAnalysis) {
      const prompt = (analysis.prompt || '').toLowerCase();
      if (prompt.includes('camera') || prompt.includes('position') || prompt.includes('angle')) {
        promptsWithCameraInstructions++;
      }
      if (prompt.includes('left') || prompt.includes('right') || prompt.includes('move') || prompt.includes('forward') || prompt.includes('back')) {
        promptsWithPositionChanges++;
      }
      if (prompt.includes('close') || prompt.includes('far') || prompt.includes('distance') || prompt.includes('zoom')) {
        promptsWithDistanceChanges++;
      }
      if (prompt.includes('eye level') || prompt.includes('low angle') || prompt.includes('elevated') || prompt.includes('height')) {
        promptsWithHeightChanges++;
      }
      if (prompt.includes('angle') || prompt.includes('diagonal') || prompt.includes('straight') || prompt.includes('orientation')) {
        promptsWithAngleChanges++;
      }
    }

    console.log(`Prompts with camera instructions: ${promptsWithCameraInstructions}/${contextAnalysis.length}`);
    console.log(`Prompts mentioning position: ${promptsWithPositionChanges}/${contextAnalysis.length}`);
    console.log(`Prompts mentioning distance: ${promptsWithDistanceChanges}/${contextAnalysis.length}`);
    console.log(`Prompts mentioning height: ${promptsWithHeightChanges}/${contextAnalysis.length}`);
    console.log(`Prompts mentioning angle: ${promptsWithAngleChanges}/${contextAnalysis.length}`);

    return Response.json({
      totalImages: allMessages.length,
      charactersWithImages: Object.keys(byCharacter).length,
      messagesWithContext: contextAnalysis.length,
      threadsWithMultipleImages: threadAnalysis.length,
      cameraComplianceStatus: {
        promptsWithCameraInstructions,
        promptsWithPositionChanges,
        promptsWithDistanceChanges,
        promptsWithHeightChanges,
        promptsWithAngleChanges,
      },
      complianceScore: `${((promptsWithCameraInstructions + promptsWithPositionChanges + promptsWithDistanceChanges) / (contextAnalysis.length * 3) * 100).toFixed(1)}%`
    });

  } catch (error) {
    console.error('Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});