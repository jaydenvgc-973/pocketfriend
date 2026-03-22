import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Sparkles, RefreshCw, Check, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSystemPrompt } from "@/lib/defaultCharacter";
import { motion } from "framer-motion";

export default function EditDefaultCharacter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: characters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list(),
  });

  const defaultChar = characters.find(c => c.is_default);

  const [generatedImages, setGeneratedImages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const generateImages = async () => {
    if (!defaultChar) return;
    setIsGenerating(true);
    setGeneratedImages([]);
    const basePrompt = `Realistic portrait photo of a 31-year-old Latino man, well-groomed, intentional style, urban New Jersey/New York. Candid, authentic, natural light. Not stock photo.`;
    const results = await Promise.all([
      base44.integrations.Core.GenerateImage({ prompt: basePrompt }),
      base44.integrations.Core.GenerateImage({ prompt: basePrompt + " Wearing a clean outfit, NYC street backdrop." }),
      base44.integrations.Core.GenerateImage({ prompt: basePrompt + " At home, relaxed but put together." }),
    ]);
    setGeneratedImages(results.map(r => r.url));
    setIsGenerating(false);
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setSelectedImageUrl(file_url);
    setIsUploading(false);
  };

  const handleSave = async () => {
    if (!defaultChar || !selectedImageUrl) return;
    setIsSaving(true);
    const updated = { ...defaultChar, avatar_url: selectedImageUrl };
    updated.system_prompt = buildSystemPrompt(updated);
    await base44.entities.Character.update(defaultChar.id, updated);
    queryClient.invalidateQueries({ queryKey: ["characters"] });
    navigate("/home");
  };

  if (!defaultChar) return null;

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
        <h2 className="text-sm font-semibold">Edit {defaultChar.name}'s Photo</h2>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        {/* Current avatar */}
        <div className="flex justify-center">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-primary/20 ring-2 ring-primary/30 flex items-center justify-center">
            {(selectedImageUrl || defaultChar.avatar_url) ? (
              <img src={selectedImageUrl || defaultChar.avatar_url} className="w-full h-full object-cover" alt="avatar" />
            ) : (
              <span className="text-3xl font-bold text-primary">{defaultChar.name?.[0]}</span>
            )}
          </div>
        </div>

        {/* Upload option */}
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Upload a photo</p>
          <label className="cursor-pointer">
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            <div className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/30 transition-colors text-sm text-muted-foreground">
              {isUploading ? <><RefreshCw className="w-4 h-4 animate-spin" /> Uploading...</> : <><Upload className="w-4 h-4" /> Choose from device</>}
            </div>
          </label>
        </div>

        {/* Generate option */}
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Or generate AI photos</p>
          <Button onClick={generateImages} disabled={isGenerating} variant="outline" className="w-full rounded-xl gap-2">
            {isGenerating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating...</> : <><Sparkles className="w-4 h-4" /> Generate photos</>}
          </Button>
        </div>

        {generatedImages.length > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {generatedImages.map((url, i) => (
                <div key={i} onClick={() => setSelectedImageUrl(selectedImageUrl === url ? null : url)} className={`relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all ${selectedImageUrl === url ? "border-primary" : "border-transparent"}`}>
                  <img src={url} alt={`option ${i + 1}`} className="w-full h-full object-cover" />
                  {selectedImageUrl === url && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <Check className="w-6 h-6 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Button onClick={generateImages} disabled={isGenerating} variant="ghost" size="sm" className="w-full gap-2 text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </Button>
          </div>
        )}

        <Button onClick={handleSave} disabled={!selectedImageUrl || isSaving} className="w-full h-12 rounded-xl">
          {isSaving ? "Saving..." : "Save Photo"}
        </Button>
      </div>
    </div>
  );
}