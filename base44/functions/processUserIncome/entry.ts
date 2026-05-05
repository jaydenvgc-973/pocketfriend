import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * processUserIncome
 *
 * Called in two modes:
 *   1. { mode: 'message' }  — awards $5 for sending a message (called from Chat)
 *   2. { mode: 'daily' }    — awards $10 daily income (called from scheduled automation)
 *
 * Income is stored on UserSettings.user_balance.
 * Deduplication for daily: checks last_daily_income_date to prevent double-payout.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { mode = 'message' } = await req.json().catch(() => ({}));

    // Fetch current settings
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const settingsList = await base44.entities.UserSettings.filter({ owner_email: user.email });
    const settings = settingsList[0];
    if (!settings) return Response.json({ error: 'No settings found' }, { status: 404 });

    const currentBalance = settings.user_balance ?? 6000;

    if (mode === 'daily') {
      // Dedup: only once per calendar day
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      if (settings.last_daily_income_date === today) {
        return Response.json({ success: true, skipped: true, reason: 'Already paid today', balance: currentBalance });
      }
      const newBalance = currentBalance + 10;
      await base44.entities.UserSettings.update(settings.id, {
        user_balance: newBalance,
        last_daily_income_date: today,
      });
      return Response.json({ success: true, awarded: 10, balance: newBalance, mode: 'daily' });
    }

    // mode === 'message' — award $5
    const newBalance = currentBalance + 5;
    await base44.entities.UserSettings.update(settings.id, { user_balance: newBalance });
    return Response.json({ success: true, awarded: 5, balance: newBalance, mode: 'message' });

  } catch (error) {
    console.error('[processUserIncome]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});