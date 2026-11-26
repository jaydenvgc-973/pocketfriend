import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Car, RefreshCw, Upload, Trash2, Check } from "lucide-react";
import { CAR_VIEWS, carViewPrompt, carReferenceUrls, emptyCar } from "@/lib/ownerBelongings";

/**
 * CarBelongingsEditor — one owner's car and its four visual references.
 *
 * Every view is generated through the app's existing image generation, and the interior
 * views are drawn against the exterior so the four references stay the SAME vehicle.
 * Uploading an existing photo is the same reference, so nothing is regenerated twice.
 */
export default function CarBelongingsEditor({ car, onChange }) {
  const current = car || emptyCar();
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState("");

  const setCar = (patch) => onChange({ ...current, ...patch });
  const setView = (key, url) => setCar({ views: { ...(current.views || {}), [key]: url } });

  const generate = async (viewKey) => {
    setBusyKey(viewKey);
    setError("");
    try {
      const refs = carReferenceUrls(current, viewKey);
      const result = await base44.integrations.Core.GenerateImage({
        prompt: carViewPrompt(current, viewKey),
        existing_image_urls: refs.length > 0 ? refs : undefined,
      });
      if (result?.url) setView(viewKey, result.url);
      else setError("That view could not be drawn. Try again.");
    } catch {
      setError("That view could not be drawn. Try again.");
    } finally {
      setBusyKey(null);
    }
  };

  const generateAll = async () => {
    for (const view of CAR_VIEWS) {
      if (!current.views?.[view.key] || view.key === "exterior") {
        // eslint-disable-next-line no-await-in-loop
        await generate(view.key);
      }
    }
  };

  const upload = async (viewKey, file) => {
    if (!file) return;
    setBusyKey(viewKey);
    setError("");
    try {
      const res = await base44.integrations.Core.UploadPublicFile({ file });
      if (res?.file_url) setView(viewKey, res.file_url);
    } catch {
      setError("That photo could not be uploaded. Try again.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Car className="w-3.5 h-3.5 text-primary" /> Car</p>
        {car && (
          <button onClick={() => onChange(null)} className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> Remove car
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Input value={current.label || ""} onChange={(e) => setCar({ label: e.target.value })} placeholder="Make and model" className="h-8 text-xs rounded-lg" />
        <Input value={current.color || ""} onChange={(e) => setCar({ color: e.target.value })} placeholder="Color" className="h-8 text-xs rounded-lg" />
      </div>
      <Input value={current.description || ""} onChange={(e) => setCar({ description: e.target.value })} placeholder="Anything distinctive (optional)" className="h-8 text-xs rounded-lg" />

      <p className="text-[10px] text-muted-foreground">Four views of the same vehicle. Generate each one, or upload your own photo.</p>

      <div className="space-y-2">
        {CAR_VIEWS.map((view) => {
          const url = current.views?.[view.key];
          const busy = busyKey === view.key;
          return (
            <div key={view.key} className="flex items-start gap-2 rounded-xl border border-border bg-secondary/30 p-2">
              <div className="w-[92px] h-[56px] rounded-lg overflow-hidden bg-secondary flex items-center justify-center flex-shrink-0">
                {url ? <img src={url} alt={view.label} className="w-full h-full object-cover" /> : <Car className="w-4 h-4 text-muted-foreground/60" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-foreground leading-tight">{view.label}</p>
                <p className="text-[9px] text-muted-foreground leading-tight">{view.hint}</p>
                <div className="flex items-center gap-1 mt-1">
                  <button
                    onClick={() => generate(view.key)}
                    disabled={busy}
                    className="text-[9px] px-1.5 py-0.5 rounded-md border border-border text-foreground hover:border-primary/50 disabled:opacity-50 flex items-center gap-1"
                  >
                    {busy ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />} Generate
                  </button>
                  <label className="text-[9px] px-1.5 py-0.5 rounded-md border border-border text-foreground hover:border-primary/50 cursor-pointer flex items-center gap-1">
                    <Upload className="w-2.5 h-2.5" /> Upload
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => upload(view.key, e.target.files?.[0])} />
                  </label>
                  {url && <Check className="w-3 h-3 text-green-500" />}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Button size="sm" variant="outline" onClick={generateAll} disabled={!!busyKey} className="w-full h-8 text-[11px] rounded-lg">
        {busyKey ? <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" /> : null} Generate all four views
      </Button>

      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}