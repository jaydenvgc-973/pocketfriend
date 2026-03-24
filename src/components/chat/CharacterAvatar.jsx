const stateRings = {
  calm: "ring-emerald-500/40",
  irritated: "ring-orange-500/40",
  defensive: "ring-red-500/40",
  reflective: "ring-blue-500/40",
  "closed-off": "ring-zinc-600/40",
  flirtatious: "ring-pink-500/40",
  bored: "ring-slate-500/40",
  "burnt out": "ring-orange-600/40",
  joyful: "ring-yellow-500/40",
  anxious: "ring-purple-500/40",
  sad: "ring-blue-600/40",
  excited: "ring-amber-400/40",
  overwhelmed: "ring-rose-500/40",
  content: "ring-teal-400/40",
  frustrated: "ring-red-600/40"
};

export default function CharacterAvatar({ character, size = "md" }) {
  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-14 h-14 text-lg",
    xl: "w-20 h-20 text-2xl"
  };

  const ringClass = stateRings[character?.emotional_state] || stateRings.calm;

  return (
    <div className={`${sizeClasses[size]} rounded-full bg-primary/20 ring-2 ${ringClass} flex items-center justify-center flex-shrink-0 overflow-hidden`}>
      {character?.avatar_url ? (
        <img src={character.avatar_url} alt={character.name} className="w-full h-full object-cover" />
      ) : (
        <span className="font-semibold text-primary">
          {character?.name?.[0]?.toUpperCase() || "?"}
        </span>
      )}
    </div>
  );
}