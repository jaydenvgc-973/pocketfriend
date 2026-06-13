import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { discardDashboardCacheForCharacter } from '@/components/character/CharacterDashboard';

const NEEDS = [
  { label: 'Hunger',    key: 'hunger_value',         emoji: '🍽️', description: 'How hungry they are' },
  { label: 'Energy',    key: 'energy_value',          emoji: '⚡', description: 'Physical energy level' },
  { label: 'Social',    key: 'social_value',          emoji: '👥', description: 'Social connection need' },
  { label: 'Health',    key: 'health_value',          emoji: '❤️', description: 'Physical health status' },
  { label: 'Mental',    key: 'mental_value',          emoji: '🧠', description: 'Mental wellbeing' },
  { label: 'Financial', key: 'financial_need_value',  emoji: '💰', description: 'Financial stability' },
  { label: 'Hygiene',   key: 'hygiene_value',         emoji: '🚿', description: 'Personal hygiene' },
  { label: 'Comfort',   key: 'comfort_value',         emoji: '🛋️', description: 'Comfort and ease' },
];

function getLabel(value) {
  if (value >= 76) return { text: 'Strong',   color: 'text-green-500',  bg: 'bg-green-600' };
  if (value >= 51) return { text: 'Stable',   color: 'text-blue-400',   bg: 'bg-blue-500' };
  if (value >= 26) return { text: 'Low',      color: 'text-amber-500',  bg: 'bg-amber-500' };
  return               { text: 'Critical', color: 'text-destructive', bg: 'bg-destructive' };
}

// Vick Servicio is identified by character_type === 'npc_world_service' or name includes 'Vick Servicio'
const isVickServicio = (c) =>
  c?.character_type === 'npc_world_service' ||
  c?.is_world_service === true ||
  (c?.name && c.name.toLowerCase().includes('vick servicio'));

