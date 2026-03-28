import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import VoiceSettings from "@/components/character/VoiceSettings";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import ReferencePhotoUploader from "@/components/character/ReferencePhotoUploader";

export default function EditDefaultCharacter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ created_by: currentUser.email })
      : [],
    enabled: !!currentUser?.email,
  });

  const defaultChar = characters.find(c => c.is_default);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [referenceUrls, setReferenceUrls] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({});

  const { data: userSettings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const hasApiKey = userSettings[0]?.openai_api_key ? true : false;

  useEffect(() => {
    if (defaultChar && !avatarUrl && referenceUrls.length === 0) {
      setAvatarUrl(defaultChar.avatar_url || null);
      setReferenceUrls(defaultChar.reference_image_urls || []);
      setForm({
        voice_enabled: defaultChar.voice_enabled || false,
        voice_name: defaultChar.voice_name || "",
        voice_style_note: defaultChar.voice_style_note || "",
      });
    }
  }, [defaultChar, avatarUrl, referenceUrls]);

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
      voice_enabled: form.voice_enabled,
      voice_name: form.voice_name,
      voice_style_note: form.voice_style_note,
    };
    updated.system_prompt = buildSystemPrompt(updated);
    await base44.entities.Character.update(defaultChar.id, updated);
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setIsSaving(false);
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
          descriptor={defaultChar.personality_summary || `a ${defaultChar.age_range} ${defaultChar.gender} from ${defaultChar.city}`}
          onAvatarGenerated={handleAvatarGenerated}
          existingReferenceUrls={referenceUrls}
          existingAvatarUrl={avatarUrl}
        />

        <div className="border-t border-border pt-6">
          <VoiceSettings 
            data={form} 
            onUpdate={(field, value) => setForm(p => ({ ...p, [field]: value }))} 
            hasApiKey={hasApiKey} 
          />
        </div>

        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="w-full h-12 rounded-xl gap-2 mt-4"
        >
          {saved ? <><Check className="w-4 h-4" /> Saved</> : isSaving ? "Saving..." : "Save"}
        </Button>
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}