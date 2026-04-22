import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import ReligionStep from "@/components/create/ReligionStep";
import { useSettingsCharacters } from "@/hooks/useSettingsCharacters";
import SettingsCharacterList from "@/components/settings/SettingsCharacterList";

export default function EditCharacterReligion() {
  const queryClient = useQueryClient();
  const [selectedChar, setSelectedChar] = useState(null);
  const [form, setForm] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { sections, isLoading } = useSettingsCharacters(currentUser, "religion");

  const handleSelect = (char) => {
    setSelectedChar(char);
    setForm({
      religion: char.religion || "None",
      belief_level: char.belief_level || "moderate",
      religion_custom: char.religion_custom || "",
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selectedChar) return;
    setIsSaving(true);
    await base44.entities.Character.update(selectedChar.id, form);
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ["character", selectedChar.id] });
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        {selectedChar ? (
          <button onClick={() => setSelectedChar(null)} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : (
          <Link to="/settings" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        )}
        <h2 className="text-sm font-semibold">
          {selectedChar ? `Edit Religion — ${selectedChar.name}` : "Edit Religion"}
        </h2>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {!selectedChar ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground mb-4">Select a character to edit their religion.</p>
            {isLoading ? (
              <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
            ) : (
              <SettingsCharacterList
                sections={sections}
                onSelect={handleSelect}
                renderSubtitle={char =>
                  char.religion && char.religion !== "None"
                    ? `${char.religion} · ${char.belief_level?.replace("_", " ") || "moderate"}`
                    : "No religion set"
                }
                emptyMessage="No characters yet."
              />
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <ReligionStep
              data={form}
              onChange={(field, value) => setForm((p) => ({ ...p, [field]: value }))}
            />
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full h-12 rounded-xl gap-2"
            >
              {saved ? (
                <><Check className="w-4 h-4" /> Saved</>
              ) : isSaving ? (
                "Saving..."
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        )}
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}