import { useState, useEffect, useRef } from "react";

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non-binary", label: "Non-binary" },
  { value: "other", label: "Other" },
];

export default function SettingsTextFields({ settings, onSave }) {
  const [worldName, setWorldName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [gender, setGender] = useState("");
  const loadedSettingsId = useRef(null);

  // Only load from DB once per settings record (identified by settings.id)
  useEffect(() => {
    if (settings.id && settings.id !== loadedSettingsId.current) {
      setWorldName(settings.fictional_world_name || "");
      setBirthday(settings.user_birthday || "");
      setScheduleNotes(settings.user_schedule_notes || "");
      setGender(settings.user_gender || "");
      loadedSettingsId.current = settings.id;
    }
  }, [settings.id, settings.fictional_world_name, settings.user_birthday, settings.user_schedule_notes, settings.user_gender]);

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
          onBlur={() => onSave({ fictional_world_name: worldName })}
          className="w-full h-11 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      {/* Your Gender */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Gender</p>
        <p className="text-xs text-muted-foreground">Used for image generation and character context</p>
        <div className="grid grid-cols-2 gap-2">
          {GENDER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => {
                setGender(opt.value);
                onSave({ user_gender: opt.value });
              }}
              className={`h-10 rounded-xl border text-sm font-medium transition-colors ${
                gender === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Your Birthday */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Birthday</p>
        <p className="text-xs text-muted-foreground">Used for in-world birthday awareness</p>
        <input
          type="date"
          value={birthday}
          onChange={e => {
            const val = e.target.value;
            setBirthday(val);
            if (val) onSave({ user_birthday: val });
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
          onBlur={() => onSave({ user_schedule_notes: scheduleNotes })}
          rows={3}
          className="w-full px-3 py-2 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 resize-none"
        />
      </div>
    </div>
  );
}