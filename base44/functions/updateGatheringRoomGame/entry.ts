import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// ── Bowling scoring helpers (authoritative) ──────────────────────────────────
// Standard ten-frame bowling. Each player has 10 frames. A frame is a list of
// rolls. Strike = [10], spare = [a, 10-a] with a>0, open = [a, b] with a+b<10.
// 10th frame: up to 3 rolls if strike or spare on the first/second roll.
// Cumulative score is running total with strike/spare bonuses.

function frameScore(frames, i) {
  const frame = frames[i];
  if (!frame || frame.rolls.length === 0) return null;
  const rolls = frame.rolls;
  const r0 = rolls[0] ?? 0;
  const r1 = rolls[1] ?? 0;
  const r2 = rolls[2] ?? 0;

  if (i < 9) {
    if (r0 === 10) {
      // strike: 10 + next two rolls
      const next = nextTwoRolls(frames, i);
      if (next === null) return null;
      return 10 + next;
    }
    if (rolls.length === 2 && r0 + r1 === 10) {
      // spare: 10 + next one roll
      const next = nextOneRoll(frames, i);
      if (next === null) return null;
      return 10 + next;
    }
    if (rolls.length === 2) return r0 + r1;
    return null; // frame not complete
  }
  // 10th frame
  const sum = rolls.reduce((a, b) => a + b, 0);
  // Complete if: 2 rolls and no strike/spare (open), or 3 rolls (strike/spare)
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
    if (fs === null) {
      cum.push(null);
    } else {
      total += fs;
      cum.push(total);
    }
  }
  return cum;
}

function isFrameComplete(frame, frameIndex) {
  const rolls = frame.rolls;
  if (rolls.length === 0) return false;
  if (frameIndex < 9) {
    const r0 = rolls[0];
    if (r0 === 10) return true; // strike
    return rolls.length === 2;
  }
  // 10th frame
  const r0 = rolls[0] ?? 0;
  const r1 = rolls[1] ?? 0;
  const isStrikeOrSpare = r0 === 10 || (rolls.length >= 2 && r0 + r1 === 10);
  if (isStrikeOrSpare) return rolls.length === 3;
  return rolls.length === 2;
}

function allFramesComplete(frames) {
  return frames.every((f, i) => isFrameComplete(f, i));
}

// Apply a roll to the bowling state. Returns { state, frameComplete, gameComplete }.
function applyBowlingRoll(state, pinCount) {
  const frames = state.frames.map(p => p.map(f => ({ rolls: [...f.rolls] })));
  const playerFrames = frames[state.currentPlayer];
  const frameIndex = state.currentFrame;
  const frame = playerFrames[frameIndex];
  const pinsBefore = state.pinsStanding;

  // Clamp pin count to available pins (can't knock more than standing)
  let pins = Math.max(0, Math.min(pinCount, pinsBefore));
  frame.rolls.push(pins);

  // Determine pins standing for next roll in same frame
  let pinsStanding = pinsBefore - pins;
  let frameComplete = isFrameComplete(frame, frameIndex);

  // 10th frame special: pins reset on strike or after spare in 10th
  if (frameIndex === 9) {
    const r0 = frame.rolls[0] ?? 0;
    const r1 = frame.rolls[1] ?? 0;
    const r2 = frame.rolls[2] ?? 0;
    // After a strike in 10th, pins reset for bonus rolls
    if (frame.rolls.length === 1 && r0 === 10) pinsStanding = 10;
    if (frame.rolls.length === 2 && r0 === 10 && r1 === 10) pinsStanding = 10;
    if (frame.rolls.length === 2 && r0 !== 10 && r0 + r1 === 10) pinsStanding = 10;
    // After strike + non-strike, remaining pins carry (no reset)
  } else {
    if (frameComplete) pinsStanding = 10; // reset for next frame
    if (frame.rolls[0] === 10) pinsStanding = 10; // strike resets
  }

  // Recompute cumulative scores
  const cumFrames = frames.map(pf => computeCumulatives(pf));

  let gameComplete = false;
  let nextPlayer = state.currentPlayer;
  let nextFrame = state.currentFrame;

  if (frameComplete) {
    // Move to next player's same frame, or next frame
    if (state.currentPlayer < frames.length - 1) {
      nextPlayer = state.currentPlayer + 1;
      nextFrame = state.currentFrame;
      pinsStanding = 10; // fresh frame for next player
    } else {
      // All players done this frame → next frame, back to player 0
      nextFrame = state.currentFrame + 1;
      nextPlayer = 0;
      pinsStanding = 10;
      if (nextFrame >= 10) {
        gameComplete = true;
      }
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
  let winnerIndex = null;
  let summary = '';
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

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const gameId = body.game_id;
    const action = body.action; // "roll" | "complete" | "abandon"
    const asPlayerIndex = body.as_player_index;
    const pinCount = body.pin_count;
    const resultSummary = body.result_summary; // for "complete" with non-bowling games

    if (!gameId || !action) {
      return Response.json({ error: 'Missing game_id or action' }, { status: 400 });
    }

    // Load the game (service role so any participant can read regardless of owner)
    let game;
    try {
      const games = await base44.asServiceRole.entities.GatheringRoomGame.filter({ id: gameId }, null, 1);
      game = games[0];
    } catch (_) {
      return Response.json({ error: 'Game not found' }, { status: 404 });
    }
    if (!game) return Response.json({ error: 'Game not found' }, { status: 404 });
    if (game.status === 'completed') return Response.json({ error: 'Game already completed' }, { status: 400 });

    // Validate caller is a participant
    const callerIsParticipant = (game.participants || []).some(p =>
      p.owner_email === user.email || (p.participant_type === 'user' && p.owner_email === user.email)
    );
    if (!callerIsParticipant) {
      return Response.json({ error: 'You are not a participant in this game.' }, { status: 403 });
    }

    if (action === 'abandon') {
      await base44.asServiceRole.entities.GatheringRoomGame.update(gameId, {
        status: 'abandoned',
        completed_at: new Date().toISOString(),
      });
      return Response.json({ success: true, status: 'abandoned' });
    }

    if (action === 'roll') {
      if (game.game_type !== 'bowling') {
        return Response.json({ error: 'roll action only supported for bowling via this function' }, { status: 400 });
      }
      if (typeof asPlayerIndex !== 'number' || asPlayerIndex !== game.state?.currentPlayer) {
        return Response.json({ error: 'Not this player\'s turn.' }, { status: 400 });
      }
      if (typeof pinCount !== 'number' || pinCount < 0 || pinCount > 10) {
        return Response.json({ error: 'Invalid pin count' }, { status: 400 });
      }

      const { state: newState, gameComplete } = applyBowlingRoll(game.state, pinCount);

      let update = {
        state: newState,
        player_turn_index: newState.currentPlayer,
      };

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

    if (action === 'complete') {
      // For non-bowling games (existing games played vs character locally), the
      // client sends the final result_summary and winner_index. This records the
      // completed shared game so the other human participant (if any) sees it finish.
      const winnerIndex = body.winner_index;
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