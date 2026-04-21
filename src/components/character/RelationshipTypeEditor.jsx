import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { RELATIONSHIP_TYPES, RELATIONSHIP_CATEGORIES, getInverseRelationType, isBilateralRelationship, isPairedRelationship } from "@/lib/relationshipTypeDefinitions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AlertCircle, Check } from "lucide-react";

export default function RelationshipTypeEditor({ sourceCharacterId, targetCharacterId, sourceCharacterName, targetCharacterName, existingRelationType, onSave, onCancel }) {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState(existingRelationType || "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  // Group relationship types by category
  const groupedTypes = useMemo(() => {
    const grouped = {};
    Object.entries(RELATIONSHIP_TYPES).forEach(([key, def]) => {
      if (!grouped[def.category]) {
        grouped[def.category] = [];
      }
      grouped[def.category].push({ key, ...def });
    });
    return grouped;
  }, []);

  const selectedTypeDef = RELATIONSHIP_TYPES[selectedType];

  const handleSave = async () => {
    if (!selectedType) return;

    setIsSaving(true);
    setSaveResult(null);

    try {
      const inverseType = getInverseRelationType(selectedType);
      const isBilateral = isBilateralRelationship(selectedType);
      const isPaired = isPairedRelationship(selectedType);

      // Update source → target relationship
      await base44.entities.CharacterRelationship.filter({
        source_character_id: sourceCharacterId,
        target_character_id: targetCharacterId
      }).then(async (existing) => {
        if (existing.length > 0) {
          // Update existing
          await base44.entities.CharacterRelationship.update(existing[0].id, {
            relationship_type: selectedType
          });
        } else {
          // Create new
          await base44.entities.CharacterRelationship.create({
            source_character_id: sourceCharacterId,
            target_character_id: targetCharacterId,
            relationship_type: selectedType
          });
        }
      });

      // Auto-create or update reverse relationship
      if (isBilateral || isPaired) {
        await base44.entities.CharacterRelationship.filter({
          source_character_id: targetCharacterId,
          target_character_id: sourceCharacterId
        }).then(async (existing) => {
          if (existing.length > 0) {
            // Update reverse
            await base44.entities.CharacterRelationship.update(existing[0].id, {
              relationship_type: inverseType
            });
          } else {
            // Create reverse
            await base44.entities.CharacterRelationship.create({
              source_character_id: targetCharacterId,
              target_character_id: sourceCharacterId,
              relationship_type: inverseType
            });
          }
        });
      }

      // Invalidate relationship queries
      queryClient.invalidateQueries({ queryKey: ["character", sourceCharacterId] });
      queryClient.invalidateQueries({ queryKey: ["character", targetCharacterId] });

      setSaveResult({
        success: true,
        message: `✓ ${sourceCharacterName} → ${selectedTypeDef.label} ← ${targetCharacterName}${isPaired || isBilateral ? " (synced)" : ""}`
      });

      setTimeout(() => {
        onSave?.();
      }, 1500);

    } catch (err) {
      setSaveResult({
        success: false,
        message: `Failed: ${err.message}`
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-4 rounded-xl bg-card border border-border">
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Relationship Type</p>
        <p className="text-xs text-muted-foreground">
          {sourceCharacterName} → <span className="text-foreground font-medium">{selectedType ? RELATIONSHIP_TYPES[selectedType]?.label : "Select..."}</span> ← {targetCharacterName}
        </p>
      </div>

      <div className="space-y-3">
        {Object.entries(groupedTypes).map(([category, types]) => {
          const categoryDef = RELATIONSHIP_CATEGORIES[category];
          return (
            <div key={category} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{categoryDef.label}</p>
              <div className="grid grid-cols-2 gap-2">
                {types.map(type => (
                  <button
                    key={type.key}
                    onClick={() => setSelectedType(type.key)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-all border ${
                      selectedType === type.key
                        ? `${categoryDef.bg} border-current text-foreground`
                        : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <p className="font-medium">{type.label}</p>
                    <p className="text-[10px] opacity-75 mt-0.5">{type.description}</p>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTypeDef && (
        <div className="p-2 rounded-lg bg-secondary/40 border border-border/50 text-xs space-y-1">
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Type:</span> {selectedTypeDef.type}
          </p>
          {selectedTypeDef.type !== "neutral" && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Reverse:</span> {RELATIONSHIP_TYPES[selectedTypeDef.inverse]?.label || selectedTypeDef.inverse}
            </p>
          )}
          {selectedTypeDef.type === "bilateral" && (
            <p className="text-blue-400">↔ Auto-synced on both sides</p>
          )}
          {selectedTypeDef.type === "paired" && (
            <p className="text-purple-400">⇄ Paired roles (auto-reversed)</p>
          )}
        </div>
      )}

      {saveResult && (
        <div className={`flex items-start gap-2 p-2 rounded-lg text-xs ${
          saveResult.success
            ? "bg-green-500/10 border border-green-500/30 text-green-400"
            : "bg-destructive/10 border border-destructive/30 text-destructive"
        }`}>
          {saveResult.success ? <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
          <p>{saveResult.message}</p>
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={onCancel} variant="outline" className="flex-1 rounded-lg h-10">Cancel</Button>
        <Button onClick={handleSave} disabled={!selectedType || isSaving} className="flex-1 rounded-lg h-10">
          {isSaving ? "Saving..." : "Save Relationship"}
        </Button>
      </div>
    </div>
  );
}