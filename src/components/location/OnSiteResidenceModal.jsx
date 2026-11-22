import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Home, Upload, Plus, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ZoneImageGenerator from "@/components/location/ZoneImageGenerator";
import { getOnSiteResidence } from "@/lib/onsiteResidence";

const MAX_IMAGES = 5;

/**
 * OnSiteResidenceModal — the configuration surface for the residential environment a
 * business property contains.
 *
 * It writes to what Places already stores, and nothing else:
 *  - the residence itself is a residential entry in the location's `environments[]`
 *  - its rooms are the location's existing zones, chosen here
 *  - each room's pictures are that zone's existing `image_urls`
 *  - its people are the location's existing resident list
 *
 * The parent business keeps its category, hours, staff and operational zones untouched.
 * Changes are applied to the location form and kept when the location is saved.
 */
export default function OnSiteResidenceModal({
  locationName,
  existingLocation = false,
  zones = [],
  environments = [],
  residentIds = [],
  residentNames = {},
  characters = [],
  onAddZone,
  onUpdateZoneImages,
  onSave,
  onClose,
}) {
  const existing = useMemo(
    () => getOnSiteResidence({ environments, category: "business" }),
    [environments]
  );

  const [name, setName] = useState(existing?.name || "");
  const [zoneNames, setZoneNames] = useState(existing?.zone_names || []);
  const [residents, setResidents] = useState(residentIds);
  const [newZone, setNewZone] = useState("");
  const [search, setSearch] = useState("");
  const [uploadingZone, setUploadingZone] = useState(null);

  const zoneNamesInLocation = zones.map((z) => z.zone_name).filter(Boolean);
  const availableZones = [...new Set([...zoneNamesInLocation, ...zoneNames])];

  const zoneRecord = (zoneName) =>
    zones.find((z) => String(z.zone_name).toLowerCase() === String(zoneName).toLowerCase());

  const toggleZone = (zoneName) =>
    setZoneNames((prev) =>
      prev.includes(zoneName) ? prev.filter((z) => z !== zoneName) : [...prev, zoneName]
    );

  const addZone = () => {
    const trimmed = newZone.trim();
    if (!trimmed) return;
    const already = availableZones.some((z) => z.toLowerCase() === trimmed.toLowerCase());
    if (!already) onAddZone?.(trimmed);
    if (!zoneNames.includes(trimmed)) setZoneNames((prev) => [...prev, trimmed]);
    setNewZone("");
  };

  const toggleResident = (id) =>
    setResidents((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const uploadImages = async (zoneName, fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const current = zoneRecord(zoneName)?.image_urls || [];
    const room = MAX_IMAGES - current.length;
    if (room <= 0) return;
    setUploadingZone(zoneName);
    const uploaded = [];
    for (const file of files.slice(0, room)) {
      try {
        const res = await base44.integrations.Core.UploadPublicFile({ file });
        if (res?.file_url) uploaded.push(res.file_url);
      } catch (err) {
        console.error("[OnSiteResidence] Upload failed:", err?.message);
      }
    }
    if (uploaded.length > 0) onUpdateZoneImages?.(zoneName, [...current, ...uploaded]);
    setUploadingZone(null);
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const environment = {
      id: existing?.id || `env_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed,
      type: "residential",
      follows_business_hours: false,
      zone_names: zoneNames,
    };
    onSave?.({ environment, residentIds: residents });
  };

  const query = search.trim().toLowerCase();
  // Every saved resident is shown — including someone whose record this account does not
  // load directly (a shared residence). A saved assignment is never displayed as missing.
  const residentCharacters = residents.map(
    (id) =>
      characters.find((c) => c.id === id) || {
        id,
        name: residentNames?.[id] || "Resident",
      }
  );
  const assignable = characters
    .filter((c) => !residents.includes(c.id))
    .filter((c) => !query || (c.name || c.display_name || "").toLowerCase().includes(query))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-card border border-emerald-400/30 rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto"
      >
        <div className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Home className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">On-Site Residence</h3>
              <p className="text-[10px] text-muted-foreground">
                A living space inside {locationName || "this business"} — the business stays a business.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
              Residence name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. North Campus Quarters"
              className="h-10 rounded-xl text-sm"
            />
          </div>

          {/* Rooms */}
          <div className="space-y-2">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Residential rooms</p>
              <p className="text-[11px] text-muted-foreground/80">
                Choose which of this property's zones are part of the residence. Unchosen zones stay operational.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableZones.map((zoneName) => {
                const assigned = zoneNames.includes(zoneName);
                return (
                  <button
                    key={zoneName}
                    type="button"
                    onClick={() => toggleZone(zoneName)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      assigned
                        ? "bg-emerald-400/15 text-emerald-300 border-emerald-400/50"
                        : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {assigned ? "✓ " : ""}{zoneName}
                  </button>
                );
              })}
              {availableZones.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No zones yet — add rooms below.</p>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={newZone}
                onChange={(e) => setNewZone(e.target.value)}
                placeholder="Add a room (Living Room, Kitchen...)"
                className="h-9 rounded-xl text-sm"
                onKeyDown={(e) => e.key === "Enter" && addZone()}
              />
              <Button size="sm" variant="outline" onClick={addZone} disabled={!newZone.trim()} className="rounded-xl px-3">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Room pictures */}
          {zoneNames.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Room pictures</p>
              <p className="text-[11px] text-muted-foreground/80">
                These are the residence's own reference images. Business zones keep theirs.
              </p>
              {zoneNames.map((zoneName) => {
                const zone = zoneRecord(zoneName);
                const images = zone?.image_urls || [];
                return (
                  <div key={zoneName} className="rounded-xl border border-border bg-secondary/30 p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-foreground">{zoneName}</p>
                      <span className="text-[10px] text-muted-foreground">{images.length}/{MAX_IMAGES}</span>
                    </div>
                    {images.length > 0 && (
                      <div className="grid grid-cols-4 gap-1.5">
                        {images.map((url, i) => (
                          <div key={url + i} className="relative group">
                            <img src={url} alt={`${zoneName} ${i + 1}`} className="w-full aspect-square object-cover rounded-lg" />
                            <button
                              type="button"
                              onClick={() => onUpdateZoneImages?.(zoneName, images.filter((_, idx) => idx !== i))}
                              className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-3 h-3 text-white" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {images.length < MAX_IMAGES && (
                      <div className="space-y-2">
                        <label className="block cursor-pointer">
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => { uploadImages(zoneName, e.target.files); e.target.value = ""; }}
                            className="hidden"
                          />
                          <div className="flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-border text-muted-foreground hover:border-emerald-400/40 hover:text-foreground transition-colors text-[11px]">
                            <Upload className="w-3.5 h-3.5" />
                            {uploadingZone === zoneName ? "Uploading..." : `Upload pictures (${MAX_IMAGES - images.length} left)`}
                          </div>
                        </label>
                        <ZoneImageGenerator
                          zoneName={zoneName}
                          locationName={name.trim() || locationName}
                          category="home"
                          subtype={[]}
                          locationDescription="Residential living space inside a business property"
                          hasExistingImage={images.length > 0}
                          existingZoneImageUrls={images}
                          onGenerate={(url) => onUpdateZoneImages?.(zoneName, [...images, url])}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Residents */}
          <div className="space-y-2">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Residents</p>
              <p className="text-[11px] text-muted-foreground/80">
                People who live here. Living here never makes anyone an employee, and working here never makes anyone a resident.
              </p>
            </div>
            {residentCharacters.length > 0 ? (
              <div className="space-y-1.5">
                {residentCharacters.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 rounded-lg bg-secondary/40 px-2 py-1.5">
                    {c.avatar_url ? (
                      <img src={c.avatar_url} alt={c.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-semibold text-primary flex-shrink-0">
                        {c.name?.[0]?.toUpperCase() || "?"}
                      </div>
                    )}
                    <p className="text-xs text-foreground flex-1 truncate">{c.name || c.display_name}</p>
                    <button
                      onClick={() => toggleResident(c.id)}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-lg"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No residents assigned yet.</p>
            )}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search characters to add"
                className="h-9 rounded-xl text-sm pl-8"
              />
            </div>
            <div className="max-h-44 overflow-y-auto space-y-1">
              {assignable.slice(0, 40).map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleResident(c.id)}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary/60 transition-colors text-left"
                >
                  {c.avatar_url ? (
                    <img src={c.avatar_url} alt={c.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-semibold text-primary flex-shrink-0">
                      {c.name?.[0]?.toUpperCase() || "?"}
                    </div>
                  )}
                  <span className="text-xs text-foreground flex-1 truncate">{c.name || c.display_name}</span>
                  <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              ))}
              {assignable.length === 0 && (
                <p className="text-[11px] text-muted-foreground italic px-1">No characters match.</p>
              )}
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground">
            {existingLocation
              ? "Saved on this property — the business's own settings are untouched."
              : "Applied to this new location — kept when you add the location."}
          </p>
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border px-4 py-3 flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl">Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()} className="flex-1 rounded-xl">
            {existing ? "Update residence" : "Add residence"}
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}