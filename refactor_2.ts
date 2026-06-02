import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

content = content.replace(/winner,/g, 'winnerId: winner,');
content = content.replace(/state\.winner/g, 'state.winnerId');

// fix DEBUG_FORCE_HAND
content = content.replace(/players: \{\s*\.\.\.state\.players,\s*player: \{\s*\.\.\.state\.players\[0\],\s*hand: action\.hand,\s*\},\s*\}/gs, 'players: state.players.map(p => p.id === "p0" ? { ...p, hand: action.hand } : p)');

// fix move card direction
content = content.replace(/\[playerId\]: \{ \.\.\.player, hand: newHand \}/g, '/* handled below */');
content = content.replace(/players: \{\s*\.\.\.state\.players,\s*\/\* handled below \*\/\s*\}/g, 'players: state.players.map(p => p.id === playerId ? { ...p, hand: newHand } : p)');
content = content.replace(/\[playerId\]: \{ \.\.\.player, hand: sortedHand \}/g, '/* handled below */');

fs.writeFileSync('src/App.tsx', content);
