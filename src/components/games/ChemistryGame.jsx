import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { X, Flame, Brain, Zap, Smile, Heart, Shield, TrendingUp } from "lucide-react";

const CARDS = {
  flirty: {
    icon: "🔥", label: "Flirty", color: "from-rose-500/20 to-pink-600/10", border: "border-rose-500/40", textColor: "text-rose-400",
    prompts: [
      "What's something you've wanted to do with me but haven't said?",
      "If you could change one thing about how we interact, what would it be?",
      "What's the first thing you notice about someone you're attracted to?",
      "Say one thing you find attractive about how I carry myself.",
    ]
  },
  deep: {
    icon: "🧠", label: "Deep", color: "from-blue-500/20 to-indigo-600/10", border: "border-blue-500/40", textColor: "text-blue-400",
    prompts: [
      "What's something you're afraid to lose right now?",
      "What's a version of yourself you've had to leave behind?",
      "What do you wish more people understood about you?",
      "What's something you've never admitted out loud before?",
    ]
  },
  tension: {
    icon: "⚡", label: "Tension", color: "from-amber-500/20 to-yellow-600/10", border: "border-amber-500/40", textColor: "text-amber-400",
    prompts: [
      "Say something you've been holding back.",
      "What's one thing about me that actually bothers you?",
      "What's a boundary you have that most people don't respect?",
      "Tell me something about yourself that might change how I see you.",
    ]
  },
  funny: {
    icon: "😂", label: "Funny", color: "from-green-500/20 to-emerald-600/10", border: "border-green-500/40", textColor: "text-green-400",
    prompts: [
      "What's the dumbest thing you've done this week?",
      "What's your most embarrassing habit that you actually defend?",
      "What would your enemies say about you, and are they wrong?",
      "What's something you're irrationally passionate about?",
    ]
  }
};

const CARD_TYPES = ["flirty", "deep", "tension", "funny"];

function pickCard(round) {
  const type = CARD_TYPES[round % CARD_TYPES.length];
  const card = CARDS[type];
  const prompt = card.prompts[Math.floor(Math.random() * card.prompts.length)];
  return { type, prompt, ...card };
}

function ScoreMeter({ label, value, color }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className={color}>{value}</span>
      </div>
      <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
        <motion.div
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.5 }}
          className={`h-full rounded-full bg-gradient-to-r ${color === "text-rose-400" ? "from-rose-500 to-pink-400" : color === "text-blue-400" ? "from-blue-500 to-indigo-400" : "from-amber-500 to-yellow-400"}`}
        />
      </div>
    </div>
  );
}

