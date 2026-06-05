/**
 * MovementCommitmentPrompt
 *
 * Shows a confirmation card when a character makes a movement commitment.
 * Destination and ETA are fully editable before confirming.
 *
 * - Prefills destination with the system's best guess (editable)
 * - Allows changing destination via searchable location list
 * - Allows changing ETA time
 * - Requires a real destination_location_id before submitting
 */
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Clock, MapPin, ChevronDown, Search, X } from 'lucide-react';
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

  const handleConfirm = async () => {
    if (!selectedLocId) {
      setError('Please select a destination before scheduling.');
      return;
    }
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
      destination_location_id: selectedLocId,
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
              <span className="font-semibold">{characterName}</span> is heading to{' '}
              <span className="font-semibold text-primary">{selectedLocName || '...'}</span>.{' '}
              Schedule this move?
            </p>
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

            {/* Editable ETA */}
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
              disabled={isLoading || !selectedLocId}
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
            {characterName} will stay where they are until the scheduled time, then move to {selectedLocName || destination}.
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}