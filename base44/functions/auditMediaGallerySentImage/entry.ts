/**
 * auditMediaGallerySentImage
 *
 * Traces a single Media Gallery image from send → storage → retrieval.
 * Identifies where prompts/descriptions are lost.
 *
 * REQUIRED INPUT: A message ID from a Media Gallery send.
 * This could be obtained from:
 * - Direct chat message ID after user sends image
 * - Conversation query for recent messages
 * - Message ID provided by user from browser dev tools
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { messageId } = await req.json();
    if (!messageId) {
      return Response.json({ error: 'messageId required' }, { status: 400 });
    }

    const ownerEmail = user.email;
    const audit = { messageId, ownerEmail, steps: [] };

    // Step 1: Find the message directly
    audit.steps.push('STEP 1: Direct message lookup');
    let msg;
    try {
      const msgs = await base44.entities.Message.filter(
        { id: messageId },
        '-created_date',
        1
      );
      msg = msgs?.[0];
      audit.steps.push(`  Found via direct query: ${msg ? 'YES' : 'NO'}`);
      if (msg) {
        audit.steps.push(`  sender_type: ${msg.sender_type}`);
        audit.steps.push(`  image_url exists: ${!!msg.image_url}`);
        audit.steps.push(`  image_description: "${msg.image_description?.substring(0, 100) || '(empty)'}"`);
        audit.steps.push(`  generation_context: ${msg.generation_context ? 'EXISTS' : 'NULL'}`);
        if (msg.generation_context) {
          audit.steps.push(`    - original_raw_prompt: ${msg.generation_context.original_raw_prompt ? 'YES' : 'NO'}`);
          audit.steps.push(`    - scene_prompt: ${msg.generation_context.scene_prompt ? 'YES' : 'NO'}`);
          audit.steps.push(`    - resolved_description: ${msg.generation_context.resolved_description ? 'YES' : 'NO'}`);
          audit.steps.push(`    - prompt (gc.prompt) length: ${msg.generation_context.prompt?.length || 0}`);
        }
        audit.steps.push(`  owner_email: ${msg.owner_email || '(not set)'}`);
      }
    } catch (e) {
      audit.steps.push(`  ERROR: ${e.message}`);
    }

    if (!msg) {
      return Response.json({
        audit,
        conclusion: 'Message not found in database. Check messageId.',
      });
    }

    // Step 2: Test fetchMediaGalleryPage with this message's conversation
    audit.steps.push('STEP 2: Test fetchMediaGalleryPage retrieval');
    try {
      const convo = await base44.entities.Conversation.filter(
        { id: msg.conversation_id },
        '-created_date',
        1
      );
      audit.steps.push(`  Conversation found: ${convo?.length > 0 ? 'YES' : 'NO'}`);
      if (convo?.length > 0) {
        audit.steps.push(`    - conversation.created_by: ${convo[0].created_by || '(not set)'}`);
      }
    } catch (e) {
      audit.steps.push(`  ERROR: ${e.message}`);
    }

    // Step 3: Check what fetchMediaGalleryPage would resolve for this message
    audit.steps.push('STEP 3: Simulate displayPrompt resolution');
    const gc = msg.generation_context || {};
    const gcPromptIfReadable = (gc?.prompt && gc.prompt.length < 2000) ? gc.prompt : null;
    const displayPrompt =
      gc?.original_raw_prompt ||
      gc?.scene_prompt ||
      msg.image_description ||
      gc?.resolved_description ||
      gcPromptIfReadable ||
      null;

    audit.steps.push(`  Resolved displayPrompt: ${displayPrompt ? 'YES' : 'NO'}`);
    if (displayPrompt) {
      audit.steps.push(`    - length: ${displayPrompt.length}`);
      audit.steps.push(`    - preview: "${displayPrompt.substring(0, 150)}..."`);
    }

    // Step 4: Check for metadata leaks
    audit.steps.push('STEP 4: Check for metadata leaks in displayPrompt');
    if (displayPrompt) {
      const leakPatterns = [
        { name: 'NAME_REFERENCE_KEY', pattern: /\[NAME REFERENCE KEY/i },
        { name: '[CHARACTER]', pattern: /^\[CHARACTER\]/i },
        { name: '[USER]', pattern: /^\[USER\]/i },
        { name: '[JOINT]', pattern: /^\[JOINT\]/i },
        { name: '(ID: hex)', pattern: /\(ID:\s*[a-z0-9]+\)/i },
        { name: 'character_assignment', pattern: /^\s*"[^"]*"\s*=\s*[^\n]*$/m },
        { name: 'Generated character photo', pattern: /^Generated character photo\.\s*Scene:/i },
      ];

      const found = leakPatterns.filter(lp => lp.pattern.test(displayPrompt));
      if (found.length === 0) {
        audit.steps.push(`  No metadata leaks detected ✓`);
      } else {
        audit.steps.push(`  LEAKS FOUND:`);
        found.forEach(f => {
          audit.steps.push(`    - ${f.name}`);
        });
      }
    }

    // Step 5: Trace the schema issue
    audit.steps.push('STEP 5: Ownership trace');
    if (!msg.owner_email) {
      audit.steps.push(`  ⚠️ Message missing owner_email field`);
      audit.steps.push(`     This means fetchMediaGalleryPage must query by conversation_id only`);
      audit.steps.push(`     Conversation ownership is scoped by created_by: ${convo?.[0]?.created_by || '?'}`);
    } else {
      audit.steps.push(`  Message.owner_email = ${msg.owner_email} ✓`);
    }

    return Response.json({
      audit,
      messageData: {
        id: msg.id,
        hasImageUrl: !!msg.image_url,
        imageDescriptionLength: msg.image_description?.length || 0,
        hasGenerationContext: !!msg.generation_context,
        displayPromptResolved: !!displayPrompt,
        displayPromptLength: displayPrompt?.length || 0,
        isMediaGallerySent: msg.sender_type === 'user' && !!msg.image_url,
        ownerEmailSet: !!msg.owner_email,
      },
      conclusion: displayPrompt
        ? `Message stored correctly with displayPrompt. Modal should show it (${displayPrompt.length} chars).`
        : `Message stored but displayPrompt is NULL. Check backend resolution chain.`,
    });

  } catch (error) {
    console.error('[auditMediaGallerySentImage] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});