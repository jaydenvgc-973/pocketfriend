import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * processMonthlyVGCMobileBilling
 * 
 * Runs on the 1st of every month to charge all active created characters $50 for VGC Mobile.
 * Called by scheduled automation.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch all active characters
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { status: 'active', character_type: 'active' },
      null,
      1000
    );

    const now = new Date();
    const billingMonth = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    let successCount = 0;
    let failureCount = 0;

    // Charge each character
    for (const char of allChars) {
      try {
        await base44.asServiceRole.functions.invoke('chargeVGCMobileBill', {
          characterId: char.id,
          billingMonth,
        });
        successCount++;
      } catch (err) {
        console.error(`[processMonthlyVGCMobileBilling] Failed to charge ${char.name}:`, err.message);
        failureCount++;
      }
    }

    console.log(`[processMonthlyVGCMobileBilling] Charged ${successCount} characters, ${failureCount} failures`);

    return Response.json({
      success: true,
      totalCharacters: allChars.length,
      charged: successCount,
      failed: failureCount,
      month: billingMonth,
    });
  } catch (error) {
    console.error('[processMonthlyVGCMobileBilling]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});