export default function CharacterNeedsPanel({ character, onRefresh }) {
  const [isSimulating, setIsSimulating] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastSimResult, setLastSimResult] = useState(null);
  const [validationIssues, setValidationIssues] = useState([]);
  const [lockUpdating, setLockUpdating] = useState(false);
  const [, setTickCount] = useState(0); // forces re-render for live sleep bar
  const queryClient = useQueryClient();

  // Show for active_created_character (or legacy characters missing character_type — never hide valid characters)
  const isActiveCreated = (
    character?.character_type === 'active_created_character' ||
    (!character?.character_type && character?.status === 'active')
  ) && character?.status === 'active';

  // Run simulation on mount — staggered 3s to avoid 429 alongside other profile queries
  useEffect(() => {
    if (!isActiveCreated || !character?.id) return;
    const timer = setTimeout(runSimulation, 3000);
    return () => clearTimeout(timer);
  }, [character?.id]);

  // Auto-refresh every 5 minutes while panel is visible
  useEffect(() => {
    if (!isActiveCreated || !character?.id) return;
    const interval = setInterval(runSimulation, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [character?.id, isActiveCreated]);

  // While sleeping: re-render every 60 seconds so the live energy bar visibly ticks up
  const isSleepingForTick = ['sleeping', 'napping'].includes(character?.resolved_presence_status || '');
  useEffect(() => {
    if (!isSleepingForTick || !character?.last_sleep_start) return;
    const interval = setInterval(() => setTickCount(n => n + 1), 60 * 1000);
    return () => clearInterval(interval);
  }, [isSleepingForTick, character?.last_sleep_start]);

  const runSimulation = async () => {
    if (isSimulating) return;
    setIsSimulating(true);
    setValidationIssues([]);
    try {
      const res = await base44.functions.invoke('simulateActiveCharacterNeeds', {
        characterId: character.id,
      });
      setLastSimResult(res?.data);
      // Force re-sync: invalidate and refetch immediately
      await queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('[CharacterNeedsPanel] simulation error:', err);
      setValidationIssues([`Simulation failed: ${err.message}`]);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleLockToggle = async (lockKey, newValue) => {
    if (lockUpdating) return;
    setLockUpdating(true);
    try {
      await base44.entities.Character.update(character.id, { [lockKey]: newValue });
      await queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('[CharacterNeedsPanel] lock toggle error:', err);
    } finally {
      setLockUpdating(false);
    }
  };

  const handleNeedChange = async (key, newValue) => {
    if (isUpdating) return;
    setIsUpdating(true);
    setValidationIssues([]);
    try {
      // Persist immediately to backend — user authority is absolute.
      // Update last_need_simulated_at so the next simulation tick continues
      // from the user-set value and current time, not from an old timestamp.
      const updatePayload = {
        [key]: newValue,
        last_need_simulated_at: new Date().toISOString(),
        needs_initialized: true,
      };
      await base44.entities.Character.update(character.id, updatePayload);
      
      // Live state wins — invalidate all caches for this character
      discardDashboardCacheForCharacter(character.id);
      
      // Force re-sync: invalidate character query
      await queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      
      // Trigger state recalculation
      await base44.functions.invoke('simulateActiveCharacterNeeds', {
        characterId: character.id,
        forceRecalculate: true,
      }).then(res => setLastSimResult(res?.data)).catch(e => console.error('Recalc error:', e));
      
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('[CharacterNeedsPanel] update error:', err);
      setValidationIssues([`Failed to update ${key}: ${err.message}`]);
    } finally {
      setIsUpdating(false);
    }
  };

  // ── LIVE SLEEP ENERGY CALCULATION ────────────────────────────────────────
  // While the character is sleeping, calculate the current energy level based on
  // elapsed sleep time instead of waiting for the next simulation tick.
  // This makes the energy bar act as a loading bar that fills during sleep.
  // Rate: +12/hr. Same rate as simulateActiveCharacterNeeds sleeping context.
  // Only for active_created_character and npc_world_service.
  const isEligibleForLiveSleep = (
    character?.character_type === 'active_created_character' ||
    character?.character_type === 'npc_world_service' ||
    (!character?.character_type && character?.status === 'active')
  );
  const isSleeping = ['sleeping', 'napping'].includes(character?.resolved_presence_status || '');
  const liveEnergyOverride = (() => {
    if (!isEligibleForLiveSleep || !isSleeping || !character?.last_sleep_start) return null;
    const hoursSlept = (Date.now() - new Date(character.last_sleep_start).getTime()) / 3600000;
    if (hoursSlept <= 0) return null;
    const SLEEP_RECOVERY_PER_HOUR = 12;
    const baseEnergy = character.energy_value ?? 75;
    const calculated = Math.min(100, baseEnergy + SLEEP_RECOVERY_PER_HOUR * hoursSlept);
    return Math.max(baseEnergy, Math.round(calculated));
  })();

  if (!isActiveCreated) {
    return null; // NPCs do not use this panel
  }

  const needsInitialized = character?.needs_initialized;
  const lastSimAt = character?.last_need_simulated_at;
  const elapsedMs = lastSimAt ? Date.now() - new Date(lastSimAt).getTime() : null;
  const elapsedMinutes = elapsedMs ? Math.round(elapsedMs / 60000) : null;

  const simUpdate = lastSimResult?.updates?.find(u => u.id === character.id);

  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Live Needs</p>
        <div className="flex items-center gap-2">
          {isSimulating && (
            <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          )}
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground px-1"
          >
            {showDebug ? 'hide debug' : 'debug'}
          </button>
          <button
            onClick={runSimulation}
            disabled={isSimulating}
            className="text-[10px] text-primary/70 hover:text-primary disabled:opacity-40"
          >
            refresh
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {NEEDS.map(({ label, key, emoji }) => {
          const rawValue = character[key] ?? null;
          // Use live-calculated energy during sleep so bar fills gradually without waiting for next sim tick
          const value = (key === 'energy_value' && liveEnergyOverride !== null) ? liveEnergyOverride : rawValue;
          const displayValue = value !== null ? Math.round(value) : null;
          const { text, color, bg } = displayValue !== null ? getLabel(displayValue) : { text: '…', color: 'text-muted-foreground', bg: 'bg-muted' };

          return (
            <div key={key} className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground min-w-16">{emoji} {label}</span>
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full ${bg} transition-all duration-700`}
                  style={{ width: displayValue !== null ? `${displayValue}%` : '0%' }}
                />
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${color} bg-opacity-20 min-w-fit`}>
                {displayValue ?? '…'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Vick-only: Sleep Lock + Hunger Lock */}
      {isVickServicio(character) && (
        <div className="mt-4 p-3 rounded-xl bg-secondary/40 border border-border space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Need Locks</p>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-foreground">Sleep Lock</p>
              <p className="text-[10px] text-muted-foreground">Freeze energy/sleep simulation</p>
            </div>
            <Switch
              checked={!!character.sleep_lock}
              disabled={lockUpdating}
              onCheckedChange={(val) => handleLockToggle('sleep_lock', val)}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-foreground">Hunger Lock</p>
              <p className="text-[10px] text-muted-foreground">Freeze hunger simulation</p>
            </div>
            <Switch
              checked={!!character.hunger_lock}
              disabled={lockUpdating}
              onCheckedChange={(val) => handleLockToggle('hunger_lock', val)}
            />
          </div>
        </div>
      )}

      {/* Debug panel — exposes raw backend state */}
      {showDebug && (
        <div className="mt-4 p-3 bg-secondary/50 rounded-xl space-y-2 text-[10px] font-mono text-muted-foreground overflow-auto max-h-64">
          <p className="font-semibold text-foreground text-xs">Backend State Inspector</p>
          
          <div className="border-t border-border pt-2 mt-2">
            <p className="font-semibold text-foreground text-xs mb-1">Character</p>
            <p>id: <span className="text-primary">{character.id}</span></p>
            <p>character_type: <span className="text-primary">{character.character_type}</span></p>
            <p>status: <span className="text-primary">{character.status}</span></p>
            <p>needs_initialized: <span className={character.needs_initialized ? 'text-green-400' : 'text-red-400'}>{String(character.needs_initialized ?? false)}</span></p>
            <p>last_need_simulated_at: <span className="text-foreground">{lastSimAt ? new Date(lastSimAt).toLocaleString() : 'never'}</span></p>
            <p>elapsed since last sim: <span className="text-foreground">{elapsedMinutes !== null ? `${elapsedMinutes} min` : '—'}</span></p>
          </div>

          <div className="border-t border-border pt-2">
            <p className="font-semibold text-foreground text-xs mb-1">Current Needs (from DB)</p>
            {NEEDS.map(({ label, key }) => (
              <p key={key}>{label.padEnd(10)}: <span className="text-foreground font-semibold">{character[key] ?? '(null)'}</span></p>
            ))}
          </div>

          {simUpdate && (
            <div className="border-t border-border pt-2">
              <p className="font-semibold text-foreground text-xs mb-1">Last Simulation</p>
              <p>action: <span className="text-primary">{simUpdate.action}</span></p>
              <p>context: <span className="text-primary">{simUpdate.context ?? '—'}</span></p>
              <p>elapsed_hours: <span className="text-foreground">{simUpdate.elapsedHours ?? '—'}</span></p>
            </div>
          )}

          {lastSimResult?.decision_weights && (
            <div className="border-t border-border pt-2">
              <p className="font-semibold text-foreground text-xs mb-1">Decision Weights (from last sim)</p>
              {Object.entries(lastSimResult.decision_weights).map(([key, weight]) => (
                <p key={key}>{key.padEnd(15)}: <span className="text-foreground">{(weight * 100).toFixed(1)}%</span></p>
              ))}
            </div>
          )}

          <p className="pt-2 text-muted-foreground/60 italic">This panel shows the authoritative backend state. UI must match exactly.</p>
        </div>
      )}
    </div>
  );
}