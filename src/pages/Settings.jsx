import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Trash2, RotateCcw, BookOpen, Camera, Heart, BarChart2, User, Briefcase } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import BottomNav from "@/components/BottomNav";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import DeleteCharacterDialog from "@/components/home/DeleteCharacterDialog";
import UserPhotoUploader from "@/components/user/UserPhotoUploader";
import CommonQuestions from "@/components/settings/CommonQuestions";

export default function Settings() {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState(null);

  const { data: settingsList = [] } = useQuery({
    queryKey: ["userSettings"],
    queryFn: () => base44.entities.UserSettings.list(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters"],
    queryFn: () => base44.entities.Character.list("-created_date"),
  });

  const { data: user = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const settings = settingsList[0] || {};

  const mutation = useMutation({
    mutationFn: (data) =>
      settings.id
        ? base44.entities.UserSettings.update(settings.id, data)
        : base44.entities.UserSettings.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["userSettings"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, cause, closeness }) => {
      const activeOthers = characters.filter(c => c.id !== id && c.status !== "deleted");
      const departed = characters.find(c => c.id === id);
      if (departed) {
        await Promise.all(activeOthers.map(c =>
          base44.entities.Character.update(c.id, {
            departed_characters: [
              ...(c.departed_characters || []),
              { name: departed.name, cause, relationship_closeness: closeness }
            ]
          })
        ));
      }
      return base44.entities.Character.delete(id);
    },
    onSuccess: () => {
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    },
  });

  const moveBackMutation = useMutation({
    mutationFn: async (id) => {
      return base44.entities.Character.update(id, { status: "active" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["characters"] }),
  });

  const movedAwayChars = characters.filter(c => c.status === "moved_away");

  return (
    <div className="min-h-screen bg-background">
      {pendingDelete && (
        <DeleteCharacterDialog
          character={pendingDelete}
          onConfirm={({ cause, closeness }) => deleteMutation.mutate({ id: pendingDelete.id, cause, closeness })}
          onCancel={() => setPendingDelete(null)}
        />
      )}
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
        <div className="space-y-4 pt-2 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Response Timing</p>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-foreground">Response Lag</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Characters wait a realistic time before replying</p>
            </div>
            <Switch
              checked={settings.response_lag_enabled !== false}
              onCheckedChange={v => mutation.mutate({ response_lag_enabled: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm text-foreground">Typing Speed Delay</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Simulate realistic typing before the message appears</p>
            </div>
            <Switch
              checked={settings.typing_speed_enabled !== false}
              onCheckedChange={v => mutation.mutate({ typing_speed_enabled: v })}
            />
          </div>
          {settings.typing_speed_enabled !== false && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-foreground">Typing Speed</Label>
                <span className="text-xs text-muted-foreground font-medium">{settings.words_per_minute || 41} WPM</span>
              </div>
              <input
                type="range"
                min={15}
                max={120}
                step={1}
                value={settings.words_per_minute || 41}
                onChange={e => mutation.mutate({ words_per_minute: Number(e.target.value) })}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>15 WPM (slow)</span>
                <span>120 WPM (fast)</span>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Name in This World</p>
          <p className="text-xs text-muted-foreground">The name characters use when referring to you. Leave blank to stay anonymous.</p>
          <input
            type="text"
            placeholder="e.g. Alex, Jordan, Skylar..."
            value={settings.fictional_world_name || ""}
            onChange={e => mutation.mutate({ fictional_world_name: e.target.value })}
            className="w-full h-11 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground"
          />
        </div>
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Birthday (optional)</p>
          <input
            type="date"
            value={settings.user_birthday || ""}
            onChange={e => mutation.mutate({ user_birthday: e.target.value })}
            className="w-full h-11 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm"
          />
        </div>
        <div className="space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Schedule</p>
          <p className="text-xs text-muted-foreground">Let characters know when you're usually free so they reach out at the right times.</p>
          <textarea
            placeholder="e.g. I work 9-5 on weekdays. I'm usually free evenings and weekends. I'm a night owl."
            value={settings.user_schedule_notes || ""}
            onChange={e => mutation.mutate({ user_schedule_notes: e.target.value })}
            rows={3}
            className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground resize-none"
          />
        </div>
        <div className="pt-4 border-t border-border">
          <UserPhotoUploader referenceImages={user.reference_image_urls || []} generatedAvatars={user.generated_avatar_urls || []} />
        </div>
        <div className="space-y-4 pt-4 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Per-Character Nicknames</p>
          <p className="text-xs text-muted-foreground">Set a nickname a specific character uses for you. Overrides your global name for that character only.</p>
          <div className="space-y-3">
            {characters.filter(c => c.status !== "deleted" && c.status !== "moved_away").map(char => (
              <div key={char.id} className="flex items-center gap-3">
                <CharacterAvatar character={char} size="sm" />
                <span className="text-sm text-foreground w-24 shrink-0 truncate">{char.name}</span>
                <input
                  type="text"
                  placeholder={settings.fictional_world_name || "nickname..."}
                  defaultValue={char.nickname_for_user || ""}
                  onBlur={e => {
                    const val = e.target.value.trim();
                    if (val !== (char.nickname_for_user || "")) {
                      base44.entities.Character.update(char.id, { nickname_for_user: val || null })
                        .then(() => queryClient.invalidateQueries({ queryKey: ["characters"] }));
                    }
                  }}
                  className="flex-1 h-9 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground"
                />
              </div>
            ))}
          </div>
        </div>
        <div className="pt-4 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Characters</p>
          <Link to="/edit-character-story">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <BookOpen className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Character Stories</p>
                <p className="text-xs text-muted-foreground">Update backstory, situation, family history & more</p>
              </div>
            </button>
          </Link>
          <Link to="/edit-character-photos">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Camera className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Character Photos</p>
                <p className="text-xs text-muted-foreground">Update avatar and reference photos</p>
              </div>
            </button>
          </Link>
          <Link to="/edit-character-emotions">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Heart className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Character Emotions</p>
                <p className="text-xs text-muted-foreground">Triggers, emotional state, baggage & reactions</p>
              </div>
            </button>
          </Link>
          <Link to="/edit-character-relationships">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <BarChart2 className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Relationship Levels</p>
                <p className="text-xs text-muted-foreground">Respect, friendship, romantic, attraction & chosen family</p>
              </div>
            </button>
          </Link>
          <Link to="/edit-character-profile" className="mt-2 block">
            <button className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors text-left">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Briefcase className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">Edit Occupation, Education & Relationships</p>
                <p className="text-xs text-muted-foreground">Job, education, inter-character relationships with bi-directional sync</p>
              </div>
            </button>
          </Link>
        </div>
        {movedAwayChars.length > 0 && (
          <div className="space-y-4 pt-4 border-t border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Characters Away ({movedAwayChars.length})</p>
            <div className="space-y-3">
              {movedAwayChars.map(char => (
                <div key={char.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                  <CharacterAvatar character={char} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{char.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{char.personality_summary?.split(".")[0]}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => moveBackMutation.mutate(char.id)}
                      disabled={moveBackMutation.isPending}
                      className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                      title="Move back"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPendingDelete(char)}
                      className="p-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <CommonQuestions />

        <div className="pt-4 pb-2">
          <button
            onClick={() => base44.auth.logout()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors"
          >
            Log out
          </button>
        </div>
      </div>
      <div className="pb-28" />
      <BottomNav />
    </div>
  );
}