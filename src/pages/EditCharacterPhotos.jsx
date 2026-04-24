import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Upload, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import VoiceSettings from "@/components/character/VoiceSettings";
import ReferencePhotoUploader from "@/components/character/ReferencePhotoUploader";
import { useSettingsCharacters } from "@/hooks/useSettingsCharacters";
import SettingsCharacterList from "@/components/settings/SettingsCharacterList";

export default function EditCharacterPhotos() {
  const queryClient = useQueryClient();
  const [selectedChar, setSelectedChar] = useState(null);
  const [uploadingAvatarId, setUploadingAvatarId] = useState(null);
  const [avatarSaveStatus, setAvatarSaveStatus] = useState('idle'); // idle | saving | saved | failed

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { sections, isLoading } = useSettingsCharacters(currentUser, "photos");

  const { data: userSettings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const hasApiKey = userSettings[0]?.openai_api_key ? true : false;
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState(null); // uploaded but not yet saved
  const [form, setForm] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSelect = (char) => {
    setSelectedChar(char);
    setPendingAvatarUrl(null);
    setAvatarSaveStatus('idle');
    setForm({
      voice_enabled: char.voice_enabled || false,
      voice_name: char.voice_name || "",
      voice_style_note: char.voice_style_note || "",
    });
  };

  const handleAvatarGenerated = async (newAvatarUrl, newRefUrls, newGenerationPrompt, newDescriptionText) => {
    if (!selectedChar) return;
    setAvatarSaveStatus('saving');
    try {
      console.log(`[AVATAR] Generated avatar saving for character ${selectedChar.id} — url: ${newAvatarUrl?.substring(0, 60)}`);
      const updated = {
        ...selectedChar,
        avatar_url: newAvatarUrl,
        reference_image_urls: newRefUrls,
        avatar_generation_prompt: newGenerationPrompt || selectedChar.avatar_generation_prompt,
        avatar_description_text: newDescriptionText !== undefined ? newDescriptionText : selectedChar.avatar_description_text,
      };
      await base44.entities.Character.update(selectedChar.id, {
        avatar_url: newAvatarUrl,
        reference_image_urls: newRefUrls,
        ...(newGenerationPrompt ? { avatar_generation_prompt: newGenerationPrompt } : {}),
        ...(newDescriptionText !== undefined ? { avatar_description_text: newDescriptionText } : {}),
      });
      console.log(`[AVATAR] Generated avatar saved successfully for character ${selectedChar.id}`);
      setSelectedChar(updated);
      setAvatarSaveStatus('saved');
      queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
      queryClient.invalidateQueries({ queryKey: ["character", selectedChar.id] });
      setTimeout(() => setAvatarSaveStatus('idle'), 3000);
    } catch (err) {
      console.error(`[AVATAR] Generated avatar save failed for character ${selectedChar.id}:`, err.message);
      setAvatarSaveStatus('failed');
      setTimeout(() => setAvatarSaveStatus('idle'), 4000);
    }
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
            {isLoading ? (
              <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
            ) : (
              <SettingsCharacterList
                sections={sections}
                onSelect={handleSelect}
                renderSubtitle={char => char.personality_summary?.split(".")[0]}
                emptyMessage="No characters yet."
              />
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold mb-4">Edit {selectedChar.name}'s Photos</h3>

              <div className="space-y-6">
                {/* Option 1: Replace avatar directly */}
                <div className="border border-border rounded-2xl p-4 space-y-3">
                  <p className="text-xs font-medium text-foreground uppercase tracking-wider">Replace Avatar</p>
                  <p className="text-xs text-muted-foreground">Upload a photo to use as their avatar directly. This photo becomes 100% of the avatar.</p>
                  {/* Preview: pending upload takes priority over saved avatar */}
                  {(pendingAvatarUrl || selectedChar.avatar_url) && (
                    <div className="flex justify-center">
                      <div className="relative w-24 h-24 rounded-full overflow-hidden ring-2 ring-primary/30">
                        <img src={pendingAvatarUrl || selectedChar.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                        {pendingAvatarUrl && (
                          <div className="absolute bottom-0 left-0 right-0 bg-primary/80 text-[9px] text-white text-center py-0.5">Preview</div>
                        )}
                      </div>
                    </div>
                  )}
                  {avatarSaveStatus === 'saved' && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-medium">
                      <Check className="w-3.5 h-3.5 flex-shrink-0" /> Avatar saved successfully
                    </div>
                  )}
                  {avatarSaveStatus === 'failed' && (
                    <div className="px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs font-medium">
                      ✗ Save failed — please try again
                    </div>
                  )}
                  {/* Step 1: pick a photo */}
                  <label className="block">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingAvatarId === selectedChar.id}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingAvatarId(selectedChar.id);
                        try {
                          const result = await base44.integrations.Core.UploadFile({ file });
                          setPendingAvatarUrl(result.file_url);
                          setAvatarSaveStatus('idle');
                        } catch (err) {
                          setAvatarSaveStatus('failed');
                          setTimeout(() => setAvatarSaveStatus('idle'), 4000);
                        } finally {
                          setUploadingAvatarId(null);
                        }
                      }}
                    />
                    <div className="w-full py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/40 flex items-center justify-center cursor-pointer transition-colors">
                      {uploadingAvatarId === selectedChar.id ? (
                        <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
                      ) : (
                        <div className="flex items-center gap-2">
                          <Upload className="w-4 h-4 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{pendingAvatarUrl ? "Choose a different photo" : "Click to upload a photo"}</span>
                        </div>
                      )}
                    </div>
                  </label>
                  {/* Step 2: explicit Save button */}
                  {pendingAvatarUrl && (
                    <Button
                      onClick={async () => {
                        setAvatarSaveStatus('saving');
                        try {
                          await base44.entities.Character.update(selectedChar.id, {
                            avatar_url: pendingAvatarUrl,
                            reference_image_urls: [pendingAvatarUrl],
                          });
                          setSelectedChar({ ...selectedChar, avatar_url: pendingAvatarUrl, reference_image_urls: [pendingAvatarUrl] });
                          setPendingAvatarUrl(null);
                          setAvatarSaveStatus('saved');
                          queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
                          queryClient.invalidateQueries({ queryKey: ["character", selectedChar.id] });
                          setTimeout(() => setAvatarSaveStatus('idle'), 3000);
                        } catch (err) {
                          console.error('[AVATAR] Save failed:', err.message);
                          setAvatarSaveStatus('failed');
                          setTimeout(() => setAvatarSaveStatus('idle'), 4000);
                        }
                      }}
                      disabled={avatarSaveStatus === 'saving'}
                      className="w-full h-11 rounded-xl gap-2"
                    >
                      {avatarSaveStatus === 'saving' ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving...</> : <><Check className="w-4 h-4" /> Save Avatar</>}
                    </Button>
                  )}
                </div>

                {/* Option 2: Generate from reference photos + description */}
                <div className="border border-border rounded-2xl p-4 space-y-3">
                  <p className="text-xs font-medium text-foreground uppercase tracking-wider">Generate Avatar</p>
                  <p className="text-xs text-muted-foreground">
                    Upload reference photos and/or write a description. Each counts equally — 1 photo + 1 description = 50/50.
                  </p>
                  <ReferencePhotoUploader
                    descriptor={selectedChar.personality_summary || selectedChar.name}
                    existingAvatarUrl={selectedChar.avatar_url}
                    existingReferenceUrls={selectedChar.reference_image_urls || []}
                    existingDescriptionText={selectedChar.avatar_description_text || ""}
                    existingGenerationPrompt={selectedChar.avatar_generation_prompt || ""}
                    onAvatarGenerated={handleAvatarGenerated}
                  />
                </div>

                {/* Voice Settings */}
                <div className="border border-border rounded-2xl p-4">
                  <VoiceSettings
                    data={form}
                    onUpdate={(field, value) => setForm(p => ({ ...p, [field]: value }))}
                    hasApiKey={hasApiKey}
                    character={selectedChar}
                  />
                </div>
              </div>

              <Button
                onClick={async () => {
                  setIsSaving(true);
                  await base44.functions.invoke('updateCharacterAvatar', {
                    characterId: selectedChar.id,
                    voiceEnabled: form.voice_enabled,
                    voiceName: form.voice_name,
                    voiceStyleNote: form.voice_style_note,
                  });
                  queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
                  setIsSaving(false);
                  setSaved(true);
                  setTimeout(() => setSaved(false), 2000);
                }}
                disabled={isSaving}
                className="w-full h-12 rounded-xl gap-2 mt-4"
              >
                {saved ? <><Check className="w-4 h-4" /> Saved</> : isSaving ? "Saving..." : "Save Voice Settings"}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}