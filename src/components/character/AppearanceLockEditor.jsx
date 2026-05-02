import { useState, useEffect, useRef } from "react";
import React from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Wand2, Loader2, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const FIELDS = [
  { key: "skin_tone", label: "Skin Tone", placeholder: "e.g. deep brown, light caramel, dark ebony, olive..." },
  { key: "hair_type", label: "Hair Type", placeholder: "e.g. 4C coily, loose waves, straight fine, thick curly..." },
  { key: "hairstyle", label: "Hairstyle", placeholder: "e.g. short fade, long locs, natural afro, braids..." },
  { key: "facial_hair", label: "Facial Hair", placeholder: "e.g. full beard, clean shaven, light stubble..." },
  { key: "makeup", label: "Makeup / Face", placeholder: "e.g. no makeup, bold lip, natural glam, no makeup..." },
  { key: "clothing_style", label: "Clothing Style", placeholder: "e.g. streetwear, business casual, athleisure..." },
  { key: "footwear", label: "Footwear", placeholder: "e.g. Air Force 1s, Chelsea boots, bare feet..." },
  { key: "overall_aesthetic", label: "Overall Aesthetic", placeholder: "e.g. dark academia, Caribbean casual, NYC streetwear..." },
];

function inchesToFeet(totalInches) {
  if (!totalInches) return '';
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'${inches}"`;
}

