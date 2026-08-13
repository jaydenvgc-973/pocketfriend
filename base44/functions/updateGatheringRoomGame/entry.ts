import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// ── Bowling scoring helpers (authoritative) ──────────────────────────────────

function frameScore(frames, i) {
  const frame = frames[i];
  if (!frame || frame.rolls.length === 0) return null;
  const rolls = frame.rolls;
  const r0 = rolls[0] ?? 0;
  const r1 = rolls[1] ?? 0;

  if (i < 9) {
    if (r0 === 10) {
      const next = nextTwoRolls(frames, i);
      if (next === null) return null;
      return 10 + next;
    }
    if (rolls.length === 2 && r0 + r1 === 10) {
      const next = nextOneRoll(frames, i);
      if (next === null) return null;
      return 10 + next;
    }
    if (rolls.length === 2) return r0 + r1;
    return null;
  }
  const sum = rolls.reduce((a, b) => a + b, 0);
  const isStrikeOrSpare = r0 === 10 || (rolls.length >= 2 && r0 + r1 === 10);
  if (isStrikeOrSpare && rolls.length < 3) return null;
  if (!isStrikeOrSpare && rolls.length < 2) return null;
  return sum;
}

function nextOneRoll(frames, i) {
  for (let k = i + 1; k < frames.length; k++) {
    if (frames[k].rolls.length > 0) return frames[k].rolls[0];
  }
  return null;
}

function nextTwoRolls(frames, i) {
  const collected = [];
  for (let k = i + 1; k < frames.length && collected.length < 2; k++) {
    for (const r of frames[k].rolls) {
      collected.push(r);
      if (collected.length >= 2) break;
    }
  }
  if (collected.length < 2) return null;
  return collected[0] + collected[1];
}

function computeCumulatives(frames) {
  const cum = [];
  let total = 0;
  for (let i = 0; i < frames.length; i++) {
    const fs = frameScore(frames, i);
    if (fs === null) cum.push(null);
    else { total += fs; cum.push(total); }
  }
  return cum;
}

function isFrameComplete(frame, frameIndex) {
  const rolls = frame.rolls;
  if (rolls.length === 0) return false;
  if (frameIndex < 9) {
    if (rolls[0] === 10) return true;
    return rolls.length === 2;
  }
  const r0 = rolls[0] ?? 0, r1 = rolls[1] ?? 0;
  const isStrikeOrSpare = r0 === 10 || (rolls.length >= 2 && r0 + r1 === 10);
  if (isStrikeOrSpare) return rolls.length === 3;
  return rolls.length === 2;
}

function applyBowlingRoll(state, pinCount) {
  const frames = state.frames.map(p => p.map(f => ({ rolls: [...f.rolls] })));
  const playerFrames = frames[state.currentPlayer];
  const frameIndex = state.currentFrame;
  const frame = playerFrames[frameIndex];
  const pinsBefore = state.pinsStanding;
  let pins = Math.max(0, Math.min(pinCount, pinsBefore));
  frame.rolls.push(pins);

  let pinsStanding = pinsBefore - pins;
  let frameComplete = isFrameComplete(frame, frameIndex);

  if (frameIndex === 9) {
    const r0 = frame.rolls[0] ?? 0, r1 = frame.rolls[1] ?? 0;
    if (frame.rolls.length === 1 && r0 === 10) pinsStanding = 10;
    if (frame.rolls.length === 2 && r0 === 10 && r1 === 10) pinsStanding = 10;
    if (frame.rolls.length === 2 && r0 !== 10 && r0 + r1 === 10) pinsStanding = 10;
  } else {
    if (frameComplete) pinsStanding = 10;
    if (frame.rolls[0] === 10) pinsStanding = 10;
  }

  const cumFrames = frames.map(pf => computeCumulatives(pf));
  let gameComplete = false;
  let nextPlayer = state.currentPlayer, nextFrame = state.currentFrame;

  if (frameComplete) {
    if (state.currentPlayer < frames.length - 1) {
      nextPlayer = state.currentPlayer + 1;
      nextFrame = state.currentFrame;
      pinsStanding = 10;
    } else {
      nextFrame = state.currentFrame + 1;
      nextPlayer = 0;
      pinsStanding = 10;
      if (nextFrame >= 10) gameComplete = true;
    }
  }

  const newState = {
    ...state,
    frames: cumFrames,
    currentPlayer: gameComplete ? state.currentPlayer : nextPlayer,
    currentFrame: gameComplete ? state.currentFrame : nextFrame,
    pinsStanding,
  };
  return { state: newState, frameComplete, gameComplete };
}

