import React, { useState } from "react";
import { Plus, Trash2, Building2, Home, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * EnvironmentManager
 *
 * UI for explicitly creating, editing, and deleting location environments.
 * Environments are user-defined metadata stored on LocationReference.environments[].
 *
 * STRICT: No inference. No auto-classification. The user explicitly:
 *  - Creates an environment with a name and type
 *  - Toggles whether it follows business hours
 *  - Assigns existing zone names to it
 *
 * A zone is never auto-assigned. Absence of environments = no mixed-use UI anywhere.
 */
export default function EnvironmentManager({ zones = [], environments = [], onChange }) {
  const [expanded, setExpanded] = useState(false);
  const [addingEnv, setAddingEnv] = useState(false);
  const [newEnvName, setNewEnvName] = useState("");
  const [newEnvType, setNewEnvType] = useState("operational");
  const [newEnvFollowsHours, setNewEnvFollowsHours] = useState(true);
  const [newEnvZones, setNewEnvZones] = useState([]);

  const zoneNames = zones.map(z => z.zone_name).filter(Boolean);

  const handleAddEnvironment = () => {
    const name = newEnvName.trim();
    if (!name) return;
    const id = `env_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newEnv = {
      id,
      name,
      type: newEnvType,
      follows_business_hours: newEnvType === "operational" ? newEnvFollowsHours : false,
      zone_names: newEnvZones,
    };
    onChange([...environments, newEnv]);
    setNewEnvName("");
    setNewEnvType("operational");
    setNewEnvFollowsHours(true);
    setNewEnvZones([]);
    setAddingEnv(false);
  };

  const handleDeleteEnvironment = (id) => {
    onChange(environments.filter(e => e.id !== id));
  };

  const handleToggleZoneForEnv = (envId, zoneName) => {
    onChange(environments.map(env => {
      if (env.id !== envId) return env;
      const already = env.zone_names.includes(zoneName);
      return {
        ...env,
        zone_names: already
          ? env.zone_names.filter(z => z !== zoneName)
          : [...env.zone_names, zoneName],
      };
    }));
  };

  const handleToggleZoneForNew = (zoneName) => {
    setNewEnvZones(prev =>
      prev.includes(zoneName) ? prev.filter(z => z !== zoneName) : [...prev, zoneName]
    );
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-border bg-card text-sm font-semibold text-foreground hover:border-primary/40 transition-colors"
      >
        <span>🏢 Environments ({environments.length})</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="space-y-3 pl-1">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Define distinct environments within this location (e.g. business operations vs. residential quarters).
            The Travel page will show an environment picker only for locations with entries here.
            No environments = standard single-use location behavior.
          </p>

          {/* Existing environments */}
          {environments.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No environments configured. Add one below.</p>
          )}

          {environments.map(env => (
            <div key={env.id} className="border border-border rounded-xl p-3 space-y-3 bg-secondary/30">
              <div className="flex items-center gap-2">
                {env.type === "residential"
                  ? <Home className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  : <Building2 className="w-4 h-4 text-amber-400 flex-shrink-0" />
                }
                <span className="text-sm font-semibold text-foreground flex-1">{env.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  env.type === "residential"
                    ? "bg-emerald-400/10 text-emerald-400"
                    : "bg-amber-400/10 text-amber-400"
                }`}>
                  {env.type === "residential" ? "Residential" : "Operational"}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteEnvironment(env.id)}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Business hours toggle for operational */}
              {env.type === "operational" && (
                <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-card border border-border">
                  <span className="text-xs text-muted-foreground">Follows business hours</span>
                  <button
                    type="button"
                    onClick={() => onChange(environments.map(e =>
                      e.id === env.id ? { ...e, follows_business_hours: !e.follows_business_hours } : e
                    ))}
                    className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                      env.follows_business_hours !== false ? "bg-primary" : "bg-secondary border border-border"
                    }`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      env.follows_business_hours !== false ? "translate-x-4" : "translate-x-0"
                    }`} />
                  </button>
                </div>
              )}
              {env.type === "residential" && (
                <p className="text-[10px] text-emerald-400/80 px-2">Always available — ignores business hours</p>
              )}

              {/* Zone assignment */}
              {zoneNames.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Assigned zones</p>
                  <div className="flex flex-wrap gap-1.5">
                    {zoneNames.map(zoneName => {
                      const assigned = env.zone_names.includes(zoneName);
                      return (
                        <button
                          key={zoneName}
                          type="button"
                          onClick={() => handleToggleZoneForEnv(env.id, zoneName)}
                          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                            assigned
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                          }`}
                        >
                          {assigned ? "✓ " : ""}{zoneName}
                        </button>
                      );
                    })}
                  </div>
                  {env.zone_names.length === 0 && (
                    <p className="text-[10px] text-amber-500/70">No zones assigned — tap zones above to assign them</p>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Add new environment form */}
          {addingEnv ? (
            <div className="border border-primary/30 rounded-xl p-3 space-y-3 bg-primary/5">
              <p className="text-xs font-semibold text-foreground">New Environment</p>

              <Input
                value={newEnvName}
                onChange={e => setNewEnvName(e.target.value)}
                placeholder="Environment name (e.g. Business Operations)"
                className="h-9 rounded-lg text-sm"
              />

              {/* Type selector */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "operational", label: "🏢 Operational", desc: "Follows business hours" },
                  { value: "residential", label: "🏠 Residential", desc: "Always available" },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setNewEnvType(opt.value);
                      if (opt.value === "residential") setNewEnvFollowsHours(false);
                      else setNewEnvFollowsHours(true);
                    }}
                    className={`py-2.5 px-2 rounded-xl border text-left transition-colors ${
                      newEnvType === opt.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <p className="text-xs font-medium">{opt.label}</p>
                    <p className="text-[10px] opacity-70 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>

              {/* Business hours toggle for operational */}
              {newEnvType === "operational" && (
                <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-card border border-border">
                  <span className="text-xs text-muted-foreground">Follows business hours</span>
                  <button
                    type="button"
                    onClick={() => setNewEnvFollowsHours(v => !v)}
                    className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                      newEnvFollowsHours ? "bg-primary" : "bg-secondary border border-border"
                    }`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      newEnvFollowsHours ? "translate-x-4" : "translate-x-0"
                    }`} />
                  </button>
                </div>
              )}

              {/* Zone assignment for new env */}
              {zoneNames.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Assign zones (optional)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {zoneNames.map(zoneName => {
                      const assigned = newEnvZones.includes(zoneName);
                      return (
                        <button
                          key={zoneName}
                          type="button"
                          onClick={() => handleToggleZoneForNew(zoneName)}
                          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                            assigned
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                          }`}
                        >
                          {assigned ? "✓ " : ""}{zoneName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setAddingEnv(false); setNewEnvName(""); setNewEnvZones([]); }}
                  className="flex-1 rounded-lg"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddEnvironment}
                  disabled={!newEnvName.trim()}
                  className="flex-1 rounded-lg"
                >
                  Add Environment
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingEnv(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Environment
            </button>
          )}
        </div>
      )}
    </div>
  );
}