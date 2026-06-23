/**
 * buildCommitmentAwarenessBlock
 *
 * Extracted helper for Step 5c of buildCanonicalCharacterContext.
 *
 * Reads CommunicationCommitment records for a character (pending + recently resolved).
 * Returns:
 *   - awarenessBlock      : string to inject into the canonical prompt
 *   - latestCommitmentTs  : ISO timestamp of the most recently updated commitment
 *   - pending             : count
 *   - recentlyResolved    : count
 *
 * READ-ONLY. No records are created, updated, or deleted.
 * Called by buildCanonicalCharacterContext for direct_chat and text contexts only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, characterName = '' } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId is required' }, { status: 400 });

    const sr = base44.asServiceRole;
    const now48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

    const [pendingCommitments, recentlyResolvedCommitments] = await Promise.all([
      sr.entities.CommunicationCommitment.filter(
        { character_id: characterId, status: 'pending' },
        'due_after',
        10
      ).catch(() => []),
      sr.entities.CommunicationCommitment.filter(
        { character_id: characterId },
        '-updated_date',
        5
      ).catch(() => []),
    ]);

    // Compute latestCommitmentTs across all fetched records (for freshness metadata)
    const allCommitments = [...pendingCommitments, ...recentlyResolvedCommitments];
    let latestCommitmentTs = null;
    if (allCommitments.length > 0) {
      const tss = allCommitments
        .map(c => c.updated_date || c.fulfilled_at || c.created_at || c.created_date)
        .filter(Boolean)
        .map(ts => new Date(ts).getTime());
      if (tss.length > 0) latestCommitmentTs = new Date(Math.max(...tss)).toISOString();
    }

    // Filter resolved to last 48h
    const recentlyResolved = recentlyResolvedCommitments.filter(c => {
      if (c.status === 'pending') return false;
      const ts = c.fulfilled_at || c.updated_date || c.created_date;
      if (!ts) return false;
      return new Date(ts) >= new Date(now48h);
    });

    const hasPending = pendingCommitments.length > 0;
    const hasResolved = recentlyResolved.length > 0;

    if (!hasPending && !hasResolved) {
      console.log(
        `[buildCommitmentAwarenessBlock] char=${characterName} (${characterId})` +
        ` | pending=0 | resolved=0 | latestCommitmentTs=${latestCommitmentTs || 'none'}`
      );
      return Response.json({
        awarenessBlock: '',
        latestCommitmentTs,
        pending: 0,
        recentlyResolved: 0,
      });
    }

    const lines = [];

    if (hasPending) {
      lines.push('PROMISES YOU STILL NEED TO KEEP:');
      for (const c of pendingCommitments) {
        const dueNote = c.due_after
          ? ` (due: ${new Date(c.due_after).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })})`
          : '';
        const targetNote = c.target_character_name ? ` → to ${c.target_character_name}` : '';
        const thirdPartyNote = c.third_party_character_name
          ? ` (relay to ${c.third_party_character_name}: "${c.third_party_message || ''}") `
          : '';
        lines.push(`• [${c.commitment_type.replace(/_/g, ' ')}]${targetNote}${thirdPartyNote}: "${(c.commitment_text || '').substring(0, 120)}"${dueNote}`);
      }
      lines.push('RULE: You remember making these promises. Do NOT re-promise. Either follow through or acknowledge you haven\'t yet.');
    }

    if (hasResolved) {
      lines.push('\nPROMISES YOU RECENTLY KEPT OR CLOSED (last 48h):');
      for (const c of recentlyResolved) {
        const statusLabel = c.status === 'fulfilled' ? 'KEPT'
          : c.status === 'expired' ? 'EXPIRED (not followed up)'
          : c.status.toUpperCase();
        const whenNote = c.fulfilled_at
          ? ` at ${new Date(c.fulfilled_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
          : '';
        lines.push(`• [${statusLabel}]${whenNote}: "${(c.commitment_text || '').substring(0, 100)}"`);
      }
      lines.push('RULE: These are already resolved. Do NOT re-promise or re-acknowledge them as pending — they are done.');
    }

    const awarenessBlock = `\n════════════════════════════════════\nCOMMUNICATION COMMITMENTS — YOUR PROMISE STATE\nSource: live CommunicationCommitment records. Never invented.\n════════════════════════════════════\n${lines.join('\n')}\n════════════════════════════════════\n`;

    console.log(
      `[buildCommitmentAwarenessBlock] char=${characterName} (${characterId})` +
      ` | pending=${pendingCommitments.length} | recently_resolved=${recentlyResolved.length}` +
      ` | latestCommitmentTs=${latestCommitmentTs || 'none'}`
    );

    return Response.json({
      awarenessBlock,
      latestCommitmentTs,
      pending: pendingCommitments.length,
      recentlyResolved: recentlyResolved.length,
    });

  } catch (error) {
    console.error(`[buildCommitmentAwarenessBlock] error: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});