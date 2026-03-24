import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";

const RELATIONSHIP_TYPES = [
  "friend",
  "best friend",
  "sibling",
  "cousin",
  "rival",
  "colleague",
  "mentor",
  "student",
  "romantic partner",
  "ex-partner",
  "acquaintance",
  "neighbor",
  "childhood friend"
];

export default function RelationshipsStep({ data, onChange }) {
  const [activeCharacters, setActiveCharacters] = useState([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [selectedRelationType, setSelectedRelationType] = useState("");

  useEffect(() => {
    const loadCharacters = async () => {
      const chars = await base44.entities.Character.filter({ status: "active" }, "-updated_date", 50);
      setActiveCharacters(chars);
    };
    loadCharacters();
  }, []);

  const handleAddRelationship = () => {
    if (!selectedCharacterId || !selectedRelationType) return;

    const selectedChar = activeCharacters.find(c => c.id === selectedCharacterId);
    if (!selectedChar) return;

    const newRelationship = {
      person_name: selectedChar.name,
      related_character_id: selectedCharacterId,
      relationship_type: selectedRelationType,
      description: `${data.name} is a ${selectedRelationType} of ${selectedChar.name}.`,
      current_status: "active",
      emotional_impact: "neutral"
    };

    const updated = [...(data.character_relationships || []), newRelationship];
    onChange({ character_relationships: updated });

    setSelectedCharacterId("");
    setSelectedRelationType("");
  };

  const handleRemoveRelationship = (index) => {
    const updated = data.character_relationships?.filter((_, i) => i !== index) || [];
    onChange({ character_relationships: updated });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-3">Connect with Existing Characters</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Select relationships between {data.name} and active characters in your world. These relationships will affect how both characters interact.
        </p>

        <div className="space-y-3 mb-6">
          <Select value={selectedCharacterId} onValueChange={setSelectedCharacterId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a character..." />
            </SelectTrigger>
            <SelectContent>
              {activeCharacters.map(char => (
                <SelectItem key={char.id} value={char.id}>
                  {char.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedRelationType} onValueChange={setSelectedRelationType}>
            <SelectTrigger>
              <SelectValue placeholder="Select relationship type..." />
            </SelectTrigger>
            <SelectContent>
              {RELATIONSHIP_TYPES.map(type => (
                <SelectItem key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            onClick={handleAddRelationship}
            disabled={!selectedCharacterId || !selectedRelationType}
            className="w-full"
          >
            Add Relationship
          </Button>
        </div>

        {(data.character_relationships || []).length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-foreground">Added Relationships:</h4>
            <div className="space-y-2">
              {data.character_relationships.map((rel, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-secondary rounded-lg p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{rel.person_name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{rel.relationship_type}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveRelationship(idx)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}