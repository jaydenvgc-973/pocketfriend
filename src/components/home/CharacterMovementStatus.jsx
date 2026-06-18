import { useState } from "react";
import { RefreshCw, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

/**
 * CharacterMovementStatus
 *
 * Shows a plain-English movement status for a character and a one-click
 * "Refresh Movement" button if something looks stale or blocked.
 *
 * Displayed on CharacterCard for active (non-default, non-moved-away) characters.
 */

function getPlainStatus(character) {
  const status = character.resolved_presence_status || '';
  const reason = character.resolved_source_reason || '';
  const name = character.name?.split(' ')[0] || 'This character';
  const loc = character.resolved_current_location_name || 'home';
  const lastUpdated = character.resolved_last_updated_at
    ? new Date(character.resolved_last_updated_at)
    : null;
  const hoursSinceUpdate = lastUpdated
    ? (Date.now() - lastUpdated.getTime()) / 3600000
    : 999;

  // Sleeping
  if (status === 'sleeping') {
    return {
      text: `${name} is sleeping right now.`,
      color: 'text-blue-300',
      needsRepair: false,
    };
  }

  // Napping
  if (status === 'napping') {
    return {
      text: `${name} is napping right now — low energy.`,
      color: 'text-indigo-300',
      needsRepair: false,
    };
  }

  // Resting — awake state, relaxing but not asleep
  if (status === 'resting') {
    return {
      text: `${name} is resting right now — recharging.`,
      color: 'text-muted-foreground',
      needsRepair: false,
    };
  }

  // At work
  if (status === 'at_work' || reason === 'work_schedule') {
    return {
      text: `${name} is at work.`,
      color: 'text-blue-400',
      needsRepair: false,
    };
  }

  // At school
  if (status === 'at_school' || reason === 'school_schedule') {
    return {
      text: `${name} is at school.`,
      color: 'text-amber-400',
      needsRepair: false,
    };
  }

  // Visiting a location normally
  if ((status === 'visiting' || status === 'at_location') && hoursSinceUpdate < 6) {
    return {
      text: `${name} is out — at ${loc}.`,
      color: 'text-emerald-400',
      needsRepair: false,
    };
  }

  // Autonomously moved
  if (reason === 'autonomous_needs_driven' && hoursSinceUpdate < 6) {
    return {
      text: `${name} headed to ${loc} on their own.`,
      color: 'text-emerald-400',
      needsRepair: false,
    };
  }

  // Home (with validation) — only show as home if character has valid home location
  const hasValidHome = !!(character.current_home_location_id || character.home_location_id || character.temporary_housing_location_id);
  if ((status === 'home' || !status) && hasValidHome) {
    return {
      text: `${name} is at home.`,
      color: 'text-pink-400',
      needsRepair: false,
    };
  }
  
  // No home assigned — show Away
  if ((status === 'home' || !status) && !hasValidHome) {
    return {
      text: `${name} is away.`,
      color: 'text-muted-foreground',
      needsRepair: false,
    };
  }

  return {
    text: `${name} is moving normally.`,
    color: 'text-muted-foreground',
    needsRepair: false,
  };
}

export default function CharacterMovementStatus({ character, userEmail }) {
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState(null); // null | 'success' | 'nothing_to_do'
  const [showDetails, setShowDetails] = useState(false);
  const [details, setDetails] = useState(null);
  const queryClient = useQueryClient();

  const statusInfo = getPlainStatus(character);

  const handleRepair = async (e) => {
    e.stopPropagation();
    setRepairing(true);
    setRepairResult(null);
    try {
      const res = await base44.functions.invoke('autonomousCharacterMovement', {});
      const moved = res?.data?.moves || [];
      const charName = character.name?.split(' ')[0] || 'This character';
      const wasMoved = moved.some(m => m.startsWith(character.name));
      setRepairResult(wasMoved ? 'success' : 'nothing_to_do');
      setDetails({
        moved: wasMoved,
        destination: wasMoved
          ? moved.find(m => m.startsWith(character.name))?.split('→')[1]?.trim()
          : null,
      });
      queryClient.invalidateQueries({ queryKey: ['characters', userEmail] });
    } catch {
      setRepairResult('nothing_to_do');
    } finally {
      setRepairing(false);
    }
  };

  if (!statusInfo.needsRepair && !repairResult) return null;

  return (
    <div className="mt-2 rounded-xl bg-secondary/50 px-3 py-2 text-xs space-y-1">
      {/* Status line */}
      {!repairResult && (
        <p className={`${statusInfo.color}`}>{statusInfo.text}</p>
      )}

      {/* Repair result */}
      {repairResult === 'success' && details && (
        <div className="flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>
            Movement refreshed
            {details.destination ? ` — heading to ${details.destination}` : ''}.
          </span>
        </div>
      )}
      {repairResult === 'nothing_to_do' && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Movement checked — {character.name?.split(' ')[0]} is staying put for now.</span>
        </div>
      )}

      {/* Repair button */}
      {!repairResult && statusInfo.needsRepair && (
        <button
          onClick={handleRepair}
          disabled={repairing}
          className="flex items-center gap-1.5 text-primary hover:text-primary/80 font-medium disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${repairing ? 'animate-spin' : ''}`} />
          {repairing ? 'Refreshing...' : (statusInfo.repairLabel || 'Refresh Movement')}
        </button>
      )}
    </div>
  );
}