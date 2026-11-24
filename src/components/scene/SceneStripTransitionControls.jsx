import { Siren, Compass } from "lucide-react";

/**
 * SceneStripTransitionControls — the two controls at the far end of the activity strip
 * that are NOT things a character does. Arrest hands someone to the existing custody
 * pathway; Next Scene moves the scene to another existing location. Both are drawn with
 * their own emphasis so they never read as ordinary activities, and both sit after every
 * character activity.
 */
export default function SceneStripTransitionControls({ onArrest, onNextScene, arrestDisabled = false }) {
  return (
    <>
      <button
        onClick={onArrest}
        disabled={arrestDisabled}
        title={arrestDisabled ? "No one in this scene can be arrested" : "Take someone into custody"}
        className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all text-center flex-shrink-0 snap-center ${arrestDisabled ? "opacity-40 cursor-not-allowed border-destructive/20 bg-destructive/5" : "bg-destructive/15 border-destructive/60 hover:bg-destructive/25"}`}
      >
        <Siren className="w-4 h-4 text-destructive" />
        <span className="text-[9px] text-destructive font-bold leading-tight whitespace-nowrap uppercase tracking-wide">Arrest</span>
      </button>
      <button
        onClick={onNextScene}
        title="Move the scene to another location"
        className="flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all text-center flex-shrink-0 snap-center bg-primary/15 border-primary/60 hover:bg-primary/25"
      >
        <Compass className="w-4 h-4 text-primary" />
        <span className="text-[9px] text-primary font-bold leading-tight whitespace-nowrap uppercase tracking-wide">Next Scene</span>
      </button>
    </>
  );
}