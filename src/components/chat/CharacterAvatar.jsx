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
  frustrated: "ring-red-600/40",
  joy: "ring-yellow-400/40",
  happiness: "ring-yellow-300/40",
  contentment: "ring-teal-300/40",
  excitement: "ring-amber-500/40",
  elation: "ring-yellow-500/40",
  hope: "ring-sky-400/40",
  relief: "ring-green-400/40",
  gratitude: "ring-lime-400/40",
  love: "ring-pink-400/40",
  affection: "ring-rose-400/40",
  compassion: "ring-pink-300/40",
  empathy: "ring-violet-300/40",
  pride: "ring-indigo-400/40",
  confidence: "ring-blue-400/40",
  peacefulness: "ring-cyan-400/40",
  satisfaction: "ring-emerald-400/40",
  curiosity: "ring-purple-400/40",
  interest: "ring-indigo-300/40",
  amusement: "ring-amber-300/40",
  surprise: "ring-orange-300/40",
  awe: "ring-violet-400/40",
  anticipation: "ring-amber-400/40",
  nostalgia: "ring-rose-300/40",
  longing: "ring-purple-300/40",
  desire: "ring-rose-500/40",
  passion: "ring-red-400/40",
  infatuation: "ring-pink-600/40",
  tenderness: "ring-rose-300/40",
  vulnerability: "ring-violet-300/40",
  trust: "ring-sky-500/40",
  security: "ring-green-500/40",
  belonging: "ring-teal-500/40",
  acceptance: "ring-emerald-300/40",
  patience: "ring-cyan-300/40",
  annoyance: "ring-orange-400/40",
  irritation: "ring-orange-500/40",
  anger: "ring-red-500/40",
  rage: "ring-red-700/40",
  resentment: "ring-red-800/40",
  jealousy: "ring-green-600/40",
  envy: "ring-lime-600/40",
  insecurity: "ring-zinc-500/40",
  doubt: "ring-slate-400/40",
  confusion: "ring-amber-600/40",
  stress: "ring-orange-700/40",
  fear: "ring-purple-700/40",
  panic: "ring-red-600/40",
  worry: "ring-amber-700/40",
  guilt: "ring-stone-500/40",
  shame: "ring-stone-600/40",
  embarrassment: "ring-rose-600/40",
  regret: "ring-slate-600/40",
  disappointment: "ring-blue-700/40",
  grief: "ring-indigo-700/40",
  loneliness: "ring-slate-700/40",
  hopelessness: "ring-zinc-700/40",
  despair: "ring-zinc-800/40",
  detachment: "ring-zinc-500/40",
  numbness: "ring-slate-500/40",
  apathy: "ring-stone-400/40"
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