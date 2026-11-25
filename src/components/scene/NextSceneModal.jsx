import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, MapPin, Search, Check, CornerDownRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildNextSceneDestinations, filterNextSceneDestinations } from "@/lib/nextSceneDestinations";

/**
 * NextSceneModal — a scene-transition control, not an in-world action.
 *
 * The user picks an existing location (with its zones or units when it has them) and which
 * of the people already in this scene come along. Only the chosen people are moved, through
 * the app's existing presence pipeline; everyone else stays where they are. Nothing changes
 * until Confirm — Cancel closes this and leaves the scene exactly as it was.
 *
 * Who the user is stays honest: present, they may go with the group or send it ahead;
 * observing, they may send the group or only watch the destination. Watching never moves
 * anyone and never puts the user in the room.
 */
export default function NextSceneModal({
  open,
  locations = [],
  participants = [],
  userPresent = true,
  onClose,
  onConfirm,
}) {
  const [query, setQuery] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [spaceKey, setSpaceKey] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [unitId, setUnitId] = useState("");
  const [travelerIds, setTravelerIds] = useState(participants.map((p) => p.id));
  const [mode, setMode] = useState(userPresent ? "go" : "send");
  if (!open) return null;

  // A property and the spaces already established inside it — its businesses, and its
  // on-site residence when it has one. Choosing a space resolves to that same property.
  const sections = buildNextSceneDestinations(locations);
  const filtered = filterNextSceneDestinations(sections, query);
  const destination = locations.find((l) => l.id === destinationId) || null;
  const selectedSpace = sections.find((s) => s.location.id === destinationId)?.children.find((c) => c.key === spaceKey) || null;
  // A chosen space narrows the room choices to its own; the property itself keeps all of
  // its rooms and units exactly as before.
  const zones = selectedSpace
    ? selectedSpace.zoneNames
    : (destination?.zones || []).map((z) => z.zone_name).filter(Boolean);
  const units = selectedSpace ? [] : (destination?.residential_units || []);
  const selectDestination = (loc, space) => {
    setDestinationId(loc.id);
    setSpaceKey(space?.key || "");
    setZoneName(space?.zoneName || "");
    setUnitId(space?.unitId || "");
  };

  const modes = userPresent
    ? [
      { id: "go", label: "Go with them", hint: "You and the people you chose move there." },
      { id: "send", label: "Send them ahead", hint: "They go. You stay in this scene." },
    ]
    : [
      { id: "send", label: "Send them there", hint: "They move; you keep watching, from here." },
      { id: "watch", label: "Just watch the destination", hint: "Nobody moves. You watch whoever is there." },
    ];

  const toggle = (id) => setTravelerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  // Sending needs someone to send; going alone and watching alone are both valid.
  const needsTravelers = mode === "send";
  const canConfirm = !!destinationId && (!needsTravelers || travelerIds.length > 0);

  return createPortal(
    <div className="fixed inset-0 z-[195] flex items-end sm:items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-2xl bg-card border border-border p-4 space-y-4"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Next Scene</p>
            <h3 className="text-sm font-bold text-foreground">Where does this scene go next?</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-foreground">Destination</p>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your locations" className="h-8 pl-8 text-xs rounded-lg" />
          </div>
          <div className="max-h-52 overflow-y-auto rounded-xl border border-border divide-y divide-border">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">No location matches that.</p>
            ) : filtered.map(({ location: loc, children }) => {
              const parentPicked = destinationId === loc.id && !spaceKey;
              return (
                <div key={loc.id}>
                  <button
                    onClick={() => selectDestination(loc, null)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${parentPicked ? "bg-primary/10" : "hover:bg-secondary"}`}
                  >
                    <MapPin className={`w-3.5 h-3.5 flex-shrink-0 ${parentPicked ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`flex-1 min-w-0 text-xs truncate ${parentPicked ? "text-primary font-medium" : "text-foreground"}`}>{loc.name}</span>
                    {parentPicked && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                  </button>
                  {/* The spaces already inside this property, directly beneath it. */}
                  {children.map((space) => {
                    const spacePicked = destinationId === loc.id && spaceKey === space.key;
                    return (
                      <button
                        key={space.key}
                        onClick={() => selectDestination(loc, space)}
                        className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-left transition-colors ${spacePicked ? "bg-primary/10" : "hover:bg-secondary"}`}
                      >
                        <CornerDownRight className={`w-3 h-3 flex-shrink-0 ${spacePicked ? "text-primary" : "text-muted-foreground/70"}`} />
                        <span className={`flex-1 min-w-0 text-xs truncate ${spacePicked ? "text-primary font-medium" : "text-foreground/90"}`}>{space.name}</span>
                        <span className="text-[9px] uppercase tracking-wide text-muted-foreground flex-shrink-0">{space.kindLabel}</span>
                        {spacePicked && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {zones.length > 1 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-foreground">Room or zone</p>
              <div className="flex flex-wrap gap-1">
                <button onClick={() => setZoneName("")} className={`px-2 py-1 rounded-lg border text-[10px] ${!zoneName ? "bg-primary/15 border-primary/50 text-primary" : "bg-secondary border-border text-foreground"}`}>Anywhere</button>
                {zones.map((z) => (
                  <button key={z} onClick={() => setZoneName(z)} className={`px-2 py-1 rounded-lg border text-[10px] ${zoneName === z ? "bg-primary/15 border-primary/50 text-primary" : "bg-secondary border-border text-foreground"}`}>{z}</button>
                ))}
              </div>
            </div>
          )}

          {units.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-foreground">Unit</p>
              <div className="flex flex-wrap gap-1">
                <button onClick={() => setUnitId("")} className={`px-2 py-1 rounded-lg border text-[10px] ${!unitId ? "bg-primary/15 border-primary/50 text-primary" : "bg-secondary border-border text-foreground"}`}>Whole building</button>
                {units.map((u) => (
                  <button key={u.unit_id} onClick={() => setUnitId(u.unit_id)} className={`px-2 py-1 rounded-lg border text-[10px] ${unitId === u.unit_id ? "bg-primary/15 border-primary/50 text-primary" : "bg-secondary border-border text-foreground"}`}>{u.unit_name}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-foreground">Who comes along</p>
          <p className="text-[10px] text-muted-foreground">Only people in this scene. Nobody else moves.</p>
          <div className="rounded-xl border border-border divide-y divide-border max-h-36 overflow-y-auto">
            {participants.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">No one else is in this scene.</p>
            ) : participants.map((p) => {
              const picked = travelerIds.includes(p.id);
              return (
                <button key={p.id} onClick={() => toggle(p.id)} className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${picked ? "bg-primary/10" : "hover:bg-secondary"}`}>
                  <div className="w-7 h-7 rounded-full bg-secondary overflow-hidden flex-shrink-0">
                    {p.avatar_url ? <img src={p.avatar_url} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-[10px] font-bold text-foreground flex items-center justify-center h-full">{p.name?.[0]}</span>}
                  </div>
                  <span className={`flex-1 min-w-0 text-xs truncate ${picked ? "text-primary font-medium" : "text-foreground"}`}>{p.name}</span>
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${picked ? "bg-primary" : "border border-border"}`}>
                    {picked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-foreground">{userPresent ? "You" : "You are watching"}</p>
          {modes.map((m) => (
            <button key={m.id} onClick={() => setMode(m.id)} className={`w-full text-left px-3 py-2 rounded-xl border transition-colors ${mode === m.id ? "bg-primary/10 border-primary/50" : "bg-secondary border-border"}`}>
              <p className={`text-xs font-medium ${mode === m.id ? "text-primary" : "text-foreground"}`}>{m.label}</p>
              <p className="text-[10px] text-muted-foreground">{m.hint}</p>
            </button>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} className="flex-1 rounded-xl">Cancel</Button>
          <Button
            disabled={!canConfirm}
            onClick={() => onConfirm({
              destination,
              zoneName,
              unitId,
              environmentId: selectedSpace?.environmentId || "",
              spaceLabel: selectedSpace?.name || null,
              travelerIds,
              mode,
            })}
            className="flex-1 rounded-xl"
          >
            Confirm
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Nothing changes until you confirm. Cancelling leaves everyone exactly where they are.
        </p>
      </motion.div>
    </div>,
    document.body
  );
}