import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * retroactiveVGCMobileCharge
 * 
 * One-time function to charge all active characters for April 2026 VGC Mobile.
 * Can be called manually or as part of setup.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch all active created characters
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    let successCount = 0;
    let failureCount = 0;
    const failures = [];

    // Charge each character for April 2026
    for (const char of allChars) {
      try {
        await base44.asServiceRole.functions.invoke('chargeVGCMobileBill', {
          characterId: char.id,
          billingMonth: 'April 2026',
        });
        successCount++;
      } catch (err) {
        console.error(`[retroactiveVGCMobileCharge] Failed to charge ${char.name}:`, err.message);
        failureCount++;
        failures.push({ characterId: char.id, name: char.name, error: err.message });
      }
    }

    console.log(`[retroactiveVGCMobileCharge] Retroactive billing complete: ${successCount} charged, ${failureCount} failed`);

    return Response.json({
      success: true,
      totalCharacters: allChars.length,
      charged: successCount,
      failed: failureCount,
      failures: failures.length > 0 ? failures : undefined,
    });
  } catch (error) {
    console.error('[retroactiveVGCMobileCharge]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});