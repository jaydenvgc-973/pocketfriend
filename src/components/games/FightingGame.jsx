import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RotateCcw, X } from 'lucide-react';

const MOVES = {
  light: { name: 'Light Attack', damage: [8, 12], cooldown: 0 },
  heavy: { name: 'Heavy Attack', damage: [14, 22], cooldown: 0 },
  block: { name: 'Block', damage: [0, 0], cooldown: 0, isDefensive: true },
  special: { name: 'Special Move', damage: [20, 30], cooldown: 2 }
};

export default function FightingGame({ character, onEnd }) {
  const [playerHealth, setPlayerHealth] = useState(100);
  const [characterHealth, setCharacterHealth] = useState(100);
  const [isPlayerTurn, setIsPlayerTurn] = useState(true);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState(null);
  const [lastDamage, setLastDamage] = useState(null);
  const [playerBlocking, setPlayerBlocking] = useState(false);
  const [charBlocking, setCharBlocking] = useState(false);
  const [specialCooldown, setSpecialCooldown] = useState(0);
  const [charSpecialCooldown, setCharSpecialCooldown] = useState(0);
  const [battleLog, setBattleLog] = useState(['Battle start!']);

  const rollDamage = (move) => {
    const [min, max] = move.damage;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  const characterChooseMove = () => {
    const charHealth = characterHealth;
    const playerHealthPercent = playerHealth / 100;
    
    // AI: use special when available and player is low
    if (charSpecialCooldown === 0 && playerHealthPercent < 0.4) return 'special';
    
    // AI: block when low health
    if (charHealth < 30) return Math.random() < 0.5 ? 'block' : 'light';
    
    // AI: default aggression with some defense
    const rand = Math.random();
    if (rand < 0.5) return 'light';
    if (rand < 0.75) return 'heavy';
    if (rand < 0.9) return 'block';
    return charSpecialCooldown === 0 ? 'special' : 'light';
  };

  const applyDamage = (damage, isPlayerAttacking, isBlocking) => {
    let finalDamage = damage;
    if (isBlocking) {
      finalDamage = Math.floor(damage * 0.4); // Block reduces by 60%
    }
    return finalDamage;
  };

  const handlePlayerMove = (moveKey) => {
    if (gameOver || !isPlayerTurn) return;
    if (moveKey === 'special' && specialCooldown > 0) return;

    const move = MOVES[moveKey];
    const charMove = characterChooseMove();
    const charMoveData = MOVES[charMove];

    // Player attacks or blocks
    let playerDamageDealt = 0;
    let charDamageTaken = 0;

    if (!move.isDefensive) {
      playerDamageDealt = rollDamage(move);
      charDamageTaken = applyDamage(playerDamageDealt, true, charBlocking);
    }

    setPlayerBlocking(moveKey === 'block');

    // Character attacks or blocks
    let charDamageDealt = 0;
    let playerDamageTaken = 0;

    if (!charMoveData.isDefensive) {
      charDamageDealt = rollDamage(charMoveData);
      playerDamageTaken = applyDamage(charDamageDealt, false, playerBlocking);
    }

    setCharBlocking(charMove === 'block');

    // Update healths
    const newCharHealth = Math.max(0, characterHealth - charDamageTaken);
    const newPlayerHealth = Math.max(0, playerHealth - playerDamageTaken);

    setCharacterHealth(newCharHealth);
    setPlayerHealth(newPlayerHealth);

    // Update cooldowns
    if (moveKey === 'special') setSpecialCooldown(2);
    if (charMove === 'special') setCharSpecialCooldown(2);

    // Reduce cooldowns
    if (specialCooldown > 0) setSpecialCooldown(c => c - 1);
    if (charSpecialCooldown > 0) setCharSpecialCooldown(c => c - 1);

    // Log the turn
    const log = `You used ${move.name}${playerDamageDealt ? ` (${charDamageTaken} damage)` : ''}. ${character.name} used ${charMoveData.name}${charDamageDealt ? ` (${playerDamageTaken} damage)` : ''}.`;
    setBattleLog(prev => [...prev, log]);

    // Check for winner
    if (newCharHealth <= 0) {
      setWinner('player');
      setGameOver(true);
    } else if (newPlayerHealth <= 0) {
      setWinner('character');
      setGameOver(true);
    } else {
      setIsPlayerTurn(false);
      setTimeout(() => setIsPlayerTurn(true), 1000);
    }
  };

  const handleRematch = () => {
    setPlayerHealth(100);
    setCharacterHealth(100);
    setIsPlayerTurn(true);
    setGameOver(false);
    setWinner(null);
    setPlayerBlocking(false);
    setCharBlocking(false);
    setSpecialCooldown(0);
    setCharSpecialCooldown(0);
    setBattleLog(['Battle start!']);
  };

  return (
    <div className="w-full rounded-2xl bg-gradient-to-b from-purple-900 via-blue-900 to-black p-6 border border-purple-500/30 space-y-4">
      {/* Health Bars */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-xs text-white font-semibold">YOU</p>
          <div className="w-full bg-gray-800 rounded-full h-4 overflow-hidden">
            <motion.div
              initial={false}
              animate={{ width: `${playerHealth}%` }}
              className={`h-full ${playerHealth > 50 ? 'bg-green-500' : playerHealth > 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p className="text-xs text-gray-300">{playerHealth}/100 HP</p>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-white font-semibold">{character.name?.toUpperCase()}</p>
          <div className="w-full bg-gray-800 rounded-full h-4 overflow-hidden">
            <motion.div
              initial={false}
              animate={{ width: `${characterHealth}%` }}
              className={`h-full ${characterHealth > 50 ? 'bg-green-500' : characterHealth > 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p className="text-xs text-gray-300">{characterHealth}/100 HP</p>
        </div>
      </div>

      {/* Battle Log */}
      <div className="bg-black/50 rounded-xl p-3 h-20 overflow-y-auto text-xs text-gray-300 space-y-1 border border-purple-500/20">
        {battleLog.slice(-4).map((log, i) => (
          <p key={i} className="text-purple-300">{'>'} {log}</p>
        ))}
      </div>

      {/* Turn Indicator */}
      {!gameOver && (
        <div className="text-center text-xs font-semibold text-yellow-400">
          {isPlayerTurn ? '⚔️ YOUR TURN' : '⏳ OPPONENT TURN...'}
        </div>
      )}

      {/* Action Buttons */}
      {!gameOver && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handlePlayerMove('light')}
            disabled={!isPlayerTurn}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
          >
            ⚡ Light
          </button>
          <button
            onClick={() => handlePlayerMove('heavy')}
            disabled={!isPlayerTurn}
            className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
          >
            💥 Heavy
          </button>
          <button
            onClick={() => handlePlayerMove('block')}
            disabled={!isPlayerTurn}
            className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
          >
            🛡️ Block
          </button>
          <button
            onClick={() => handlePlayerMove('special')}
            disabled={!isPlayerTurn || specialCooldown > 0}
            className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
          >
            ✨ Special {specialCooldown > 0 && `(${specialCooldown})`}
          </button>
        </div>
      )}

      {/* End Game Screen */}
      {gameOver && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-3 py-4">
          <p className="text-2xl font-bold text-yellow-300">
            {winner === 'player' ? '🎉 YOU WIN!' : '⚔️ YOU LOST'}
          </p>
          <p className="text-sm text-gray-300">
            {winner === 'player' ? `You defeated ${character.name}!` : `${character.name} defeated you.`}
          </p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={handleRematch}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold flex items-center gap-2 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Rematch
            </button>
            <button
              onClick={() => onEnd && onEnd({ winner, playerFinal: playerHealth, charFinal: characterHealth })}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold flex items-center gap-2 transition-colors"
            >
              <X className="w-4 h-4" /> Exit
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}