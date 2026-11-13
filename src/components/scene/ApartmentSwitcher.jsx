import { useEffect, useRef, useState } from "react";
import { Building, ChevronDown } from "lucide-react";
import { getUnitLabel } from "@/lib/residentialUnits";

/**
 * ApartmentSwitcher
 *
 * Chooses which apartment of a multi-dwelling property is being visited. Separate from
 * the zone dropdown: the unit is the household, the zone is the room inside it. Zones and
 * their images stay shared across units.
 */
export default function ApartmentSwitcher({
  units = [],
  activeUnitId = null,
  onSelect = () => {},
  location = null,
  allowNone = false,
  noneLabel = "Whole building",
  className = "",
  direction = "down",
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (units.length === 0) return null;

  const active = units.find((u) => u.unit_id === activeUnitId) || null;
  const buttonLabel = active ? getUnitLabel(active.unit_name, location) : noneLabel;

  const choose = (unitId) => {
    setOpen(false);
    onSelect(unitId);
  };

  return (
    <div className={`relative flex-shrink-0 ${className}`} ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
          active
            ? "bg-primary/10 border-primary/40 text-primary"
            : "bg-secondary border-border text-muted-foreground hover:text-foreground"
        }`}
        title="Apartment"
      >
        <Building className="w-3.5 h-3.5" />
        <span className="truncate max-w-[110px]">{buttonLabel}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className={`absolute left-0 w-48 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden ${direction === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}>
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Apartment</p>
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {allowNone && (
              <button
                onClick={() => choose(null)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary ${
                  !active ? "bg-primary/10 text-primary" : "text-foreground"
                }`}
              >
                <span className="flex-1 truncate">{noneLabel}</span>
                {!active && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
              </button>
            )}
            {units.map((unit) => {
              const isActive = unit.unit_id === activeUnitId;
              return (
                <button
                  key={unit.unit_id}
                  onClick={() => choose(unit.unit_id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary ${
                    isActive ? "bg-primary/10 text-primary" : "text-foreground"
                  }`}
                >
                  <span className="flex-1 truncate">{getUnitLabel(unit.unit_name, location)}</span>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}