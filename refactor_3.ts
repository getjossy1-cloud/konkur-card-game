import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Replace state.turn with state.activePlayerIndex
content = content.replace(/state\.turn/g, 'state.activePlayerIndex');

// Replace playerId 'player' and 'cpu' with valid ids or dynamic lookups
// e.g. dispatch({ type: 'DRAW_FROM_DECK', playerId: 'cpu' }) -> dispatch({ type: 'DRAW_FROM_DECK', playerId: state.players[state.activePlayerIndex].id })

// Let's replace 'cpu' inside CPU action hooks to use the active player ID
content = content.replace(/state\.players\[state\.activePlayerIndex\]\.id === 'cpu'/g, 'state.players[state.activePlayerIndex].isBot');
content = content.replace(/state\.players\[1\];/g, 'state.players[state.activePlayerIndex];');
content = content.replace(/playerId: 'cpu'/g, 'playerId: state.players[state.activePlayerIndex].id');

// Replace interactive hooks: they should only work if the active player is NOT a bot
content = content.replace(/state\.players\[state\.activePlayerIndex\]\.id === 'player'/g, '!state.players[state.activePlayerIndex].isBot');
content = content.replace(/playerId: 'player'/g, 'playerId: state.players[state.activePlayerIndex].id');

// In interactions, ensure active player is used
// handleDiscardPileClick
content = content.replace(/if \(!state\.players\[state\.activePlayerIndex\]\.isBot \|\| state\.phase !== 'draw'\) return;/g, "if (state.players[state.activePlayerIndex].isBot || state.phase !== 'draw') return;");
content = content.replace(/const handCards = state\.players\[0\]\.hand\.filter/g, 'const activePlayer = state.players[state.activePlayerIndex];\\n      const handCards = activePlayer.hand.filter');

// Also handle attach logic
content = content.replace(/const allMelds = \[\.\.\.state\.players\[0\]\.melds, \.\.\.state\.players\[1\]\.melds\];/g, 'const allMelds = state.players.flatMap(p => p.melds);');

// toggleCardSelection
content = content.replace(/if \(state\.activePlayerIndex !== 'player' \|\| state\.phase !== 'action'\) return;/g, 'if (state.players[state.activePlayerIndex].isBot || state.phase !== "action") return;');

// Handle meld
content = content.replace(/state\.players\[0\]\.hand\.filter/g, 'state.players[state.activePlayerIndex].hand.filter');

// calculate scores
content = content.replace(/const playerScore = calculatePlayerScore\(state\.players\[0\]\.hand, state\.players\[0\]\.melds\);/g, '');
content = content.replace(/const cpuScore = calculatePlayerScore\(state\.players\[1\]\.hand, state\.players\[1\]\.melds\);/g, '');

// remove auto-start useEffect
content = content.replace(/dispatch\(\{ type: 'START_GAME' \}\);/g, "// dispatch({ type: 'START_GAME' });");

fs.writeFileSync('src/App.tsx', content);
