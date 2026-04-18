import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MapPin, Search, Rabbit, Check, Ban } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";

const CATEGORY_EMOJIS = {
  home: "🏠", workplace: "🏢", gym: "💪", social: "🎉",
  outdoor: "🌳", food_drink: "🍽️", medical: "🏥", education: "📚",
  grocery: "🛒", religion: "⛪", government: "🏛️", public: "🌍",
  business: "💼", school: "🎓", community: "🤝", generic: "📍",
};

export default function LocationAliasResolutionPopup({ phrase, characterId, characterName, onResolved, onDismiss }) {
  const [search, setSearch] = useState("");
  const [step, setStep] = useState("choose"); // "choose" | "select_location"
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const { data: locationsRes } = useQuery({
    queryKey: ["allLocationsForUser"],
    queryFn: () => base44.functions.invoke("fetchAllLocationsForUser", {}),
    staleTime: 60000,
  });
  const allLocations = locationsRes?.data?.locations || [];

  const filtered = allLocations.filter(loc => {
    if (!search) return true;
    const s = search.toLowerCase();
    return loc.name.toLowerCase().includes(s) || loc.category?.toLowerCase().includes(s);
  });

  const handleSelectExisting = () => setStep("select_location");

  const handleConfirmLocation = async () => {
    if (!selectedLocation) return;
    setIsSaving(true);
    try {
      const res = await base44.functions.invoke("resolveLocationAlias", {
        phrase,
        resolutionType: "saved_location",
        locationId: selectedLocation.id,
        locationName: selectedLocation.name,
        characterId: characterId || null,
      });
      onResolved({ type: "saved_location", location: selectedLocation, aliasId: res?.data?.aliasId });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRabbitHole = async () => {
    setIsSaving(true);
    const label = phrase.replace(/\b\w/g, c => c.toUpperCase());
    try {
      const res = await base44.functions.invoke("resolveLocationAlias", {
        phrase,
        resolutionType: "rabbit_hole",
        rabbitHoleLabel: label,
        characterId: characterId || null,
      });
      onResolved({ type: "rabbit_hole", label, aliasId: res?.data?.aliasId });
    } finally {
      setIsSaving(false);
    }
  };

  const handleNonsense = async () => {
    setIsSaving(true);
    try {
      // Record this as a nonsense detection so the AI can learn from it
      await base44.functions.invoke("resolveLocationAlias", {
        phrase,
        resolutionType: "nonsense",
        characterId: characterId || null,
        feedback: "User marked this location detection as nonsense — the AI was pattern-matching sentence structure rather than applying real logic.",
      });
    } catch { /* fire-and-forget */ } finally {
      setIsSaving(false);
    }
    onDismiss();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[999] flex items-end justify-center bg-black/60 px-4 pb-4"
        onClick={onDismiss}
      >
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-lg bg-card border border-border rounded-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Resolve location reference</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {characterName ? `${characterName} mentioned ` : ""}
                <span className="text-primary font-medium">"{phrase}"</span>
              </p>
            </div>
            <button onClick={onDismiss} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {step === "choose" && (
            <div className="px-5 pb-5 space-y-3">
              <p className="text-xs text-muted-foreground">
                "<span className="text-foreground">{phrase}</span>" doesn't match a saved location on your account. Is this an existing place, or an off-screen destination?
              </p>
              <button
                onClick={handleSelectExisting}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/10 border border-primary/20 text-left hover:bg-primary/15 transition-colors"
              >
                <MapPin className="w-5 h-5 text-primary flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">Select existing location</p>
                  <p className="text-xs text-muted-foreground">Choose from locations on your account</p>
                </div>
              </button>
              <button
                onClick={handleRabbitHole}
                disabled={isSaving}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary border border-border text-left hover:bg-secondary/80 transition-colors disabled:opacity-60"
              >
                <Rabbit className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">Treat as off-screen destination</p>
                  <p className="text-xs text-muted-foreground">Show as active rabbit hole — no saved location needed</p>
                </div>
              </button>
              <button
                onClick={handleNonsense}
                disabled={isSaving}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-left hover:bg-destructive/15 transition-colors disabled:opacity-60"
              >
                <Ban className="w-5 h-5 text-destructive flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">This is nonsense</p>
                  <p className="text-xs text-muted-foreground">The AI misread the sentence — this isn't a location reference</p>
                </div>
              </button>
              <button onClick={onDismiss} className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-2">
                Dismiss for now
              </button>
            </div>
          )}

          {step === "select_location" && (
            <div className="px-5 pb-5 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search locations..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1.5">
                {filtered.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">No locations found</p>
                )}
                {filtered.map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => setSelectedLocation(loc.id === selectedLocation?.id ? null : loc)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                      selectedLocation?.id === loc.id
                        ? "bg-primary/10 border border-primary/30"
                        : "bg-secondary hover:bg-secondary/80 border border-transparent"
                    }`}
                  >
                    <span className="text-lg">{CATEGORY_EMOJIS[loc.category] || "📍"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{loc.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{loc.category?.replace(/_/g, " ") || "location"}</p>
                    </div>
                    {selectedLocation?.id === loc.id && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setStep("choose")}
                  className="flex-1 py-2.5 rounded-xl bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirmLocation}
                  disabled={!selectedLocation || isSaving}
                  className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Confirm"}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}