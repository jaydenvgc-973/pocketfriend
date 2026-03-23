import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, Check, X, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import { buildSystemPrompt } from "@/lib/defaultCharacter";

export default function EditCharacterPhotos() {
  const queryClient = useQueryClient();
  const [selectedChar, setSelectedChar] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [refUrls, setRefUrls] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: characters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list("-created_date"),
  });

  const editableChars = characters.filter(c => c.status !== "deleted");

  const handleSelect = (char) => {
    setSelectedChar(char);
    setAvatarUrl(char.avatar_url || "");
    setRefUrls(char.reference_image_urls || []);
    setSaved(false);
  };

  const handleUploadAvatar = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setAvatarUrl(file_url);
    setUploading(false);
  };

  const handleUploadRef = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setRefUrls(prev => [...prev, file_url]);
    setUploading(false);
  };

  const handleRemoveRef = (idx) => {
    setRefUrls(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!selectedChar) return;
    setIsSaving(true);
    const updated = { ...selectedChar, avatar_url: avatarUrl, reference_image_urls: refUrls };
    updated.system_prompt = buildSystemPrompt(updated);
    await base44.entities.Character.update(selectedChar.id, {
      avatar_url: avatarUrl,
      reference_image_urls: refUrls,
      system_prompt: updated.system_prompt,
    });
    queryClient.invalidateQueries({ queryKey: ["characters"] });
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
            {/* Avatar */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Avatar Photo</label>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl font-semibold text-primary">{selectedChar.name?.[0]?.toUpperCase()}</span>
                  )}
                </div>
                <label className="cursor-pointer">
                  <input type="file" accept="image/*" className="hidden" onChange={handleUploadAvatar} />
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm hover:bg-secondary/80 transition-colors">
                    <Upload className="w-4 h-4" />
                    {uploading ? "Uploading..." : "Upload"}
                  </div>
                </label>
              </div>
            </div>

            {/* Reference Photos */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Reference Photos</label>
              <div className="flex flex-wrap gap-3">
                {refUrls.map((url, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden">
                    <img src={url} alt={`ref-${idx}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => handleRemoveRef(idx)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-destructive flex items-center justify-center"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
                <label className="cursor-pointer w-20 h-20 rounded-xl border-2 border-dashed border-border flex items-center justify-center hover:border-primary/40 transition-colors">
                  <input type="file" accept="image/*" className="hidden" onChange={handleUploadRef} />
                  <Upload className="w-5 h-5 text-muted-foreground" />
                </label>
              </div>
            </div>

            <Button onClick={handleSave} disabled={isSaving || uploading} className="w-full h-12 rounded-xl gap-2">
              {saved ? <><Check className="w-4 h-4" /> Saved</> : isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}