import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { MapPin } from "lucide-react";

export default function OwnedLocationsPanel({ characterId }) {
  const { data: ownedLocations = [], isLoading } = useQuery({
    queryKey: ['ownedLocations', characterId],
    queryFn: () => base44.entities.LocationReference.filter({ owner_character_id: characterId }),
    enabled: !!characterId,
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Locations Owned</p>
        <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (ownedLocations.length === 0) {
    return null;
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">Locations Owned</p>
      <div className="space-y-2">
        {ownedLocations.map((location, idx) => (
          <div key={idx} className="flex items-start gap-2">
            <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground font-medium">{location.name}</p>
              {location.category && (
                <p className="text-xs text-muted-foreground capitalize">{location.category}</p>
              )}
              {location.owner_role && (
                <p className="text-xs text-muted-foreground/70">{location.owner_role}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}