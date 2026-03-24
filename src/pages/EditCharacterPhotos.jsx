import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import ReferencePhotoUploader from "@/components/character/ReferencePhotoUploader";

export default function EditCharacterPhotos() {
  const queryClient = useQueryClient();
  const [selectedChar, setSelectedChar] = useState(null);

  const { data: characters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list("-created_date"),
  });

  const editableChars = characters.filter(c => c.status !== "deleted");

  const handleSelect = (char) => {
    setSelectedChar(char);
  };

  const handleAvatarGenerated = async (newAvatarUrl, newRefUrls) => {
    if (!selectedChar) return;
    const updated = { ...selectedChar, avatar_url: newAvatarUrl, reference_image_urls: newRefUrls };
    updated.system_prompt = buildSystemPrompt(updated);
    await base44.entities.Character.update(selectedChar.id, {
      avatar_url: newAvatarUrl,
      reference_image_urls: newRefUrls,
      system_prompt: updated.system_prompt,
    });
    queryClient.invalidateQueries({ queryKey: ["characters"] });
    queryClient.invalidateQueries({ queryKey: ["character", selectedChar.id] });
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
          {selectedChar ? `Edit Photos — ${selectedChar.name}` : "Edit Character Photos"}
        </h2>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {!selectedChar ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground mb-4">Select a character to edit their photos.</p>
            {editableChars.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No characters yet.</p>
            )}
            {editableChars.map(char => (
              <button
                key={char.id}
                onClick={() => handleSelect(char)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left"
              >
                <CharacterAvatar character={char} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{char.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{char.personality_summary?.split(".")[0]}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <ReferencePhotoUploader
            descriptor={selectedChar.personality_summary || selectedChar.name}
            existingAvatarUrl={selectedChar.avatar_url}
            existingReferenceUrls={selectedChar.reference_image_urls || []}
            onAvatarGenerated={handleAvatarGenerated}
          />
        )}
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}