function bowlingResultSummary(participants, frames) {
  const totals = frames.map(pf => {
    const cum = computeCumulatives(pf);
    return cum[9] ?? cum.filter(c => c !== null).pop() ?? 0;
  });
  const max = Math.max(...totals);
  const winners = totals.map((t, i) => (t === max ? i : -1)).filter(i => i >= 0);
  let winnerIndex, summary;
  if (winners.length === 1) {
    winnerIndex = winners[0];
    const loserIdx = totals.findIndex((t, i) => i !== winnerIndex);
    summary = `${participants[winnerIndex].participant_name} beat ${participants[loserIdx].participant_name} at Bowling ${totals[winnerIndex]}-${totals[loserIdx]}.`;
  } else {
    winnerIndex = -1;
    summary = `${participants.map(p => p.participant_name).join(' and ')} tied at Bowling ${max}-${max}.`;
  }
  return { winnerIndex, summary, totals };
}

// ── Tic-Tac-Toe move validation (authoritative) ──────────────────────────────

const TTT_WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

function applyTicTacToeMove(state, playerIndex, cellIndex) {
  const board = [...(state.board || Array(9).fill(null))];
  const symbol = playerIndex === 0 ? 'X' : 'O';

  if (state.winner) return { error: 'Game already finished' };
  if (state.currentPlayer !== playerIndex) return { error: 'Not your turn' };
  if (cellIndex < 0 || cellIndex > 8) return { error: 'Invalid cell' };
  if (board[cellIndex]) return { error: 'Cell already taken' };

  board[cellIndex] = symbol;

  let winner = null, winLine = null;
  for (const [a,b,c] of TTT_WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      winner = board[a]; winLine = [a,b,c]; break;
    }
  }
  if (!winner && board.every(Boolean)) winner = 'draw';

  let winnerIndex = null;
  if (winner === 'draw') winnerIndex = -1;
  else if (winner === 'X') winnerIndex = 0;
  else if (winner === 'O') winnerIndex = 1;

  return {
    state: {
      ...state,
      board,
      currentPlayer: winner ? state.currentPlayer : (1 - state.currentPlayer),
      winner, winLine,
    },
    gameComplete: !!winner,
    winnerIndex,
  };
}

// ── Dots & Boxes move validation (authoritative) ─────────────────────────────

const DB_DOTS = 5, DB_BOXES = 4;
const DB_H_COUNT = (DB_BOXES + 1) * DB_BOXES;
const DB_V_COUNT = DB_BOXES * DB_DOTS;

function dbHIdx(r, c) { return r * DB_BOXES + c; }
function dbVIdx(r, c) { return r * DB_DOTS + c; }

