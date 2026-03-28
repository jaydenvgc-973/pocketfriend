import React, { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Volume2, Play, Wand2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

const OPENAI_VOICES = [
  { value: 'alloy', label: 'Alloy (Balanced, friendly)' },
  { value: 'echo', label: 'Echo (Warm, expressive)' },
  { value: 'fable', label: 'Fable (Narrative, storyteller)' },
  { value: 'onyx', label: 'Onyx (Deep, authoritative)' },
  { value: 'nova', label: 'Nova (Bright, energetic)' },
  { value: 'shimmer', label: 'Shimmer (Clear, crisp)' },
];

const generateSpeakingStyle = (character) => {
  if (!character) return '';
  
  const parts = [];
  
  // Gender influence
  const genderMap = {
    male: 'masculine',
    female: 'feminine',
    'non-binary': 'neutral, balanced',
    other: 'unique',
  };
  if (character.gender && genderMap[character.gender]) {
    parts.push(genderMap[character.gender]);
  }
  
  // Age group influence
  const ageMap = {
    'Early 20s': 'youthful, energetic',
    'Mid 20s': 'confident, engaging',
    'Late 20s': 'mature, assured',
    'Early 30s': 'grounded, thoughtful',
    'Mid 30s': 'experienced, poised',
    'Late 30s': 'seasoned, composed',
    'Early 40s': 'measured, authoritative',
    'Mid 40s': 'wise, deliberate',
    'Late 40s': 'seasoned, reflective',
    'Early 50s': 'calm, settled',
    'Mid 50s': 'steady, confident',
    'Late 50s': 'sage, measured',
    '60s': 'wise, contemplative',
    '70s+': 'reflective, gentle',
  };
  if (character.age_range && ageMap[character.age_range]) {
    parts.push(ageMap[character.age_range]);
  }
  
  // Social energy influence
  const energyMap = {
    introvert: 'reserved, introspective',
    mostly_introvert: 'quiet, thoughtful',
    ambivert: 'balanced, adaptable',
    mostly_extrovert: 'outgoing, engaging',
    extrovert: 'lively, expressive',
  };
  if (character.social_energy && energyMap[character.social_energy]) {
    parts.push(energyMap[character.social_energy]);
  }
  
  // Archetype influence
  const archetypeMap = {
    'The Hero': 'bold, determined',
    'The Lover': 'warm, affectionate',
    'The Sage': 'intellectual, articulate',
    'The Innocent': 'optimistic, cheerful',
    'The Explorer': 'adventurous, curious',
    'The Creator': 'passionate, expressive',
    'The Ruler': 'authoritative, commanding',
    'The Magician': 'charismatic, mysterious',
    'The Lover Archetype': 'sensual, intimate',
    'The Everyman': 'friendly, relatable',
    'The Jester': 'playful, witty',
    'The Caregiver': 'compassionate, gentle',
  };
  if (character.archetype && archetypeMap[character.archetype]) {
    parts.push(archetypeMap[character.archetype]);
  }
  
  // Personality traits (take up to 3)
  if (character.personality_traits && character.personality_traits.length > 0) {
    const traits = character.personality_traits.slice(0, 3);
    parts.push(traits.join(', '));
  }
  
  // Communication style
  if (character.communication_style) {
    parts.push(character.communication_style);
  }
  
  // Cultural background influence
  if (character.ethnicities && character.ethnicities.length > 0) {
    const ethnicityMap = {
      'African': 'rhythmic, soulful',
      'Asian': 'measured, respectful',
      'European': 'articulate, refined',
      'Latin': 'warm, expressive',
      'Middle Eastern': 'eloquent, passionate',
      'Native American': 'grounded, contemplative',
      'Pacific Islander': 'laid-back, warm',
    };
    for (const eth of character.ethnicities) {
      for (const [key, val] of Object.entries(ethnicityMap)) {
        if (eth.includes(key)) {
          parts.push(val);
          break;
        }
      }
    }
  }
  
  // Sexual orientation influence
  if (character.sexual_orientation) {
    parts.push(character.sexual_orientation.toLowerCase());
  }
  
  // Combine unique parts (remove duplicates), limit to 5 descriptors
  const unique = Array.from(new Set(parts.filter(p => p && p.trim())));
  return unique.slice(0, 5).join(', ');
};

export default function VoiceSettings({ data, onUpdate, hasApiKey, character }) {
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Auto-generate speaking style on component mount or when character changes
  useEffect(() => {
    if (character && !data.voice_style_note) {
      const generated = generateSpeakingStyle(character);
      if (generated) {
        onUpdate('voice_style_note', generated);
      }
    }
  }, [character?.id]);

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
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Speaking Style</Label>
                  {character && (
                    <button
                      onClick={async () => {
                        setIsGenerating(true);
                        const generated = generateSpeakingStyle(character);
                        if (generated) {
                          onUpdate('voice_style_note', generated);
                        }
                        setIsGenerating(false);
                      }}
                      disabled={isGenerating}
                      className="text-[10px] text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                      title="Auto-generate from character traits"
                    >
                      <Wand2 className="w-3 h-3" />
                      Regenerate
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Based on age, personality, background & orientation. Edit or replace as needed.
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