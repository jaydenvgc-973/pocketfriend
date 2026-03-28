import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { AlertCircle, Volume2 } from "lucide-react";

const OPENAI_VOICES = [
  { value: 'alloy', label: 'Alloy (Balanced, friendly)' },
  { value: 'echo', label: 'Echo (Warm, expressive)' },
  { value: 'fable', label: 'Fable (Narrative, storyteller)' },
  { value: 'onyx', label: 'Onyx (Deep, authoritative)' },
  { value: 'nova', label: 'Nova (Bright, energetic)' },
  { value: 'shimmer', label: 'Shimmer (Clear, crisp)' },
];

export default function VoiceAudioSettings({ settings, onUpdate, isSaving }) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(settings?.openai_api_key || '');
  const [showCostInfo, setShowCostInfo] = useState(false);

  const handleApiKeySave = () => {
    onUpdate('openai_api_key', apiKeyInput);
    setShowApiKey(false);
  };

  const handleApiKeyClear = () => {
    setApiKeyInput('');
    onUpdate('openai_api_key', '');
  };

  const isVoiceReady = settings?.voice_enabled && settings?.openai_api_key;

  return (
    <div className="space-y-6 pt-4 border-t border-border">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-4">Voice & Audio Settings</h3>
        
        {/* Master toggle */}
        <div className="flex items-center justify-between mb-4 p-3 rounded-xl bg-secondary/40">
          <div>
            <Label className="text-sm text-foreground">Enable Character Voices</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Characters can speak their dialogue on the Chat page
            </p>
          </div>
          <Switch
            checked={settings?.voice_enabled || false}
            onCheckedChange={v => onUpdate('voice_enabled', v)}
            disabled={isSaving}
          />
        </div>

        {/* API Key section — only show if voices are enabled */}
        {settings?.voice_enabled && (
          <div className="space-y-3 mt-4 p-3 rounded-xl bg-secondary/60 border border-border">
            <div>
              <Label className="text-sm text-foreground">Your OpenAI API Key</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Voice features use your personal OpenAI API account. Any audio generated will be billed directly to you by OpenAI based on your usage. This app does not charge you for voice and does not cover these costs.
              </p>
            </div>
            
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                placeholder="sk-..."
                className="rounded-xl text-sm pr-24"
                disabled={isSaving}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-2">
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showApiKey ? "Hide" : "Show"}
                </button>
                {apiKeyInput && apiKeyInput !== (settings?.openai_api_key || '') && (
                  <button
                    onClick={handleApiKeySave}
                    disabled={isSaving}
                    className="text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50 font-medium"
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </button>
                )}
                {settings?.openai_api_key && (
                  <button
                    onClick={handleApiKeyClear}
                    disabled={isSaving}
                    className="text-xs text-destructive hover:text-destructive/80 transition-colors disabled:opacity-50 font-medium"
                  >
                    {isSaving ? "Clearing..." : "Clear"}
                  </button>
                )}
              </div>
            </div>

            {/* Cost disclosure */}
            <div className="mt-3 p-2 rounded-lg bg-amber-950/20 border border-amber-700/30">
              <div className="flex gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-700">
                  <p className="font-medium mb-1">Estimated Cost</p>
                  <p>OpenAI voice generation typically costs a few cents per minute of audio. Light use may cost a few dollars per month. Heavy use may cost more. You are responsible for all usage billed to your API key.</p>
                </div>
              </div>
            </div>

            {/* Usage tracker */}
            {settings?.voice_minutes_used > 0 && (
              <div className="text-xs text-muted-foreground mt-2">
                💬 You have used approximately <span className="font-medium text-foreground">{Math.round(settings.voice_minutes_used * 10) / 10} minutes</span> of voice this session.
              </div>
            )}

            {/* Status indicator */}
            {!settings?.openai_api_key ? (
              <div className="text-xs text-destructive">
                ⚠️ Add your OpenAI API key to enable character voices.
              </div>
            ) : (
              <div className="text-xs text-emerald-600 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-600" />
                API key connected — ready to use voices
              </div>
            )}
          </div>
        )}

        {!settings?.voice_enabled && (
          <p className="text-xs text-muted-foreground text-center py-4 italic">
            Enable character voices above to configure voice settings.
          </p>
        )}
      </div>
    </div>
  );
}