function applyDotsAndBoxesMove(state, playerIndex, line) {
  const h = [...(state.h || new Array(DB_H_COUNT).fill(false))];
  const v = [...(state.v || new Array(DB_V_COUNT).fill(false))];
  const boxes = [...(state.boxes || new Array(DB_BOXES * DB_BOXES).fill(null))];
  const scores = [...(state.scores || [0, 0])];

  if (state.winner !== null && state.winner !== undefined) return { error: 'Game already finished' };
  if (state.currentPlayer !== playerIndex) return { error: 'Not your turn' };

  if (line.type === 'h') {
    const idx = dbHIdx(line.r, line.c);
    if (h[idx]) return { error: 'Line already drawn' };
    h[idx] = true;
  } else {
    const idx = dbVIdx(line.r, line.c);
    if (v[idx]) return { error: 'Line already drawn' };
    v[idx] = true;
  }

  let scored = 0;
  for (let r = 0; r < DB_BOXES; r++) {
    for (let c = 0; c < DB_BOXES; c++) {
      const idx = r * DB_BOXES + c;
      if (boxes[idx] === null && h[dbHIdx(r,c)] && h[dbHIdx(r+1,c)] && v[dbVIdx(r,c)] && v[dbVIdx(r,c+1)]) {
        boxes[idx] = playerIndex;
        scored++;
      }
    }
  }
  scores[playerIndex] += scored;

  const total = DB_BOXES * DB_BOXES;
  const claimed = boxes.filter(b => b !== null).length;
  let winner = null, gameComplete = false;
  if (claimed >= total) {
    gameComplete = true;
    if (scores[0] > scores[1]) winner = 0;
    else if (scores[1] > scores[0]) winner = 1;
    else winner = -1;
  }

  const nextPlayer = scored > 0 && !gameComplete ? playerIndex : (1 - playerIndex);

  return {
    state: {
      ...state,
      h, v, boxes, scores,
      currentPlayer: gameComplete ? state.currentPlayer : nextPlayer,
      winner,
    },
    gameComplete,
    winnerIndex: gameComplete ? winner : null,
  };
}

// ── Result summary for turn-based games ──────────────────────────────────────

