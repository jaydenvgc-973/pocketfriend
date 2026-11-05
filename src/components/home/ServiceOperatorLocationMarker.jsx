import { useQueryClient } from "@tanstack/react-query";
import { MapPin, Home, Briefcase, BookOpen, Moon, Coffee, Compass, AlertTriangle, Dumbbell, Wine } from "lucide-react";
import { getCharacterLivePresence } from "@/lib/locationResolutionEngine";
import CharacterTeleportPicker from "@/components/home/CharacterTeleportPicker";

/**
 * ServiceOperatorLocationMarker
 *
 * Location marker for Service Operator cards (e.g. Vick Servicio).
 * Reuses the EXACT same sources as regular character cards:
 *   - getCharacterLivePresence (authoritative live presence resolver)
 *   - CharacterTeleportPicker (existing teleportation control + updateCharacterLocation)
 *
 * Nothing is assumed from character_type or investigation status — the operator's
 * location is whatever the resolver reports, same as any other character.
 */

const CATEGORY_STYLES = {
  home: { Icon: Home, color: "text-pink-400" },
  gym: { Icon: Dumbbell, color: "text-cyan-400" },
  food_drink: { Icon: Wine, color: "text-amber-400" },
  school: { Icon: BookOpen, color: "text-amber-400" },
  education: { Icon: BookOpen, color: "text-amber-400" },
  workplace: { Icon: Briefcase, color: "text-blue-400" },
};

export default function ServiceOperatorLocationMarker({ character, locationMap = {} }) {
  const queryClient = useQueryClient();
  if (!character) return null;

  const presence = getCharacterLivePresence(character, locationMap);

  let Icon = MapPin;
  let color = "text-muted-foreground";

  if (presence.status === "sleeping" || presence.status === "napping") {
    Icon = Moon; color = "text-blue-300";
  } else if (presence.status === "resting") {
    Icon = Coffee; color = "text-amber-400";
  } else if (presence.status === "at_work") {
    Icon = Briefcase; color = "text-blue-400";
  } else if (presence.status === "at_school") {
    Icon = BookOpen; color = "text-amber-400";
  } else if (presence.status === "rabbit_hole") {
    Icon = Compass; color = "text-violet-400";
  } else if (presence.status === "health_critical") {
    Icon = AlertTriangle; color = "text-red-400";
  } else if (presence.status === "home") {
    Icon = Home; color = "text-pink-400";
  } else if (presence.status === "visiting" || presence.status === "at_location") {
    const style = CATEGORY_STYLES[locationMap[character.resolved_current_location_id]?.category];
    if (style) { Icon = style.Icon; color = style.color; }
    else { color = "text-blue-400"; }
  }

  return (
    <CharacterTeleportPicker
      character={character}
      currentLabel={presence.label}
      currentColor={color}
      IconComponent={Icon}
      onTeleported={() => queryClient.invalidateQueries({ queryKey: ["character", character.id] })}
    />
  );
}