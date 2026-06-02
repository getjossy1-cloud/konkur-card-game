import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Fix specific usages of state.players[0] in bottom section
content = content.replace(/state\.players\[0\]\.hand\.length > 11/g, 'state.players[state.activePlayerIndex].hand.length > 11');
content = content.replace(/findAutoMelds\(state\.players\[0\]\.hand\)/g, 'findAutoMelds(state.players[state.activePlayerIndex].hand)');
content = content.replace(/state\.players\[0\]\.hand\.find/g, 'state.players[state.activePlayerIndex].hand.find');
content = content.replace(/disabled=\{state\.players\[0\]\.hand\.length > 0\}/g, 'disabled={state.players[state.activePlayerIndex].hand.length > 0}');
content = content.replace(/state\.players\[0\]\.hand\.length === 0/g, 'state.players[state.activePlayerIndex].hand.length === 0');

// Fix specific usages of state.activePlayerIndex !== 'player'
content = content.replace(/state\.activePlayerIndex !== 'player'/g, 'state.players[state.activePlayerIndex].isBot');

// Fix score computation in the Game Over overlay
// Remove the old calculatePlayerScore which probably crashed because I removed it earlier
content = content.replace(/\{playerScore\.earned - playerScore\.penalty\}/g, '');
content = content.replace(/\{\(\+playerScore\.earned.*?\)/g, '');
content = content.replace(/\{cpuScore\.earned - cpuScore\.penalty\}/g, '');
content = content.replace(/\{\(\+cpuScore\.earned.*?\)/g, '');

content = content.replace(/state\.winnerId === 'player' \? 'YOU REIGNED SUPREME' : 'THE HOUSE ALWAYS WINS'/g, 'state.players.find(p => p.id === state.winnerId)?.name + " REIGNED SUPREME"');

fs.writeFileSync('src/App.tsx', content);