function turnBasedResultSummary(participants, winnerIndex, gameLabel) {
  if (winnerIndex === -1 || winnerIndex === null) {
    return `${participants.map(p => p.participant_name).join(' and ')} drew at ${gameLabel}.`;
  }
  const winner = participants[winnerIndex];
  const loserIdx = participants.findIndex((_, i) => i !== winnerIndex);
  const loser = participants[loserIdx];
  return `${winner.participant_name} beat ${loser.participant_name} at ${gameLabel}.`;
}

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const gameId = body.game_id;
    const action = body.action; // "roll" | "move" | "complete" | "abandon" | "accept" | "decline"
    const asPlayerIndex = body.as_player_index;
    const pinCount = body.pin_count;
    const move = body.move; // { cell } for tictactoe, { type, r, c } for dotsandboxes
    const resultSummary = body.result_summary;
    const winnerIndexBody = body.winner_index;

    if (!gameId || !action) {
      return Response.json({ error: 'Missing game_id or action' }, { status: 400 });
    }

    let game;
    try {
      const games = await base44.asServiceRole.entities.GatheringRoomGame.filter({ id: gameId }, null, 1);
      game = games[0];
    } catch (_) {
      return Response.json({ error: 'Game not found' }, { status: 404 });
    }
    if (!game) return Response.json({ error: 'Game not found' }, { status: 404 });

    // Validate caller is a participant
    const callerIsParticipant = (game.participants || []).some(p => p.owner_email === user.email);
    if (!callerIsParticipant) {
      return Response.json({ error: 'You are not a participant in this game.' }, { status: 403 });
    }

    // ── ACCEPT pending invite ──
    if (action === 'accept') {
      if (game.status !== 'pending') return Response.json({ error: 'Game is not pending' }, { status: 400 });
      await base44.asServiceRole.entities.GatheringRoomGame.update(gameId, { status: 'active' });
      return Response.json({ success: true, status: 'active' });
    }

    // ── DECLINE pending invite ──
    if (action === 'decline') {
      if (game.status !== 'pending') return Response.json({ error: 'Game is not pending' }, { status: 400 });
      await base44.asServiceRole.entities.GatheringRoomGame.update(gameId, {
        status: 'cancelled', completed_at: new Date().toISOString(),
      });
      return Response.json({ success: true, status: 'cancelled' });
    }

    // ── ABANDON active game ──
    if (action === 'abandon') {
      if (game.status === 'completed' || game.status === 'cancelled') {
        return Response.json({ success: true, status: game.status });
      }
      await base44.asServiceRole.entities.GatheringRoomGame.update(gameId, {
        status: 'abandoned', completed_at: new Date().toISOString(),
      });
      return Response.json({ success: true, status: 'abandoned' });
    }

    // For roll/move/complete, game must be active
    if (game.status !== 'active') {
      return Response.json({ error: `Game is not active (status: ${game.status})` }, { status: 400 });
    }

    // ── BOWLING ROLL ──
    if (action === 'roll') {
      if (game.game_type !== 'bowling') {
        return Response.json({ error: 'roll action only supported for bowling' }, { status: 400 });
      }
      if (typeof asPlayerIndex !== 'number' || asPlayerIndex !== game.state?.currentPlayer) {
        return Response.json({ error: 'Not this player\'s turn.' }, { status: 400 });
      }
      if (typeof pinCount !== 'number' || pinCount < 0 || pinCount > 10) {
        return Response.json({ error: 'Invalid pin count' }, { status: 400 });
      }

      const { state: newState, gameComplete } = applyBowlingRoll(game.state, pinCount);
      let update = { state: newState, player_turn_index: newState.currentPlayer };

      if (gameComplete) {
        const { winnerIndex, summary, totals } = bowlingResultSummary(game.participants, newState.frames);
        update.status = 'completed';
        update.winner_index = winnerIndex;
        update.result_summary = summary;
        update.completed_at = new Date().toISOString();
        update.state = { ...newState, totals, status: 'completed' };
      }

      const updated = await base44.asServiceRole.entities.GatheringRoomGame.update(gameId, update);
      return Response.json({ success: true, game: updated });
    }

    // ── TIC-TAC-TOE / DOTS & BOXES MOVE ──
    if (action === 'move') {
      if (typeof asPlayerIndex !== 'number' || asPlayerIndex !== game.state?.currentPlayer) {
        return Response.json({ error: 'Not this player\'s turn.' }, { status: 400 });
      }

      let result;
      if (game.game_type === 'tictactoe') {
        if (!move || typeof move.cell !== 'number') {
          return Response.json({ error: 'Invalid move' }, { status: 400 });
        }
        result = applyTicTacToeMove(game.state, asPlayerIndex, move.cell);
      } else if (game.game_type === 'dotsandboxes') {
        if (!move || !move.type || typeof move.r !== 'number' || typeof move.c !== 'number') {
          return Response.json({ error: 'Invalid move' }, { status: 400 });
        }
        result = applyDotsAndBoxesMove(game.state, asPlayerIndex, move);
      } else {
        return Response.json({ error: 'move action not supported for this game type' }, { status: 400 });
      }

      if (result.error) return Response.json({ error: result.error }, { status: 400 });

      let update = { state: result.state, player_turn_index: result.state.currentPlayer };

      if (result.gameComplete) {
        const gameLabel = game.game_type === 'tictactoe' ? 'Tic-Tac-Toe' : 'Dots & Boxes';
        const summary = turnBasedResultSummary(game.participants, result.winnerIndex, gameLabel);
        update.status = 'completed';
        update.winner_index = result.winnerIndex;
        update.result_summary = summary;
        update.completed_at = new Date().toISOString();
      }

      const updated = await base44.asServiceRole.entities.GatheringRoomGame.update(gameId, update);
      return Response.json({ success: true, game: updated });
    }

    // ── COMPLETE (for character-opponent games that finish locally) ──
    if (action === 'complete') {
      const winnerIndex = winnerIndexBody;
      await base44.asServiceRole.entities.GatheringRoomGame.update(gameId, {
        status: 'completed',
        winner_index: winnerIndex ?? -1,
        result_summary: resultSummary || '',
        completed_at: new Date().toISOString(),
      });
      return Response.json({ success: true, status: 'completed' });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});