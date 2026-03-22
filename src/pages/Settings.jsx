import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Settings() {
  const queryClient = useQueryClient();

  const { data: settingsList = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const settings = settingsList[0] || {};

  const mutation = useMutation({
    mutationFn: (data) =>
      settings.id
        ? base44.entities.UserSettings.update(settings.id, data)
        : base44.entities.UserSettings.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["userSettings"] }),
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/home" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
        <h2 className="text-sm font-semibold">Settings</h2>
      </div>
      <div className="max-w-lg mx-auto px-6 py-6 space-y-8">
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Response Length</p>
          <Select value={settings.response_length || "medium"} onValueChange={v => mutation.mutate({ response_length: v })}>
            <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="long">Long</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Emotional Intensity</p>
          <Select value={settings.emotional_intensity || "medium"} onValueChange={v => mutation.mutate({ emotional_intensity: v })}>
            <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-sm text-foreground">Voice Input</Label>
          <Switch
            checked={settings.voice_enabled || false}
            onCheckedChange={v => mutation.mutate({ voice_enabled: v })}
          />
        </div>
      </div>
    </div>
  );
}