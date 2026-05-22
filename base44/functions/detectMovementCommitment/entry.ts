/**
 * detectMovementCommitment
 *
 * Detects when a character makes a movement commitment in chat.
 * Extracts: destination, ETA time, and commitment phrase.
 *
 * Commitment phrases:
 * - "I'll be there in X minutes"
 * - "I'm on my way"
 * - "I'm heading to [place]"
 * - "I'll come over"
 * - "I'm coming to"
 * - "heading out now"
 * - "see you in X minutes"
 *
 * Returns:
 * {
 *   detected: boolean,
 *   commitment_phrase: string,
 *   destination_name: string | null,
 *   eta_minutes: number | null,
 *   scheduled_arrival_time: ISO string | null,
 *   confidence: number (0-1)
 * }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMITMENT_PATTERNS = [
  { phrase: /i['']?ll be there in (\d+)\s*min/i, extractEta: true },
  { phrase: /i['']?m on my way/i, extractEta: false },
  { phrase: /i['']?m heading (to|out|over)/i, extractEta: false },
  { phrase: /i['']?ll come (over|to)/i, extractEta: false },
  { phrase: /i['']?m coming (to|over)/i, extractEta: false },
  { phrase: /heading out now/i, extractEta: false },
  { phrase: /see you in (\d+)\s*min/i, extractEta: true },
  { phrase: /i['']?ll head (to|over|out)/i, extractEta: false },
  { phrase: /be there in (\d+)\s*min/i, extractEta: true },
  { phrase: /about (\d+)\s*min away/i, extractEta: true },
  { phrase: /(\d+)\s*min out/i, extractEta: true },
];

const DESTINATION_PATTERN = /(?:at|to|heading to|going to|come to|over to)\s+([^.!?\n]+?)(?:\.|!|\?|,|$|\n)/i;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { message_text, conversation_id } = await req.json();
    
    if (!message_text || !conversation_id) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const lowerText = message_text.toLowerCase();

    // Step 1: Detect commitment phrase
    let matchedPattern = null;
    let etaMinutes = null;

    for (const pattern of COMMITMENT_PATTERNS) {
      const match = lowerText.match(pattern.phrase);
      if (match) {
        matchedPattern = pattern;
        if (pattern.extractEta && match[1]) {
          etaMinutes = parseInt(match[1], 10);
        }
        break;
      }
    }

    if (!matchedPattern) {
      return Response.json({
        detected: false,
        reason: 'no_commitment_phrase_found'
      });
    }

    // Step 2: Extract destination from conversation context
    const conversation = await base44.asServiceRole.entities.Conversation.filter(
      { id: conversation_id, owner_email: user.email },
      null,
      1
    ).catch(() => []);

    const messages = await base44.asServiceRole.entities.Message.filter(
      { conversation_id },
      '-timestamp',
      15
    ).catch(() => []);

    // Look for destination mention in recent messages
    let destinationName = null;
    for (const msg of messages) {
      if (!msg.content) continue;
      const destMatch = msg.content.match(DESTINATION_PATTERN);
      if (destMatch && destMatch[1]) {
        destinationName = destMatch[1].trim();
        // Remove trailing prepositions
        destinationName = destinationName.replace(/\s+(in|at|to)$/i, '');
        break;
      }
    }

    // Fallback: check current message too
    if (!destinationName) {
      const destMatch = message_text.match(DESTINATION_PATTERN);
      if (destMatch && destMatch[1]) {
        destinationName = destMatch[1].trim().replace(/\s+(in|at|to)$/i, '');
      }
    }

    // Step 3: Calculate scheduled arrival time
    let scheduledArrivalTime = null;
    if (etaMinutes) {
      const now = new Date();
      const eta = new Date(now.getTime() + etaMinutes * 60000);
      scheduledArrivalTime = eta.toISOString();
    }

    // Confidence: higher if we have destination + ETA
    const confidence = (destinationName ? 0.7 : 0.5) + (etaMinutes ? 0.2 : 0);

    return Response.json({
      success: true,
      detected: true,
      commitment_phrase: message_text,
      destination_name: destinationName,
      eta_minutes: etaMinutes,
      scheduled_arrival_time: scheduledArrivalTime,
      confidence: Math.min(1, confidence)
    });

  } catch (error) {
    console.error('[detectMovementCommitment]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});