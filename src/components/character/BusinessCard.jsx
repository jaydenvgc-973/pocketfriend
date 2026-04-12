import React, { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ChevronDown, Edit2, Trash2, Users } from "lucide-react";
import BusinessEmployeePanel from "./BusinessEmployeePanel";

export default function BusinessCard({ business, characterId, isLocationBased, onDelete, allCharacters = [] }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(business.name);
  const [editingNotes, setEditingNotes] = useState(business.notes || "");
  const [editingRevenue, setEditingRevenue] = useState(business.income || 0);
  const [isEditing, setIsEditing] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async (updates) => {
      if (isLocationBased) {
        const locationUpdates = { ...updates };
        if ('income' in locationUpdates) {
          locationUpdates.income_generated = locationUpdates.income;
          delete locationUpdates.income;
        }
        if ('name' in locationUpdates) delete locationUpdates.name;
        await base44.entities.LocationReference.update(business.linkedLocationId, locationUpdates);
        queryClient.invalidateQueries({ queryKey: ["ownedLocations", characterId] });
      } else {
        const results = await base44.entities.Character.filter({ id: characterId });
        const char = results[0];
        const businesses = char.businesses || [];
        const idx = businesses.findIndex(b => b.id === business.id);
        if (idx >= 0) {
          businesses[idx] = { ...businesses[idx], ...updates };
          await base44.entities.Character.update(characterId, { businesses });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["character", characterId] });
    },
  });

  const handleEmployeeUpdate = (updates) => {
    updateMutation.mutate(updates);
  };

  const handleSaveEdits = async () => {
    const updates = {};
    if (editingName !== business.name) updates.name = editingName;
    if (editingNotes !== (business.notes || "")) updates.notes = editingNotes;
    if (editingRevenue !== (business.income || 0)) updates.income = parseFloat(editingRevenue);
    if (Object.keys(updates).length > 0) await updateMutation.mutateAsync(updates);
    setIsEditing(false);
  };

  const employeeCount = (business.employees || []).length;

  return (
    <div className="bg-secondary/30 rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{business.name}</p>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-green-400 font-semibold">${(business.income || 0).toFixed(2)}/mo</span>
            {employeeCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="w-3 h-3" /> {employeeCount} emp.
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3 bg-secondary/20">
          {!isEditing ? (
            <>
              {business.notes && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Notes</p>
                  <p className="text-xs text-foreground leading-relaxed">{business.notes}</p>
                </div>
              )}
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
              >
                <Edit2 className="w-3 h-3" /> Edit
              </button>
              {!isLocationBased && (
                <div className="pt-2 border-t border-border mt-2">
                  <BusinessEmployeePanel
                    business={business}
                    characterId={characterId}
                    onBusinessUpdate={handleEmployeeUpdate}
                    allCharacters={allCharacters}
                  />
                </div>
              )}
              <button
                onClick={() => onDelete(business.id)}
                className="w-full text-xs text-destructive hover:bg-destructive/10 py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Delete Business
              </button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Business Name</p>
                  <input
                    type="text"
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Monthly Revenue</p>
                  <input
                    type="number"
                    value={editingRevenue}
                    onChange={e => setEditingRevenue(e.target.value)}
                    className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Notes</p>
                  <textarea
                    value={editingNotes}
                    onChange={e => setEditingNotes(e.target.value)}
                    rows={2}
                    className="w-full bg-secondary text-foreground text-xs rounded-lg px-2 py-1.5 border border-border outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex-1 text-xs text-muted-foreground bg-secondary rounded-lg py-1.5 hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdits}
                  disabled={updateMutation.isPending}
                  className="flex-1 text-xs text-primary-foreground bg-primary rounded-lg py-1.5 hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  Save
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}