import ApartmentSwitcher from "@/components/scene/ApartmentSwitcher";

/**
 * ScenePresenceStrip — who is in this scene, and the space switcher when the property has
 * units or businesses. Display only: selection, presence and space changes are decided by
 * Scenes and passed in.
 */
export default function ScenePresenceStrip({
  observeMode,
  displayName,
  currentUser,
  observeCast = [],
  traveledWithChars = [],
  selectedNpcs = [],
  extraNpcs = [],
  location,
  locationUnits = [],
  locationWorkplaces = [],
  activeUnitId,
  onSelectUnit,
}) {
  const present = (observeMode ? observeCast : [...traveledWithChars, ...selectedNpcs, ...extraNpcs])
    .filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/50 flex-shrink-0 overflow-x-auto scrollbar-hide">
      {(locationUnits.length > 0 || locationWorkplaces.length > 0) && (
        <>
          <ApartmentSwitcher units={locationUnits} workspaces={locationWorkplaces} activeUnitId={activeUnitId} onSelect={onSelectUnit} location={location} allowNone />
          <div className="w-px h-6 bg-border flex-shrink-0" />
        </>
      )}
      {!observeMode && (
        <div className="flex flex-col items-center gap-1">
          <div className="w-8 h-8 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center overflow-hidden">
            {currentUser?.generated_avatar_urls?.[0]
              ? <img src={currentUser.generated_avatar_urls[0]} alt={displayName} className="w-full h-full object-cover" />
              : <span className="text-xs font-bold text-primary">{displayName?.[0]}</span>}
          </div>
          <span className="text-[9px] text-primary font-medium">{displayName}</span>
        </div>
      )}
      {present.map((char) => (
        <div key={char.id} className="flex flex-col items-center gap-1">
          <div className="w-8 h-8 rounded-full bg-secondary border-2 border-border flex items-center justify-center overflow-hidden">
            {char.avatar_url
              ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
              : <span className="text-xs font-bold text-foreground">{char.name?.[0]}</span>}
          </div>
          <span className="text-[9px] text-muted-foreground truncate max-w-[40px]">{char.name.split(" ")[0]}</span>
        </div>
      ))}
      {observeMode
        ? (observeCast.length === 0 && <span className="text-xs text-muted-foreground ml-1">Pick who to watch</span>)
        : (traveledWithChars.length === 0 && selectedNpcs.length === 0 && extraNpcs.length === 0 && <span className="text-xs text-muted-foreground ml-1">You're here alone</span>)}
    </div>
  );
}