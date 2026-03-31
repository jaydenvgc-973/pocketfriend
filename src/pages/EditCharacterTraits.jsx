import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import CharacterTraitsStep, { CHARACTER_TRAITS } from "@/components/character/CharacterTraitsStep";
import { buildSystemPrompt } from "@/lib/defaultCharacter";

export default function EditCharacterTraits() {
  const queryClient = useQueryClient();
  const [selectedCharId, setSelectedCharId] = useState(null);
  const [localTraits, setLocalTraits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: user } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", user?.email],
    queryFn: () => base44.entities.Character.filter({ created_by: user.email, status: "active" }, "-created_date"),
    enabled: !!user?.email,
  });

  const selectedChar = characters.find(c => c.id === selectedCharId);

  const selectChar = (char) => {
    setSelectedCharId(char.id);
    // Seed local state from character fields
    const seed = {};
    CHARACTER_TRAITS.forEach(t => { seed[t.key] = !!char[t.key]; });
    setLocalTraits(seed);
    setSaved(false);
  };

  const handleChange = (key, value) => {
    setLocalTraits(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selectedChar) return;
    setSaving(true);
    const updates = {};
    CHARACTER_TRAITS.forEach(t => { updates[t.key] = !!localTraits[t.key]; });
    await base44.entities.Character.update(selectedChar.id, updates);
    queryClient.invalidateQueries({ queryKey: ["characters", user?.email] });
    setSaving(false);
    setSaved(true);
  };

  const hasChanges = selectedChar && CHARACTER_TRAITS.some(
    t => !!localTraits[t.key] !== !!selectedChar[t.key]
  );

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-sm font-semibold">Character Traits & Quirks</h2>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">
        {/* Character selector */}
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Select a character</p>
          <div className="space-y-2">
            {characters.map(char => (
              <button
                key={char.id}
                onClick={() => selectChar(char)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                  selectedCharId === char.id
                    ? "bg-primary/10 border-primary/40"
                    : "bg-card border-border hover:border-primary/30"
                }`}
              >
                <CharacterAvatar character={char} size="sm" />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-foreground">{char.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {CHARACTER_TRAITS.filter(t => !!char[t.key]).map(t => t.label).join(", ") || "No traits set"}
                  </p>
                </div>
                {selectedCharId === char.id && (
                  <Check className="w-4 h-4 text-primary flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Traits editor */}
        {selectedChar && (
          <>
            <div className="border-t border-border pt-4">
              <CharacterTraitsStep data={localTraits} onChange={handleChange} />
            </div>

            <Button
              onClick={handleSave}
              disabled={saving || (!hasChanges && !saved)}
              className="w-full rounded-xl h-11"
            >
              {saving ? "Saving..." : saved ? "✓ Saved" : "Save Changes"}
            </Button>
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}