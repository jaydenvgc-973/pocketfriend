import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * vickDiagnosticChatFlowProof
 *
 * TRUE end-to-end proof. No hardcoded data. No synthetic fixtures.
 *
 * This function simulates EXACTLY what happens in Chat.jsx when the user
 * types "run a diagnostic on my account" to Vick Servicio:
 *
 * Step 1: Authenticate user
 * Step 2: Find Vick Servicio for this account (live DB lookup)
 * Step 3: Call vickRunDiagnostic LIVE — real DB queries, real account data
 * Step 4: Build the exact same LLM prompt that Chat.jsx builds
 * Step 5: Call the LLM with real diagnostic results injected
 * Step 6: Return Vick's actual response
 *
 * The response returned here is IDENTICAL to what the user would see
 * in the chat UI when they type a diagnostic request to Vick.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;

    // ── STEP 1: Find Vick Servicio (live DB lookup) ────────────────────────
    let vick = null;
    try {
      const vickResult = await base44.entities.Character.filter({
        character_type: 'npc_world_service',
        owner_email: ownerEmail,
        status: 'active',
      });
      vick = vickResult[0] || null;
    } catch (_) {}

    if (!vick) {
      return Response.json({
        success: false,
        error: 'Vick Servicio not found for this account. Run ensureVickServicio first.',
        ownerEmail,
      }, { status: 404 });
    }

    // ── STEP 2: Call vickRunDiagnostic LIVE ────────────────────────────────
    // This is a real call — no hardcoded data, no fixtures.
    // This is the exact same call Chat.jsx makes via:
    //   base44.functions.invoke('vickRunDiagnostic', { diagnosticType: 'account_overview' })
    const diagResult = await base44.functions.invoke('vickRunDiagnostic', {
      diagnosticType: 'account_overview',
    });

    const diagData = diagResult?.data;

    if (!diagData?.success) {
      return Response.json({
        success: false,
        error: 'vickRunDiagnostic did not return success',
        raw: diagData,
        ownerEmail,
        vick_id: vick.id,
      }, { status: 500 });
    }

    // ── STEP 3: Build Vick's LLM prompt — identical to Chat.jsx ───────────
    const nowET = new Date().toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const vickIdentity = `You ARE Vick Servicio. You are the conversational face of the Account Help & Repair system — a diagnostics specialist and recovery specialist. You just ran a full account diagnostic and have the real results below. Report them plainly and honestly. Do not invent findings. Do not claim you ran checks that are not listed. You are direct, calm, and specific.`;

    const diagnosticBlock = `

════════════════════════════════════
LIVE DIAGNOSTIC RESULTS — REAL DATA (ran at ${nowET} Eastern)
════════════════════════════════════
${diagData.plainSummary}

Functions executed: ${(diagData.functionsExecuted || []).join(', ')}
Verdict: ${diagData.verdict}
Errors found: ${diagData.errorCount}
Warnings found: ${diagData.warningCount}
════════════════════════════════════
CRITICAL RULE: Use ONLY these results. Do not invent or add anything. Report exactly what was found above — no more, no less.`;

    const userMessage = "run a diagnostic on my account";

    const fullPrompt = `${vickIdentity}${diagnosticBlock}

The user just said: "${userMessage}"

Respond as Vick. Report the diagnostic findings from the real data above. Be specific and direct. 2-4 sentences. No bullet points. Do not start with your own name.`;

    // ── STEP 4: Call the LLM ───────────────────────────────────────────────
    const llmResponse = await base44.integrations.Core.InvokeLLM({ prompt: fullPrompt });

    // ── RETURN PROOF ───────────────────────────────────────────────────────
    return Response.json({
      success: true,
      proof_type: 'LIVE_END_TO_END — no hardcoded data',
      account: ownerEmail,
      vick: {
        id: vick.id,
        name: vick.name,
        character_type: vick.character_type,
      },
      step2_live_diagnostic: {
        verdict: diagData.verdict,
        errorCount: diagData.errorCount,
        warningCount: diagData.warningCount,
        functionsExecuted: diagData.functionsExecuted,
        findings: diagData.findings,
      },
      step3_vick_response: llmResponse,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});