export default function ChemistryGame({ character, conversationId, onEnd }) {
  const TOTAL_ROUNDS = 5;

  const [round, setRound] = useState(0); // 0-indexed
  const [phase, setPhase] = useState("card"); // card | user_choice | user_input | char_response | result
  const [currentCard, setCurrentCard] = useState(null);
  const [userChoice, setUserChoice] = useState(null); // "truth" | "tension"
  const [userInput, setUserInput] = useState("");
  const [charResponse, setCharResponse] = useState(null); // { narrative, dialogue, choice }
  const [isLoading, setIsLoading] = useState(false);
  const [scores, setScores] = useState({ attraction: 50, trust: 50, tension: 30 });
  const [sessionMemory, setSessionMemory] = useState([]);
  const [gameOver, setGameOver] = useState(false);
  const [summary, setSummary] = useState(null);

  // Draw card on mount and each new round
  useEffect(() => {
    setCurrentCard(pickCard(round));
    setPhase("card");
    setUserChoice(null);
    setUserInput("");
    setCharResponse(null);
  }, [round]);

  const handleUserChoice = (choice) => {
    setUserChoice(choice);
    setPhase("user_input");
  };

  const handleUserSubmit = async () => {
    if (!userInput.trim()) return;
    setIsLoading(true);
    setPhase("char_response");

    try {
      const memoryContext = sessionMemory.length > 0
        ? `Earlier in this session: ${sessionMemory.map(m => `Round ${m.round}: User said "${m.userResponse}" (${m.choiceType}) on a ${m.cardType} card.`).join(" ")}`
        : "";

      const relationshipContext = `Attraction: ${scores.attraction}/100. Trust: ${scores.trust}/100. Tension: ${scores.tension}/100. Friendship: ${character.friendship_level ?? 75}/100. Romantic: ${character.romantic_level ?? 0}/100.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${character.name}. ${character.personality_summary || ""}

CHEMISTRY GAME CONTEXT:
Card type: ${currentCard?.type} (${currentCard?.label})
Card prompt: "${currentCard?.prompt}"
User chose: ${userChoice === "truth" ? "Truth (honest, vulnerable)" : "Tension (bold, risky, confrontational)"}
User response: "${userInput}"

${relationshipContext}
${memoryContext}

Your character traits: ${(character.personality_traits || []).join(", ") || "authentic, complex"}
Emotional state: ${character.emotional_state || "calm"}

You must respond with:
1. A NARRATIVE ACTION (physical/emotional action, 1 sentence, third person, e.g. "${character.name} leans in, studying their face.")
2. DIALOGUE (what you say out loud, 1-2 sentences, first person, direct and in-character)
3. Your CHOICE for this round: "truth" or "tension" (based on your personality and the dynamic)
4. Score DELTAS: how much this changes attraction (+/-0-10), trust (+/-0-10), tension (+/-0-15)

Be authentic to your personality. High attraction means more flirty. Low trust means guarded. Respond naturally to what was said.

Return ONLY valid JSON:
{
  "narrative": "...",
  "dialogue": "...",
  "char_choice": "truth" or "tension",
  "attraction_delta": number,
  "trust_delta": number,
  "tension_delta": number
}`,
        response_json_schema: {
          type: "object",
          properties: {
            narrative: { type: "string" },
            dialogue: { type: "string" },
            char_choice: { type: "string" },
            attraction_delta: { type: "number" },
            trust_delta: { type: "number" },
            tension_delta: { type: "number" }
          }
        }
      });

      const parsed = typeof result === "string" ? JSON.parse(result) : result;

      setCharResponse(parsed);

      // Update scores
      const newScores = {
        attraction: Math.max(0, Math.min(100, scores.attraction + (parsed.attraction_delta || 0))),
        trust: Math.max(0, Math.min(100, scores.trust + (parsed.trust_delta || 0))),
        tension: Math.max(0, Math.min(100, scores.tension + (parsed.tension_delta || 0))),
      };
      setScores(newScores);

      // Store session memory
      const memEntry = {
        round: round + 1,
        cardType: currentCard?.type,
        prompt: currentCard?.prompt,
        choiceType: userChoice,
        userResponse: userInput,
        charResponse: parsed.dialogue,
        charChoice: parsed.char_choice,
      };
      const newMemory = [...sessionMemory, memEntry];
      setSessionMemory(newMemory);

      // Persist memory to character's memory bank
      if (conversationId) {
        base44.entities.Memory.create({
          character_id: character.id,
          title: `Chemistry Game — ${currentCard?.label} card (Round ${round + 1})`,
          description: `Card prompt: "${currentCard?.prompt}". User chose ${userChoice} and said: "${userInput}". ${character.name} responded: "${parsed.dialogue}"`,
          emotional_impact: `${currentCard?.type === "flirty" ? "romantic/flirty" : currentCard?.type === "deep" ? "vulnerable/intimate" : currentCard?.type === "tension" ? "confrontational/tense" : "light/funny"} exchange`,
          lesson_learned: `User is willing to be ${userChoice === "truth" ? "honest and open" : "bold and risky"} in conversation.`,
          timestamp: new Date().toISOString(),
          source_context: `chemistry_game_${conversationId}`,
        }).catch(() => {});
      }

      // Also post narrative + dialogue to conversation
      if (conversationId) {
        base44.entities.Message.create({
          conversation_id: conversationId,
          sender_type: "character",
          character_id: character.id,
          character_name: character.name,
          content: parsed.narrative,
          is_narrative: true,
          timestamp: new Date().toISOString(),
        }).catch(() => {});

        setTimeout(() => {
          base44.entities.Message.create({
            conversation_id: conversationId,
            sender_type: "character",
            character_id: character.id,
            character_name: character.name,
            content: parsed.dialogue,
            is_narrative: false,
            emotional_state: character.emotional_state || "calm",
            timestamp: new Date().toISOString(),
          }).catch(() => {});
        }, 600);
      }

      setPhase("result");
    } catch (err) {
      setIsLoading(false);
      setPhase("user_input");
    }
    setIsLoading(false);
  };

  const handleNextRound = async () => {
    if (round + 1 >= TOTAL_ROUNDS) {
      // Generate end summary
      setIsLoading(true);
      try {
        const summaryResult = await base44.integrations.Core.InvokeLLM({
          prompt: `You are ${character.name}. A Chemistry: Truth or Tension game just ended between you and someone you know.

Session summary:
${sessionMemory.map(m => `Round ${m.round} (${m.cardType}): They said "${m.userResponse}" (chose ${m.choiceType}). You said "${m.charResponse}" (chose ${m.charChoice}).`).join("\n")}

Final scores: Attraction ${scores.attraction}/100, Trust ${scores.trust}/100, Tension ${scores.tension}/100.

Write a short, in-character summary of how you feel after this game. 2-3 sentences. First person. Real and raw — how did this change (or not change) how you see them? Reference something specific they said.`,
        });
        setSummary(summaryResult);

        // Update relationship levels
        base44.functions.invoke("updateRelationshipLevels", {
          characterId: character.id,
          userMessage: `[Chemistry Game completed — ${TOTAL_ROUNDS} rounds]`,
          characterReply: summaryResult,
          recentMessages: sessionMemory.map(m => ({
            sender_type: "user", content: m.userResponse
          })),
        }).catch(() => {});
      } catch {
        setSummary("That was... something. I'm still processing it.");
      }
      setIsLoading(false);
      setGameOver(true);
    } else {
      setRound(r => r + 1);
    }
  };

  if (!currentCard) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="w-full my-4 rounded-2xl border border-border bg-card overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-purple-500/10 to-pink-500/10">
        <div>
          <p className="text-xs font-bold text-foreground tracking-wider uppercase">Chemistry: Truth or Tension</p>
          <p className="text-[10px] text-muted-foreground">with {character.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {Array.from({ length: TOTAL_ROUNDS }).map((_, i) => (
              <div key={i} className={`w-2 h-2 rounded-full transition-all ${i < round ? "bg-primary" : i === round ? "bg-primary/60 ring-1 ring-primary" : "bg-border"}`} />
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">Round {round + 1}/{TOTAL_ROUNDS}</span>
          <button onClick={() => onEnd?.()} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Score meters */}
      <div className="flex gap-3 px-4 py-2 border-b border-border/50">
        <ScoreMeter label="Attraction" value={scores.attraction} color="text-rose-400" />
        <ScoreMeter label="Trust" value={scores.trust} color="text-blue-400" />
        <ScoreMeter label="Tension" value={scores.tension} color="text-amber-400" />
      </div>

      {/* Game Content */}
      <div className="p-4 space-y-4">
        <AnimatePresence mode="wait">
          {!gameOver ? (
            <motion.div key={`round-${round}-${phase}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">

              {/* Card Display */}
              <div className={`rounded-2xl p-4 bg-gradient-to-br ${currentCard.color} border ${currentCard.border}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{currentCard.icon}</span>
                  <span className={`text-xs font-bold uppercase tracking-wider ${currentCard.textColor}`}>{currentCard.label} Card</span>
                </div>
                <p className="text-sm text-foreground font-medium leading-snug">"{currentCard.prompt}"</p>
              </div>

              {/* Phase: Choose Truth or Tension */}
              {phase === "card" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground text-center">How do you want to play this?</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleUserChoice("truth")}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 hover:border-blue-500/60 hover:bg-blue-500/20 transition-all"
                    >
                      <Shield className="w-5 h-5 text-blue-400" />
                      <span className="text-sm font-bold text-blue-400">Truth</span>
                      <span className="text-[10px] text-muted-foreground text-center">Honest + vulnerable</span>
                    </button>
                    <button
                      onClick={() => handleUserChoice("tension")}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 hover:border-rose-500/60 hover:bg-rose-500/20 transition-all"
                    >
                      <Zap className="w-5 h-5 text-rose-400" />
                      <span className="text-sm font-bold text-rose-400">Tension</span>
                      <span className="text-[10px] text-muted-foreground text-center">Bold + risky</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Phase: User Input */}
              {phase === "user_input" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${userChoice === "truth" ? "bg-blue-500/20 text-blue-400" : "bg-rose-500/20 text-rose-400"}`}>
                      {userChoice === "truth" ? "⚡ Truth" : "🔥 Tension"}
                    </span>
                    <span className="text-xs text-muted-foreground">Your response</span>
                  </div>
                  <textarea
                    value={userInput}
                    onChange={e => setUserInput(e.target.value)}
                    placeholder={userChoice === "truth" ? "Be honest..." : "Be bold..."}
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleUserSubmit(); } }}
                  />
                  <button
                    onClick={handleUserSubmit}
                    disabled={!userInput.trim()}
                    className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
                  >
                    Send →
                  </button>
                </div>
              )}

              {/* Phase: Character Responding */}
              {phase === "char_response" && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full" />
                  <p className="text-xs text-muted-foreground">{character.name} is responding...</p>
                </div>
              )}

              {/* Phase: Result — show char's response and continue */}
              {phase === "result" && charResponse && (
                <div className="space-y-3">
                  {/* Narrative action */}
                  <div className="px-3 py-2 rounded-xl bg-secondary/60 border-l-2 border-primary/40">
                    <p className="text-xs italic text-muted-foreground leading-relaxed">{charResponse.narrative}</p>
                  </div>

                  {/* Dialogue bubble */}
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {character.avatar_url
                        ? <img src={character.avatar_url} alt={character.name} className="w-full h-full object-cover" />
                        : <span className="text-xs font-bold text-primary">{character.name?.[0]}</span>
                      }
                    </div>
                    <div className="flex-1 bg-secondary rounded-2xl rounded-tl-sm px-3 py-2.5">
                      <p className="text-sm text-foreground leading-relaxed">"{charResponse.dialogue}"</p>
                    </div>
                  </div>

                  {/* Char's choice */}
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{character.name} played</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${charResponse.char_choice === "truth" ? "bg-blue-500/20 text-blue-400" : "bg-rose-500/20 text-rose-400"}`}>
                      {charResponse.char_choice === "truth" ? "Truth" : "Tension"}
                    </span>
                  </div>

                  {/* Score changes */}
                  <div className="flex gap-2 justify-center flex-wrap">
                    {charResponse.attraction_delta !== 0 && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${charResponse.attraction_delta > 0 ? "bg-rose-500/20 text-rose-400" : "bg-muted text-muted-foreground"}`}>
                        ❤️ {charResponse.attraction_delta > 0 ? "+" : ""}{charResponse.attraction_delta}
                      </span>
                    )}
                    {charResponse.trust_delta !== 0 && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${charResponse.trust_delta > 0 ? "bg-blue-500/20 text-blue-400" : "bg-muted text-muted-foreground"}`}>
                        🛡️ {charResponse.trust_delta > 0 ? "+" : ""}{charResponse.trust_delta}
                      </span>
                    )}
                    {charResponse.tension_delta !== 0 && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${charResponse.tension_delta > 0 ? "bg-amber-500/20 text-amber-400" : "bg-muted text-muted-foreground"}`}>
                        ⚡ {charResponse.tension_delta > 0 ? "+" : ""}{charResponse.tension_delta}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={handleNextRound}
                    disabled={isLoading}
                    className="w-full py-2.5 rounded-xl bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors border border-primary/20 disabled:opacity-50"
                  >
                    {round + 1 >= TOTAL_ROUNDS ? "See outcome →" : `Round ${round + 2} →`}
                  </button>
                </div>
              )}
            </motion.div>
          ) : (
            /* Game Over */
            <motion.div key="gameover" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4 py-2">
              <div className="text-center space-y-1">
                <p className="text-lg font-bold text-foreground">
                  {scores.attraction >= 70 ? "🔥 Electric" : scores.trust >= 70 ? "💙 Deep Connection" : scores.tension >= 70 ? "⚡ Loaded Tension" : "💬 Real Talk"}
                </p>
                <p className="text-xs text-muted-foreground">5 rounds complete</p>
              </div>

              <div className="flex justify-center gap-4">
                <div className="text-center">
                  <div className="text-xl font-bold text-rose-400">{scores.attraction}</div>
                  <div className="text-[10px] text-muted-foreground">Attraction</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-blue-400">{scores.trust}</div>
                  <div className="text-[10px] text-muted-foreground">Trust</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-amber-400">{scores.tension}</div>
                  <div className="text-[10px] text-muted-foreground">Tension</div>
                </div>
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-3">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full" />
                  <span className="text-xs text-muted-foreground">{character.name} is reflecting...</span>
                </div>
              ) : summary && (
                <div className="rounded-xl bg-secondary/60 border border-border px-4 py-3">
                  <p className="text-xs font-semibold text-primary mb-1">{character.name} says:</p>
                  <p className="text-sm text-foreground italic leading-relaxed">"{summary}"</p>
                </div>
              )}

              <button
                onClick={() => onEnd?.({ scores, rounds: TOTAL_ROUNDS })}
                className="w-full py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
              >
                Close
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}