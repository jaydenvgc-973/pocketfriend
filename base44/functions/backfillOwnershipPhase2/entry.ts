import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * PHASE 2: BACKFILL OWNERSHIP
 * 
 * Populates owner_user_id for existing records based on created_by email.
 * This is CRITICAL — skipping this causes data disappearance after enforcement.
 * 
 * Processes:
 * - Character records
 * - LocationReference records
 * - Message records
 * - UserSettings records
 * - Conversation records
 * 
 * Admin-only function.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin check
    if (user?.role !== 'admin') {
      return Response.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const results = {
      character: { processed: 0, updated: 0, flagged: 0, errors: [] },
      location: { processed: 0, updated: 0, flagged: 0, errors: [] },
      message: { processed: 0, updated: 0, flagged: 0, errors: [] },
      usersettings: { processed: 0, updated: 0, flagged: 0, errors: [] },
      conversation: { processed: 0, updated: 0, flagged: 0, errors: [] },
    };

    // Helper: resolve email to user ID
    const resolveOwnerUserId = async (email) => {
      if (!email) return null;
      try {
        // Query User entity for the email
        const users = await base44.asServiceRole.entities.User.filter({ email });
        if (users && users.length > 0) {
          return users[0].id;
        }
      } catch (err) {
        console.warn(`[backfill] Could not resolve user for email ${email}:`, err.message);
      }
      return null;
    };

    // PHASE 2.1: Character backfill
    console.log('[backfill] Starting Character backfill...');
    try {
      let offset = 0;
      const pageSize = 50;
      let hasMore = true;

      while (hasMore) {
        const chars = await base44.asServiceRole.entities.Character.list(
          '-created_date',
          pageSize,
          offset
        );

        if (!chars || chars.length === 0) {
          hasMore = false;
          break;
        }

        for (const char of chars) {
          results.character.processed++;

          // Skip if already has owner_user_id
          if (char.owner_user_id) {
            continue;
          }

          // Determine owner
          let ownerUserId = null;
          if (char.created_by) {
            ownerUserId = await resolveOwnerUserId(char.created_by);
          }

          if (!ownerUserId) {
            results.character.flagged++;
            console.warn(`[backfill] Character ${char.id} (${char.name}) has no owner — flagging`);
            continue;
          }

          // Determine scope
          const dataScope = char.visibility_scope === 'admin_global' ? 'system_global' : 'private_user';

          // Update record
          try {
            await base44.asServiceRole.entities.Character.update(char.id, {
              owner_user_id: ownerUserId,
              data_scope: dataScope,
            });
            results.character.updated++;
          } catch (err) {
            results.character.errors.push(`Character ${char.id}: ${err.message}`);
          }
        }

        offset += pageSize;
        if (chars.length < pageSize) {
          hasMore = false;
        }
      }
      console.log(`[backfill] Character backfill complete: ${results.character.updated} updated, ${results.character.flagged} flagged`);
    } catch (err) {
      results.character.errors.push(`Batch error: ${err.message}`);
    }

    // PHASE 2.2: LocationReference backfill
    console.log('[backfill] Starting LocationReference backfill...');
    try {
      let offset = 0;
      const pageSize = 50;
      let hasMore = true;

      while (hasMore) {
        const locs = await base44.asServiceRole.entities.LocationReference.list(
          '-created_date',
          pageSize,
          offset
        );

        if (!locs || locs.length === 0) {
          hasMore = false;
          break;
        }

        for (const loc of locs) {
          results.location.processed++;

          // Skip if already has owner_user_id
          if (loc.owner_user_id) {
            continue;
          }

          // Determine owner
          let ownerUserId = null;
          if (loc.created_by) {
            ownerUserId = await resolveOwnerUserId(loc.created_by);
          }

          if (!ownerUserId) {
            results.location.flagged++;
            console.warn(`[backfill] Location ${loc.id} (${loc.name}) has no owner — flagging`);
            continue;
          }

          // Determine scope
          const dataScope = loc.scope === 'shared' ? 'shared' : 'private_user';

          // Update record
          try {
            await base44.asServiceRole.entities.LocationReference.update(loc.id, {
              owner_user_id: ownerUserId,
              data_scope: dataScope,
            });
            results.location.updated++;
          } catch (err) {
            results.location.errors.push(`Location ${loc.id}: ${err.message}`);
          }
        }

        offset += pageSize;
        if (locs.length < pageSize) {
          hasMore = false;
        }
      }
      console.log(`[backfill] LocationReference backfill complete: ${results.location.updated} updated, ${results.location.flagged} flagged`);
    } catch (err) {
      results.location.errors.push(`Batch error: ${err.message}`);
    }

    // PHASE 2.3: UserSettings backfill
    console.log('[backfill] Starting UserSettings backfill...');
    try {
      const settings = await base44.asServiceRole.entities.UserSettings.list('-created_date', 100);

      for (const setting of settings || []) {
        results.usersettings.processed++;

        // Skip if already has owner_user_id
        if (setting.owner_user_id) {
          continue;
        }

        // Determine owner from created_by
        let ownerUserId = null;
        if (setting.created_by) {
          ownerUserId = await resolveOwnerUserId(setting.created_by);
        }

        if (!ownerUserId) {
          results.usersettings.flagged++;
          console.warn(`[backfill] UserSettings ${setting.id} has no owner — flagging`);
          continue;
        }

        // Update record
        try {
          await base44.asServiceRole.entities.UserSettings.update(setting.id, {
            owner_user_id: ownerUserId,
            data_scope: 'private_user',
          });
          results.usersettings.updated++;
        } catch (err) {
          results.usersettings.errors.push(`UserSettings ${setting.id}: ${err.message}`);
        }
      }
      console.log(`[backfill] UserSettings backfill complete: ${results.usersettings.updated} updated, ${results.usersettings.flagged} flagged`);
    } catch (err) {
      results.usersettings.errors.push(`Batch error: ${err.message}`);
    }

    // PHASE 2.4: Message backfill (lighter backfill — user can regenerate if needed)
    console.log('[backfill] Starting Message backfill (light)...');
    try {
      let offset = 0;
      const pageSize = 100;
      let hasMore = true;
      let count = 0;

      while (hasMore && count < 500) {
        const msgs = await base44.asServiceRole.entities.Message.list(
          '-created_date',
          pageSize,
          offset
        );

        if (!msgs || msgs.length === 0) {
          hasMore = false;
          break;
        }

        for (const msg of msgs) {
          results.message.processed++;

          // Skip if already has owner_user_id
          if (msg.owner_user_id) {
            continue;
          }

          // Determine owner from created_by
          let ownerUserId = null;
          if (msg.created_by) {
            ownerUserId = await resolveOwnerUserId(msg.created_by);
          }

          if (!ownerUserId) {
            // Messages are less critical — don't flag all of them
            continue;
          }

          // Update record
          try {
            await base44.asServiceRole.entities.Message.update(msg.id, {
              owner_user_id: ownerUserId,
              data_scope: 'private_user',
            });
            results.message.updated++;
          } catch (err) {
            results.message.errors.push(`Message ${msg.id}: ${err.message}`);
          }

          count++;
          if (count >= 500) {
            hasMore = false;
            break;
          }
        }

        offset += pageSize;
        if (msgs.length < pageSize) {
          hasMore = false;
        }
      }
      console.log(`[backfill] Message backfill complete (light): ${results.message.updated} updated (limited to 500)`);
    } catch (err) {
      results.message.errors.push(`Batch error: ${err.message}`);
    }

    // PHASE 2.5: Conversation backfill
    console.log('[backfill] Starting Conversation backfill...');
    try {
      let offset = 0;
      const pageSize = 50;
      let hasMore = true;

      while (hasMore) {
        const convos = await base44.asServiceRole.entities.Conversation.list(
          '-created_date',
          pageSize,
          offset
        );

        if (!convos || convos.length === 0) {
          hasMore = false;
          break;
        }

        for (const convo of convos) {
          results.conversation.processed++;

          // Skip if already has owner_user_id
          if (convo.owner_user_id) {
            continue;
          }

          // Determine owner from created_by
          let ownerUserId = null;
          if (convo.created_by) {
            ownerUserId = await resolveOwnerUserId(convo.created_by);
          }

          if (!ownerUserId) {
            results.conversation.flagged++;
            console.warn(`[backfill] Conversation ${convo.id} has no owner — flagging`);
            continue;
          }

          // Update record
          try {
            await base44.asServiceRole.entities.Conversation.update(convo.id, {
              owner_user_id: ownerUserId,
              data_scope: 'private_user',
            });
            results.conversation.updated++;
          } catch (err) {
            results.conversation.errors.push(`Conversation ${convo.id}: ${err.message}`);
          }
        }

        offset += pageSize;
        if (convos.length < pageSize) {
          hasMore = false;
        }
      }
      console.log(`[backfill] Conversation backfill complete: ${results.conversation.updated} updated, ${results.conversation.flagged} flagged`);
    } catch (err) {
      results.conversation.errors.push(`Batch error: ${err.message}`);
    }

    console.log('[backfill] PHASE 2 COMPLETE', JSON.stringify(results, null, 2));

    return Response.json({
      status: 'success',
      message: 'Phase 2 backfill complete',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[backfill] Critical error:', error);
    return Response.json(
      { error: error.message, status: 'failed' },
      { status: 500 }
    );
  }
});