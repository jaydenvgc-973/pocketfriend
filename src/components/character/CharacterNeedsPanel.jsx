import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';

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

export default function CharacterNeedsPanel({ character, onRefresh }) {
  const [isSimulating, setIsSimulating] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [lastSimResult, setLastSimResult] = useState(null);
  const queryClient = useQueryClient();

  // Only show for active created characters
  const isActiveCreated = character?.character_type === 'active' && character?.status === 'active';

  // Run simulation on mount and when character changes
  useEffect(() => {
    if (!isActiveCreated || !character?.id) return;
    runSimulation();
  }, [character?.id]);

  // Auto-refresh every 5 minutes while panel is visible
  useEffect(() => {
    if (!isActiveCreated || !character?.id) return;
    const interval = setInterval(runSimulation, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [character?.id, isActiveCreated]);

  const runSimulation = async () => {
    if (isSimulating) return;
    setIsSimulating(true);
    try {
      const res = await base44.functions.invoke('simulateActiveCharacterNeeds', {
        characterId: character.id,
      });
      setLastSimResult(res?.data);
      // Invalidate character query so profile re-reads fresh values
      queryClient.invalidateQueries({ queryKey: ['character', character.id] });
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('[CharacterNeedsPanel] simulation error:', err);
    } finally {
      setIsSimulating(false);
    }
  };

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

      <div className="space-y-3">
        {NEEDS.map(({ label, key, emoji }) => {
          const value = character[key] ?? null;
          const displayValue = value !== null ? Math.round(value) : null;
          const { text, color, bg } = displayValue !== null ? getLabel(displayValue) : { text: '…', color: 'text-muted-foreground', bg: 'bg-muted' };

          return (
            <div key={key}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-foreground">{emoji} {label}</span>
                <div className="flex items-center gap-2">
                  {displayValue !== null && (
                    <span className="text-[10px] font-mono text-muted-foreground">{displayValue}</span>
                  )}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${color} bg-opacity-20`}>
                    {text}
                  </span>
                </div>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full ${bg} transition-all duration-700`}
                  style={{ width: displayValue !== null ? `${displayValue}%` : '0%' }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Debug panel */}
      {showDebug && (
        <div className="mt-4 p-3 bg-secondary/50 rounded-xl space-y-2 text-[10px] font-mono text-muted-foreground">
          <p className="font-semibold text-foreground text-xs">Debug Info — Active Character Needs</p>
          <p>character_type: <span className="text-primary">{character.character_type}</span></p>
          <p>needs_initialized: <span className={character.needs_initialized ? 'text-green-400' : 'text-red-400'}>{String(character.needs_initialized ?? false)}</span></p>
          <p>last_need_simulated_at: <span className="text-foreground">{lastSimAt ? new Date(lastSimAt).toLocaleString() : 'never'}</span></p>
          <p>elapsed since last sim: <span className="text-foreground">{elapsedMinutes !== null ? `${elapsedMinutes} min` : '—'}</span></p>
          {simUpdate && (
            <>
              <p>last sim action: <span className="text-primary">{simUpdate.action}</span></p>
              <p>context: <span className="text-primary">{simUpdate.context ?? '—'}</span></p>
              <p>elapsed hours applied: <span className="text-foreground">{simUpdate.elapsedHours ?? '—'}</span></p>
            </>
          )}
          <p className="pt-1 text-muted-foreground/60">Raw values:</p>
          {NEEDS.map(({ label, key }) => (
            <p key={key}>{label}: <span className="text-foreground">{character[key] ?? 'null (from DB)'}</span></p>
          ))}
          <p>source: <span className={character.needs_initialized ? 'text-green-400' : 'text-amber-400'}>{character.needs_initialized ? 'database' : 'uninitialized — will be set on next run'}</span></p>
        </div>
      )}
    </div>
  );
}