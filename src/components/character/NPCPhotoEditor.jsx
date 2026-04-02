import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Camera, Upload, Loader2, X, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import NPCPhotoCropper from './NPCPhotoCropper';

export default function NPCPhotoEditor({ npc, sourceCharacter, onPhotoUpdate, onClose }) {
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState(npc?.photo_url || null);
  const [cropping, setCropping] = useState(false);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setPreview(file_url);
    } catch {
      // ignore
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    if (!sourceCharacter) return;
    
    setGenerating(true);
    try {
      const prompt = `A realistic solo portrait photo of ${npc.person_name}, who is ${sourceCharacter.name}'s ${npc.relationship_type}.
${sourceCharacter.ethnicities?.length > 0 ? `Ethnic background: ${sourceCharacter.ethnicities.join(", ")}.` : ""}
${npc.description ? `Description: ${npc.description.substring(0, 100)}` : ""}
Solo headshot or upper body portrait. Natural lighting, unposed, like a real person's photo. NOT a cartoon, NOT illustrated, NOT a group photo. Photorealistic. Only one person in the frame.`;

      const result = await base44.integrations.Core.GenerateImage({
        prompt,
      });
      
      if (result?.url) {
        setPreview(result.url);
      }
    } catch (error) {
      console.error('NPC photo generation failed:', error);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4">
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-card border border-border rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto space-y-4"
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">Photo for {npc.person_name}</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Preview */}
        {preview && (
          <div className="relative rounded-xl overflow-hidden bg-secondary h-40">
            <img src={preview} alt={npc.person_name} className="w-full h-full object-cover" />
            <button
              onClick={() => setCropping(true)}
              className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity"
              title="Reposition photo"
            >
              <ZoomIn className="w-6 h-6 text-white" />
            </button>
          </div>
        )}

        <div className="space-y-2">
          {/* Upload */}
          <label className="block">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              disabled={uploading || generating}
              className="hidden"
            />
            <button
              onClick={e => e.currentTarget.parentElement?.querySelector('input[type="file"]')?.click()}
              disabled={uploading || generating}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-border bg-secondary/50 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload Photo
                </>
              )}
            </button>
          </label>

          {/* Generate */}
          <button
            onClick={handleGenerate}
            disabled={uploading || generating}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 font-medium text-sm"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" />
                Generate Photo
              </>
            )}
          </button>
        </div>

        {preview && (
          <Button
            onClick={async () => {
              await onPhotoUpdate(preview);
              onClose();
            }}
            className="w-full rounded-xl"
            size="sm"
          >
            Done
          </Button>
        )}
      </div>

      {/* Photo Cropper */}
      {cropping && preview && (
        <NPCPhotoCropper
          photoUrl={preview}
          npcName={npc.person_name}
          onSave={() => setCropping(false)}
          onClose={() => setCropping(false)}
        />
      )}
    </div>
  );
}