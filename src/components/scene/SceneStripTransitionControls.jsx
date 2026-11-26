import { Siren, Compass, DollarSign, HandCoins, Smartphone, Car } from "lucide-react";

/**
 * The scene's financial and phone entries. Both money controls open the ONE established
 * financial interaction (who pays, who is paid, then the Chat page's own modal); Open Phone
 * opens the scene phone. None of them changes an activity, a balance or the scene itself.
 */
const extraCardClass =
  "flex flex-col items-center justify-center gap-1 p-1.5 w-[78px] min-w-[78px] rounded-xl border transition-all text-center flex-shrink-0 snap-center bg-secondary border-border hover:border-primary/30";

export function SendMoneyControl({ onClick, disabled = false }) {
  return (
    <button onClick={onClick} disabled={disabled} title="Send money to someone here" className={`${extraCardClass} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
      <DollarSign className="w-4 h-4 text-primary" />
      <span className="w-full text-[9px] text-foreground font-medium leading-tight whitespace-normal break-words text-center">Send Money</span>
    </button>
  );
}

export function ReceiveMoneyControl({ onClick, disabled = false }) {
  return (
    <button onClick={onClick} disabled={disabled} title="Request or take money from someone here" className={`${extraCardClass} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
      <HandCoins className="w-4 h-4 text-green-500" />
      <span className="w-full text-[9px] text-foreground font-medium leading-tight whitespace-normal break-words text-center">Receive Money</span>
    </button>
  );
}

export function OpenPhoneControl({ onClick }) {
  return (
    <button onClick={onClick} title="Open your phone" className={extraCardClass}>
      <Smartphone className="w-4 h-4 text-primary" />
      <span className="w-full text-[9px] text-foreground font-medium leading-tight whitespace-normal break-words text-center">Open Phone</span>
    </button>
  );
}

/**
 * Take a Ride — a scene transition taken inside the chosen owner's own vehicle. It is a
 * strip control, outside every folder, because it moves the scene rather than being an
 * activity someone performs in the room.
 */
export function RideControl({ onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Take a ride in someone's car"
      className={`${extraCardClass} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      <Car className="w-4 h-4 text-primary" />
      <span className="w-full text-[9px] text-foreground font-medium leading-tight whitespace-normal break-words text-center">Take a Ride</span>
    </button>
  );
}

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
      className={`flex flex-col items-center justify-center gap-1 p-1.5 w-[78px] min-w-[78px] rounded-xl border-2 transition-all text-center flex-shrink-0 snap-center ${arrestDisabled ? "opacity-40 cursor-not-allowed border-destructive/20 bg-destructive/5" : "bg-destructive/15 border-destructive/60 hover:bg-destructive/25"}`}
    >
      <Siren className="w-4 h-4 text-destructive" />
      <span className="w-full text-[9px] text-destructive font-bold leading-tight whitespace-normal break-words text-center uppercase tracking-wide">Arrest</span>
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