function feetStringToInches(str) {
  // Accepts: 5'8", 5'8, 5 8, 68"
  if (!str) return null;
  const stripped = str.trim().replace(/["""''`]/g, "'");
  // feet'inches
  const feetInch = stripped.match(/^(\d+)'(\d*)$/);
  if (feetInch) {
    return parseInt(feetInch[1]) * 12 + (parseInt(feetInch[2]) || 0);
  }
  // pure inches
  const pureInch = stripped.match(/^(\d+)$/);
  if (pureInch) {
    const n = parseInt(pureInch[1]);
    // if under 12, treat as feet
    return n < 12 ? n * 12 : n;
  }
  return null;
}

export default function AppearanceLockEditor({ character }) {
  const queryClient = useQueryClient();
  const [lock, setLock] = useState(character.appearance_lock || {});
  const lockRef = useRef(lock);
  const [heightRaw, setHeightRaw] = useState(() => {
    const h = character.appearance_lock?.height_inches;
    return h ? inchesToFeet(h) : '';
  });
  const [customInput, setCustomInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saved, setSaved] = useState(false);

  const setLockSynced = (updater) => {
    setLock(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      lockRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    const al = character.appearance_lock || {};
    setLock(al);
    lockRef.current = al;
    setHeightRaw(al.height_inches ? inchesToFeet(al.height_inches) : '');
  }, [character.id, JSON.stringify(character.appearance_lock)]);

  const commitHeight = () => {
    if (heightRaw === '') {
      setLockSynced(prev => ({ ...prev, height_inches: null }));
    } else {
      const parsed = feetStringToInches(heightRaw);
      if (parsed !== null && parsed > 0) {
        setLockSynced(prev => ({ ...prev, height_inches: parsed }));
      } else {
        setHeightRaw(lock.height_inches ? inchesToFeet(lock.height_inches) : '');
      }
    }
    setSaved(false);
  };

  const update = (field, value) => {
    setLockSynced(prev => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const addCustomKeyword = () => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    const existing = lockRef.current.custom_keywords || [];
    if (existing.includes(trimmed)) { setCustomInput(""); return; }
    setLockSynced(prev => ({ ...prev, custom_keywords: [...existing, trimmed] }));
    setCustomInput("");
    setSaved(false);
  };

  const removeCustomKeyword = (kw) => {
    setLockSynced(prev => ({ ...prev, custom_keywords: (prev.custom_keywords || []).filter(k => k !== kw) }));
    setSaved(false);
  };

  const save = async () => {
    // Flush any pending height before saving
    let finalLock = { ...lockRef.current };
    if (heightRaw !== '') {
      const parsed = feetStringToInches(heightRaw);
      if (parsed !== null && parsed > 0) {
        finalLock = { ...finalLock, height_inches: parsed };
        setLockSynced(() => finalLock);
        setHeightRaw(inchesToFeet(parsed));
      }
    }
    setSaving(true);
    await base44.entities.Character.update(character.id, { appearance_lock: finalLock });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const generateFromAvatar = async () => {
    if (!character.avatar_url && !character.reference_image_urls?.length) return;
    setGenerating(true);
    const refUrls = [character.avatar_url, ...(character.reference_image_urls || [])].filter(Boolean).slice(0, 3);
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Analyze the appearance of the person shown in these reference images for the character named ${character.name}.
${character.ethnicities?.length > 0 ? `Their ethnicity/background is: ${character.ethnicities.join(", ")}.` : ""}

Extract and describe the following appearance traits ACCURATELY based on the images. Be specific. Do NOT default to generic or Caucasian descriptors if the person is not Caucasian. Respect their actual identity.

Return a JSON object with these exact keys (omit any key you cannot confidently determine):
{
  "skin_tone": "specific skin tone description",
  "hair_type": "hair texture and type",
  "hairstyle": "current hairstyle",
  "facial_hair": "facial hair description or 'clean shaven' or 'n/a'",
  "makeup": "makeup style or 'natural' or 'none'",
  "clothing_style": "general clothing/fashion style",
  "overall_aesthetic": "overall visual vibe and aesthetic"
}`,
      file_urls: refUrls,
      response_json_schema: {
        type: "object",
        properties: {
          skin_tone: { type: "string" },
          hair_type: { type: "string" },
          hairstyle: { type: "string" },
          facial_hair: { type: "string" },
          makeup: { type: "string" },
          clothing_style: { type: "string" },
          overall_aesthetic: { type: "string" }
        }
      }
    });
    if (result && typeof result === "object") {
      const merged = { ...lock, ...result };
      setLock(merged);
      setSaved(false);
    }
    setGenerating(false);
  };

  const hasAvatar = !!(character.avatar_url || character.reference_image_urls?.length);
  // Compare lock state vs saved — normalize null/undefined for height_inches
  const normalizedLock = { ...lock, height_inches: lock.height_inches || null };
  const normalizedSaved = { ...(character.appearance_lock || {}), height_inches: (character.appearance_lock?.height_inches) || null };
  const hasChanges = JSON.stringify(normalizedLock) !== JSON.stringify(normalizedSaved);

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-primary" />
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Appearance Lock</p>
        </div>
        {hasAvatar && (
          <Button
            size="sm"
            variant="outline"
            onClick={generateFromAvatar}
            disabled={generating}
            className="gap-1.5 rounded-xl h-8 text-xs"
          >
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            {generating ? "Analyzing..." : "Auto-detect"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        These traits are locked identity anchors. They guide image generation and prevent drift — race, skin tone, features, and body proportions will never default or change.
      </p>

      <div className="space-y-3">
        {/* Height field — stored as height_inches, parsed on blur */}
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Height</label>
          <input
            type="text"
            value={heightRaw}
            onChange={e => { setHeightRaw(e.target.value); setSaved(false); }}
            onBlur={commitHeight}
            placeholder="e.g. 5'8 or 5'10"
            className="w-full h-10 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
          />
          {lock.height_inches > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              {lock.height_inches}" → {lock.height_inches < 64 ? 'short' : lock.height_inches <= 69 ? 'average' : lock.height_inches <= 74 ? 'tall' : 'very tall'} proportions
            </p>
          )}
        </div>

        {FIELDS.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">{label}</label>
            <input
              type="text"
              value={lock[key] || ""}
              onChange={e => update(key, e.target.value)}
              placeholder={placeholder}
              className="w-full h-10 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        ))}

        {/* Custom keywords */}
        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">Custom Keywords</label>
          {(lock.custom_keywords || []).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(lock.custom_keywords || []).map(kw => (
                <span key={kw} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  {kw}
                  <button onClick={() => removeCustomKeyword(kw)} className="text-primary/60 hover:text-destructive transition-colors ml-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addCustomKeyword()}
              placeholder="e.g. gap tooth, vitiligo, box braids, freckles..."
              className="flex-1 h-9 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button
              onClick={addCustomKeyword}
              disabled={!customInput.trim()}
              className="h-9 px-3 rounded-xl bg-primary text-primary-foreground text-sm disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {hasChanges && (
        <Button onClick={save} disabled={saving} className="w-full rounded-xl gap-2">
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Lock className="w-4 h-4" /> Save Appearance Lock</>}
        </Button>
      )}
      {saved && <p className="text-xs text-green-400 text-center">Appearance lock saved ✓</p>}
    </div>
  );
}