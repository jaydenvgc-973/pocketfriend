import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";

// Read-only display field (non-editable)
export function NonEditableField({ label, value, placeholder = "Not set" }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm text-foreground capitalize px-3 py-2 bg-secondary/40 rounded-xl">
        {value || <span className="text-muted-foreground italic">{placeholder}</span>}
      </p>
    </div>
  );
}

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

const STANDARD_OPTIONS_KEY = "__standard__";

// Editable select/dropdown field
export function EditableSelectField({ character, field, label, options }) {
  const queryClient = useQueryClient();
  const standardOptions = options.filter(o => (o.value || o) !== "Other");
  const currentVal = character[field] || "";
  const isCustom = currentVal && !standardOptions.some(o => (o.value || o) === currentVal) && currentVal !== "Other";

  const [value, setValue] = useState(currentVal);
  const [open, setOpen] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(isCustom);
  const [customText, setCustomText] = useState(isCustom ? currentVal : "");
  const ref = useRef(null);

  useEffect(() => {
    const v = character[field] || "";
    const custom = v && !standardOptions.some(o => (o.value || o) === v) && v !== "Other";
    setValue(v);
    setShowCustomInput(custom);
    setCustomText(custom ? v : "");
  }, [character[field]]);

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const save = async (newVal) => {
    setValue(newVal);
    setOpen(false);
    await base44.entities.Character.update(character.id, { [field]: newVal });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
  };

  const saveCustom = async () => {
    if (!customText.trim()) return;
    await save(customText.trim());
  };

  const isStandard = standardOptions.some(o => (o.value || o) === value);
  const displayValue = showCustomInput ? (value || "Custom...") : (value || "Not set");

  return (
    <div ref={ref} className="relative">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between bg-secondary text-foreground text-sm rounded-xl px-3 py-2 border border-transparent focus:border-primary/50 hover:border-primary/30 transition-colors"
      >
        <span className={value ? "capitalize" : "text-muted-foreground"}>{displayValue}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-lg overflow-y-auto max-h-52">
          <button
            onClick={() => { setValue(""); setShowCustomInput(false); setCustomText(""); setOpen(false); save(""); }}
            className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-secondary transition-colors"
          >
            Not set
          </button>
          {standardOptions.map(opt => {
            const val = opt.value || opt;
            const lbl = opt.label || opt;
            return (
              <button
                key={val}
                onClick={() => { setShowCustomInput(false); setCustomText(""); save(val); }}
                className={`w-full text-left px-3 py-2 text-sm capitalize transition-colors hover:bg-secondary ${value === val ? "text-primary font-medium" : "text-foreground"}`}
              >
                {lbl}
              </button>
            );
          })}
          <button
            onClick={() => { setShowCustomInput(true); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-secondary ${showCustomInput ? "text-primary font-medium" : "text-foreground"}`}
          >
            Other...
          </button>
        </div>
      )}
      {showCustomInput && (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={customText}
            onChange={e => setCustomText(e.target.value)}
            onBlur={saveCustom}
            onKeyDown={e => e.key === "Enter" && saveCustom()}
            placeholder="Type custom value..."
            autoFocus
            className="flex-1 bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-primary/50 placeholder:text-muted-foreground"
          />
        </div>
      )}
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