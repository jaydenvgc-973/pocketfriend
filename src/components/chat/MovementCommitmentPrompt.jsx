/**
 * MovementCommitmentPrompt
 *
 * Shows a confirmation card when a character makes a movement commitment.
 * Destination and ETA are fully editable before confirming.
 *
 * - Prefills destination with the system's best guess (editable)
 * - Allows changing destination via searchable location list
 * - Two choices, both through the existing pipelines:
 *     Right Now        → updateCharacterLocation (the immediate movement writer)
 *     Schedule for Later → confirmMovementCommitment (registers the pending relocation
 *                          that processScheduledRelocations executes when due)
 * - Requires a valid destination before either action
 */
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Clock, MapPin, ChevronDown, Search, X, Zap, CalendarClock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

export default function MovementCommitmentPrompt({
  characterName,
  characterId,
  currentCharacter,
  destination,           // resolved location name (prefill, editable)
  destinationLocationId, // resolved ID (prefill, editable)
  etaMinutes,
  scheduledTime,
  conversationId,
  messageId,
  onConfirm,
  onCancel,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  // 'now' = move through the immediate movement writer, 'later' = schedule it
  const [mode, setMode] = useState('later');
  const queryClient = useQueryClient();

  // Editable destination state
  const [selectedLocId, setSelectedLocId] = useState(destinationLocationId || null);
  const [selectedLocName, setSelectedLocName] = useState(destination || '');

  // Editable ETA
  const [editedTime, setEditedTime] = useState(() => {
    if (scheduledTime) {
      const d = new Date(scheduledTime);
      const h = d.getHours().toString().padStart(2, '0');
      const m = d.getMinutes().toString().padStart(2, '0');
      return `${h}:${m}`;
    }
    return '';
  });

  // Location search state
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [locations, setLocations] = useState([]);
  const [locSearch, setLocSearch] = useState('');
  const [loadingLocs, setLoadingLocs] = useState(false);

  // Sync when props update (resolver resolved later)
  useEffect(() => {
    if (destinationLocationId && !selectedLocId) setSelectedLocId(destinationLocationId);
    if (destination && !selectedLocName) setSelectedLocName(destination);
  }, [destinationLocationId, destination]);

  const loadLocations = async () => {
    if (locations.length > 0) return; // already loaded
    setLoadingLocs(true);
    try {
      const ownerEmail = currentCharacter?.owner_email;
      const filter = ownerEmail ? { owner_email: ownerEmail } : {};
      const locs = await base44.entities.LocationReference.filter(filter, null, 200);
      setLocations(locs || []);
    } catch (e) {
      console.warn('[MovementCommitmentPrompt] Failed to load locations:', e.message);
    } finally {
      setLoadingLocs(false);
    }
  };

  const handleOpenPicker = () => {
    setShowLocationPicker(true);
    loadLocations();
  };

  const handleSelectLocation = (loc) => {
    setSelectedLocId(loc.id);
    setSelectedLocName(loc.name);
    setShowLocationPicker(false);
    setLocSearch('');
    setError(null);
  };

  const filteredLocs = locations.filter(l =>
    !locSearch || l.name?.toLowerCase().includes(locSearch.toLowerCase())
  );

  // Build final scheduled time from editable time input
  const buildScheduledTime = () => {
    if (!editedTime) return scheduledTime;
    try {
      const [h, m] = editedTime.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      if (d <= new Date()) d.setDate(d.getDate() + 1);
      return d.toISOString();
    } catch {
      return scheduledTime;
    }
  };

  const etaDisplay = editedTime
    ? new Date(buildScheduledTime()).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : scheduledTime
    ? new Date(scheduledTime).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : `in ${etaMinutes} minutes`;

  // Rabbit Hole: when the user has kept a named destination that has no built
  // LocationReference, submit it as an intentional off-screen destination.
  // The backend stores location_id = "rabbit_hole".
  const isRabbitHole = !selectedLocId && !!selectedLocName.trim();

  const requireDestination = () => {
    if (!selectedLocId && !isRabbitHole) {
      setError('Choose a destination first.');
      return false;
    }
    return true;
  };

  // RIGHT NOW — the same immediate movement call the existing teleport control uses.
  const handleMoveNow = async () => {
    if (!requireDestination()) return;
    setIsLoading(true);
    setError(null);

    const payload = isRabbitHole
      ? {
          characterId,
          rabbitHole: true,
          locationName: selectedLocName.trim(),
          sourceReason: 'user_teleport_rabbit_hole',
        }
      : {
          characterId,
          locationId: selectedLocId,
          locationName: selectedLocName,
          presenceStatus: 'visiting',
          locationType: 'visit',
          sourceReason: 'user_teleport',
        };

    try {
      const response = await base44.functions.invoke('updateCharacterLocation', payload);
      const result = response?.data || response;
      if (result?.success === false || result?.error) {
        throw new Error(result?.error || 'The move was not confirmed');
      }
      queryClient.invalidateQueries({ queryKey: ['character', characterId] });
      queryClient.invalidateQueries({ queryKey: ['characters'] });
      onConfirm({ ...result, immediate: true });
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Error moving character';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // SCHEDULE FOR LATER — the existing commitment registration pipeline.
  const handleSchedule = async () => {
    if (!requireDestination()) return;
    const finalTime = buildScheduledTime();
    if (!finalTime) {
      setError('Arrival time is missing. Cannot schedule this move.');
      return;
    }

    setIsLoading(true);
    setError(null);

    const payload = {
      character_id: characterId,
      character_name: currentCharacter?.name || characterName,
      character_current_location_id: currentCharacter?.resolved_current_location_id || null,
      character_current_location_name: currentCharacter?.resolved_current_location_name || null,
      destination_location_id: isRabbitHole ? 'rabbit_hole' : selectedLocId,
      destination_name: selectedLocName,
      scheduled_arrival_time: finalTime,
      conversation_id: conversationId,
      message_id: messageId,
      travel_reason: `${characterName} committed to being at ${selectedLocName}`,
    };

    console.log('[MOVEMENT_COMMITMENT] Final payload:', payload);

    try {
      const response = await base44.functions.invoke('confirmMovementCommitment', payload);
      if (response?.data?.success) {
        onConfirm(response.data);
      } else {
        const serverError = response?.data?.error;
        setError(serverError || 'Failed to confirm movement');
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Error confirming movement';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => (mode === 'now' ? handleMoveNow() : handleSchedule());

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="mb-4 p-4 rounded-lg bg-primary/10 border border-primary/30 backdrop-blur-sm"
      >
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-sm font-medium text-foreground">
              {selectedLocName ? (
                <>
                  <span className="font-semibold">{characterName}</span> is heading to{' '}
                  <span className="font-semibold text-primary">{selectedLocName}</span>.{' '}
                  {mode === 'now' ? 'Move them there now?' : 'Schedule this move?'}
                </>
              ) : (
                <>
                  <span className="font-semibold">{characterName}</span>, choose a destination
                  {mode === 'now' ? ' to move them there now.' : ' to schedule this move.'}
                </>
              )}
            </p>
          </div>

          {/* Choice: move immediately or schedule for later */}
          <div className="ml-8 grid grid-cols-2 gap-2">
            <button
              onClick={() => { setMode('now'); setError(null); }}
              disabled={isLoading}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                mode === 'now'
                  ? 'bg-primary/20 border-primary text-foreground'
                  : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Right Now
            </button>
            <button
              onClick={() => { setMode('later'); setError(null); }}
              disabled={isLoading}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                mode === 'later'
                  ? 'bg-primary/20 border-primary text-foreground'
                  : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <CalendarClock className="w-3.5 h-3.5" />
              Schedule for Later
            </button>
          </div>

          {/* Editable destination */}
          <div className="ml-8 space-y-2">
            <button
              onClick={handleOpenPicker}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm text-left hover:border-primary/40 transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="flex-1 truncate text-foreground">
                {selectedLocName || 'Select destination…'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            </button>

            {/* Location picker dropdown */}
            <AnimatePresence>
              {showLocationPicker && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="bg-card border border-border rounded-lg shadow-xl z-20 max-h-48 overflow-hidden flex flex-col"
                >
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                    <Search className="w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      autoFocus
                      value={locSearch}
                      onChange={e => setLocSearch(e.target.value)}
                      placeholder="Search locations…"
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                    />
                    <button onClick={() => { setShowLocationPicker(false); setLocSearch(''); }}>
                      <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  </div>
                  <div className="overflow-y-auto">
                    {loadingLocs && (
                      <p className="text-xs text-muted-foreground px-3 py-2">Loading…</p>
                    )}
                    {!loadingLocs && filteredLocs.length === 0 && (
                      <p className="text-xs text-muted-foreground px-3 py-2">No locations found</p>
                    )}
                    {filteredLocs.map(loc => (
                      <button
                        key={loc.id}
                        onClick={() => handleSelectLocation(loc)}
                        className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors truncate"
                      >
                        {loc.name}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Editable ETA — only needed when scheduling for later */}
            {mode === 'later' && (
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <input
                  type="time"
                  value={editedTime}
                  onChange={e => setEditedTime(e.target.value)}
                  className="bg-secondary border border-border rounded-lg px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
                />
                <span className="text-xs text-muted-foreground">ETA: {etaDisplay}</span>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="ml-8 text-xs text-destructive bg-destructive/10 rounded px-2 py-1">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="ml-8 flex items-center gap-2">
            <button
              onClick={handleConfirm}
              disabled={isLoading || (!selectedLocId && !isRabbitHole) || (mode === 'later' && !buildScheduledTime())}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading
                ? (mode === 'now' ? 'Moving...' : 'Scheduling...')
                : (mode === 'now' ? 'Move Now' : 'Schedule Move')}
            </button>
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 transition-colors"
            >
              Not Now
            </button>
          </div>

          {selectedLocName && (
            <p className="ml-8 text-xs text-muted-foreground">
              {mode === 'now'
                ? `${characterName} will move to ${selectedLocName} immediately.`
                : `${characterName} will stay where they are until the scheduled time, then move to ${selectedLocName}.`}
            </p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}