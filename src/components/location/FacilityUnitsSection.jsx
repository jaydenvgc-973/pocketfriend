import { useNavigate } from "react-router-dom";
import { ArrowRight, DoorOpen } from "lucide-react";
import { getUnitKind, getUnitLabel } from "@/lib/residentialUnits";

/**
 * FacilityUnitsSection
 *
 * Read-only view of a medical or correctional facility's internal spaces — patient rooms
 * in a hospital or clinic, cells in a prison or jail — from the same `residential_units`
 * assignments the Places page maintains. Each space lists who is assigned to it and can be
 * entered directly on the Scenes page.
 *
 * The facility is the location; the room or cell is the assigned space. Zones are untouched.
 */
export default function FacilityUnitsSection({ location, characters = [] }) {
  const navigate = useNavigate();
  const units = (location?.residential_units || []).filter((u) => u?.unit_id && u?.unit_name);
  if (units.length === 0) return null;

  const kind = getUnitKind(location);

  const resolveOccupant = (id) => {
    const char = characters.find((c) => c.id === id);
    if (char) return { id, name: char.name || char.display_name, avatar_url: char.avatar_url };
    const inmate = (location.inmates || []).find((i) => i.character_id === id);
    if (inmate) return { id, name: inmate.character_name, avatar_url: null };
    return { id, name: "Unknown character", avatar_url: null };
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 mt-3">
        <DoorOpen className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{kind.plural}</span>
      </div>
      <div className="space-y-1.5">
        {units.map((unit) => {
          const occupants = (unit.occupant_character_ids || []).map(resolveOccupant);
          return (
            <div key={unit.unit_id} className="bg-secondary/30 rounded-lg p-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-medium text-foreground">{getUnitLabel(unit.unit_name, location)}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {occupants.length} assigned
                </span>
                <button
                  onClick={() => navigate(`/scene?locationId=${location.id}&unitId=${unit.unit_id}`)}
                  className="text-[10px] text-primary font-medium flex items-center gap-0.5 hover:underline flex-shrink-0"
                >
                  Visit <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              {occupants.length > 0 ? (
                <div className="space-y-0.5">
                  {occupants.map((o) => (
                    <div key={o.id} className="flex items-center gap-1.5">
                      {o.avatar_url
                        ? <img src={o.avatar_url} alt={o.name} className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                        : <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-[8px] font-bold text-primary">{o.name?.[0]?.toUpperCase()}</div>}
                      <span className="text-xs text-foreground flex-1 truncate">{o.name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground italic">Nobody assigned</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}