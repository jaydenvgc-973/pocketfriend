import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Gamepad2, X, Users, ChevronRight, Trophy, Clock, Check, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import Bowling from "@/components/games/Bowling";
import TicTacToe from "@/components/games/TicTacToe";
import DotsAndBoxes from "@/components/games/DotsAndBoxes";
import Pool from "@/components/games/Pool";
import GemDuel from "@/components/games/GemDuel";
import ChemistryGame from "@/components/games/ChemistryGame";

const GAMES = [
  { id: "bowling",      label: "Bowling",       emoji: "🎳", desc: "Ten frames, strikes & spares",          supportsHuman: true,  supportsCharacter: true,  color: "from-amber-500/20 to-orange-600/10" },
  { id: "tictactoe",    label: "Tic-Tac-Toe",   emoji: "⭕", desc: "Classic 3×3 strategy",                   supportsHuman: true,  supportsCharacter: true,  color: "from-yellow-500/20 to-amber-600/10" },
  { id: "dotsandboxes", label: "Dots & Boxes",  emoji: "📦", desc: "Connect lines, claim boxes",             supportsHuman: true,  supportsCharacter: true,  color: "from-blue-500/20 to-indigo-600/10" },
  { id: "pool",         label: "Pool",           emoji: "🎱", desc: "Aim & shoot — sink your balls first",  supportsHuman: false, supportsCharacter: true,  color: "from-green-500/20 to-emerald-700/10" },
  { id: "gemduel",      label: "Gem Duel",       emoji: "💎", desc: "Match gems, chain combos",              supportsHuman: false, supportsCharacter: true,  color: "from-purple-500/20 to-violet-700/10" },
  { id: "chemistry",    label: "Chemistry",      emoji: "🧪", desc: "Truth or Tension — 5 rounds",           supportsHuman: false, supportsCharacter: true,  color: "from-pink-500/20 to-purple-600/10" },
];

function initState(gameId) {
  if (gameId === "bowling") return { frames: Array.from({ length: 2 }, () => Array.from({ length: 10 }, () => ({ rolls: [] }))), currentPlayer: 0, currentFrame: 0, pinsStanding: 10 };
  if (gameId === "tictactoe") return { board: Array(9).fill(null), currentPlayer: 0, winner: null, winLine: null };
  if (gameId === "dotsandboxes") return { h: new Array(20).fill(false), v: new Array(20).fill(false), boxes: new Array(16).fill(null), scores: [0, 0], currentPlayer: 0, winner: null };
  return {};
}

