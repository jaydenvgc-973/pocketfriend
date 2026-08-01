import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Trash2, Pencil, MapPin, Clock, Image as ImageIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const CATEGORY_EMOJI = {
  food_drink: '🍽️', gym: '🏋️', social: '🎭', outdoor: '🌳',
  medical: '🏥', grocery: '🛒', education: '🏫', business: '🏢',
  religion: '🛐', public: '🏛️', generic: '📍',
};

export default function SavedPlaces({ currentUser, onLocationSelect, onEdit }) {
  const queryClient = useQueryClient();

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["realLocations", currentUser?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke("fetchAllLocationsForUser", {});
      return (res?.data?.locations || []).filter(l => l.is_real_world === true);
    },
    enabled: !!currentUser?.email,
  });

  const deleteMutation = useMutation({
    mutationFn: (locationId) => base44.entities.LocationReference.delete(locationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["realLocations", currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUser?.email] });
    },
  });

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <MapPin className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm font-medium text-foreground">No saved places yet</p>
        <p className="text-xs mt-1">Visit a real location from the Travel page to save it here</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-2">
        These are real-world locations you've visited. Edit one to add zones and images — it'll then move to your regular locations.
      </p>
      <AnimatePresence>
        {locations.map(loc => {
          const zones = loc.zones || [];
          const totalImages = zones.reduce((sum, z) => sum + (z.image_urls?.length || 0), 0);
          const emoji = CATEGORY_EMOJI[loc.category] || '📍';

          return (
            <motion.div
              key={loc.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-card border rounded-2xl overflow-hidden border-border"
            >
              <div className="flex items-center gap-3 p-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 text-lg">
                  {emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{loc.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {loc.description && (
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">{loc.description}</p>
                    )}
                    <span className="text-xs text-muted-foreground">· {zones.length} zone{zones.length !== 1 ? "s" : ""}</span>
                    <span className="text-xs text-muted-foreground">· {totalImages} img{totalImages !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => onEdit?.(loc)}
                    className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                    title="Edit & convert to app location"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Remove "${loc.name}" from saved places?`)) {
                        deleteMutation.mutate(loc.id);
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="p-1.5 text-muted-foreground hover:text-destructive rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}