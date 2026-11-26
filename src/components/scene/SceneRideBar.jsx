import React from "react";
import { Car } from "lucide-react";
import { carLabel } from "@/lib/ownerBelongings";

/**
 * SceneRideBar — the one line that says the scene is currently a car.
 *
 * It states whose vehicle it is, what it is, and where it is headed, so the destination
 * chosen for the ride stays visible for the whole ride. It is not a control: the ride ends
 * through Arrive at Destination in the strip.
 */
export default function SceneRideBar({ ride }) {
  if (!ride) return null;
  const whose = ride.ownerType === "user" ? "your" : `${ride.ownerName}'s`;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-primary/10 flex-shrink-0">
      <Car className="w-3.5 h-3.5 text-primary flex-shrink-0" />
      <span className="flex-1 min-w-0 text-[11px] text-foreground truncate">
        Riding in {whose} {carLabel(ride.car) || "car"} → {ride.spaceLabel || ride.destination?.name}
      </span>
    </div>
  );
}