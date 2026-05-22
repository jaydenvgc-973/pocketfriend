/**
 * MovementCommitmentPrompt
 *
 * Shows a confirmation prompt when a character makes a movement commitment.
 * Example: "James says he'll be at Anderson's Bar in 10 minutes. Should I schedule that move?"
 *
 * User can: Confirm, Cancel, or Edit destination/time
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, X, Clock, MapPin } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function MovementCommitmentPrompt({
  characterName,
  characterId,
  destination,
  etaMinutes,
  scheduledTime,
  conversationId,
  messageId,
  onConfirm,
  onCancel,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const etaDisplay = scheduledTime
    ? new Date(scheduledTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : `in ${etaMinutes} minutes`;

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await base44.functions.invoke('confirmMovementCommitment', {
        character_id: characterId,
        destination_name: destination,
        scheduled_arrival_time: scheduledTime,
        conversation_id: conversationId,
        message_id: messageId,
      });

      if (response?.data?.success) {
        onConfirm(response.data);
      } else {
        setError(response?.data?.error || 'Failed to confirm movement');
      }
    } catch (err) {
      setError(err.message || 'Error confirming movement');
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
              <span className="font-semibold">{characterName}</span> says he'll be at{' '}
              <span className="font-semibold text-primary">{destination}</span> {etaDisplay}. Schedule this move?
            </p>
          </div>

          {/* Time details */}
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
              disabled={isLoading}
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
            {characterName} will stay where they are until the scheduled time, then instantly move to {destination}.
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}