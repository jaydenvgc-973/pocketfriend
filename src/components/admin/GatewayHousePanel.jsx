import { useState, useEffect } from "react";
import { Home, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

/**
 * GatewayHousePanel — administrator control for the shared residence.
 *
 * Gateway House is the one property where characters from different accounts may
 * live together. The panel creates it on first load (idempotent) and lets the
 * administrator set optional capacity limits. An empty limit means no limit.
 */
export default function GatewayHousePanel() {
  const [state, setState] = useState({ loading: true, saving: false, location: null, config: null });
  const [maxResidents, setMaxResidents] = useState("");
  const [maxUnits, setMaxUnits] = useState("");
  const [message, setMessage] = useState("");

  const apply = (data) => {
    setState(prev => ({ ...prev, loading: false, saving: false, location: data.location, config: data.config }));
    setMaxResidents(data.config?.max_residents ? String(data.config.max_residents) : "");
    setMaxUnits(data.config?.max_units ? String(data.config.max_units) : "");
  };

  useEffect(() => {
    base44.functions.invoke("configureSharedResidency", { action: "load" })
      .then(res => apply(res.data))
      .catch(err => {
        console.warn("[GatewayHouse] Could not load:", err.message);
        setState(prev => ({ ...prev, loading: false }));
      });
  }, []);

  const save = async () => {
    setState(prev => ({ ...prev, saving: true }));
    setMessage("");
    try {
      const res = await base44.functions.invoke("configureSharedResidency", {
        action: "save",
        max_residents: maxResidents,
        max_units: maxUnits,
      });
      apply(res.data);
      setMessage("Saved.");
    } catch (err) {
      setState(prev => ({ ...prev, saving: false }));
      setMessage(err.message || "Could not save.");
    }
  };

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading residence…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Home className="w-4 h-4 text-primary" />
        <div>
          <p className="text-sm font-medium text-foreground">{state.location?.name || "Gateway House"}</p>
          <p className="text-[10px] text-muted-foreground">
            {state.location
              ? `${state.location.resident_count} resident${state.location.resident_count === 1 ? "" : "s"} · ${state.location.unit_count} apartment${state.location.unit_count === 1 ? "" : "s"}`
              : "Shared residence"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Max residents</label>
          <input
            type="number"
            min="0"
            value={maxResidents}
            onChange={e => { setMaxResidents(e.target.value); setMessage(""); }}
            placeholder="No limit"
            className="w-full h-9 px-2.5 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Max apartments</label>
          <input
            type="number"
            min="0"
            value={maxUnits}
            onChange={e => { setMaxUnits(e.target.value); setMessage(""); }}
            placeholder="No limit"
            className="w-full h-9 px-2.5 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={state.saving}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
        >
          {state.saving ? "Saving…" : "Save limits"}
        </button>
        {message && <span className="text-[10px] text-muted-foreground">{message}</span>}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Leave a field empty for no limit. These limits are enforced when a character is moved in, not by hiding anything already there.
      </p>
    </div>
  );
}