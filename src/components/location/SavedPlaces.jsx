import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Trash2, Edit2, MapPin, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function SavedPlaces({ currentUser, onLocationSelect }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  const { data: locations = [] } = useQuery({
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
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ locationId, name }) =>
      base44.entities.LocationReference.update(locationId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["realLocations", currentUser?.email] });
      setEditingId(null);
    },
  });

  const handleSave = (locationId) => {
    if (editName.trim()) {
      updateMutation.mutate({ locationId, name: editName.trim() });
    }
  };

  if (locations.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No saved places yet</p>
        <p className="text-xs opacity-75">Create one from the Travel page</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {locations.map(loc => (
          <motion.div
            key={loc.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 p-3 rounded-xl bg-secondary border border-border hover:border-primary/30 transition-colors"
          >
            <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            
            {editingId === loc.id ? (
              <input
                autoFocus
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleSave(loc.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="flex-1 px-2 py-1 rounded-lg bg-background border border-border text-sm text-foreground"
              />
            ) : (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{loc.name}</p>
                {loc.operating_hours?.length > 0 && (
                  <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>Has operating hours</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-1 flex-shrink-0">
              {editingId === loc.id ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSave(loc.id)}
                    disabled={!editName.trim()}
                    className="h-7 text-xs"
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                    className="h-7 text-xs"
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setEditingId(loc.id);
                      setEditName(loc.name);
                    }}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit name"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(loc.id)}
                    disabled={deleteMutation.isPending}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}