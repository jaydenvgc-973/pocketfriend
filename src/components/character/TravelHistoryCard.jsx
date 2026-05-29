import React from "react";
import { MapPin, Clock, LogOut, LogIn } from "lucide-react";
import { format, formatDistance } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function TravelHistoryCard({ character }) {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const { data: locationHistory = [], isLoading } = useQuery({
    queryKey: ["locationHistory", character.id],
    queryFn: async () => {
      if (!character.id || !character.owner_email) return [];
      return base44.entities.LocationHistory.filter(
        { character_id: character.id, owner_email: character.owner_email },
        "-arrival_time",
        50
      ).catch(() => []);
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Filter to last 24 hours
  const recentHistory = locationHistory.filter(h => new Date(h.arrival_time) >= twentyFourHoursAgo);

  const getEventIcon = (eventType) => {
    if (eventType.includes("arrival") || eventType === "arrival") return <LogIn className="w-4 h-4 text-emerald-400" />;
    if (eventType.includes("departure") || eventType === "departure") return <LogOut className="w-4 h-4 text-orange-400" />;
    if (eventType === "return_home") return <LogIn className="w-4 h-4 text-blue-400" />;
    return <MapPin className="w-4 h-4 text-slate-400" />;
  };

  const getEventLabel = (eventType) => {
    const labels = {
      arrival: "Arrived",
      departure: "Left",
      return_home: "Returned home",
      work_start: "Started work",
      work_end: "Ended work",
      school_start: "Started school",
      school_end: "Left school",
      religious_service: "Attended service",
      food_need: "Visited for food",
      social_visit: "Social visit",
      gym_visit: "Gym visit",
      transit: "Traveling",
      stay: "Stayed at",
      other: "Visited"
    };
    return labels[eventType] || "Visited";
  };

  const getTravelReason = (h) => {
    if (h.travel_reason) return h.travel_reason;
    const reasons = {
      schedule: "Scheduled",
      autonomous: "Autonomous travel",
      promise: "Promised to be there",
      commitment: "Commitment",
      need_fulfillment: "Fulfilling a need",
      manual: "Manual move",
      system: "System",
    };
    return reasons[h.travel_source] || "";
  };

  return (
    <Card className="bg-card border border-border">
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          Travel History · Last 24 Hours
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading travel history...</p>
        ) : recentHistory.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No location changes recorded in the last 24 hours.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {recentHistory.map((h) => {
              const departureTime = h.departure_time ? new Date(h.departure_time) : null;
              const arrivalTime = new Date(h.arrival_time);
              const duration = h.duration_minutes ? `${Math.round(h.duration_minutes / 60)}h ${h.duration_minutes % 60}m` : null;

              return (
                <div key={h.id} className="text-xs space-y-1 p-2 rounded-lg bg-secondary/40 border border-border/50">
                  <div className="flex items-start gap-2">
                    {getEventIcon(h.event_type)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground">{h.location_name}</p>
                      <p className="text-[10px] text-muted-foreground">{getEventLabel(h.event_type)} · {h.location_category}</p>
                    </div>
                    {h.is_current && (
                      <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[9px] font-semibold">
                        Currently here
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span className="text-[9px]">
                        {format(arrivalTime, "h:mm a")}
                        {departureTime && ` - ${format(departureTime, "h:mm a")}`}
                        {duration && ` (${duration})`}
                      </span>
                    </div>
                  </div>

                  {getTravelReason(h) && (
                    <p className="text-[9px] text-slate-400 italic">{getTravelReason(h)}</p>
                  )}

                  {h.notes && (
                    <p className="text-[9px] text-slate-500">{h.notes}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}