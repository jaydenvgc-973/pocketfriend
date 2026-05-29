import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Clock, AlertCircle } from 'lucide-react';

const LOCATION_ICONS = {
  home: '🏠',
  work: '💼',
  school: '🎓',
  gym: '💪',
  food_drink: '🍽️',
  religion: '🙏',
  social: '👥',
  shopping: '🛍️',
  medical: '⚕️',
  other: '📍',
};

const EVENT_LABELS = {
  arrival: 'Arrived',
  departure: 'Left',
  return_home: 'Returned home',
  work_start: 'Work started',
  work_end: 'Left work',
  school_start: 'School started',
  school_end: 'Left school',
  religious_service: 'Religious service',
  food_need: 'Ate',
  social_visit: 'Visited',
  gym_visit: 'Gym visit',
  transit: 'In transit',
  stay: 'Stayed',
  other: 'Visited',
};

const TRAVEL_SOURCE_LABELS = {
  schedule: 'Schedule',
  autonomous: 'Autonomous',
  promise: 'Promise',
  commitment: 'Commitment',
  need_fulfillment: 'Need',
  manual: 'Manual',
  system: 'System',
  other: 'Other',
};

export default function TravelHistoryCard({ characterId, ownerEmail }) {
  const formatTime = (iso) => {
    if (!iso) return null;
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (iso) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  // Fetch LocationHistory for last 24 hours
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['locationHistory', characterId, ownerEmail],
    queryFn: async () => {
      if (!characterId || !ownerEmail) return [];
      
      const now = new Date();
      const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      try {
        const records = await base44.entities.LocationHistory.filter(
          {
            character_id: characterId,
            owner_email: ownerEmail,
          },
          '-arrival_time',
          30
        );
        
        return records.filter(r => new Date(r.arrival_time) >= new Date(cutoff24h));
      } catch {
        return [];
      }
    },
    enabled: !!characterId && !!ownerEmail,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  if (isLoading) {
    return (
      <Card className="col-span-full">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Travel History · Last 24 Hours
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground animate-pulse">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (history.length === 0) {
    return (
      <Card className="col-span-full">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Travel History · Last 24 Hours
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="w-3 h-3" />
            No location changes recorded in the last 24 hours.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <MapPin className="w-4 h-4" /> Travel History · Last 24 Hours
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {history.map((h, i) => {
            const arrTime = formatTime(h.arrival_time);
            const depTime = h.departure_time ? formatTime(h.departure_time) : null;
            const timeStr = depTime ? `${arrTime}–${depTime}` : `${arrTime}`;
            const icon = LOCATION_ICONS[h.location_category] || LOCATION_ICONS.other;
            const eventLabel = EVENT_LABELS[h.event_type] || h.event_type;
            const sourceLabel = TRAVEL_SOURCE_LABELS[h.travel_source] || h.travel_source;

            return (
              <div key={h.id} className="flex gap-2 text-xs">
                <span className="text-lg shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{h.location_name}</div>
                  <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {timeStr}
                    </span>
                    {h.is_current && <Badge variant="outline" className="text-[10px]">Currently here</Badge>}
                    {sourceLabel && <Badge variant="secondary" className="text-[10px]">{sourceLabel}</Badge>}
                  </div>
                  {h.travel_reason && (
                    <div className="text-muted-foreground text-[11px] mt-0.5">{h.travel_reason}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}