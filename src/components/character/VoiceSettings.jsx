import React, { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Volume2, Play } from "lucide-react";
import { base44 } from "@/api/base44Client";

const OPENAI_VOICES = [
  { value: 'alloy', label: 'Alloy (Balanced, friendly)' },
  { value: 'echo', label: 'Echo (Warm, expressive)' },
  { value: 'fable', label: 'Fable (Narrative, storyteller)' },
  { value: 'onyx', label: 'Onyx (Deep, authoritative)' },
  { value: 'nova', label: 'Nova (Bright, energetic)' },
  { value: 'shimmer', label: 'Shimmer (Clear, crisp)' },
];

export default function VoiceSettings({ data, onUpdate, hasApiKey }) {
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const handlePreviewVoice = async () => {
    if (!hasApiKey || !data.voice_name) return;
    
    setIsPreviewLoading(true);
    setPreviewError(null);
    
    try {
      // Retrieve the user's API key from settings
      const settings = await base44.entities.UserSettings.list();
      const userSettings = settings?.[0];
      const apiKey = userSettings?.openai_api_key;
      
      if (!apiKey) {
        setPreviewError("API key not found. Add it in Settings.");
        setIsPreviewLoading(false);
        return;
      }
      
      const sampleText = `Hi, I'm ${data.first_name || 'a character'}. This is how I sound.`;
      
      const res = await base44.functions.invoke('generateSpeech', {
        text: sampleText,
        voice: data.voice_name,
        voiceStyleNote: data.voice_style_note,
        apiKey,
      });
      
      if (res?.data?.audioUrl) {
        const audio = new Audio(res.data.audioUrl);
        audio.play();
      } else {
        setPreviewError("Failed to generate preview.");
      }
    } catch (err) {
      setPreviewError(err.message || "Preview failed. Check your API key.");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-3 rounded-xl bg-secondary/40 border border-border">
      <div className="flex items-center gap-2 mb-2">
        <Volume2 className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Character Voice</h3>
      </div>

      {!hasApiKey ? (
        <p className="text-xs text-muted-foreground">
          Add your OpenAI API key in Settings to enable character voices.
        </p>
      ) : (
        <>
          {/* Voice enabled toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-xs text-foreground">How They Sound</Label>
            <Switch
              checked={data.voice_enabled || false}
              onCheckedChange={v => onUpdate('voice_enabled', v)}
            />
          </div>

          {data.voice_enabled && (
            <>
              {/* Voice selection */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Selected Voice</Label>
                <Select value={data.voice_name || 'alloy'} onValueChange={v => onUpdate('voice_name', v)}>
                  <SelectTrigger className="rounded-xl text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPENAI_VOICES.map(voice => (
                      <SelectItem key={voice.value} value={voice.value}>
                        {voice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Voice style note */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Speaking Style (optional)</Label>
                <p className="text-[10px] text-muted-foreground">
                  e.g., warm, confident, playful, calm, sarcastic, soft-spoken
                </p>
                <Input
                  value={data.voice_style_note || ''}
                  onChange={e => onUpdate('voice_style_note', e.target.value)}
                  placeholder="e.g. warm and thoughtful"
                  className="rounded-xl text-sm h-9"
                />
              </div>

              {/* Preview button */}
              <Button
                onClick={handlePreviewVoice}
                disabled={isPreviewLoading || !data.voice_name}
                variant="outline"
                size="sm"
                className="w-full rounded-xl gap-2 text-xs"
              >
                <Play className="w-3 h-3" />
                {isPreviewLoading ? 'Generating...' : 'Preview Their Voice'}
              </Button>

              {previewError && (
                <p className="text-xs text-destructive">{previewError}</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}