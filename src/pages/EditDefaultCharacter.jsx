import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import ReferencePhotoUploader from "@/components/character/ReferencePhotoUploader";

export default function EditDefaultCharacter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: characters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list(),
  });

  const defaultChar = characters.find(c => c.is_default);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [referenceUrls, setReferenceUrls] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  const handleAvatarGenerated = (url, refs) => {
    setAvatarUrl(url);
    setReferenceUrls(refs);
  };

  const handleSave = async () => {
    if (!defaultChar) return;
    setIsSaving(true);
    const updated = {
      ...defaultChar,
      avatar_url: avatarUrl || defaultChar.avatar_url,
      reference_image_urls: referenceUrls.length > 0 ? referenceUrls : defaultChar.reference_image_urls,
    };
    updated.system_prompt = buildSystemPrompt(updated);
    await base44.entities.Character.update(defaultChar.id, updated);
    queryClient.invalidateQueries({ queryKey: ["characters"] });
    navigate("/home");
  };

  if (!defaultChar) return null;

  const hasChanges = avatarUrl || referenceUrls.length > 0 || (defaultChar?.reference_image_urls?.length > 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/home")} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></button>
        <h2 className="text-sm font-semibold">Edit {defaultChar.name}'s Photos</h2>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <p className="text-sm text-muted-foreground">
          Upload multiple real photos of {defaultChar.name}. The more you upload, the better the AI can blend them into a consistent avatar — and match their look when they send photos in chat.
        </p>

        <ReferencePhotoUploader
          descriptor={`a 31-year-old Latino man, well-groomed, intentional style, urban New Jersey/New York`}
          onAvatarGenerated={handleAvatarGenerated}
          existingReferenceUrls={defaultChar.reference_image_urls || []}
          existingAvatarUrl={defaultChar.avatar_url || null}
        />

        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="w-full h-12 rounded-xl"
        >
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}