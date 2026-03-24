import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";

// Editable text input field that saves on blur
export function EditableTextField({ character, field, label, placeholder = "Not set" }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(character[field] || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(character[field] || ""); }, [character[field]]);

  const save = async () => {
    if (value === (character[field] || "")) return;
    setSaving(true);
    await base44.entities.Character.update(character.id, { [field]: value });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    setSaving(false);
  };

  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <input
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        placeholder={placeholder}
        className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-transparent focus:border-primary/50 placeholder:text-muted-foreground"
      />
    </div>
  );
}

// Editable select/dropdown field
export function EditableSelectField({ character, field, label, options }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(character[field] || "");

  useEffect(() => { setValue(character[field] || ""); }, [character[field]]);

  const save = async (newVal) => {
    setValue(newVal);
    await base44.entities.Character.update(character.id, { [field]: newVal });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
  };

  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <select
        value={value}
        onChange={e => save(e.target.value)}
        className="w-full bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-transparent focus:border-primary/50 capitalize"
      >
        <option value="">Not set</option>
        {options.map(opt => (
          <option key={opt.value || opt} value={opt.value || opt}>{opt.label || opt}</option>
        ))}
      </select>
    </div>
  );
}

// Multi-select ethnicity checkboxes (displayed as tags + dropdown)
export function EditableEthnicityField({ character }) {
  const queryClient = useQueryClient();
  const ETHNICITIES = [
    "Black / African American", "White / European", "Latino / Hispanic",
    "East Asian", "South Asian", "Southeast Asian", "Middle Eastern / North African",
    "Native American / Indigenous", "Pacific Islander", "Mixed / Multiracial", "Other"
  ];
  const [selected, setSelected] = useState(character.ethnicities || []);
  const [open, setOpen] = useState(false);

  useEffect(() => { setSelected(character.ethnicities || []); }, [character.ethnicities]);

  const toggle = async (eth) => {
    const next = selected.includes(eth) ? selected.filter(e => e !== eth) : [...selected, eth];
    setSelected(next);
    await base44.entities.Character.update(character.id, { ethnicities: next });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
  };

  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Ethnic Background</p>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(eth => (
            <button
              key={eth}
              onClick={() => toggle(eth)}
              className="px-2.5 py-1 rounded-full bg-primary/20 text-primary text-xs font-medium flex items-center gap-1"
            >
              {eth} <span className="opacity-60">×</span>
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen(v => !v)}
        className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
      >
        {open ? "Close" : "+ Add ethnicity"}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 gap-1">
          {ETHNICITIES.map(eth => (
            <label key={eth} className="flex items-center gap-2 cursor-pointer py-1">
              <input
                type="checkbox"
                checked={selected.includes(eth)}
                onChange={() => toggle(eth)}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">{eth}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}