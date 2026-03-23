import { Slider } from "@/components/ui/slider";

const RELATIONSHIPS = [
  {
    key: "user_respect_level",
    label: "Respect",
    description: "How much do they respect the user?",
    color: "bg-blue-500",
  },
  {
    key: "friendship_level",
    label: "Friendship",
    description: "How close is the friendship?",
    color: "bg-emerald-500",
  },
  {
    key: "romantic_level",
    label: "Romantic",
    description: "Are there romantic feelings toward the user?",
    color: "bg-pink-500",
  },
  {
    key: "attraction_level",
    label: "Attraction",
    description: "Physical/aesthetic attraction toward the user?",
    color: "bg-orange-500",
  },
  {
    key: "chosen_family_level",
    label: "Chosen Family",
    description: "Do they consider the user chosen family?",
    color: "bg-purple-500",
  },
];

export default function RelationshipStep({ data, onChange }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">
          Relationship with you
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Set the starting levels for how this person relates to you. These will evolve over time through your conversations.
        </p>
      </div>

      {RELATIONSHIPS.map(({ key, label, description, color }) => {
        const value = data[key] ?? 0;
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <span className="text-sm font-semibold text-foreground tabular-nums w-10 text-right">
                {value}%
              </span>
            </div>
            <div className="relative h-2 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${color}`}
                style={{ width: `${value}%` }}
              />
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[value]}
              onValueChange={([v]) => onChange(key, v)}
              className="mt-1"
            />
          </div>
        );
      })}
    </div>
  );
}