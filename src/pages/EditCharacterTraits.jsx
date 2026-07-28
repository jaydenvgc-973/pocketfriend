import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import CharacterTraitsStep, { CHARACTER_TRAITS } from "@/components/character/CharacterTraitsStep";
import SettingsQuirksStep from "@/components/settings/SettingsQuirksStep";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import { useSettingsCharacters } from "@/hooks/useSettingsCharacters";
import SettingsCharacterList from "@/components/settings/SettingsCharacterList";

export default function EditCharacterTraits() {
  const queryClient = useQueryClient();
  const [selectedCharId, setSelectedCharId] = useState(null);
  const [localTraits, setLocalTraits] = useState({});
  const [localQuirks, setLocalQuirks] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: user } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { sections, allCharacters: characters, isLoading } = useSettingsCharacters(user, "traits");

  const selectedChar = characters.find(c => c.id === selectedCharId);

  const selectChar = (char) => {
    setSelectedCharId(char.id);
    // Seed local state from character fields + quirks array
    const seed = {};
    CHARACTER_TRAITS.forEach(t => { seed[t.key] = !!char[t.key]; });
    setLocalTraits(seed);
    setLocalQuirks(Array.isArray(char.quirks) ? char.quirks.map(q => ({ ...q })) : []);
    setSaved(false);
  };

  const handleChange = (key, value) => {
    setLocalTraits(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleQuirksChange = (newQuirks) => {
    setLocalQuirks(newQuirks);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selectedChar) return;
    setSaving(true);
    const updates = {};
    CHARACTER_TRAITS.forEach(t => { updates[t.key] = !!localTraits[t.key]; });
    updates.quirks = localQuirks;
    await base44.entities.Character.update(selectedChar.id, updates);
    queryClient.invalidateQueries({ queryKey: ["characters", user?.email] });
    setSaving(false);
    setSaved(true);
  };

  const quirksChanged = JSON.stringify(localQuirks) !== JSON.stringify(selectedChar.quirks || []);
  const hasChanges = selectedChar && (
    CHARACTER_TRAITS.some(t => !!localTraits[t.key] !== !!selectedChar[t.key]) || quirksChanged
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
          {isLoading ? (
            <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
          ) : (
            <SettingsCharacterList
              sections={sections}
              onSelect={selectChar}
              renderSubtitle={char => {
                const traitLabels = CHARACTER_TRAITS.filter(t => !!char[t.key]).map(t => t.label);
                const quirkLabels = (char.quirks || []).filter(q => q.active).map(q => q.label);
                const all = [...traitLabels, ...quirkLabels];
                return all.join(", ") || "No traits or quirks set";
              }}
              emptyMessage="No characters yet."
            />
          )}
        </div>

        {/* Traits editor */}
        {selectedChar && (
          <>
            <div className="border-t border-border pt-4">
              <CharacterTraitsStep data={localTraits} onChange={handleChange} />
            </div>

            <div className="border-t border-border pt-4">
              <SettingsQuirksStep data={localQuirks} onChange={handleQuirksChange} />
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