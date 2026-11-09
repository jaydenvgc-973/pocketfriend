import React from "react";
import { Users } from "lucide-react";

/**
 * ObserveCastPicker
 *
 * Chooses which characters present at the location take part in the observed
 * interaction. Everybody already there is a candidate; the observer decides who
 * is in the moment.
 */
export default function ObserveCastPicker({ candidates = [], castIds = [], onToggle, disabled }) {
  if (candidates.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide px-3 pt-2 pb-1">
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground flex-shrink-0">
        <Users className="w-3 h-3" />
        In this
      </span>
      {candidates.map((c) => {
        const active = castIds.includes(c.id);
        return (
          <button
            key={c.id}
            onClick={() => onToggle(c.id)}
            disabled={disabled}
            title={active ? `Remove ${c.name} from this moment` : `Add ${c.name} to this moment`}
            className={`flex items-center gap-1 pl-0.5 pr-2 py-0.5 rounded-full border transition-colors flex-shrink-0 ${
              active ? "bg-primary/15 border-primary/50 text-primary" : "bg-secondary border-border text-muted-foreground"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-secondary overflow-hidden flex items-center justify-center flex-shrink-0">
              {c.avatar_url
                ? <img src={c.avatar_url} alt={c.name} className="w-full h-full object-cover" />
                : <span className="text-[9px] font-bold text-foreground">{c.name?.[0]}</span>}
            </span>
            <span className="text-[10px] font-medium truncate max-w-[70px]">{c.name?.split(" ")[0]}</span>
          </button>
        );
      })}
    </div>
  );
}