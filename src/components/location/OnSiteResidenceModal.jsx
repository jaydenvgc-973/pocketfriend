import React, { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, Home, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PhysicalSettingToggle from "@/components/location/PhysicalSettingToggle";
import ResidenceSpacesEditor from "@/components/location/ResidenceSpacesEditor";

const RESIDENCE_TYPES = [
  "Apartment",
  "House",
  "Studio",
  "Condo",
  "Dorm room",
  "Room",
  "Suite",
  "Sleeping area",
  "Encampment",
  "Other",
];

/**
 * OnSiteResidenceModal — the configuration surface for ONE residence inside a property.
 *
 * It writes to what Places already stores, and nothing else:
 *  - the residence itself is one residential entry in the location's `environments[]`
 *  - its spaces are the property's existing zones, chosen here (several, never one)
 *  - each space's pictures are this residence's own `zone_images`
 *  - its people are this residence's own `occupant_character_ids`
 *
 * The parent property keeps its category, hours, staff and operational zones untouched,
 * and its other residences keep their own spaces, people and pictures.
 */
export default function OnSiteResidenceModal({
  residence = null,
  locationName,
  existingLocation = false,
  zones = [],
  suggestedZones = [],
  lockedZoneNames = [],
  residentIds = [],
  residentNames = {},
  residenceResidents = null,
  otherResidences = [],
  characters = [],
  category = "",
  subtype = [],
  locationDescription = "",
  onAddPropertyZone,
  onAddPropertyZoneImage,
  onRemovePropertyZoneImage,
  onSave,
  onClose,
  contextLabel = "business",
}) {
  const [name, setName] = useState(residence?.name || "");
  const [residenceType, setResidenceType] = useState(residence?.residence_type || "");
  const [zoneNames, setZoneNames] = useState(residence?.zone_names || []);
  const [zoneImages, setZoneImages] = useState(residence?.zone_images || []);
  const [physicalSetting, setPhysicalSetting] = useState(residence?.physical_setting || "");
  const [residents, setResidents] = useState(residenceResidents ?? residentIds ?? []);
  const [search, setSearch] = useState("");

  const toggleResident = (id) =>
    setResidents((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const environment = {
      id: residence?.id || `env_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed,
      type: "residential",
      follows_business_hours: false,
      zone_names: zoneNames,
      zone_images: zoneImages,
      residence_type: residenceType,
      physical_setting: physicalSetting || "",
      occupant_character_ids: residents,
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
              <h3 className="text-sm font-semibold text-foreground">{residence ? "Edit residence" : "Add residence"}</h3>
              <p className="text-[10px] text-muted-foreground">
                A living space inside {locationName || `this ${contextLabel}`} — the {contextLabel} keeps its own category and spaces.
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
              placeholder="e.g. Apartment 2A, North Campus Quarters, Underpass Encampment"
              className="h-10 rounded-xl text-sm"
            />
          </div>

          {/* Residence type */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">
              Residence type
            </label>
            <select
              value={residenceType}
              onChange={(e) => setResidenceType(e.target.value)}
              className="w-full h-9 px-2 rounded-xl bg-secondary border border-border text-xs text-foreground outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">Not designated</option>
              {RESIDENCE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Spaces of this residence — several, with their own pictures */}
          <ResidenceSpacesEditor
            residenceLabel={name.trim() || "this residence"}
            zoneNames={zoneNames}
            onChangeZoneNames={setZoneNames}
            zoneImages={zoneImages}
            onChangeZoneImages={setZoneImages}
            propertyZones={zones}
            suggestedZones={suggestedZones}
            lockedZoneNames={lockedZoneNames}
            otherResidences={otherResidences}
            locationName={locationName}
            category={category}
            subtype={subtype}
            locationDescription={locationDescription}
            onAddPropertyZone={onAddPropertyZone}
            onAddPropertyZoneImage={onAddPropertyZoneImage}
            onRemovePropertyZoneImage={onRemovePropertyZoneImage}
          />

          {/* Residents of THIS residence */}
          <div className="space-y-2">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Residents of this residence</p>
              <p className="text-[11px] text-muted-foreground/80">
                Only the people who live in this space. Someone in another residence of this {contextLabel} is never treated as living here.
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
              <p className="text-xs text-muted-foreground italic">No residents assigned to this residence yet.</p>
            )}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search residents of this location"
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

          {/* A residence attached to this property is not automatically inside it. */}
          <PhysicalSettingToggle
            value={physicalSetting}
            onChange={(value) => setPhysicalSetting(value || "")}
            hint="Independent of the property: a residence attached to it can sit outdoors."
          />

          <p className="text-[10px] text-muted-foreground">
            {existingLocation
              ? `Saved on this property — the ${contextLabel}'s own settings and its other residences are untouched.`
              : "Applied to this new location — kept when you add the location."}
          </p>
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border px-4 py-3 flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl">Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim()} className="flex-1 rounded-xl">
            {residence ? "Update residence" : "Add residence"}
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}