/**
 * MovementCommitmentPrompt
 *
 * Shows a confirmation prompt when a character makes a movement commitment.
 * Requires a real destination_location_id — never sends placeholder text to backend.
 *
 * Proof logging: logs extracted destination text, matched saved location name/ID,
 * and the final payload sent to confirmMovementCommitment.
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Clock, MapPin } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function MovementCommitmentPrompt({
  characterName,
  characterId,
  currentCharacter,     // canonical character object already loaded by chat page
  destination,          // resolved location name from resolver
  destinationLocationId, // real LocationReference ID — required to enable submit
  etaMinutes,
  scheduledTime,
  conversationId,
  messageId,
  onConfirm,
  onCancel,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const destinationResolved = !!destinationLocationId;

  const etaDisplay = scheduledTime
    ? new Date(scheduledTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : `in ${etaMinutes} minutes`;

  const handleConfirm = async () => {
    // Hard guard: never submit without a real location ID
    if (!destinationResolved) {
      setError('Destination could not be resolved to a saved location. Ask the character to specify exactly where they\'re going.');
      return;
    }
    if (!scheduledTime) {
      setError('Arrival time is missing. Cannot schedule this move.');
      return;
    }

    setIsLoading(true);
    setError(null);

    // Log the full payload before sending — proof of correct resolution
    // Pass character fields from the already-loaded context — no backend character lookup
    const payload = {
      character_id: characterId,
      character_name: currentCharacter?.name || characterName,
      character_current_location_id: currentCharacter?.resolved_current_location_id || null,
      character_current_location_name: currentCharacter?.resolved_current_location_name || null,
      destination_location_id: destinationLocationId,
      destination_name: destination,
      scheduled_arrival_time: scheduledTime,
      conversation_id: conversationId,
      message_id: messageId,
      travel_reason: `${characterName} committed to being at ${destination}`,
    };

    console.log('[MOVEMENT_COMMITMENT] Final payload to confirmMovementCommitment:', payload);

    try {
      const response = await base44.functions.invoke('confirmMovementCommitment', payload);

      if (response?.data?.success) {
        console.log('[MOVEMENT_COMMITMENT] Stored travel commitment:', {
          character: response.data.character_name,
          from: response.data.proof?.from_location,
          to: response.data.destination,
          destination_id: response.data.destination_id,
          eta: response.data.eta_time,
        });
        onConfirm(response.data);
      } else {
        const serverError = response?.data?.error;
        const destName = response?.data?.destination_name;
        if (serverError === 'Destination location not found') {
          setError(`"${destName || destination}" wasn't found in your saved locations. Make sure the location exists first.`);
        } else {
          setError(serverError || 'Failed to confirm movement');
        }
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Error confirming movement';
      const isMissingField = msg.includes('Missing required') || err?.status === 400;
      setError(isMissingField
        ? 'Could not schedule: destination or arrival time is missing.'
        : msg
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="mb-4 p-4 rounded-lg bg-primary/10 border border-primary/30 backdrop-blur-sm"
      >
        <div className="space-y-3">
          {/* Question */}
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium text-foreground">
              <span className="font-semibold">{characterName}</span> is heading to{' '}
              <span className="font-semibold text-primary">{destination}</span> {etaDisplay}. Schedule this move?
            </p>
          </div>

          {/* Time + destination details */}
          <div className="ml-8 flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>ETA: {etaDisplay}</span>
            </div>
            <div className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              <span>To: {destination}</span>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="ml-8 text-xs text-destructive bg-destructive/10 rounded px-2 py-1">
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div className="ml-8 flex items-center gap-2">
            <button
              onClick={handleConfirm}
              disabled={isLoading || !destinationResolved}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Scheduling...' : 'Yes, Schedule It'}
            </button>
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors"
            >
              Not Now
            </button>
          </div>

          <p className="ml-8 text-xs text-muted-foreground">
            {characterName} will stay where they are until the scheduled time, then move to {destination}.
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}