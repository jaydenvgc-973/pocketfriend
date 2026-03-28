import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, Upload, RefreshCw } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import VoiceSettings from "@/components/character/VoiceSettings";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import ReferencePhotoUploader from "@/components/character/ReferencePhotoUploader";

export default function EditCharacterPhotos() {
  const queryClient = useQueryClient();
  const [selectedChar, setSelectedChar] = useState(null);
  const [uploadingAvatarId, setUploadingAvatarId] = useState(null);

  const { data: currentUser = null } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ created_by: currentUser.email }, "-created_date")
      : [],
    enabled: !!currentUser?.email,
  });

  const editableChars = characters.filter(c => c.status !== "deleted");

  const { data: userSettings = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const hasApiKey = userSettings[0]?.openai_api_key ? true : false;
  const [voiceForm, setVoiceForm] = useState({});

  const handleSelect = (char) => {
    setSelectedChar(char);
    setVoiceForm({
      voice_enabled: char.voice_enabled || false,
      voice_name: char.voice_name || "",
      voice_style_note: char.voice_style_note || "",
    });
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
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
    queryClient.invalidateQueries({ queryKey: ["character", selectedChar.id] });
  };

  const handleVoiceSave = async () => {
    if (!selectedChar) return;
    await base44.entities.Character.update(selectedChar.id, voiceForm);
    queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
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
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold mb-4">Edit {selectedChar.name}'s Photos</h3>
              
              <div className="space-y-6">
                {/* Option 1: Replace avatar directly */}
                <div className="border border-border rounded-2xl p-4 space-y-3">
                  <p className="text-xs font-medium text-foreground uppercase tracking-wider">Replace Avatar</p>
                  <p className="text-xs text-muted-foreground">Upload a photo to use as their avatar instead of the generated one.</p>
                  {selectedChar.avatar_url && (
                    <div className="flex justify-center">
                      <div className="relative w-24 h-24 rounded-full overflow-hidden ring-2 ring-primary/30">
                        <img src={selectedChar.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                      </div>
                    </div>
                  )}
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
                          const updated = { ...selectedChar, avatar_url: result.file_url, reference_image_urls: [result.file_url] };
                          updated.system_prompt = buildSystemPrompt(updated);
                          await base44.entities.Character.update(selectedChar.id, {
                            avatar_url: result.file_url,
                            reference_image_urls: [result.file_url],
                            system_prompt: updated.system_prompt,
                          });
                          setSelectedChar(updated);
                          queryClient.invalidateQueries({ queryKey: ["characters", currentUser?.email] });
                          queryClient.invalidateQueries({ queryKey: ["character", selectedChar.id] });
                        } finally {
                          setUploadingAvatarId(null);
                        }
                      }}
                    />
                    <div className="w-full py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/40 flex items-center justify-center cursor-pointer transition-colors disabled:opacity-50">
                      {uploadingAvatarId === selectedChar.id ? (
                        <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />
                      ) : (
                        <div className="flex items-center gap-2">
                          <Upload className="w-4 h-4 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Click to upload a photo</span>
                        </div>
                      )}
                    </div>
                  </label>
                </div>

                {/* Option 2: Generate from reference photos */}
                <div className="border border-border rounded-2xl p-4 space-y-3">
                  <p className="text-xs font-medium text-foreground uppercase tracking-wider">Generate Avatar from Photos</p>
                  <ReferencePhotoUploader
                    descriptor={selectedChar.personality_summary || selectedChar.name}
                    existingAvatarUrl={selectedChar.avatar_url}
                    existingReferenceUrls={selectedChar.reference_image_urls || []}
                    onAvatarGenerated={handleAvatarGenerated}
                  />
                </div>

                {/* Voice Settings */}
                <div className="border border-border rounded-2xl p-4 space-y-3 pt-4 mt-4">
                  <VoiceSettings 
                    data={voiceForm} 
                    onUpdate={(field, value) => setVoiceForm(p => ({ ...p, [field]: value }))} 
                    hasApiKey={hasApiKey} 
                  />
                  {(voiceForm.voice_enabled !== selectedChar.voice_enabled || voiceForm.voice_name !== selectedChar.voice_name || voiceForm.voice_style_note !== selectedChar.voice_style_note) && (
                    <button
                      onClick={handleVoiceSave}
                      className="w-full py-2 px-3 bg-primary text-primary-foreground rounded-xl text-xs font-medium hover:bg-primary/90 transition-colors"
                    >
                      Save Voice Settings
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}