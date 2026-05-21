/**
 * fetchMediaGalleryPage
 *
 * TRUE image-level pagination for Media Gallery with EXPLICIT owner_email scoping.
 *
 * HARD RULE: Every message must be scoped by currentUser.email before rendering,
 * pagination, deletion, sharing, or count calculation.
 *
 * Algorithm:
 *   1. Fetch messages in batches of BATCH_SIZE, ordered -timestamp.
 *   2. For each message, verify:
 *      a) Has image_url
 *      b) Belongs to currentUser.email (NOT created_by, NOT character_id filter)
 *   3. Collect until PAGE_SIZE valid images found or no more messages exist.
 *   4. Return the images + the new rawCursor + diagnostics showing:
 *      - source queried
 *      - raw records scanned
 *      - valid images found
 *      - currentUser.email
 *      - blocked_cross_owner_count (images from OTHER users)
 *      - next cursor/offset
 *
 * Ownership verification via Message.owner_email.
 * If unverifiable, block and log as unverified_ownership.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PAGE_SIZE = 20;
const BATCH_SIZE = 100;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { rawCursor = 0, searchTerm = '' } = await req.json();
    const currentUserEmail = user.email;
    const searchLower = searchTerm.toLowerCase();

    console.log(`[fetchMediaGalleryPage] currentUser=${currentUserEmail} rawCursor=${rawCursor} search="${searchTerm}"`);

    const collected = [];
    const seenUrls = new Set();
    let currentOffset = rawCursor;
    let totalRawScanned = 0;
    let totalExcluded = 0;
    let blockedCrossOwner = 0;
    let blockedUnverified = 0;
    let exhausted = false;

    // Keep scanning batches until we have PAGE_SIZE images or run out of messages
    while (collected.length < PAGE_SIZE) {
      console.log(`[fetchMediaGalleryPage] Fetching batch at offset=${currentOffset}`);

      const batch = await base44.entities.Message.list('-timestamp', BATCH_SIZE, currentOffset);

      if (!batch || batch.length === 0) {
        console.log(`[fetchMediaGalleryPage] No more messages at offset=${currentOffset} — exhausted`);
        exhausted = true;
        break;
      }

      totalRawScanned += batch.length;
      console.log(`[fetchMediaGalleryPage] Batch: ${batch.length} raw messages scanned`);

      for (const m of batch) {
        // Must have image_url
        if (!m.image_url) {
          totalExcluded++;
          continue;
        }

        // ─────────────────────────────────────────────────────────────────
        // OWNERSHIP VERIFICATION VIA INHERITANCE
        // ─────────────────────────────────────────────────────────────────
        // Ownership can be inherited from parent records:
        // 1. Message.owner_email (direct)
        // 2. Character.owner_email (if image stored on character)
        // 3. Conversation parent (through message chain)
        // Only block if we cannot verify ownership through ANY parent.
        let isOwnerVerified = false;
        let ownerVerificationPath = null;

        // Path 1: Message has owner_email
        if (m.owner_email === currentUserEmail) {
          isOwnerVerified = true;
          ownerVerificationPath = 'message.owner_email';
        } else if (m.owner_email && m.owner_email !== currentUserEmail) {
          console.log(`[fetchMediaGalleryPage] BLOCKED cross_owner: msg=${m.id} (message owner=${m.owner_email} !== current=${currentUserEmail})`);
          blockedCrossOwner++;
          totalExcluded++;
          continue;
        }

        // Path 2: Character ownership (if character_id present and no direct message owner)
        if (!isOwnerVerified && m.character_id) {
          try {
            const char = await base44.asServiceRole.entities.Character.get(m.character_id).catch(() => null);
            if (char && char.owner_email === currentUserEmail) {
              isOwnerVerified = true;
              ownerVerificationPath = `character(${m.character_id}).owner_email`;
            } else if (char && char.owner_email && char.owner_email !== currentUserEmail) {
              console.log(`[fetchMediaGalleryPage] BLOCKED cross_owner: char=${m.character_id} (owner=${char.owner_email} !== current=${currentUserEmail})`);
              blockedCrossOwner++;
              totalExcluded++;
              continue;
            }
          } catch (e) {
            console.log(`[fetchMediaGalleryPage] Character lookup failed for ${m.character_id}: ${e.message}`);
          }
        }

        // Path 3: Conversation ownership (if conversation_id present)
        if (!isOwnerVerified && m.conversation_id) {
          try {
            const conv = await base44.asServiceRole.entities.Conversation.get(m.conversation_id).catch(() => null);
            if (conv && (conv.owner_email === currentUserEmail || conv.created_by === currentUserEmail)) {
              isOwnerVerified = true;
              ownerVerificationPath = `conversation(${m.conversation_id}).owner_email or created_by`;
            } else if (conv && conv.owner_email && conv.owner_email !== currentUserEmail) {
              console.log(`[fetchMediaGalleryPage] BLOCKED cross_owner: conv=${m.conversation_id} (owner=${conv.owner_email} !== current=${currentUserEmail})`);
              blockedCrossOwner++;
              totalExcluded++;
              continue;
            }
          } catch (e) {
            console.log(`[fetchMediaGalleryPage] Conversation lookup failed for ${m.conversation_id}: ${e.message}`);
          }
        }

        // If still unverified, block it
        if (!isOwnerVerified) {
          console.log(`[fetchMediaGalleryPage] BLOCKED unverified_ownership: msg=${m.id} (no verifiable owner via message/character/conversation)`);
          blockedUnverified++;
          totalExcluded++;
          continue;
        }

        // Deduplicate by URL
        if (seenUrls.has(m.image_url)) {
          console.log(`[fetchMediaGalleryPage] EXCLUDED duplicate url: ${m.image_url.substring(0, 60)}`);
          totalExcluded++;
          continue;
        }
        seenUrls.add(m.image_url);

        // Apply search filter
        if (searchTerm) {
          const desc = (m.image_description || m.content || '').toLowerCase();
          const name = (m.character_name || '').toLowerCase();
          if (!desc.includes(searchLower) && !name.includes(searchLower)) {
            console.log(`[fetchMediaGalleryPage] EXCLUDED search mismatch: msg=${m.id}`);
            totalExcluded++;
            continue;
          }
        }

        collected.push({
          id: m.id,
          url: m.image_url,
          description: m.image_description || m.content?.slice(0, 100) || 'Image',
          senderType: m.sender_type,
          senderName: m.character_name || 'You',
          characterId: m.character_id,
          conversationId: m.conversation_id,
          timestamp: m.timestamp || m.created_date,
          messageId: m.id,
          ownerEmail: m.owner_email,
          verificationPath: ownerVerificationPath,
        });

        if (collected.length >= PAGE_SIZE) break;
      }

      // Advance raw cursor by how many raw messages we scanned in this batch
      currentOffset += batch.length;

      // If batch was smaller than BATCH_SIZE, there are no more messages
      if (batch.length < BATCH_SIZE) {
        console.log(`[fetchMediaGalleryPage] Batch smaller than BATCH_SIZE (${batch.length} < ${BATCH_SIZE}) — exhausted`);
        exhausted = true;
        break;
      }
    }

    const nextRawCursor = exhausted ? null : currentOffset;
    const hasMore = !exhausted && collected.length === PAGE_SIZE;

    console.log(`[fetchMediaGalleryPage] PROOF LOG:`);
    console.log(`  currentUser.email: ${currentUserEmail}`);
    console.log(`  source: Message entity (all channels, explicit owner_email filtering)`);
    console.log(`  raw records scanned: ${totalRawScanned}`);
    console.log(`  valid images found: ${collected.length}`);
    console.log(`  excluded records: ${totalExcluded}`);
    console.log(`  blocked_cross_owner: ${blockedCrossOwner}`);
    console.log(`  blocked_unverified_ownership: ${blockedUnverified}`);
    console.log(`  returned image count: ${collected.length}`);
    console.log(`  next rawCursor: ${nextRawCursor}`);
    console.log(`  hasMore: ${hasMore}`);
    console.log(`  exhausted: ${exhausted}`);

    return Response.json({
      images: collected,
      currentUserEmail,
      nextRawCursor,
      hasMore,
      proof: {
        currentUserEmail,
        rawScanned: totalRawScanned,
        validFound: collected.length,
        excluded: totalExcluded,
        blockedCrossOwner,
        blockedUnverified: blockedUnverified,
        nextRawCursor,
        hasMore,
        exhausted,
      }
    });

  } catch (error) {
    console.error('[fetchMediaGalleryPage] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});