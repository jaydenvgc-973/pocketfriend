import { Home, Trees } from "lucide-react";

/**
 * Physical Setting — is this space physically indoors or outdoors?
 *
 * Independent of Location Category, Venue Type, Environment and any parent location.
 * A workspace connected to a building may still operate outdoors; a residence connected
 * to a property may sit outside it. Leaving it unset is a real state: nothing is inferred.
 */
export default function PhysicalSettingToggle({ value, onChange, label = "Physical Setting", hint = null, disabled = false }) {
  const options = [
    { value: "indoor", label: "Indoor", Icon: Home },
    { value: "outdoor", label: "Outdoor", Icon: Trees },
  ];

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider block">{label}</label>
      <div className="flex gap-2">
        {options.map(({ value: option, label: optionLabel, Icon }) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onChange?.(value === option ? null : option)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] border transition-colors ${
              value === option
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border text-muted-foreground hover:border-primary/40"
            } ${disabled ? "opacity-60 cursor-default" : ""}`}
          >
            <Icon className="w-3 h-3" />
            {optionLabel}
          </button>
        ))}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground leading-relaxed">{hint}</p>}
    </div>
  );
}