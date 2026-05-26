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

        // Fetch user info and saved locations
        const user = await base44.auth.me();
        if (!user) {
          setError('Not authenticated');
          setResolving(false);
          return;
        }

        // Fetch all saved locations scoped by owner_email
        const locations = await base44.entities.LocationReference.filter({
          owner_email: user.email,
        }, null, 200);

        // Fetch characters for disambiguation
        const chars = await base44.entities.Character.filter({
          owner_email: user.email,
        }, null, 200);

        // Call the resolver
        const result = await resolveMovementDestination({
          destinationText: rawDestination,
          savedLocations: locations,
          characters: chars,
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

  // While resolving, show loading state
  if (resolving) {
    return (
      <div className="mb-4 p-4 rounded-lg bg-secondary/40 border border-border animate-pulse">
        <p className="text-xs text-muted-foreground">Resolving destination...</p>
      </div>
    );
  }

  // If error during resolution, don't show the card
  if (error) {
    console.error('[MOVEMENT_COMMITMENT] Cannot show commitment card:', error);
    return null;
  }

  // If resolution failed or unresolvable, don't show the card
  if (!resolutionResult?.location_id) {
    return null;
  }

  // Render the prompt with resolved location
  return (
    <MovementCommitmentPrompt
      characterName={characterName}
      characterId={characterId}
      destination={resolutionResult.location_name}
      destinationLocationId={resolutionResult.location_id}
      etaMinutes={etaMinutes}
      scheduledTime={scheduledTime}
      conversationId={conversationId}
      messageId={messageId}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}