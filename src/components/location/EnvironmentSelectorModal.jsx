import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Building2, Home, Clock, CheckCircle } from "lucide-react";
import { createPortal } from "react-dom";

/**
 * Detects whether a location has mixed-use environments.
 * A location is mixed-use if it has zones tagged with environment_type,
 * OR if it matches the known VGC Recovery Yard pattern (has both operational zones
 * and residential zones such as "North Campus Quarters").
 *
 * Returns an array of environment objects:
 *   { id, label, description, type: 'business'|'residential', zones, alwaysAvailable }
 */
export function detectMixedUseEnvironments(location) {
  if (!location) return [];
  const zones = location.zones || [];

  // Detect residential zones by name patterns
  const RESIDENTIAL_ZONE_PATTERNS = [
    /north campus quarters/i,
    /man cave/i,
    /residential/i,
    /quarters/i,
    /living quarters/i,
    /apartment/i,
    /suite/i,
  ];

  const residentialZones = zones.filter(z =>
    RESIDENTIAL_ZONE_PATTERNS.some(p => p.test(z.zone_name))
  );

  const businessZones = zones.filter(z =>
    !RESIDENTIAL_ZONE_PATTERNS.some(p => p.test(z.zone_name))
  );

  // Only return mixed-use if there are both types OR explicit env metadata
  if (residentialZones.length === 0) return [];
  if (businessZones.length === 0 && residentialZones.length === zones.length) return [];

  const environments = [];

  if (businessZones.length > 0) {
    environments.push({
      id: "business_operations",
      label: "Business Operations",
      description: "Follows operating hours. Normal business travel rules apply.",
      type: "business",
      zones: businessZones,
      alwaysAvailable: false,
    });
  }

  if (residentialZones.length > 0) {
    // Find primary residential zone name
    const primaryZone = residentialZones.find(z => /north campus quarters/i.test(z.zone_name))
      || residentialZones[0];

    environments.push({
      id: "residential",
      label: primaryZone.zone_name,
      description: "Residential environment. Available regardless of business operating hours.",
      type: "residential",
      zones: residentialZones,
      alwaysAvailable: true,
    });
  }

  return environments;
}

export default function EnvironmentSelectorModal({ location, isOpen, onClose, onSelect, isLocationOpenNow }) {
  if (!isOpen || !location) return null;

  const environments = detectMixedUseEnvironments(location);
  if (environments.length === 0) return null;

  const businessClosed = isLocationOpenNow === false;

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
                const isBusiness = env.type === "business";
                const isBlocked = isBusiness && businessClosed;

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
                      {isBusiness
                        ? <Building2 className="w-4 h-4 text-amber-400 flex-shrink-0" />
                        : <Home className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      }
                      <span className="text-sm font-semibold text-foreground">{env.label}</span>
                      {env.alwaysAvailable && (
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
                    <p className="text-xs text-muted-foreground leading-relaxed pl-6">{env.description}</p>
                    {env.zones.length > 0 && (
                      <p className="text-[10px] text-muted-foreground/60 pl-6">
                        {env.zones.map(z => z.zone_name).join(" · ")}
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