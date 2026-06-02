import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Replace state.players[playerId] with finding from array
content = content.replace(/const player = state\.players\[playerId\];/g, 'const player = state.players.find(p => p.id === playerId)!;');
content = content.replace(/const opponent = state\.players\[opponentId\];/g, 'const opponent = state.players.find(p => p.id === opponentId)!;');

// Replace player updates
content = content.replace(/players: \{\s*\.\.\.state\.players,\s*\[playerId\]: \{\s*\.\.\.player,\s*(.*?)\s*\},\s*\}/gs, (match, inner) => {
  return `players: state.players.map(p => p.id === playerId ? { ...p, ${inner} } : p)`;
});

content = content.replace(/const updatedPlayers = \{ \.\.\.state\.players \};/g, 'let updatedPlayers = [...state.players];');

content = content.replace(/updatedPlayers\[ownerIdToUpdate\] = \{\s*\.\.\.updatedPlayers\[ownerIdToUpdate\],\s*melds: updatedPlayers\[ownerIdToUpdate\]\.melds\.map\(m => m\.id === meldId \? updatedMeld : m\),\s*\};/g, `updatedPlayers = updatedPlayers.map(p => p.id === ownerIdToUpdate ? { ...p, melds: p.melds.map(m => m.id === meldId ? updatedMeld : m) } : p);`);

content = content.replace(/updatedPlayers\[playerId\] = \{ \.\.\.player, hand: remainingHand \};/g, `updatedPlayers = updatedPlayers.map(p => p.id === playerId ? { ...p, hand: remainingHand } : p);`);

content = content.replace(/state\.turn !== playerId/g, 'state.players[state.activePlayerIndex].id !== playerId');
content = content.replace(/state\.turn === /g, 'state.players[state.activePlayerIndex].id === ');
content = content.replace(/turn: 'player'/g, 'activePlayerIndex: 0');
content = content.replace(/turn: winner \? playerId : \(playerId === 'player' \? 'cpu' : 'player'\)/g, 'activePlayerIndex: winner ? state.activePlayerIndex : (state.activePlayerIndex + 1) % state.players.length');

content = content.replace(/players: \{\s*\.\.\.state\.players,\s*player: \{\s*\.\.\.state\.players\.player, hand: action\.hand \},\s*\}/gs, 'players: state.players.map(p => p.id === "p0" ? { ...p, hand: action.hand } : p)');

content = content.replace(/state\.players\.player/g, `state.players[0]`);
content = content.replace(/state\.players\.cpu/g, `state.players[1]`);

fs.writeFileSync('src/App.tsx', content);
