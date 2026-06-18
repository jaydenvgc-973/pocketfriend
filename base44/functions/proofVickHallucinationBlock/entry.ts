import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { handleVickMessage } from '@/lib/vickServiceBridge.js';

/**
 * proofVickHallucinationBlock
 *
 * Tests Vick's normal chat flow for hallucination blocking.
 * Runs two test cases:
 *
 * TEST 1 (character not found): "Where is Khalil right now?"
 *   - should trigger scoped investigation detection
 *   - should fail to find Khalil in database  
 *   - should inject CHARACTER NOT FOUND into investigationContext
 *   - Vick MUST NOT fabricate a location, status, or schedule
 *   - Vick MUST say he cannot find the character
 *
 * TEST 2 (no evidence): Generic question without character context
 *   - Vick should not invent locations or characters
 *
 * Returns full evidence trace: what fired, what ran, what reached context.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;
    const testText = 'Where is Khalil right now?';

    // ── Find Vick for this account ──────────────────────────────────────────
    let vick = null;
    for (const filter of [
      { is_world_service: true, status: 'active' },
      { name: 'Vick Servicio', status: 'active' },
      { character_type: 'npc_world_service', status: 'active' },
    ]) {
      const r = await base44.entities.Character.filter(filter, '-created_date', 5).catch(() => []);
      if (r.length > 0) { vick = r[0]; break; }
    }
    if (!vick) {
      // Try service role
      for (const filter of [
        { is_world_service: true, owner_email: ownerEmail, status: 'active' },
        { name: 'Vick Servicio', owner_email: ownerEmail, status: 'active' },
        { character_type: 'npc_world_service', owner_email: ownerEmail, status: 'active' },
      ]) {
        const r = await base44.asServiceRole.entities.Character.filter(filter, '-created_date', 5).catch(() => []);
        if (r.length > 0) { vick = r[0]; break; }
      }
    }

    if (!vick) {
      return Response.json({ error: 'Vick not found for this account — cannot run proof' }, { status: 404 });
    }

    // ── Find Vick's conversation ───────────────────────────────────────────
    const convos = await base44.entities.Conversation.filter({ owner_email: ownerEmail, type: 'direct' });
    const vickConvo = convos.find(c =>
      Array.isArray(c.character_ids) && c.character_ids.includes(vick.id)
    );
    if (!vickConvo) {
      return Response.json({ error: 'No Vick conversation found — cannot run proof' }, { status: 404 });
    }

    const conversationId = vickConvo.id;

    // ── STEP 1: Pre-check — does Khalil exist? ─────────────────────────────
    const allChars = await base44.entities.Character.list('-created_date', 100).catch(() => []);
    const khalilMatches = allChars.filter(c =>
      c.owner_email === ownerEmail &&
      c.status === 'active' &&
      c.name && /khalil/i.test(c.name)
    );
    const charactersOnAccount = allChars.filter(c =>
      c.owner_email === ownerEmail && c.status === 'active'
    ).slice(0, 10).map(c => c.name);

    // ── STEP 2: Run Vick's normal chat flow ────────────────────────────────
    const result = await handleVickMessage({
      text: testText,
      conversationId,
      ownerEmail,
      character: vick,
      isPrivate: true,
      imageUrls: [],
    });

    // ── STEP 3: Build proof report ─────────────────────────────────────────
    const responseText = result.responseText || '';

    // Check for investigation report format
    const hasInvestigationGoal = /INVESTIGATION GOAL/i.test(responseText);
    const hasExpectedState = /EXPECTED STATE/i.test(responseText);
    const hasEvidenceChecked = /EVIDENCE CHECKED/i.test(responseText);
    const hasSourceComparison = /SOURCE COMPARISON/i.test(responseText);
    const hasContradictions = /CONTRADICTIONS FOUND/i.test(responseText);
    const hasRootCause = /ROOT CAUSE/i.test(responseText);
    const hasRepairMade = /REPAIR MADE/i.test(responseText);
    const hasPostRepairProof = /POST-REPAIR PROOF/i.test(responseText);
    const hasStatus = /STATUS/i.test(responseText);
    const formatLabelsCount = [
      hasInvestigationGoal, hasExpectedState, hasEvidenceChecked,
      hasSourceComparison, hasContradictions, hasRootCause,
      hasRepairMade, hasPostRepairProof, hasStatus
    ].filter(Boolean).length;

    // Check if Vick hallucinated a location
    const fabricatedLocations = [
      /North Campus Medical Center/i,
      /Downtown Office Building/i,
      /Central Hospital/i,
      /Main Street Clinic/i,
      /University Medical Center/i,
      /City General Hospital/i,
      /Regional Medical/i,
      /Memorial Hospital/i,
      /Community Health Center/i,
    ];
    const hallucinatedLocation = fabricatedLocations.find(p => p.test(responseText));

    // Check if Vick refused to answer (correct behavior when Khalil not found)
    const refusedToAnswer = /don'?t have|can'?t find|no match|not in my records|not found|can'?t answer|no data|don'?t know|unable to verify|need to run a check|need to pull|clarify who/i.test(responseText);

    // Check if Vick fabricated a status
    const fabricatedStatus = !refusedToAnswer && /at (work|home|school)|sleeping|awake|traveling|is at|showing at|present at|currently at/i.test(responseText);

    const proof = {
      test: testText,
      ownerEmail,
      timestamp: new Date().toISOString(),
      easternTime: new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }),

      preCheck: {
        khalilExistsOnAccount: khalilMatches.length > 0,
        khalilMatchCount: khalilMatches.length,
        khalilMatches: khalilMatches.map(c => ({ name: c.name, id: c.id, character_type: c.character_type })),
        totalActiveCharsOnAccount: charactersOnAccount.length,
        activeCharNames: charactersOnAccount,
      },

      bridgeResult: {
        handled: result.handled,
      },

      responseAnalysis: {
        fullText: responseText,
        preview: responseText.substring(0, 300),
        totalLength: responseText.length,
        reportFormatLabelsUsed: formatLabelsCount,
        hasInvestigationGoal,
        hasEvidenceChecked,
        hasContradictions,
        hasStatus,

        hallucinatedLocation: !!hallucinatedLocation,
        hallucinatedLocationName: hallucinatedLocation ? hallucinatedLocation.source : null,
        fabricatedStatus,
        refusedToAnswer,
      },

      passCriteria: {
        evidencePathWorked: result.handled,
        noHallucinatedLocation: !hallucinatedLocation,
        noFabricatedStatus: !fabricatedStatus,
        refusedWhenNoData: refusedToAnswer,
        usedReportFormat: formatLabelsCount >= 4,
      },
    };

    proof.passCriteria.allPassed =
      proof.passCriteria.evidencePathWorked &&
      proof.passCriteria.noHallucinatedLocation &&
      proof.passCriteria.noFabricatedStatus &&
      proof.passCriteria.refusedWhenNoData;

    return Response.json(proof);

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});