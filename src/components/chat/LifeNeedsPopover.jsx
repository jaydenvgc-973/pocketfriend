import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { LIFE_NEEDS, getLifeNeedLabel } from "@/lib/lifeNeedsConstants";

/**
 * LifeNeedsPopover — read-only in-page view of the current character's Life Needs.
 *
 * This is a UI-access addition only. It reads the exact same canonical Character
 * entity fields (hunger_value, energy_value, etc.) that CharacterNeedsPanel reads
 * on the Character Profile page. No separate values, no parallel state, no
 * calculations beyond the live-sleep-energy display override that CharacterNeedsPanel
 * also uses so the Energy bar matches exactly during sleep.
 *
 * Opening this does not navigate away from the conversation.
 */
export default function LifeNeedsPopover({ isOpen, onClose, character }) {
  // Live sleep energy calculation — identical to CharacterNeedsPanel so the Energy
  // bar fills at the same rate while the character is sleeping.
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

  // Re-render every 60s while sleeping so the energy bar ticks up live
  const [, setTickCount] = useState(0);
  useEffect(() => {
    if (!isSleeping || !character?.last_sleep_start) return;
    const interval = setInterval(() => setTickCount(n => n + 1), 60 * 1000);
    return () => clearInterval(interval);
  }, [isSleeping, character?.last_sleep_start]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[90vw] max-w-sm bg-card border border-border rounded-2xl p-5 shadow-xl"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-foreground">Life Needs</h3>
                <p className="text-xs text-muted-foreground truncate">{character?.name || ''}</p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors flex-shrink-0"
                aria-label="Close Life Needs"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2.5">
              {LIFE_NEEDS.map(({ label, key, emoji }) => {
                const rawValue = character?.[key] ?? null;
                const value = (key === 'energy_value' && liveEnergyOverride !== null) ? liveEnergyOverride : rawValue;
                const displayValue = value !== null ? Math.round(value) : null;
                const { text, color, bg } = displayValue !== null
                  ? getLifeNeedLabel(displayValue)
                  : { text: '…', color: 'text-muted-foreground', bg: 'bg-muted' };
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}