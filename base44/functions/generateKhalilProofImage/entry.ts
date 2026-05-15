import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (!user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. FETCH KHALIL CHARACTER
    const chars = await base44.entities.Character.list('-updated_date', 200).catch(() => []);
    const khalil = chars.find(c => c.name && c.name.toLowerCase().includes('khalil'));

    if (!khalil) {
      return Response.json({ error: 'Khalil not found' }, { status: 404 });
    }

    console.log(`[KhalilProof] Found Khalil: ${khalil.id} | current_outfit: ${khalil.current_outfit?.label}`);

    // 2. CREATE A MESSAGE RECORD FOR GENERATION (use service role to bypass RLS)
    const testMessage = await base44.asServiceRole.entities.Message.create({
      conversation_id: `test_khalil_proof_${Date.now()}`,
      sender_type: 'user',
      character_id: khalil.id,
      character_name: khalil.name,
      content: 'Generate Khalil wearing his current outfit - Casual Athleisure',
      owner_email: user.email,
    });

    console.log(`[KhalilProof] Created message: ${testMessage.id}`);

    // 3. BUILD PROMPT
    const outfit = khalil.current_outfit;
    let outfitText = null;
    if (outfit) {
      const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
        .filter(Boolean)
        .map(p => { const t = p.trim(); return /^(n\/?a|none|-)$/i.test(t) ? null : t.replace(/^n\/?a[,\-–]\s*/i,'').trim()||null; })
        .filter(Boolean);
      outfitText = parts.length > 0 ? parts.join(', ') : null;
    }

    console.log(`[KhalilProof] Resolved outfit text: "${outfitText}"`);

    // 4. CALL GENERATEIMAGEASYNC
    const genResponse = await base44.asServiceRole.functions.invoke('generateImageAsync', {
      messageId: testMessage.id,
      prompt: `[CHARACTER] Khalil Carter standing in his casual athleisure outfit. Shirtless, bare torso visible. Grey sweatpants with elastic waistband and cuffs. White sneakers. Full body shot showing the complete outfit. Relaxed pose.`,
      subjectType: 'character',
      characterId: khalil.id,
      characterName: khalil.name,
      characterReferenceImages: khalil.reference_image_urls || [],
      characterEmotionalState: khalil.emotional_state || 'calm',
      ownerEmail: user.email,
    });

    console.log(`[KhalilProof] Generation response:`, genResponse);

    // 5. FETCH UPDATED MESSAGE WITH GENERATION CONTEXT
    const updatedMsg = await base44.entities.Message.filter({ id: testMessage.id }, null, 1).then(r => r[0]);

    return Response.json({
      success: true,
      khalil_id: khalil.id,
      khalil_name: khalil.name,
      message_id: testMessage.id,
      generated_image_url: genResponse?.imageUrl,
      generation_context: updatedMsg?.generation_context,
      outfit_metadata: {
        label: outfit?.label,
        category: outfit?.category,
        top: outfit?.top,
        bottom: outfit?.bottom,
        shoes: outfit?.shoes,
        outerwear: outfit?.outerwear,
        accessories: outfit?.accessories,
        full_description: outfit?.full_description,
      },
      resolved_outfit_text: outfitText,
      generation_response: genResponse,
    });

  } catch (error) {
    console.error('[KhalilProof] Error:', error.message);
    return Response.json({
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
});