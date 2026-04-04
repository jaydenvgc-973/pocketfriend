import { useState, useEffect } from "react";

export default function SettingsTextFields({ settings, onSave }) {
  const [worldName, setWorldName] = useState(settings.fictional_world_name || "");
  const [birthday, setBirthday] = useState(settings.user_birthday || "");
  const [scheduleNotes, setScheduleNotes] = useState(settings.user_schedule_notes || "");

  // Sync if settings load async
  useEffect(() => {
    setWorldName(settings.fictional_world_name || "");
    setBirthday(settings.user_birthday || "");
    setScheduleNotes(settings.user_schedule_notes || "");
  }, [settings.fictional_world_name, settings.user_birthday, settings.user_schedule_notes]);

  return (
    <div className="space-y-6 pt-2 border-t border-border">
      {/* Your World Name */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Name (In-World)</p>
        <p className="text-xs text-muted-foreground">The name characters use when referring to you</p>
        <input
          type="text"
          placeholder="Your fictional world name..."
          value={worldName}
          onChange={e => setWorldName(e.target.value)}
          onBlur={() => {
            if (worldName !== (settings.fictional_world_name || "")) {
              onSave({ fictional_world_name: worldName });
            }
          }}
          className="w-full h-11 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      {/* Your Birthday */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Birthday</p>
        <p className="text-xs text-muted-foreground">Used for in-world birthday awareness</p>
        <input
          type="date"
          value={birthday}
          onChange={e => setBirthday(e.target.value)}
          onBlur={() => {
            if (birthday !== (settings.user_birthday || "")) {
              onSave({ user_birthday: birthday });
            }
          }}
          className="w-full h-11 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      {/* Your Schedule */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Schedule / Availability</p>
        <p className="text-xs text-muted-foreground">Helps characters understand when you're typically free</p>
        <textarea
          placeholder="e.g. I'm usually free evenings and weekends..."
          value={scheduleNotes}
          onChange={e => setScheduleNotes(e.target.value)}
          onBlur={() => {
            if (scheduleNotes !== (settings.user_schedule_notes || "")) {
              onSave({ user_schedule_notes: scheduleNotes });
            }
          }}
          rows={3}
          className="w-full px-3 py-2 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 resize-none"
        />
      </div>
    </div>
  );
}