import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export default function Settings() {
  const queryClient = useQueryClient();

  const { data: settingsArr = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
    initialData: [],
  });

  const settings = settingsArr[0] || {};

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.UserSettings.update(settings.id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["userSettings"] }),
  });

  const update = (field, value) => {
    if (settings.id) updateMutation.mutate({ [field]: value });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h2 className="text-sm font-semibold">Settings</h2>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6 space-y-8">
        {/* Response Length */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">Response Length</Label>
          <p className="text-xs text-muted-foreground">Control how verbose character responses are</p>
          <Select value={settings.response_length || "medium"} onValueChange={(v) => update("response_length", v)}>
            <SelectTrigger className="bg-card border-border rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short — Brief, punchy</SelectItem>
              <SelectItem value="medium">Medium — Natural flow</SelectItem>
              <SelectItem value="long">Long — Detailed, expressive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Emotional Intensity */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">Emotional Intensity</Label>
          <p className="text-xs text-muted-foreground">How strongly characters react emotionally</p>
          <Select value={settings.emotional_intensity || "medium"} onValueChange={(v) => update("emotional_intensity", v)}>
            <SelectTrigger className="bg-card border-border rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low — Mild reactions</SelectItem>
              <SelectItem value="medium">Medium — Natural reactions</SelectItem>
              <SelectItem value="high">High — Intense, raw</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Voice */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium text-foreground">Voice Input</Label>
            <p className="text-xs text-muted-foreground">Enable speech-to-text</p>
          </div>
          <Switch
            checked={settings.voice_enabled || false}
            onCheckedChange={(v) => update("voice_enabled", v)}
          />
        </div>
      </div>
    </div>
  );
}