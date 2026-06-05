/**
 * MovementCommitmentPromptWithResolver
 *
 * Wrapper component that:
 * 1. Receives raw destination text from message
 * 2. Fetches saved locations (owner_email scoped)
 * 3. Calls conversational entity resolver to match destination
 * 4. Renders MovementCommitmentPrompt with resolved location ID
 * 5. Passes real destination_location_id to backend
 */

import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { resolveMovementDestination } from '@/lib/conversationalEntityResolver';
import MovementCommitmentPrompt from '@/components/chat/MovementCommitmentPrompt';

export default function MovementCommitmentPromptWithResolver({
  rawDestination,
  characterName,
  characterId,
  currentCharacter,
  etaMinutes,
  scheduledTime,
  recentMessages,
  conversationId,
  messageId,
  onConfirm,
  onCancel,
}) {
  const [resolving, setResolving] = useState(true);
  const [resolutionResult, setResolutionResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const doResolve = async () => {
      try {
        setResolving(true);
        setError(null);

        // Use owner_email from the already-loaded character object — no user fetch needed
        // Legacy characters may not have owner_email — fall back to user-scoped query
        const ownerEmail = currentCharacter?.owner_email;

        // Fetch saved locations — use owner_email filter if available, otherwise get all user-visible locations
        const locationFilter = ownerEmail ? { owner_email: ownerEmail } : {};
        const locations = await base44.entities.LocationReference.filter(
          locationFilter, null, 200
        );

        // Call the resolver using the already-loaded character — no Character re-fetch
        const result = await resolveMovementDestination({
          destinationText: rawDestination,
          savedLocations: locations,
          characters: [currentCharacter],  // use the canonical active character, not a re-fetched list
          recentMessages,
          currentCharacter,
        });

        // Log the resolution for proof
        console.log('[MOVEMENT_COMMITMENT] Destination resolution:', {
          raw_text: rawDestination,
          resolved_location_id: result?.location_id || null,
          resolved_location_name: result?.location_name || null,
          confidence: result?.confidence || 0,
          reason: result?.reason || 'unresolvable',
          resolved_from_anchor: result?.resolved_from_anchor || null,
        });

        setResolutionResult(result);
        setResolving(false);
      } catch (err) {
        console.error('[MOVEMENT_COMMITMENT] Resolution error:', err.message);
        setError(err.message);
        setResolving(false);
      }
    };

    doResolve();
  }, [rawDestination, recentMessages, currentCharacter]);

  // AUTO-CONFIRM eligibility — computed before hooks so the hook dependency is stable
  const autoConfirmEligible =
    !resolving &&
    !error &&
    !!resolutionResult?.location_id &&
    resolutionResult?.confidence >= 0.85 &&
    !resolutionResult?.requires_disambiguation;

  // ALL hooks must be declared before any early returns
  useEffect(() => {
    if (!autoConfirmEligible) return;
    const timer = setTimeout(async () => {
      try {
        // Pass all character fields from the already-loaded context — no backend lookup needed
        const response = await base44.functions.invoke('confirmMovementCommitment', {
          character_id: characterId,
          character_name: currentCharacter?.name || characterName,
          character_current_location_id: currentCharacter?.resolved_current_location_id || null,
          character_current_location_name: currentCharacter?.resolved_current_location_name || null,
          destination_location_id: resolutionResult.location_id,
          destination_name: resolutionResult.location_name,
          scheduled_arrival_time: scheduledTime,
          conversation_id: conversationId,
          message_id: messageId,
          travel_reason: `${characterName} committed to arriving at ${resolutionResult.location_name}`,
        });
        if (response?.data?.success) {
          console.log('[MOVEMENT_COMMITMENT] Auto-confirmed:', response.data);
          onConfirm(response.data);
        }
      } catch (err) {
        console.warn('[MOVEMENT_COMMITMENT] Auto-confirm failed:', err.message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [autoConfirmEligible]); // eslint-disable-line

  // Early returns AFTER all hooks
  if (resolving) {
    return (
      <div className="mb-4 p-4 rounded-lg bg-secondary/40 border border-border animate-pulse">
        <p className="text-xs text-muted-foreground">Resolving destination...</p>
      </div>
    );
  }

  // If resolution completely failed (error, not just low confidence), hide the card
  if (error) return null;

  if (autoConfirmEligible) return null;

  // Render the prompt — even when no location_id resolved, show editable picker so user can select manually
  return (
    <MovementCommitmentPrompt
      characterName={characterName}
      characterId={characterId}
      currentCharacter={currentCharacter}
      destination={resolutionResult?.location_name || rawDestination || ''}
      destinationLocationId={resolutionResult?.location_id || null}
      etaMinutes={etaMinutes}
      scheduledTime={scheduledTime}
      conversationId={conversationId}
      messageId={messageId}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}