import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Building2, Home, Lock, Clock } from "lucide-react";
import { createPortal } from "react-dom";

/**
 * getLocationEnvironments
 *
 * Returns the explicit user-configured environments from a LocationReference record.
 * STRICT RULE: No inference. No regex. No keyword matching. No auto-classification.
 * A location has environments ONLY when location.environments is a non-empty array.
 * Absence of the field means no mixed-use environments exist.
 */
export function getLocationEnvironments(location) {
  if (!location) return [];
  const envs = location.environments;
  if (!Array.isArray(envs) || envs.length === 0) return [];
  return envs;
}

/**
 * Resolves the environment type for a given zone name.
 * Returns 'operational' | 'residential' | 'restricted' | null.
 * Used by the Scene page to drive population behavior per the active zone's environment.
 */
export function getEnvironmentTypeForZone(location, zoneName) {
  if (!location || !zoneName) return null;
  const envs = getLocationEnvironments(location);
  if (envs.length === 0) return null;
  const env = envs.find(e => Array.isArray(e.zone_names) && e.zone_names.includes(zoneName));
  return env?.type || null;
}

/**
 * @deprecated Use getLocationEnvironments instead.
 * Kept as a re-export alias so any import of detectMixedUseEnvironments
 * silently receives the new explicit-only implementation.
 * All callers that previously used name-based detection will now receive []
 * for any location without explicit environment metadata.
 */
export function detectMixedUseEnvironments(location) {
  return getLocationEnvironments(location);
}

export default function EnvironmentSelectorModal({ location, isOpen, onClose, onSelect, isLocationOpenNow }) {
  if (!isOpen || !location) return null;

  const environments = getLocationEnvironments(location);
  if (environments.length === 0) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-6 sm:pb-0"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="w-full max-w-sm bg-card border border-border rounded-2xl overflow-hidden shadow-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Travel to</p>
                <h2 className="text-base font-bold text-foreground">{location.name}</h2>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="px-5 pb-3 text-xs text-muted-foreground">
              Select an environment within this location:
            </p>

            {/* Environment options */}
            <div className="px-4 pb-5 space-y-3">
              {environments.map((env) => {
                const isResidential = env.type === "residential";
                const isRestricted = env.type === "restricted";
                const isBlocked = !isResidential && env.follows_business_hours !== false && isLocationOpenNow === false;

                return (
                  <button
                    key={env.id}
                    onClick={() => {
                      if (!isBlocked) {
                        onSelect(env);
                        onClose();
                      }
                    }}
                    disabled={isBlocked}
                    className={`w-full text-left rounded-xl border p-4 transition-colors space-y-1.5 ${
                      isBlocked
                        ? "bg-secondary/30 border-border opacity-60 cursor-not-allowed"
                        : "bg-card border-border hover:border-primary/50 hover:bg-primary/5 active:scale-[0.99]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isResidential
                        ? <Home className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        : isRestricted
                        ? <Lock className="w-4 h-4 text-rose-400 flex-shrink-0" />
                        : <Building2 className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      }
                      <span className="text-sm font-semibold text-foreground">{env.name}</span>
                      {isResidential && (
                        <span className="ml-auto text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                          Always Open
                        </span>
                      )}
                      {isBlocked && (
                        <span className="ml-auto text-[10px] font-medium text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" /> Closed
                        </span>
                      )}
                    </div>
                    {env.zone_names?.length > 0 && (
                      <p className="text-[10px] text-muted-foreground/60 pl-6">
                        {env.zone_names.join(" · ")}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}