import { Siren, Compass } from "lucide-react";

/**
 * The two scene controls that are NOT things a character does.
 *
 * Arrest hands someone to the existing custody pathway, so it belongs with the general
 * activities inside their folder. Next Scene moves the scene to another existing location
 * and is the scene's own control: it is pinned beside the category folders so it is
 * reachable whatever folder is open or closed, without scrolling through any activity.
 */
export function ArrestControl({ onArrest, arrestDisabled = false }) {
  return (
    <button
      onClick={onArrest}
      disabled={arrestDisabled}
      title={arrestDisabled ? "No one in this scene can be arrested" : "Take someone into custody"}
      className={`flex flex-col items-center justify-center gap-1 p-2 rounded-xl border-2 transition-all text-center flex-shrink-0 snap-center ${arrestDisabled ? "opacity-40 cursor-not-allowed border-destructive/20 bg-destructive/5" : "bg-destructive/15 border-destructive/60 hover:bg-destructive/25"}`}
    >
      <Siren className="w-4 h-4 text-destructive" />
      <span className="text-[9px] text-destructive font-bold leading-tight whitespace-nowrap uppercase tracking-wide">Arrest</span>
    </button>
  );
}

export function NextSceneControl({ onNextScene }) {
  return (
    <button
      onClick={onNextScene}
      title="Move the scene to another location"
      className="flex flex-col items-center justify-center gap-1 p-2 rounded-xl border-2 transition-all text-center flex-shrink-0 snap-center bg-primary/15 border-primary/60 hover:bg-primary/25"
    >
      <Compass className="w-4 h-4 text-primary" />
      <span className="text-[9px] text-primary font-bold leading-tight whitespace-nowrap uppercase tracking-wide">Next Scene</span>
    </button>
  );
}

export default function SceneStripTransitionControls({ onArrest, onNextScene, arrestDisabled = false }) {
  return (
    <>
      <ArrestControl onArrest={onArrest} arrestDisabled={arrestDisabled} />
      <NextSceneControl onNextScene={onNextScene} />
    </>
  );
}