export default function GatheringRoomGamesModal({
  open, onClose, roomId, roomName,
  participants, myUserParticipant, currentUser,
  joinGame, // existing game to join directly (for accepted invites)
}) {
  const [stage, setStage] = useState("picker"); // picker | select | waiting | play | result
  const [selectedGame, setSelectedGame] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [characterRecord, setCharacterRecord] = useState(null);
  const [loadingChar, setLoadingChar] = useState(false);
  const [gameResult, setGameResult] = useState(null);
  const [sharedGameId, setSharedGameId] = useState(null);
  const [postingResult, setPostingResult] = useState(false);
  const [inviteDeclined, setInviteDeclined] = useState(false);
  const [isInitiator, setIsInitiator] = useState(true);

  // ── Join existing game (accepted invite) ──
  useEffect(() => {
    if (!open || !joinGame) return;
    const game = joinGame;
    const gameConfig = GAMES.find(g => g.id === game.game_type);
    setSelectedGame(gameConfig);
    // Find my participant index
    const myIdx = (game.participants || []).findIndex(p => p.owner_email === currentUser?.email);
    const opp = game.participants?.[myIdx === 0 ? 1 : 0];
    setOpponent(opp);
    setSharedGameId(game.id);
    setIsInitiator(game.owner_email === currentUser?.email);
    setStage("play");
  }, [open, joinGame, currentUser?.email]);

  useEffect(() => {
    if (open && !joinGame) {
      setStage("picker"); setSelectedGame(null); setOpponent(null);
      setCharacterRecord(null); setGameResult(null); setSharedGameId(null);
      setInviteDeclined(false); setIsInitiator(true);
    }
  }, [open, joinGame]);

  // ── Subscribe to shared game for invite acceptance (waiting stage) ──
  useEffect(() => {
    if (stage !== "waiting" || !sharedGameId) return;
    let unsub = () => {};
    (async () => {
      try {
        const games = await base44.entities.GatheringRoomGame.filter({ id: sharedGameId }, null, 1);
        const g = games[0];
        if (g?.status === "active") { setStage("play"); return; }
        if (g?.status === "cancelled") { setInviteDeclined(true); setStage("select"); return; }
      } catch (_) {}
      unsub = base44.entities.GatheringRoomGame.subscribe((event) => {
        if (event.data?.id !== sharedGameId) return;
        const status = event.data?.status;
        if (status === "active") setStage("play");
        else if (status === "cancelled" || status === "abandoned") {
          setInviteDeclined(true); setStage("select"); setSharedGameId(null); setIsInitiator(true);
        }
      });
    })();
    return () => unsub();
  }, [stage, sharedGameId]);

  // Eligible opponents for a game: exclude self; filter by supported type
  const eligibleOpponents = (participants || []).filter(p => {
    if (!p || p.is_self) return false;
    if (!selectedGame) return false;
    if (p.participant_type === "user") return selectedGame.supportsHuman;
    if (p.participant_type === "character") return selectedGame.supportsCharacter;
    return false;
  });

  const handleSelectGame = (game) => {
    setSelectedGame(game);
    setStage("select");
  };

  // ── Create shared game entity ──
  const createSharedGame = async (opp, gameConfig) => {
    const isHuman = opp.participant_type === "user";
    const status = isHuman ? "pending" : "active";
    try {
      const game = await base44.entities.GatheringRoomGame.create({
        game_type: gameConfig.id,
        gathering_room_id: roomId,
        gathering_room_name: roomName,
        owner_email: currentUser?.email,
        status,
        participants: [
          { participant_id: myUserParticipant?.id, participant_name: myUserParticipant?.participant_name || "You", participant_type: "user", owner_email: currentUser?.email, avatar_url: myUserParticipant?.avatar_url },
          { participant_id: opp.id, participant_name: opp.participant_name, participant_type: opp.participant_type, owner_email: opp.owner_email, avatar_url: opp.avatar_url },
        ],
        player_turn_index: 0,
        state: initState(gameConfig.id),
        created_at: new Date().toISOString(),
      });
      setSharedGameId(game.id);
      return game.id;
    } catch (err) {
      console.warn("Failed to create shared game", err?.message);
      return null;
    }
  };

  const handleSelectOpponent = async (participant) => {
    setOpponent(participant);
    const isHuman = participant.participant_type === "user";

    if (participant.participant_type === "character") {
      setLoadingChar(true);
      try {
        const chars = await base44.entities.Character.filter({ id: participant.participant_id }, null, 1);
        setCharacterRecord(chars[0] || null);
      } catch (_) { setCharacterRecord(null); }
      setLoadingChar(false);
    }

    const gameId = await createSharedGame(participant, selectedGame);
    if (!gameId) return;
    setIsInitiator(true);

    if (isHuman) {
      // Wait for acceptance
      setStage("waiting");
    } else {
      // Character opponent — play immediately
      setStage("play");
    }
  };

  // ── Post game result as a room EVENT (not user speech) ──
  // Only the initiator posts the game event to prevent duplicates.
  // For character-opponent games, the current user is always the initiator.
  // For human-vs-human games, only the user who created the game posts the result.
  const postGameResult = async () => {
    if (!sharedGameId || !isInitiator) return;
    setPostingResult(true);
    try {
      await base44.functions.invoke("postGatheringRoomGameEvent", {
        gathering_room_id: roomId,
        game_id: sharedGameId,
      });
    } catch (err) {
      console.warn("Failed to post game event", err?.message);
    }
    setPostingResult(false);
  };

  const handleGameEnd = async (outcome) => {
    const gameLabel = selectedGame?.label || "the game";
    const oppName = opponent?.participant_name || "opponent";
    const isHumanGame = opponent?.participant_type === "user";

    let summary, winnerIndex;
    if (selectedGame.id === "chemistry") {
      // Chemistry is a relationship game — neutral result, no winner/loser
      summary = `Played ${gameLabel} with ${oppName} at ${roomName}.`;
      winnerIndex = -1;
    } else if (outcome === "draw") {
      summary = `Drawn game of ${gameLabel} with ${oppName} at ${roomName}.`;
      winnerIndex = -1;
    } else if (outcome === "user_win") {
      summary = `Beat ${oppName} at ${gameLabel} at ${roomName}!`;
      winnerIndex = 0;
    } else {
      summary = `Lost to ${oppName} at ${gameLabel} at ${roomName}.`;
      winnerIndex = 1;
    }

    setGameResult({ outcome, summary });

    // For character-opponent games, mark the shared game as completed
    // (human-vs-human shared games are already completed by the backend)
    if (!isHumanGame && sharedGameId) {
      try {
        await base44.functions.invoke("updateGatheringRoomGame", {
          game_id: sharedGameId,
          action: "complete",
          winner_index: winnerIndex,
          result_summary: summary,
        });
      } catch (_) {}
    }

    // Post the game event to the room (triggers character reactions + memory)
    await postGameResult();
    setStage("result");
  };

  const handleClose = () => {
    // Abandon shared game if still active/pending (not completed)
    if (sharedGameId && stage !== "result" && stage !== "picker") {
      base44.functions.invoke("updateGatheringRoomGame", { game_id: sharedGameId, action: "abandon" }).catch(() => {});
    }
    setStage("picker"); setSelectedGame(null); setOpponent(null);
    setCharacterRecord(null); setGameResult(null); setSharedGameId(null);
    setInviteDeclined(false); setIsInitiator(true);
    onClose();
  };

  if (!open) return null;

  const isHumanGame = opponent?.participant_type === "user";
  const myIdx = joinGame
    ? (joinGame.participants || []).findIndex(p => p.owner_email === currentUser?.email)
    : 0;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg bg-card border border-border rounded-t-3xl overflow-hidden flex flex-col"
            style={{ maxHeight: "94vh" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border flex-shrink-0 bg-card/90 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                {stage !== "picker" && stage !== "result" && stage !== "waiting" && (
                  <button onClick={() => setStage(stage === "play" ? "select" : "picker")} className="text-muted-foreground hover:text-foreground text-xs">‹ Back</button>
                )}
                <div>
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <Gamepad2 className="w-4 h-4 text-primary" />
                    {stage === "picker" && "Play a Game"}
                    {stage === "select" && selectedGame?.label}
                    {stage === "waiting" && "Waiting…"}
                    {stage === "play" && selectedGame?.label}
                    {stage === "result" && "Game Over"}
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    {stage === "picker" && `Games inside ${roomName || "the room"}`}
                    {stage === "select" && "Choose who to play with"}
                    {stage === "waiting" && `Invite sent to ${opponent?.participant_name || "…"}`}
                    {stage === "play" && `vs ${opponent?.participant_name || "..."}`}
                    {stage === "result" && gameResult?.summary}
                  </p>
                </div>
              </div>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Picker */}
              {stage === "picker" && (
                <div className="p-3 space-y-2">
                  {GAMES.map((game, i) => (
                    <motion.button
                      key={game.id}
                      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleSelectGame(game)}
                      className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl bg-gradient-to-r ${game.color} border border-border/60 hover:border-primary/40 hover:shadow-md transition-all text-left group`}
                    >
                      <span className="text-3xl group-hover:scale-110 transition-transform">{game.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground">{game.label}</p>
                        <p className="text-xs text-muted-foreground">{game.desc}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                    </motion.button>
                  ))}
                  {(participants || []).length <= 1 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No one else is here right now. Invite someone or wait for others to join.</p>
                  )}
                </div>
              )}

              {/* Opponent selector */}
              {stage === "select" && (
                <div className="p-3 space-y-1.5">
                  {inviteDeclined && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-xs mb-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>Invite was declined. Choose someone else.</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground px-2 pb-1">
                    {selectedGame?.supportsHuman ? "Pick anyone currently in the room." : "This game supports character opponents. Pick a character currently in the room."}
                  </p>
                  {eligibleOpponents.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6">No eligible participants for this game right now.</p>
                  )}
                  {eligibleOpponents.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleSelectOpponent(p)}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-secondary/50 hover:bg-secondary border border-border/40 hover:border-primary/40 transition-all text-left"
                    >
                      <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-border flex-shrink-0 bg-secondary">
                        {p.avatar_url ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" /> : <Users className="w-1/2 h-1/2 text-muted-foreground m-auto mt-3" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{p.participant_name}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                    </button>
                  ))}
                </div>
              )}

              {/* Waiting for acceptance */}
              {stage === "waiting" && (
                <div className="flex flex-col items-center justify-center gap-5 py-16 px-6">
                  <motion.div
                    animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <Clock className="w-12 h-12 text-primary" />
                  </motion.div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">Waiting for {opponent?.participant_name} to accept…</p>
                    <p className="text-xs text-muted-foreground mt-1">They'll see the invite in this room.</p>
                  </div>
                  <button onClick={handleClose} className="px-5 py-2 rounded-xl bg-secondary text-foreground text-sm hover:bg-secondary/70 transition-colors">
                    Cancel Invite
                  </button>
                </div>
              )}

              {/* Game play */}
              {stage === "play" && (
                <div className="min-h-[400px]">
                  {loadingChar && (
                    <div className="flex items-center justify-center py-16">
                      <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                    </div>
                  )}
                  {!loadingChar && selectedGame?.id === "bowling" && (
                    <Bowling
                      mode={isHumanGame ? "human" : "character"}
                      opponent={{ ...opponent, character: characterRecord }}
                      gameId={sharedGameId}
                      myPlayerIndex={myIdx}
                      roomName={roomName}
                      onGameEnd={handleGameEnd}
                    />
                  )}
                  {!loadingChar && selectedGame?.id === "tictactoe" && (
                    <TicTacToe
                      mode={isHumanGame ? "human" : "character"}
                      character={characterRecord}
                      opponent={opponent}
                      gameId={sharedGameId}
                      myPlayerIndex={myIdx}
                      onGameEnd={handleGameEnd}
                    />
                  )}
                  {!loadingChar && selectedGame?.id === "dotsandboxes" && (
                    <DotsAndBoxes
                      mode={isHumanGame ? "human" : "character"}
                      character={characterRecord}
                      opponent={opponent}
                      gameId={sharedGameId}
                      myPlayerIndex={myIdx}
                      onGameEnd={handleGameEnd}
                    />
                  )}
                  {!loadingChar && selectedGame?.id === "pool" && characterRecord && (
                    <Pool character={characterRecord} onGameEnd={handleGameEnd} />
                  )}
                  {!loadingChar && selectedGame?.id === "gemduel" && characterRecord && (
                    <GemDuel character={characterRecord} onGameEnd={handleGameEnd} />
                  )}
                  {!loadingChar && selectedGame?.id === "chemistry" && characterRecord && (
                    <ChemistryGame character={characterRecord} conversationId={null} onEnd={() => handleGameEnd("draw")} />
                  )}
                </div>
              )}

              {/* Result */}
              {stage === "result" && gameResult && (
                <div className="flex flex-col items-center justify-center gap-5 py-14 px-6">
                  <motion.span
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    transition={{ type: "spring", damping: 12, stiffness: 200, delay: 0.1 }}
                    className="text-6xl"
                  >
                    {selectedGame?.id === "chemistry" ? "🧪"
                      : gameResult.outcome === "user_win" ? "🏆"
                      : gameResult.outcome === "draw" ? "🤝" : "🎳"}
                  </motion.span>
                  <div className="text-center">
                    <h2 className="text-xl font-black text-foreground">
                      {selectedGame?.id === "chemistry" ? "Game Complete"
                        : gameResult.outcome === "user_win" ? "You Won!"
                        : gameResult.outcome === "draw" ? "Draw!"
                        : `${opponent?.participant_name} Won`}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1">{gameResult.summary}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-2">
                      {postingResult ? "Sharing with the room…" : "Shared with the room — characters may react"}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => { setStage("select"); setOpponent(null); setCharacterRecord(null); setGameResult(null); setSharedGameId(null); setInviteDeclined(false); setIsInitiator(true); }} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors">
                      Play Again
                    </button>
                    <button onClick={handleClose} className="px-5 py-2.5 rounded-xl bg-secondary text-foreground font-semibold text-sm hover:bg-secondary/70 transition-colors">
                      Back to Room
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}