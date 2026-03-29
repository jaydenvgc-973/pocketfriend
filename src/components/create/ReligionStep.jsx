import React from "react";

const RELIGIONS = [
  "Christianity",
  "Islam",
  "Judaism",
  "Hinduism",
  "Buddhism",
  "Sikhism",
  "Taoism",
  "Confucianism",
  "Shinto",
  "Jainism",
  "Bahá'í Faith",
  "Zoroastrianism",
  "Spiritual / Non-Denominational",
  "Other",
  "None",
];

const BELIEF_LEVELS = [
  {
    value: "in_name_only",
    label: "In Name Only",
    desc: "Cultural identity only. No structured practice or adherence.",
    influence: "0% influence on behavior",
  },
  {
    value: "moderate",
    label: "Moderate",
    desc: "Occasional participation. Some adherence to holidays and traditions.",
    influence: "20% influence on behavior",
  },
  {
    value: "devout",
    label: "Devout",
    desc: "Consistent practice. Schedule-driven. Faith shapes daily decisions.",
    influence: "50% influence on behavior",
  },
];

export default function ReligionStep({ data, onChange }) {
  const chipClass = (selected) =>
    `py-2.5 px-3 rounded-xl text-sm border transition-colors text-left cursor-pointer ${
      selected
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-card border-border text-foreground hover:border-primary/40"
    }`;

  const hasReligion = data.religion && data.religion !== "None";

  return (
    <div className="space-y-6">
      <div>
        <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1 block">
          Religion / Belief System
        </label>
        <p className="text-xs text-muted-foreground mb-3">
          If selected, this shapes how the character thinks, schedules their day,
          and reacts to certain topics.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {RELIGIONS.map((r) => (
            <button
              key={r}
              onClick={() => {
                onChange("religion", r);
                if (r === "None") {
                  onChange("belief_level", "moderate");
                  onChange("religion_custom", "");
                }
              }}
              className={chipClass(data.religion === r)}
            >
              {r}
            </button>
          ))}
        </div>

        {data.religion === "Other" && (
          <input
            type="text"
            value={data.religion_custom || ""}
            onChange={(e) => onChange("religion_custom", e.target.value)}
            placeholder="Enter religion name..."
            className="mt-3 w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2.5 outline-none border border-transparent focus:border-primary/50 placeholder:text-muted-foreground"
          />
        )}
      </div>

      {hasReligion && data.religion !== "None" && (
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1 block">
            Belief Level
          </label>
          <p className="text-xs text-muted-foreground mb-3">
            How devout is this character? This directly controls how much their
            faith influences their schedule, behavior, and responses.
          </p>
          <div className="space-y-2">
            {BELIEF_LEVELS.map((level) => (
              <button
                key={level.value}
                onClick={() => onChange("belief_level", level.value)}
                className={`w-full p-3 rounded-xl border transition-colors text-left ${
                  data.belief_level === level.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-foreground hover:border-primary/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{level.label}</span>
                  <span
                    className={`text-xs font-mono ${
                      data.belief_level === level.value
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    }`}
                  >
                    {level.influence}
                  </span>
                </div>
                <p
                  className={`text-xs mt-0.5 ${
                    data.belief_level === level.value
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground"
                  }`}
                >
                  {level.desc}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {!hasReligion || data.religion === "None" ? (
        <p className="text-xs text-muted-foreground text-center italic">
          No religion selected — character has no faith-based behavior.
        </p>
      ) : null}
    </div>
  );
}