import { isCharacterAsleep } from "@/lib/sleepUtils";

/**
 * SceneNpcRow — one row in the Who's Here dropdown.
 *
 * Display only: whether this character is selected and what tapping the row does are
 * decided by Scenes and passed in. The row never changes presence itself.
 */
export default function SceneNpcRow({ npc, isSelected, onToggle }) {
  // Someone who is asleep is still here — they are simply asleep. The row says so with
  // the existing sleep state, so the room reads correctly without hiding anyone.
  const asleep = isCharacterAsleep(npc) || ['sleeping', 'napping', 'passed_out'].includes(npc?.resolved_presence_status);
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary"
    >
      <div className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center flex-shrink-0 overflow-hidden">
        {npc.avatar_url
          ? <img src={npc.avatar_url} alt={npc.name} className="w-full h-full object-cover" />
          : <span className="text-[9px] font-bold text-foreground">{npc.name?.[0]}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${isSelected ? "text-primary" : "text-foreground"}`}>
          {npc.name}
          {asleep && <span className="ml-1 text-[9px] text-muted-foreground font-normal">Zzz</span>}
        </p>
        {(npc.mood || npc.unit_name) && <p className="text-[10px] text-muted-foreground truncate">{npc.mood || npc.unit_name}</p>}
      </div>
      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
    </button>
  );
}