/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useReducer, useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { 
  Trophy, 
  RotateCcw, 
  ArrowRight, 
  User as UserIcon, 
  Bot, 
  Info,
  ChevronUp,
  ChevronDown,
  LayoutGrid,
  Trash2,
  Cigarette,
  Users,
  Play,
  User,
  Menu,
  Home,
  X
} from 'lucide-react';
import { 
  Card, 
  GameState, 
  PlayerId, 
  Meld,
  Rank,
  Suit,
  GameSettings,
  PlayerState
} from './types';
import { 
  createDeck, 
  isValidMeld, 
  canAttachToMeld, 
  shuffle,
  findAutoMelds,
  sortMeld,
  isSet,
  calculateMeldValue,
  findOptimalOpener,
  perfectlyPartitionMelds
} from './gameLogic';
import { CardUI } from './components/CardUI';
import { dictionary, Locale, LocalizationKey } from './i18n';
import { supabase } from './lib/supabase';
import { TelegramProfile } from './lib/telegram';

declare global {
  interface Window {
    Telegram?: {
      WebApp: any;
    };
  }
}

type Action =
  | { type: 'SYNC_STATE'; payload: GameState }
  | { type: 'START_GAME'; settings?: GameSettings; multiplayerPlayers?: { id: string | number; name: string; photoUrl?: string }[]; tgUser?: TelegramProfile }
  | { type: 'DRAW_FROM_DECK'; playerId: PlayerId }
  | { type: 'DRAW_FROM_DISCARD'; playerId: PlayerId }
  | { type: 'MELD_WITH_DISCARD'; playerId: PlayerId; handCardIds: string[] }
  | { type: 'ATTACH_DISCARD_TO_MELD'; playerId: PlayerId; meldId: string }
  | { type: 'MELD_CARDS'; playerId: PlayerId; cards: Card[] }
  | { type: 'ATTACH_TO_MELD'; playerId: PlayerId; card: Card; meldId: string }
  | { type: 'ATTACH_BATCH_TO_MELD'; playerId: PlayerId; cards: Card[]; meldId: string }
  | { type: 'DISCARD'; playerId: PlayerId; card: Card }
  | { type: 'REORDER_PLAYER_HAND'; hand: Card[] }
  | { type: 'WORKSPACE_REMOVE_CARD'; playerId: PlayerId; meldId: string; cardId: string }
  | { type: 'CONTINUE_TURN'; playerId: PlayerId }
  | { type: 'CONQUER'; playerId: PlayerId; finalCard?: Card }
  | { type: 'MOVE_CARD_DIRECTION'; playerId: PlayerId; cardId: string; direction: 'left' | 'right' }
  | { type: 'GROUP_HAND_CARDS'; playerId: PlayerId; cardIds: string[] }
  | { type: 'UNGROUP_HAND_CARDS'; playerId: PlayerId; cardIds: string[] }
  | { type: 'SORT_HAND'; playerId: PlayerId }
  | { type: 'AUTO_MELD_HAND'; playerId: PlayerId; newMelds: Card[][]; remainingHand: Card[] }
  | { type: 'MELD_OPENER_BATCH'; playerId: PlayerId; melds: Card[][]; discardCard: Card }
  | { type: 'INSTANT_CONQUER_DRAW'; playerId: PlayerId; comboCardsIds: string[] }
  | { type: 'DEBUG_FORCE_HAND'; hand: Card[] }
  | { type: 'DEBUG_FORCE_MELDS'; playerId: PlayerId; melds: Card[][] }
  | { type: 'DEBUG_FORCE_DISCARD'; card: Card }
  | { type: 'DEBUG_FORCE_SCORE_TRANSFER'; playerId: PlayerId }
  | { type: 'DEBUG_FORCE_CPU_DRAW_TEST' }
  | { type: 'DEBUG_FORCE_OPENED_AND_DRAW_PHASE'; playerId: PlayerId }
  | { type: 'DEBUG_FORCE_WIN_STATE'; playerId: PlayerId; hand: Card[]; melds: Card[][] }
  | { type: 'DEBUG_FORCE_TURN_TIMEOUT' }
  | { type: 'DEBUG_FORCE_ANTE_AND_WIN'; playerId: PlayerId }
  | { type: 'END_CPU_TURN' }
  | { type: 'FORFEIT_ACTIVE_PLAYER' }
  | { type: 'QUIT_GAME'; playerId?: string | number };

const START_PLAYER_CARDS = 14;
const START_CPU_CARDS = 13;

const initialState: GameState = {
  hasStarted: false,
  settings: { playerCount: 2, gameMode: 'vs-ai', gameStake: 10 },
  deck: [],
  discardPile: [],
  players: [
    { id: 'p0', name: 'Player 1', hand: [], melds: [], isBot: false, isOpened: false, totalBankroll: 150 },
    { id: 'p1', name: 'Dealer', hand: [], melds: [], isBot: true, isOpened: false, totalBankroll: 150 },
  ],
  activePlayerIndex: 0,
  phase: 'draw',
  winnerId: null,
  lastDrawnCard: null,
};

function gameReducer(state: GameState, action: Action): GameState {
  if (state.winnerId && action.type !== 'START_GAME' && action.type !== 'SYNC_STATE' && action.type !== 'QUIT_GAME') return state;

  switch (action.type) {
    case 'SYNC_STATE': {
      return action.payload;
    }
    case 'DEBUG_FORCE_CPU_DRAW_TEST': {
      return {
        ...state,
        activePlayerIndex: 1, // force CPU turn
        phase: 'draw'
      };
    }

    case 'DEBUG_FORCE_OPENED_AND_DRAW_PHASE': {
      const { playerId } = action as any;
      const testHand = createDeck(99).slice(0, 13).map(c => ({ ...c, faceUp: true }));
      const discard = { ...createDeck(88)[0], faceUp: true };
      return {
        ...state,
        activePlayerIndex: state.players.findIndex(p => p.id === playerId),
        phase: 'draw',
        discardPile: [discard],
        players: state.players.map(p => p.id === playerId ? { ...p, isOpened: true, hand: testHand } : p)
      };
    }

    case 'FORFEIT_ACTIVE_PLAYER': {
       const playerIndex = state.activePlayerIndex;
       
       let updatedPlayers = state.players.map((p, i) => {
           if (i === playerIndex) {
               return { 
                   ...p, 
                   isForfeited: true, 
                   hand: [] 
               };
           }
           return p;
       });
       
       const activePlayersRemaining = updatedPlayers.filter(p => !p.isForfeited && !p.isBankrupt);
       
       if (state.players.length === 2 || activePlayersRemaining.length === 1) {
           const winner = activePlayersRemaining[0];
           if (winner) {
               const pointTransfers: { [playerId: string]: { penalty: number, earned: number } } = {};
               const totalWinnerEarned = state.gamePot || 0;
               
               updatedPlayers = updatedPlayers.map(p => {
                  if (p.id === winner.id) {
                     pointTransfers[p.id] = { penalty: 0, earned: totalWinnerEarned };
                     return { ...p, totalBankroll: p.totalBankroll + totalWinnerEarned };
                  }
                  pointTransfers[p.id] = { penalty: 0, earned: 0 };
                  return p;
               });

               return {
                  ...state,
                  players: updatedPlayers,
                  winnerId: winner.id,
                  pointTransfers,
                  gamePot: 0
               };
           }
       }
       
       let nextPlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
       while ((updatedPlayers[nextPlayerIndex].isForfeited || updatedPlayers[nextPlayerIndex].isBankrupt) && nextPlayerIndex !== state.activePlayerIndex) {
           nextPlayerIndex = (nextPlayerIndex + 1) % state.players.length;
       }
       
       let nextPhase: GameState['phase'] = 'draw';
       if (state.settings.gameMode === 'pass-and-play') {
           nextPhase = 'pass-device';
       }
       
       return {
           ...state,
           players: updatedPlayers,
           gamePot: (state.gamePot || 0),
           activePlayerIndex: nextPlayerIndex,
           phase: nextPhase as any,
           turnStartTime: Date.now(),
       };
    }

    case 'DEBUG_FORCE_TURN_TIMEOUT': {
      const activePlayer = state.players[state.activePlayerIndex];
      const isFirstTurn = !activePlayer.hasPlayedFirstTurn;
      const forfeitThreshold = isFirstTurn ? 138 : 55;
      const targetElapsedTime = forfeitThreshold - 1; 

      return {
        ...state,
        turnStartTime: Date.now() - (targetElapsedTime * 1000)
      };
    }

    case 'DEBUG_FORCE_ANTE_AND_WIN': {
      // Simulate Ante deduction
      const { playerId } = action as any;
      const anteAmount = state.settings.gameStake;
      let tempPot = (state.gamePot || 0) + (anteAmount * state.players.length);
      let tempPlayers = state.players.map(p => ({ ...p, totalBankroll: p.totalBankroll - anteAmount }));

      // Now force win for playerId
      const pointTransfers: { [playerId: string]: { penalty: number, earned: number } } = {};
      let totalWinnerEarned = tempPot; // Winner takes pot

      let updatedPlayers = tempPlayers.map(p => {
         if (p.id === playerId) {
            pointTransfers[p.id] = { penalty: 0, earned: 0 };
            return p;
         }
         
         let penalty = 20; // Fake penalty
         pointTransfers[p.id] = { penalty, earned: 0 };
         totalWinnerEarned += penalty;
         return { ...p, totalBankroll: p.totalBankroll - penalty };
      });

      pointTransfers[playerId].earned = totalWinnerEarned;
      updatedPlayers = updatedPlayers.map(p => {
         let updatedScore = p.totalBankroll;
         if (p.id === playerId) {
             updatedScore += totalWinnerEarned;
         }
         return { ...p, totalBankroll: updatedScore, isBankrupt: updatedScore <= 0 };
      });

      return {
         ...state,
         players: updatedPlayers,
         winnerId: playerId,
         pointTransfers,
         gamePot: 0 
      };
    }

    case 'QUIT_GAME': {
      const { playerId } = action;
      if (!playerId || !state.players) {
        return {
          ...initialState,
          hasStarted: false,
          settings: state.settings,
        };
      }

      const newPlayers = state.players.map(p => 
        p.id === playerId ? { ...p, isForfeited: true, hand: [] } : p
      );
      
      const activePlayers = newPlayers.filter(p => !p.isForfeited && !p.isBankrupt);

      if (activePlayers.length < 2) {
        return {
          ...initialState,
          hasStarted: false,
          settings: state.settings,
        };
      }

      let nextState = { ...state, players: newPlayers };
      
      // If it was their turn, advance
      if (state.players[state.activePlayerIndex] && state.players[state.activePlayerIndex].id === playerId) {
         let nextIdx = (state.activePlayerIndex + 1) % state.players.length;
         while (nextState.players[nextIdx].isForfeited || nextState.players[nextIdx].isBankrupt) {
            nextIdx = (nextIdx + 1) % state.players.length;
         }
         nextState.activePlayerIndex = nextIdx;
         nextState.turnStartTime = Date.now();
      }

      return nextState;
    }

    case 'START_GAME': {
      const settings = action.settings || state.settings;
      
      let tempPlayers: PlayerState[] = [];
      if (action.settings) {
        // 1. BRAND NEW MATCH SERIES INITIALIZATION:
        if (action.multiplayerPlayers && action.multiplayerPlayers.length > 0) {
           for (let i = 0; i < action.multiplayerPlayers.length; i++) {
             tempPlayers.push({
               id: action.multiplayerPlayers[i].id.toString(),
               name: action.multiplayerPlayers[i].name,
               telegramId: action.multiplayerPlayers[i].id.toString(),
               photoUrl: action.multiplayerPlayers[i].photoUrl,
               hand: [],
               melds: [],
               isBot: false,
               isOpened: false,
               totalBankroll: settings.gameStake * 15,
               isBankrupt: false,
               hasPlayedFirstTurn: false,
               isForfeited: false,
             });
           }
        } else {
          // Initialize players with 15x multiplier of the chosen gameStake
          for (let i = 0; i < settings.playerCount; i++) {
            const isBot = settings.gameMode === 'vs-ai' && i > 0;
            
            let pId = `p${i}`;
            let pName = isBot ? `CPU ${i}` : `Player ${i + 1}`;
            let tId: string | undefined = undefined;
            let pUrl: string | undefined = undefined;
            
            // If it's the primary local player and we have their tgUser
            if (i === 0 && action.tgUser) {
               pId = action.tgUser.id.toString();
               pName = action.tgUser.display_name;
               tId = action.tgUser.id.toString();
               pUrl = action.tgUser.photo_url;
            }

            tempPlayers.push({
              id: pId,
              name: pName,
              telegramId: tId,
              photoUrl: pUrl,
              hand: [],
              melds: [],
              isBot,
              isOpened: false,
              totalBankroll: i === 0 && action.tgUser ? action.tgUser.bankroll : settings.gameStake * 15,
              isBankrupt: false,
              hasPlayedFirstTurn: false,
              isForfeited: false,
            });
          }
        }
      } else {
        // 2. SUBSEQUENT ROUND IN THE SERIES:
        // Preserve the existing players' totalBankroll and isBankrupt states, but reset game state for the new round
        tempPlayers = state.players.map(p => ({
          ...p,
          hand: [],
          melds: [],
          isOpened: false,
          hasPlayedFirstTurn: false,
          isForfeited: false,
        }));
      }

      // 3. ANTE DEDUCTION:
      // Automatically deduct gameStake amount from active (non-bankrupt) players and add to the central gamePot
      let gamePot = 0;
      let updatedPlayers = tempPlayers.map(p => {
        if (p.isBankrupt) {
          return p; // bankrupt players are skipped
        }
        const newBankroll = p.totalBankroll - settings.gameStake;
        gamePot += settings.gameStake;
        return {
          ...p,
          totalBankroll: newBankroll,
          isBankrupt: newBankroll <= 0, // Flagged bankrupt if reaches exactly 0 or negative
        };
      });

      // 4. DEAL CARDS AND CHOOSE FIRST NON-BANKRUPT PLAYER
      const deckCount = settings.playerCount === 4 ? 2 : 1;
      let deck: Card[] = [];
      for (let i = 0; i < deckCount; i++) {
        deck = deck.concat(createDeck(i));
      }

      // Identify the first active (non-bankrupt) player to start the turn
      let activePlayerIndex = updatedPlayers.findIndex(p => !p.isBankrupt);
      if (activePlayerIndex === -1) {
        activePlayerIndex = 0; // fallback safety
      }

      // Deal cards to active players
      for (let i = 0; i < updatedPlayers.length; i++) {
        if (updatedPlayers[i].isBankrupt) {
          updatedPlayers[i].hand = [];
          continue;
        }
        const numCards = (i === activePlayerIndex) ? START_PLAYER_CARDS : START_CPU_CARDS;
        const hand = deck.splice(0, numCards).map(c => ({
          ...c,
          faceUp: settings.gameMode === 'vs-ai' ? !updatedPlayers[i].isBot : i === 0
        }));
        updatedPlayers[i].hand = hand;
      }

      return {
        ...initialState,
        hasStarted: true,
        settings,
        deck,
        discardPile: [],
        players: updatedPlayers,
        activePlayerIndex,
        phase: 'action', // First player starts directly with action phase (14 cards)
        gamePot,
        turnStartTime: Date.now(),
      };
    }

    case 'DRAW_FROM_DECK': {
      const { playerId } = action;
      if (state.players[state.activePlayerIndex].id !== playerId || state.phase !== 'draw') return state;
      
      let deck = [...state.deck];
      let discardPile = [...state.discardPile];

      if (deck.length === 0) {
        // Reshuffle discard pile except top card
        if (discardPile.length > 1) {
          const topCard = discardPile.pop()!;
          deck = shuffle(discardPile.map(c => ({ ...c, faceUp: false })));
          discardPile = [topCard];
        } else if (discardPile.length === 1) {
          // If only one card, can't reshuffle, game might be locked. But realistically won't happen.
          // Keep it to be safe.
        } else {
          // If nothing in discard pile either... very rare.
        }
      }

      if (deck.length === 0) {
        // Still empty? Create a new deck as absolute fallback to prevent crash.
        deck = shuffle(createDeck(99).map(c => ({ ...c, faceUp: false })));
      }

      const card = deck.pop()!;
      const player = state.players.find(p => p.id === playerId)!;
      const drawnCard = { ...card, faceUp: !player.isBot };

      return {
        ...state,
        deck,
        discardPile,
        players: state.players.map(p => p.id === playerId ? { ...p, hand: [...player.hand, drawnCard], } : p),
        phase: 'action',
        lastDrawnCard: drawnCard,
      };
    }

    case 'DRAW_FROM_DISCARD': {
      const { playerId } = action;
      if (state.players[state.activePlayerIndex].id !== playerId || state.phase !== 'draw') return state;
      if (state.discardPile.length === 0) return state;

      let discardPile = [...state.discardPile];
      const discardCard = discardPile.pop()!;
      discardCard.faceUp = true; // Always faceUp since it was from discard

      const player = state.players.find(p => p.id === playerId)!;

      return {
        ...state,
        discardPile,
        players: state.players.map(p => p.id === playerId ? { ...p, hand: [...player.hand, discardCard] } : p),
        phase: 'action',
        lastDrawnCard: discardCard,
      };
    }

    case 'MELD_WITH_DISCARD': {
      const { playerId, handCardIds } = action;
      if (state.players[state.activePlayerIndex].id !== playerId || state.phase !== 'draw') return state;
      if (state.discardPile.length === 0) return state;

      const discardPile = [...state.discardPile];
      const discardCard = discardPile.pop()!;
      discardCard.faceUp = true;
      
      const player = state.players.find(p => p.id === playerId)!;
      const handCards = player.hand.filter(c => handCardIds.includes(c.id));
      const potentialMeldCards = [...handCards, discardCard];

      const remainingHand = player.hand.filter(c => !handCardIds.includes(c.id));
      
      let newMeldType: Meld['type'] = 'invalid';
      if (isValidMeld(potentialMeldCards)) {
         newMeldType = isSet(potentialMeldCards) ? 'set' : 'run';
      }

      const newMeld: Meld = {
        id: Math.random().toString(36).substr(2, 9),
        type: newMeldType,
        cards: sortMeld(potentialMeldCards.map(c => ({ ...c, faceUp: true })), newMeldType),
        ownerId: playerId,
      };

      const newMelds = [...player.melds, newMeld];
      let isOpened = player.isOpened;
      if (!isOpened) {
        const totalPoints = newMelds.filter(m => m.type !== 'invalid').reduce((sum, m) => sum + calculateMeldValue(m), 0);
        if (totalPoints >= 41) isOpened = true;
      }

      return {
        ...state,
        discardPile,
        players: state.players.map(p => p.id === playerId ? { ...p, hand: remainingHand,
            melds: newMelds, isOpened } : p),
        phase: 'action',
      };
    }

    case 'ATTACH_DISCARD_TO_MELD': {
      const { playerId, meldId } = action;
      if (state.players[state.activePlayerIndex].id !== playerId || state.phase !== 'draw') return state;
      if (state.discardPile.length === 0) return state;

      const discardPile = [...state.discardPile];
      const discardCard = discardPile.pop()!;
      discardCard.faceUp = true;

      const player = state.players.find(p => p.id === playerId)!;

      let meldToUpdate: Meld | undefined;
      let ownerIdToUpdate: PlayerId | undefined;

      for (const p of state.players) {
        const m = p.melds.find(m => m.id === meldId);
        if (m) {
          if (p.id !== playerId && !player.isOpened) return state; // Must be opened to build on opponent melds
          meldToUpdate = m;
          ownerIdToUpdate = p.id;
          break;
        }
      }

      if (!meldToUpdate || !ownerIdToUpdate || !canAttachToMeld(meldToUpdate, discardCard)) return state;

      const updatedMeld = {
        ...meldToUpdate,
        cards: sortMeld([...meldToUpdate.cards, discardCard], meldToUpdate.type),
      };

      let updatedPlayers = [...state.players];
      updatedPlayers = updatedPlayers.map(p => p.id === ownerIdToUpdate ? { ...p, melds: p.melds.map(m => m.id === meldId ? updatedMeld : m) } : p);

      return {
        ...state,
        discardPile,
        players: updatedPlayers,
        phase: 'action',
      };
    }

    case 'MELD_CARDS': {
      const { playerId, cards } = action;
      if (state.players[state.activePlayerIndex].id !== playerId || state.phase !== 'action') return state;

      const player = state.players.find(p => p.id === playerId)!;
      const cardIds = new Set(cards.map(c => c.id));
      const remainingHand = player.hand.filter(c => !cardIds.has(c.id));
      
      let newMeldType: Meld['type'] = 'invalid';
      if (isValidMeld(cards)) {
         newMeldType = isSet(cards) ? 'set' : 'run';
      }

      const newMeld: Meld = {
        id: Math.random().toString(36).substr(2, 9),
        type: newMeldType,
        cards: sortMeld(cards.map(c => ({ ...c, faceUp: true })), newMeldType),
        ownerId: playerId,
      };

      const newMelds = [...player.melds, newMeld];
      let isOpened = player.isOpened;
      if (!isOpened) {
        const totalPoints = newMelds.filter(m => m.type !== 'invalid').reduce((sum, m) => sum + calculateMeldValue(m), 0);
        if (totalPoints >= 41) isOpened = true;
      }

      return {
        ...state,
        players: state.players.map(p => p.id === playerId ? { ...p, hand: remainingHand,
            melds: newMelds, isOpened } : p),
      };
    }

    case 'WORKSPACE_REMOVE_CARD': {
      if (state.phase !== 'action') return state;
      const { playerId, meldId, cardId } = action as any;
      if (state.players[state.activePlayerIndex].id !== playerId) return state;

      let updatedPlayers = [...state.players];
      const player = updatedPlayers.find(p => p.id === playerId)!;
      
      const meld = player.melds.find(m => m.id === meldId);
      if (!meld) return state;

      const cardToMove = meld.cards.find(c => c.id === cardId);
      if (!cardToMove) return state;

      const newMeldCards = meld.cards.filter(c => c.id !== cardId);
      const newHand = [...player.hand, cardToMove];

      if (newMeldCards.length === 0) {
        // Remove meld completely
        updatedPlayers = updatedPlayers.map(p => p.id === playerId ? { 
          ...p, hand: newHand, melds: p.melds.filter(m => m.id !== meldId) 
        } : p);
      } else {
        let newMeldType: Meld['type'] = 'invalid';
        if (isValidMeld(newMeldCards)) {
           newMeldType = isSet(newMeldCards) ? 'set' : 'run';
        }
        updatedPlayers = updatedPlayers.map(p => p.id === playerId ? { 
          ...p, hand: newHand, melds: p.melds.map(m => m.id === meldId ? { ...m, type: newMeldType, cards: sortMeld(newMeldCards, newMeldType) } : m) 
        } : p);
      }

      // Re-evaluate isOpened 
      updatedPlayers = updatedPlayers.map(p => {
        if (p.id === playerId) {
          const totalPoints = p.melds.filter(m => m.type !== 'invalid').reduce((sum, m) => sum + calculateMeldValue(m), 0);
          return { ...p, isOpened: totalPoints >= 41 };
        }
        return p;
      });

      return { ...state, players: updatedPlayers };
    }

    case 'ATTACH_TO_MELD': {
      const { playerId, card, meldId } = action;
      if (state.players[state.activePlayerIndex].id !== playerId || state.phase !== 'action') return state;
      
      const player = state.players.find(p => p.id === playerId)!;

      // Find meld (can be player's or opponent's depending on rules, user said "attach to existing meld")
      let meldToUpdate: Meld | undefined;
      let ownerIdToUpdate: PlayerId | undefined;

      for (const p of state.players) {
        const m = p.melds.find(m => m.id === meldId);
        if (m) {
          if (p.id !== playerId && !player.isOpened) return state; // Must be opened to build on opponent melds
          meldToUpdate = m;
          ownerIdToUpdate = p.id;
          break;
        }
      }

      // If attaching to OPPONENT'S meld, require validation. 
      // If attaching to OWN workspace, allow freely.
      if (!meldToUpdate || !ownerIdToUpdate) return state;
      if (ownerIdToUpdate !== playerId && !canAttachToMeld(meldToUpdate, card)) {
        return state;
      }

      let newCards = [...meldToUpdate.cards, { ...card, faceUp: true }];
      
      let newMeldType = meldToUpdate.type;
      if (ownerIdToUpdate === playerId) {
         newMeldType = 'invalid';
         if (isValidMeld(newCards)) {
            newMeldType = isSet(newCards) ? 'set' : 'run';
         }
      }
      
      if (ownerIdToUpdate !== playerId || newMeldType !== 'invalid') {
         newCards = sortMeld(newCards, newMeldType);
      }

      const updatedMeld = {
        ...meldToUpdate,
        type: newMeldType,
        cards: newCards,
      };

      const remainingHand = player.hand.filter(c => c.id !== card.id);

      let updatedPlayers = [...state.players];
      updatedPlayers = updatedPlayers.map(p => p.id === playerId ? { ...p, hand: remainingHand } : p);
      updatedPlayers = updatedPlayers.map(p => p.id === ownerIdToUpdate ? { ...p, melds: p.melds.map(m => m.id === meldId ? updatedMeld : m) } : p);

      if (ownerIdToUpdate === playerId) {
        updatedPlayers = updatedPlayers.map(p => {
          if (p.id === playerId && !p.isOpened) {
            const totalPoints = p.melds.filter(m => m.type !== 'invalid').reduce((sum, m) => sum + calculateMeldValue(m), 0);
            return { ...p, isOpened: totalPoints >= 41 };
          }
          return p;
        });
      }

      return {
        ...state,
        players: updatedPlayers,
      };
    }

    case 'INSTANT_CONQUER_DRAW': {
       const { playerId, comboCardsIds } = action;
       if (state.phase !== 'draw') return state;
       
       const player = state.players.find(p => p.id === playerId);
       if (!player) return state;
       const discardPile = [...state.discardPile];
       const discardCard = discardPile.pop()!;
       discardCard.faceUp = true;
       
       let hand = [...player.hand, discardCard];
       
       const comboCards = hand.filter(c => comboCardsIds.includes(c.id) || c.id === discardCard.id);
       let remainingHand = hand.filter(c => !comboCardsIds.includes(c.id) && c.id !== discardCard.id);
       
       const { melds: newMelds, remainingHand: looseAfterAuto } = findAutoMelds(remainingHand);
       remainingHand = looseAfterAuto;
       
       // Now attach everything loose
       let attachedAny = true;
       const existingTableMelds = state.players.flatMap(p => p.melds).filter(m => m.type !== 'invalid');
       const allAvailableMelds = [
           ...existingTableMelds,
           ...perfectlyPartitionMelds(comboCards)!.map(cards => ({ type: isSet(cards) ? 'set' as const : 'run' as const, cards, id: 'temp-'+Math.random(), ownerId: player.id })),
           ...newMelds.map(cards => ({ type: isSet(cards) ? 'set' as const : 'run' as const, cards, id: 'temp-'+Math.random(), ownerId: player.id }))
       ];
       
       while (attachedAny && remainingHand.length > 0) {
           attachedAny = false;
           for (let i = 0; i < remainingHand.length; i++) {
               const card = remainingHand[i];
               for (const m of allAvailableMelds) {
                  if (isValidMeld([...m.cards, card])) {
                     m.cards = [...m.cards, card];
                     remainingHand.splice(i, 1);
                     attachedAny = true;
                     break;
                  }
               }
               if (attachedAny) break;
           }
       }
       
       // Distribute the new/modified melds back
       const myNewMelds = allAvailableMelds.filter(m => m.ownerId === player.id);
       const oppNewMelds = allAvailableMelds.filter(m => m.ownerId !== player.id);
       
       const updatedPlayers = state.players.map(p => {
           if (p.id === player.id) {
               return { ...p, hand: remainingHand, melds: myNewMelds, isOpened: true };
           }
           return { ...p, melds: oppNewMelds.filter(m => m.ownerId === p.id) };
       });
       
       // Handle conquer: either 1 card remaining (force discard) or 0 (perfect conquer)
       if (remainingHand.length === 1) {
          // It's a discard conquer
          const finalCard = remainingHand[0];
          const finalPlayers = updatedPlayers.map(p => p.id === player.id ? { ...p, hand: [] } : p);
          return {
              ...state,
              discardPile: [...discardPile, { ...finalCard, faceUp: true }],
              players: finalPlayers,
              phase: 'action', // normally conquer but we skip right to win
              winnerId: player.id
          };
       } else {
          // perfect conquer
          return {
              ...state,
              discardPile,
              players: updatedPlayers,
              phase: 'action',
              winnerId: player.id
          };
       }
    }

    case 'ATTACH_BATCH_TO_MELD': {
      const { playerId, cards, meldId } = action;
      if (state.players[state.activePlayerIndex].id !== playerId || state.phase !== 'action') return state;
      
      const player = state.players.find(p => p.id === playerId)!;

      let meldToUpdate: Meld | undefined;
      let ownerIdToUpdate: PlayerId | undefined;

      for (const p of state.players) {
        const m = p.melds.find(m => m.id === meldId);
        if (m) {
          if (p.id !== playerId && !player.isOpened) return state; // Must be opened to build on opponent melds
          meldToUpdate = m;
          ownerIdToUpdate = p.id;
          break;
        }
      }

      if (!meldToUpdate || !ownerIdToUpdate) return state;
      
      let newCards = [...meldToUpdate.cards, ...cards.map(c => ({ ...c, faceUp: true }))];
      
      let newMeldType = meldToUpdate.type;
      // For both own workspace AND opponents, we must validate!
      // But actually, allow own workspace to be temporarily invalid? The user prompt said to attach to a valid meld.
      if (!isValidMeld(newCards)) {
          return state; // If the combination is not a valid meld, reject it to be safe.
      }
      newMeldType = isSet(newCards) ? 'set' : 'run';
      newCards = sortMeld(newCards, newMeldType);

      const updatedMeld: Meld = {
         ...meldToUpdate,
         cards: newCards,
         type: newMeldType
      };

      const cardIdsToRemove = new Set(cards.map(c => c.id));
      let updatedPlayers = state.players.map(p => {
        if (p.id === playerId) {
          return { ...p, hand: p.hand.filter(c => !cardIdsToRemove.has(c.id)) };
        }
        return p;
      });

      updatedPlayers = updatedPlayers.map(p => p.id === ownerIdToUpdate ? { ...p, melds: p.melds.map(m => m.id === meldId ? updatedMeld : m) } : p);

      if (ownerIdToUpdate === playerId) {
        updatedPlayers = updatedPlayers.map(p => {
          if (p.id === playerId && !p.isOpened) {
            const totalPoints = p.melds.filter(m => m.type !== 'invalid').reduce((sum, m) => sum + calculateMeldValue(m), 0);
            return { ...p, isOpened: totalPoints >= 41 };
          }
          return p;
        });
      }

      // Check win manually? Handled externally or by conquer.
      return { ...state, players: updatedPlayers };
    }

    case 'DISCARD': {
      const { playerId, card } = action;
      if (state.players[state.activePlayerIndex].id !== playerId || state.phase !== 'action') return state;

      const player = state.players.find(p => p.id === playerId)!;
      const remainingHand = player.hand.filter(c => c.id !== card.id);
      const discardPile = [...state.discardPile, { ...card, faceUp: true }];

      if (player.isBot && remainingHand.length === 0) {
         return {
            ...state,
            discardPile,
            players: state.players.map(p => p.id === playerId ? { ...p, hand: remainingHand } : p),
            winnerId: playerId,
         };
      }

      let updatedPlayers = state.players.map(p => p.id === playerId ? { ...p, hand: remainingHand, hasPlayedFirstTurn: true } : p);

      let nextPlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
      while (updatedPlayers[nextPlayerIndex].isForfeited && nextPlayerIndex !== state.activePlayerIndex) {
         nextPlayerIndex = (nextPlayerIndex + 1) % state.players.length;
      }
      let nextPhase: GameState['phase'] = state.phase;

      if (state.settings.gameMode === 'pass-and-play') {
          nextPhase = 'pass-device';
      } else {
          nextPhase = 'draw';
      }

      return {
        ...state,
        discardPile,
        players: updatedPlayers,
        activePlayerIndex: nextPlayerIndex,
        phase: nextPhase as any,
        lastDrawnCard: null,
        turnStartTime: Date.now(),
      };
    }

    case 'REORDER_PLAYER_HAND': {
      return {
        ...state,
        players: state.players.map((p, i) => i === state.activePlayerIndex ? { ...p, hand: action.hand } : p),
      };
    }

    case 'CONTINUE_TURN': {
       const { playerId } = action as any;
       if (state.players[state.activePlayerIndex].id !== playerId || state.phase !== 'pass-device') return state;
       return {
          ...state,
          phase: 'draw'
       };
    }

    case 'GROUP_HAND_CARDS': {
      const { playerId, cardIds } = action;
      const player = state.players.find(p => p.id === playerId)!;
      
      const newHand = [...player.hand];
      const firstIndex = newHand.findIndex(c => cardIds.includes(c.id));
      if (firstIndex === -1) return state;

      const groupedCards = newHand.filter(c => cardIds.includes(c.id));
      const remainingCards = newHand.filter(c => !cardIds.includes(c.id));
      
      const groupId = `grp-${Date.now()}`;
      groupedCards.forEach(c => c.groupId = groupId);

      // Spatial Segregation: auto-sort grouped cards to the left
      remainingCards.unshift(...groupedCards);

      return {
        ...state,
        players: state.players.map(p => p.id === playerId ? { ...p, hand: remainingCards } : p),
      };
    }

    case 'UNGROUP_HAND_CARDS': {
      const { playerId, cardIds } = action;
      const player = state.players.find(p => p.id === playerId)!;
      
      const newHand = player.hand.map(c => 
         cardIds.includes(c.id) ? { ...c, groupId: undefined } : c
      );

      return {
        ...state,
        players: state.players.map(p => p.id === playerId ? { ...p, hand: newHand } : p),
      };
    }

    case 'MOVE_CARD_DIRECTION': {
      const { playerId, cardId, direction } = action;
      const player = state.players.find(p => p.id === playerId)!;
      const newHand = [...player.hand];
      const index = newHand.findIndex(c => c.id === cardId);
      
      if (index === -1) return state;
      
      const newIndex = direction === 'left' ? index - 1 : index + 1;
      
      if (newIndex < 0 || newIndex >= newHand.length) return state;
      
      // Swap
      const temp = newHand[index];
      newHand[index] = newHand[newIndex];
      newHand[newIndex] = temp;
      
      return {
        ...state,
        players: state.players.map(p => p.id === playerId ? { ...p, hand: newHand } : p),
      };
    }

    case 'SORT_HAND': {
      const { playerId } = action;
      const player = state.players.find(p => p.id === playerId)!;
      
      // Determine if currently sorted by suit
      let isSortedBySuit = true;
      for (let i = 1; i < player.hand.length; i++) {
        const prev = player.hand[i - 1];
        const curr = player.hand[i];
        if (prev.suit !== curr.suit) {
          if (prev.suit.localeCompare(curr.suit) > 0) {
            isSortedBySuit = false;
            break;
          }
        } else if (prev.rank > curr.rank) {
          isSortedBySuit = false;
          break;
        }
      }

      const sortedHand = [...player.hand].sort((a, b) => {
        if (isSortedBySuit) {
          // Alternative sort: by Rank first, then Suit (groups Sets)
          if (a.rank !== b.rank) return a.rank - b.rank;
          return a.suit.localeCompare(b.suit);
        } else {
          // Default sort: by Suit first, then Rank (groups Runs)
          if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
          return a.rank - b.rank;
        }
      });
      
      return {
        ...state,
        players: state.players.map(p => p.id === playerId ? { ...p, hand: sortedHand } : p),
      };
    }

    case 'AUTO_MELD_HAND': {
      const { playerId, newMelds, remainingHand } = action;
      if (state.players[state.activePlayerIndex].id !== playerId || state.phase !== 'action') return state;

      const player = state.players.find(p => p.id === playerId)!;
      
      const createdMelds: Meld[] = newMelds.map(cards => {
        const type = isSet(cards) ? 'set' : 'run';
        return {
          id: Math.random().toString(36).substr(2, 9),
          type,
          cards: sortMeld(cards.map(c => ({ ...c, faceUp: true })), type),
          ownerId: playerId,
        };
      });

      const updatedMelds = [...player.melds, ...createdMelds];
      let isOpened = player.isOpened;
      if (!isOpened) {
        const totalPoints = updatedMelds.filter(m => m.type !== 'invalid').reduce((sum, m) => sum + calculateMeldValue(m), 0);
        if (totalPoints >= 41) isOpened = true;
      }

      return {
        ...state,
        players: state.players.map(p => p.id === playerId ? { ...p, hand: remainingHand,
            melds: updatedMelds, isOpened } : p),
      };
    }

    case 'CONQUER': {
       const { playerId, finalCard } = action as any;
       const player = state.players.find(p => p.id === playerId);
       if (!player) return state;

       const remainingHand = finalCard ? player.hand.filter(c => c.id !== finalCard.id) : player.hand;
       const discardPile = finalCard ? [...state.discardPile, { ...finalCard, faceUp: true }] : state.discardPile;

       // 2. Winner-takes-all scoring math
       const pointTransfers: { [playerId: string]: { penalty: number, earned: number } } = {};
       const totalWinnerEarned = state.gamePot || 0;
       
       const tempPlayers = state.players.map(p => p.id === playerId ? { ...p, hand: remainingHand } : p);

       let updatedPlayers = tempPlayers.map(p => {
          if (p.id === playerId) {
             pointTransfers[p.id] = { penalty: 0, earned: totalWinnerEarned };
             return { ...p, totalBankroll: p.totalBankroll + totalWinnerEarned };
          }
          
          pointTransfers[p.id] = { penalty: 0, earned: 0 };
          return p;
       });

       return {
          ...state,
          discardPile,
          players: updatedPlayers,
          winnerId: playerId,
          pointTransfers,
          gamePot: 0
       };
    }

    case 'DEBUG_FORCE_WIN_STATE': {
       const { playerId, hand, melds } = action as any;
       let updatedPlayers = state.players.map((p) => {
          if (p.id === playerId) {
             return {
                ...p,
                hand,
                melds
             };
          }
          return p;
       });
       const activeIndex = updatedPlayers.findIndex(p => p.id === playerId);
       return {
          ...state,
          players: updatedPlayers,
          phase: 'action',
          activePlayerIndex: activeIndex >= 0 ? activeIndex : state.activePlayerIndex
       };
    }

    case 'MELD_OPENER_BATCH': {
      const { playerId, melds, discardCard } = action;
      if (state.players[state.activePlayerIndex].id !== playerId || state.phase !== 'draw') return state;
      
      const discardPile = [...state.discardPile];
      if (discardPile.length > 0 && discardPile[discardPile.length - 1].id === discardCard.id) {
         discardPile.pop();
      }

      const player = state.players.find(p => p.id === playerId)!;
      const usedCardIds = new Set(melds.flat().map(c => c.id));
      const remainingHand = player.hand.filter(c => !usedCardIds.has(c.id));
      
      const createdMelds: Meld[] = melds.map(m => {
         const type = isSet(m) ? 'set' : 'run';
         return {
            id: Math.random().toString(36).substr(2, 9),
            type,
            cards: sortMeld(m.map(c => ({ ...c, faceUp: true })), type),
            ownerId: playerId,
         };
      });

      return {
         ...state,
         discardPile,
         phase: 'action',
         players: state.players.map(p => p.id === playerId ? {
            ...p,
            hand: remainingHand,
            melds: [...p.melds, ...createdMelds],
            isOpened: true
         } : p),
      };
    }

    case 'DEBUG_FORCE_HAND': {
      return {
        ...state,
        players: state.players.map((p, i) => i === state.activePlayerIndex ? { ...p, hand: action.hand } : p),
      };
    }

    case 'DEBUG_FORCE_MELDS': {
      return {
         ...state,
         players: state.players.map(p => p.id === action.playerId ? { ...p, melds: action.melds.map(m => ({ cards: m, type: isSet(m) ? 'set' as const : 'run' as const, id: 'debug-'+Math.random(), ownerId: p.id })), isOpened: true } : p)
      };
    }

    case 'DEBUG_FORCE_DISCARD': {
      return {
        ...state,
        discardPile: [...state.discardPile, action.card],
      };
    }

    case 'DEBUG_FORCE_SCORE_TRANSFER': {
      const { playerId } = action as any;
      const pointTransfers: { [playerId: string]: { penalty: number, earned: number } } = {};
      let totalWinnerEarned = state.gamePot || 0;
      
      let updatedPlayers = state.players.map(p => {
         if (p.id === playerId) {
            pointTransfers[p.id] = { penalty: 0, earned: 0 };
            return p;
         }
         
         let penalty = 25; // Fake 25 points
         pointTransfers[p.id] = { penalty, earned: 0 };
         totalWinnerEarned += penalty;
         return { ...p, totalBankroll: p.totalBankroll - penalty };
      });

      pointTransfers[playerId].earned = totalWinnerEarned;
      updatedPlayers = updatedPlayers.map(p => {
         let updatedScore = p.totalBankroll;
         if (p.id === playerId) {
             updatedScore += totalWinnerEarned;
         }
         return { ...p, totalBankroll: updatedScore, isBankrupt: updatedScore <= 0 };
      });

      return {
         ...state,
         players: updatedPlayers,
         winnerId: playerId,
         pointTransfers
      };
    }

    default:
      return state;
  }
}

const findAutoMelds = (hand: Card[]): { melds: Card[][], remainingHand: Card[] } => {
const GAME_STAKES = [2, 5, 10, 25, 50, 100];

export default function App() {
  const [state, dispatchRaw] = useReducer(gameReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [lobbyPlayerCount, setLobbyPlayerCount] = useState<number>(2);
  const [lobbyGameMode, setLobbyGameMode] = useState<'pass-and-play' | 'vs-ai'>('vs-ai');
  const [lobbyStartingPoints, setLobbyStartingPoints] = useState<number>(10);
  const [showInstructions, setShowInstructions] = useState(false);
  const [discardShake, setDiscardShake] = useState(false);
  const [shakeCards, setShakeCards] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [handKey, setHandKey] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<'loose_combo' | 'discard_match' | 'edit_group' | 'conquer' | null>(null);
  const [isFlippingBack, setIsFlippingBack] = useState(false);
  const [locale, setLocale] = useState<Locale>('en');

  // Multi-player / Telegram / Supabase Local State
  const [tgUser, setTgUser] = useState<TelegramProfile | null>(null);
  const [isLobbyLoading, setIsLobbyLoading] = useState(true);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [isInMultiplayerRoom, setIsInMultiplayerRoom] = useState(false);
  const [multiplayerRoom, setMultiplayerRoom] = useState<{ host_id: string | number, players: { id: string | number, name: string, photo_url?: string, seat_index: number }[] } | null>(null);

  const dispatch = useCallback((action: Action) => {
    if (action.type === 'SYNC_STATE') {
      dispatchRaw(action);
      return;
    }

    const nextState = gameReducer(stateRef.current, action);
    dispatchRaw(action);

    if (isInMultiplayerRoom && roomId) {
      let updatePayload: any = { game_state: nextState };
      if (action.type === 'START_GAME') {
        updatePayload.status = 'playing';
      }
      supabase.from('rooms').update(updatePayload).eq('room_id', roomId).catch(console.error);
    }
  }, [isInMultiplayerRoom, roomId, dispatchRaw]);

  useEffect(() => {
    const initAuth = async () => {
      try {
        let extractedUser: { id: number | string; first_name: string; username?: string; photo_url?: string } | null = null;
        
        if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
          extractedUser = window.Telegram.WebApp.initDataUnsafe.user;
          try { window.Telegram.WebApp.ready(); } catch(e){}
        } else {
          extractedUser = { id: 100000001, first_name: 'Dev_Player', username: 'dev_hero' };
        }

        if (extractedUser) {
          const displayName = extractedUser.first_name || 'Player';
          await supabase.from('users').upsert({
            telegram_id: extractedUser.id,
            username: extractedUser.username,
            display_name: displayName,
            photo_url: extractedUser.photo_url
          }, { onConflict: 'telegram_id', ignoreDuplicates: true });

          const { data: existingUser } = await supabase.from('users').select('*').eq('telegram_id', extractedUser.id).single();
          if (existingUser) {
            setTgUser({
              id: existingUser.telegram_id,
              telegram_id: existingUser.telegram_id,
              username: existingUser.username,
              display_name: existingUser.display_name,
              first_name: existingUser.display_name,
              photo_url: existingUser.photo_url,
              bankroll: existingUser.bankroll,
              wins: existingUser.wins,
              losses: existingUser.losses,
              games_played: existingUser.games_played
            });
          }
        }
      } finally {
        setIsLobbyLoading(false);
      }
    };
    initAuth();
  }, []);

  // End match logic (winner execution side-effects)
  const prevWinnerIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.winnerId && state.winnerId !== prevWinnerIdRef.current && tgUser) {
        prevWinnerIdRef.current = state.winnerId;
        
        // Find my player state
        const myPlayerState = state.players.find(p => p.telegramId === tgUser.id.toString() || p.id === tgUser.id.toString());
        if (myPlayerState) {
           const isWinner = myPlayerState.id === state.winnerId;
           const myTransfers = state.pointTransfers?.[myPlayerState.id];
           
           const newBankroll = tgUser.bankroll + (myTransfers?.earned || 0) - (myTransfers?.penalty || 0);
           const newWins = tgUser.wins + (isWinner ? 1 : 0);
           const newLosses = tgUser.losses + (isWinner ? 0 : 1);
           const newGamesPlayed = tgUser.games_played + 1;

           // Update in Supabase
           supabase.from('users').update({ 
               bankroll: newBankroll,
               wins: newWins,
               losses: newLosses,
               games_played: newGamesPlayed
           }).eq('telegram_id', tgUser.id).then(() => {
               // Update local state so lobby reflects it
               setTgUser(prev => prev ? { ...prev, bankroll: newBankroll, wins: newWins, losses: newLosses, games_played: newGamesPlayed } : null);
           });
        }

        // Host closes the room if multiplayer
        if (isInMultiplayerRoom && roomId && multiplayerRoom && tgUser.id.toString() === multiplayerRoom.host_id.toString()) {
            supabase.from('rooms').update({ status: 'finished' }).eq('room_id', roomId).then();
        }
    } else if (!state.winnerId) {
        prevWinnerIdRef.current = null;
    }
  }, [state.winnerId, tgUser, state.players, state.pointTransfers, isInMultiplayerRoom, roomId, multiplayerRoom]);

  const handleCreateMatch = async () => {
    if (!tgUser) return;
    const newRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const { error } = await supabase.from('rooms').insert([{
      room_id: newRoomId,
      host_id: tgUser.id,
      status: 'waiting',
      players: [{ id: tgUser.id, name: tgUser.display_name, photo_url: tgUser.photo_url, seat_index: 0 }]
    }]);
    if (!error) {
      setRoomId(newRoomId);
      setIsInMultiplayerRoom(true);
    }
  };

  const handleJoinMatch = async () => {
    if (!tgUser || !joinRoomId) return;
    const { data: room, error } = await supabase.from('rooms').select('*').eq('room_id', joinRoomId.toUpperCase()).single();
    if (!error && room && room.players.length < 4) {
      const updatedPlayers = [...room.players, { id: tgUser.id, name: tgUser.display_name, photo_url: tgUser.photo_url, seat_index: room.players.length }];
      await supabase.from('rooms').update({ players: updatedPlayers }).eq('room_id', joinRoomId.toUpperCase());
      setRoomId(joinRoomId.toUpperCase());
      setIsInMultiplayerRoom(true);
    }
  };

  useEffect(() => {
    let channel: any;
    let pollInterval: any;

    if (isInMultiplayerRoom && roomId) {
      const fetchRoom = async () => {
        const { data } = await supabase.from('rooms').select('*').eq('room_id', roomId).single();
        if (data) {
           setMultiplayerRoom({ host_id: data.host_id, players: data.players });
           if (data.game_state) {
              dispatchRaw({ type: 'SYNC_STATE', payload: data.game_state as GameState });
           }
        }
      };

      // initial fetch
      fetchRoom();

      // fallback polling every 3 seconds
      pollInterval = setInterval(fetchRoom, 3000);

      channel = supabase.channel(`room:${roomId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `room_id=eq.${roomId}` }, (payload) => {
           if (payload.new.players) {
              setMultiplayerRoom({ host_id: payload.new.host_id, players: payload.new.players });
           }
           if (payload.new.game_state) {
              dispatchRaw({ type: 'SYNC_STATE', payload: payload.new.game_state as GameState });
           }
           if (payload.new.status === 'finished') {
              // we don't handle local state, maybe UI handles it
           }
        })
        .subscribe();
    }
    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [isInMultiplayerRoom, roomId, dispatchRaw]);

  const getText = useCallback((key: LocalizationKey) => {
    return dictionary[locale][key] || key;
  }, [locale]);

  useEffect(() => {
     setActiveSubMenu(null);
  }, [selectedCards, state.phase]);
  const [layoutFriction, setLayoutFriction] = useState(true);
  const [animateAnte, setAnimateAnte] = useState(false);

  const LanguageDropdown = () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <div className="relative z-[9999]" onMouseLeave={() => setIsOpen(false)}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 bg-slate-800/80 backdrop-blur text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700/50 hover:bg-slate-700 hover:text-white transition-colors text-[10px] sm:text-xs font-bold uppercase shadow-lg shadow-black/20"
        >
          <span className="opacity-70 mr-1">LANG:</span> {locale} <span className="opacity-50 text-[8px] ml-1">▼</span>
        </button>
        {isOpen && (
           <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700/50 rounded-lg shadow-xl overflow-hidden flex flex-col min-w-[80px]">
             {(['en', 'am', 'om', 'ti', 'so'] as Locale[]).map(l => (
               <button
                 key={l}
                 onClick={() => { setLocale(l); setIsOpen(false); }}
                 className={`px-4 py-2 text-[10px] sm:text-xs font-bold uppercase transition-colors text-left ${locale === l ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}
               >
                 {l}
               </button>
             ))}
           </div>
        )}
      </div>
    );
  };

  useEffect(() => {
    if (state.hasStarted && !state.winnerId && state.gamePot && state.gamePot > 0) {
      setAnimateAnte(true);
      const timer = setTimeout(() => {
        setAnimateAnte(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [state.hasStarted, state.winnerId, state.gamePot]);
  const [perfectHandData, setPerfectHandData] = useState<{ melds: Card[][], remainingCard: Card } | null>(null);

  const [openerTest, setOpenerTest] = useState<{ melds: Card[][], discardCard: Card } | null>(null);

  useEffect(() => {
    // Scenario A (0 Cards Left Conquering Engine)
    const activePlayer = state.players[state.activePlayerIndex];
    if (state.phase === 'action' && activePlayer.hand.length === 0 && !activePlayer.isBot) {
        if (!state.winnerId) {
            dispatch({ type: 'CONQUER', playerId: activePlayer.id });
            if (navigator.vibrate) {
               navigator.vibrate([200, 100, 200, 100, 400]);
            }
        }
    }
  }, [state.players[state.activePlayerIndex].hand.length, state.phase, state.winnerId, state.activePlayerIndex]);

  useEffect(() => {
    if (state.phase === 'action' && !state.players[state.activePlayerIndex].isBot) {
      const hand = state.players[state.activePlayerIndex].hand;
      if (hand.length === 14) {
        const { melds, remainingHand } = findAutoMelds(hand);
        if (remainingHand.length === 1) {
          setPerfectHandData({ melds, remainingCard: remainingHand[0] });
          return;
        }
      }
    }
    setPerfectHandData(null);
  }, [state.players[state.activePlayerIndex].hand, state.phase, state.activePlayerIndex, state.players]);

  useEffect(() => {
    if (state.phase !== 'draw') {
        setOpenerTest(null);
    }
  }, [state.phase]);

  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    setDiscardShake(true);
    setTimeout(() => {
      setDiscardShake(false);
      setErrorMessage(null);
    }, 2500);
  }, []);

  const handleDiscardPileClick = useCallback(() => {
    const activePlayer = state.players[state.activePlayerIndex];
    if (activePlayer.isBot || state.phase !== 'draw' || (isInMultiplayerRoom && activePlayer.id !== tgUser?.id?.toString())) return;
    if (state.discardPile.length === 0) return;

    const discardCard = state.discardPile[state.discardPile.length - 1];

    if (activePlayer.isOpened) {
      // FREELY DRAW DIRECTLY
      dispatch({ type: 'DRAW_FROM_DISCARD', playerId: activePlayer.id });
      setSelectedCards([]); // clear selection if any
      return;
    }

    if (!activePlayer.isOpened && selectedCards.length > 0) {
      if (selectedCards.length === 1) {
        showError("Brand-new melds require at least 3 cards (Discard + 2 from hand)!");
        return;
      }
      
      const handCards = activePlayer.hand.filter(c => selectedCards.includes(c.id));
      const combinedCards = [...handCards, discardCard];
      
      if (isValidMeld(combinedCards)) {
        const type = isSet(combinedCards) ? 'set' : 'run';
        const fakeMeld: any = { id: '', type, cards: sortMeld(combinedCards, type), ownerId: '' };
        const points = calculateMeldValue(fakeMeld);
        if (points < 41) {
           showError("Need 41+ Points to Open!");
           setDiscardShake(true);
           // Also set the global shake state but we don't have access to setShakeCards inside useCallback if not in dep list? Let's check... wait, it is in scope.
           setShakeCards(selectedCards);
           return;
        }
        dispatch({ type: 'MELD_WITH_DISCARD', playerId: state.players[state.activePlayerIndex].id, handCardIds: selectedCards });
        setSelectedCards([]);
        return;
      } else {
        showError("Selected cards + discard do not form a valid meld!");
        return;
      }
    }

    if (!activePlayer.isOpened && selectedCards.length === 0) {
      const testHand = [...activePlayer.hand, discardCard];
      const opener = findOptimalOpener(testHand, discardCard);
      
      if (!opener) {
        showError("Discard card does not complete a 41+ point meld!");
        return;
      }
      
      setOpenerTest({ melds: opener, discardCard });
      const openerCardIds = opener.flatMap(m => m.map(c => c.id));
      setSelectedCards(openerCardIds);
      return;
    } else if (!activePlayer.isOpened) {
      showError("Must lay down an initial hand meld of 41+ points to unlock the discard pile!");
      return;
    }

    if (selectedCards.length > 0) {
      if (selectedCards.length === 1) {
        showError("Brand-new melds require at least 3 cards (Discard + 2 from hand)!");
        return;
      }
      
      const activePlayer = state.players[state.activePlayerIndex];
      const handCards = activePlayer.hand.filter(c => selectedCards.includes(c.id));
      const potentialMeldCards = [...handCards, discardCard];
      
      if (isValidMeld(potentialMeldCards)) {
        dispatch({ type: 'MELD_WITH_DISCARD', playerId: state.players[state.activePlayerIndex].id, handCardIds: selectedCards });
        setSelectedCards([]);
      } else {
        showError("Selected cards + discard do not form a valid meld!");
      }
    } else {
      const allMelds = state.players.flatMap(p => p.melds);
      const validMeldsToAttach = allMelds.filter(m => canAttachToMeld(m, discardCard));
      
      if (validMeldsToAttach.length === 1) {
        dispatch({ type: 'ATTACH_DISCARD_TO_MELD', playerId: state.players[state.activePlayerIndex].id, meldId: validMeldsToAttach[0].id });
      } else if (validMeldsToAttach.length > 1) {
        showError("Ambiguous: Discard can attach to multiple melds. Select some cards first to form a new meld, or we need an explicit meld target feature.");
      } else {
        showError("Cannot pick up discard unless immediately melded or attached!");
      }
    }
  }, [state, selectedCards, showError]);

  // Initialize game
  useEffect(() => {
    // dispatch({ type: 'START_GAME' });
  }, []);

  // CPU Turn Logic
  useEffect(() => {
    if (state.hasStarted && state.players[state.activePlayerIndex].isBot && !state.winnerId) {
      const cpuThink = async () => {
        await new Promise(r => setTimeout(r, 1000));

        // 1. Draw
        if (state.phase === 'draw') {
          const cpu = state.players[state.activePlayerIndex];
          if (cpu.isOpened && state.discardPile.length > 0) {
             const discardCard = state.discardPile[state.discardPile.length - 1];
             const { melds: meldsWithout } = findAutoMelds(cpu.hand);
             const { melds: meldsWith } = findAutoMelds([...cpu.hand, discardCard]);
             const allMelds = state.players.flatMap(p => p.melds);
             
             if (meldsWith.length > meldsWithout.length || 
                 meldsWith.flat().length > meldsWithout.flat().length || 
                 allMelds.some(m => canAttachToMeld(m, discardCard))) {
                dispatch({ type: 'DRAW_FROM_DISCARD', playerId: cpu.id });
                return;
             }
          }
          // Simple AI: always draw from deck for now unless discard is very good
          dispatch({ type: 'DRAW_FROM_DECK', playerId: state.players[state.activePlayerIndex].id });
        }
      };
      
      if (state.phase === 'draw') cpuThink();
    }
  }, [state.activePlayerIndex, state.phase, state.winnerId, state.hasStarted]);

  useEffect(() => {
    if (state.hasStarted && state.players[state.activePlayerIndex].isBot && state.phase === 'action' && !state.winnerId) {
      const cpuAction = async () => {
        await new Promise(r => setTimeout(r, 800));
        
        // 2. Try to Melding/Action?
        // For now, simpler CPU: just discard immediately to keep it fast
        // (Advanced AI would look for runs/sets here)
        const cpu = state.players[state.activePlayerIndex];
        if (cpu.hand.length > 0) {
          const cardToDiscard = cpu.hand[0];
          dispatch({ type: 'DISCARD', playerId: state.players[state.activePlayerIndex].id, card: cardToDiscard });
        }
      };
      cpuAction();
    }
  }, [state.activePlayerIndex, state.phase]);

  const toggleCardSelection = (cardId: string) => {
    if (state.players[state.activePlayerIndex].isBot || state.phase !== "action" || (isInMultiplayerRoom && state.players[state.activePlayerIndex].id !== tgUser?.id?.toString())) return;
    
    const activeHand = state.players[state.activePlayerIndex].hand;
    const clickedCard = activeHand.find(c => c.id === cardId);
    let idsToToggle = [cardId];

    if (clickedCard?.groupId) {
      idsToToggle = activeHand.filter(c => c.groupId === clickedCard.groupId).map(c => c.id);
    }

    setSelectedCards(prev => {
      const isSelected = prev.includes(idsToToggle[0]);
      if (isSelected) {
        return prev.filter(id => !idsToToggle.includes(id));
      } else {
        return [...prev, ...idsToToggle];
      }
    });
  };

  const handleDiscard = (card: Card) => {
    if (!state.players[state.activePlayerIndex].isBot && state.phase === 'action') {
      setIsFlippingBack(true);
      setTimeout(() => {
        dispatch({ type: 'DISCARD', playerId: state.players[state.activePlayerIndex].id, card });
        setIsFlippingBack(false);
        setSelectedCards([]);
      }, 300);
    }
  };

  const handleAttach = (card: Card, meldId: string) => {
    if (!state.players[state.activePlayerIndex].isBot && state.phase === 'action') {
      dispatch({ type: 'ATTACH_TO_MELD', playerId: state.players[state.activePlayerIndex].id, card, meldId });
      setSelectedCards([]);
    }
  };

  const activePlayer = state.players[state.activePlayerIndex];
  const selectedHandCards = activePlayer.hand.filter(c => selectedCards.includes(c.id));
  
  const partitions = selectedHandCards.length >= 3 ? perfectlyPartitionMelds(selectedHandCards) : null;
  const isValidSelectionAlone = partitions !== null && partitions.length > 0;
  
  const selectionPoints = isValidSelectionAlone ? 
     partitions.reduce((total, p) => total + calculateMeldValue({ type: isSet(p) ? 'set' : 'run', cards: p } as any), 0) 
     : 0;

  const topDiscardCard = state.discardPile.length > 0 ? state.discardPile[state.discardPile.length - 1] : null;

  const comboPartitions = (state.phase === 'draw' && topDiscardCard && selectedHandCards.length >= 2) ? perfectlyPartitionMelds([...selectedHandCards, topDiscardCard]) : null;
  const isComboValid = comboPartitions !== null && comboPartitions.length > 0 && comboPartitions.some(m => m.some(c => c.id === topDiscardCard.id));

  const comboPoints = isComboValid ? 
     comboPartitions.reduce((total, p) => total + calculateMeldValue({ type: isSet(p) ? 'set' : 'run', cards: p } as any), 0)
     : 0;

  const allSelectedHaveGroupId = selectedHandCards.length > 0 && selectedHandCards.every(c => c.groupId) && new Set(selectedHandCards.map(c => c.groupId)).size === 1;
  const someSelectedNotGrouped = selectedHandCards.length > 0 && selectedHandCards.some(c => !c.groupId);

  const validMeldsToAttachTo = state.phase === 'action' && activePlayer.isOpened && selectedHandCards.length > 0 
    ? state.players.flatMap(p => p.melds).filter(m => isValidMeld([...m.cards, ...selectedHandCards]) && m.type !== 'invalid')
    : [];

  let predictiveConquerState: { valid: boolean; attachComboIds: string[] } | null = null;
  if (state.phase === 'draw' && isComboValid && topDiscardCard && comboPartitions) {
      const comboCardsIds = new Set(comboPartitions.flat().map(c => c.id));
      let remainingHand = activePlayer.hand.filter(c => !comboCardsIds.has(c.id));
      
      const { melds: newMelds, remainingHand: looseAfterAuto } = findAutoMelds(remainingHand);
      remainingHand = looseAfterAuto;
      
      const existingTableMelds = state.players.flatMap(p => p.melds).filter(m => m.type !== 'invalid');
      const allAvailableMelds = [
         ...existingTableMelds,
         ...comboPartitions.map(cards => ({ type: isSet(cards) ? 'set' as const : 'run' as const, cards, id: 'temp-'+Math.random(), ownerId: activePlayer.id })),
         ...newMelds.map(cards => ({ type: isSet(cards) ? 'set' as const : 'run' as const, cards, id: 'temp-'+Math.random(), ownerId: activePlayer.id }))
      ];
      
      let attachedAny = true;
      const looseCardsMap = [...remainingHand];
      while (attachedAny && looseCardsMap.length > 0) {
         attachedAny = false;
         for (let i = 0; i < looseCardsMap.length; i++) {
             const card = looseCardsMap[i];
             for (const m of allAvailableMelds) {
                if (isValidMeld([...m.cards, card])) {
                   m.cards = [...m.cards, card];
                   looseCardsMap.splice(i, 1);
                   attachedAny = true;
                   break;
                }
             }
             if (attachedAny) break;
         }
      }
      
      if (looseCardsMap.length === 0 || looseCardsMap.length === 1) {
         predictiveConquerState = { valid: true, attachComboIds: Array.from(comboCardsIds) };
      }
  }

  const showGroupCards = isValidSelectionAlone && someSelectedNotGrouped;
  const showUngroup = allSelectedHaveGroupId;
  const showOpen41 = !activePlayer.isOpened && state.phase === 'action' && isValidSelectionAlone && selectionPoints >= 41;
  const showPlayMeld = activePlayer.isOpened && state.phase === 'action' && isValidSelectionAlone;
  const showAttachMeld = activePlayer.isOpened && state.phase === 'action' && validMeldsToAttachTo.length > 0;
  
  const showPredictiveConquer = predictiveConquerState !== null;
  const showDiscardDrawHighlight = !activePlayer.isOpened && state.phase === 'draw' && isComboValid && !showPredictiveConquer;

  const showContextualBar = !activePlayer.isBot && selectedHandCards.length > 0 && (showGroupCards || showUngroup || showOpen41 || showPlayMeld || showAttachMeld || showPredictiveConquer);

  const displayHand = useMemo(() => {
    const items: { id: string; type: 'single' | 'group'; cards: Card[] }[] = [];
    let currentGroup: Card[] = [];
    let currentGroupId: string | undefined = undefined;
    
    for (const card of activePlayer.hand) {
      if (card.groupId) {
        if (currentGroupId === card.groupId) {
          currentGroup.push(card);
        } else {
          if (currentGroup.length > 0) items.push({ id: currentGroupId || `fake-${Date.now()}`, type: 'group', cards: currentGroup });
          currentGroupId = card.groupId;
          currentGroup = [card];
        }
      } else {
        if (currentGroup.length > 0) {
          items.push({ id: currentGroupId || `fake-${Date.now()}`, type: 'group', cards: currentGroup });
          currentGroup = [];
          currentGroupId = undefined;
        }
        items.push({ id: card.id, type: 'single', cards: [card] });
      }
    }
    if (currentGroup.length > 0) items.push({ id: currentGroupId || `fake-${Date.now()}`, type: 'group', cards: currentGroup });
    return items;
  }, [activePlayer.hand]);

  const handleGroupTogether = () => {
    dispatch({ type: 'GROUP_HAND_CARDS', playerId: activePlayer.id, cardIds: selectedCards });
    setSelectedCards([]);
  };

  const handleUngroup = () => {
    dispatch({ type: 'UNGROUP_HAND_CARDS', playerId: activePlayer.id, cardIds: selectedCards });
    setSelectedCards([]);
  };

  const handleOpenPurely = () => {
    if (!partitions) return;
    dispatch({ 
        type: 'AUTO_MELD_HAND', 
        playerId: activePlayer.id, 
        newMelds: partitions, 
        remainingHand: activePlayer.hand.filter(c => !selectedCards.includes(c.id))
    });
    setSelectedCards([]);
  };

  const handlePlayMeld = () => {
    if (!partitions) return;
    dispatch({ 
        type: 'AUTO_MELD_HAND', 
        playerId: activePlayer.id, 
        newMelds: partitions, 
        remainingHand: activePlayer.hand.filter(c => !selectedCards.includes(c.id))
    });
    setSelectedCards([]);
  };

  const handleDrawCombo = () => {
    dispatch({ type: 'MELD_WITH_DISCARD', playerId: state.players[state.activePlayerIndex].id, handCardIds: selectedCards });
    setSelectedCards([]);
  };

  const handleAttachMeld = (targetMeldId: string) => {
    dispatch({ type: 'ATTACH_BATCH_TO_MELD', playerId: activePlayer.id, cards: selectedHandCards, meldId: targetMeldId });
    setSelectedCards([]);
  };

  const handleConquer = () => {
    const player = state.players[state.activePlayerIndex];
    if (player.hand.length !== 1) {
      showError("Cannot finish! You must have exactly 1 card to discard.");
      return;
    }
    if (player.melds.length === 0 || player.melds.some(m => m.type === 'invalid')) {
      showError("Cannot finish! You have incomplete or invalid melds.");
      return;
    }
    
    setIsFlippingBack(true);
    setTimeout(() => {
      const finalCard = player.hand[0];
      dispatch({ type: 'CONQUER', playerId: player.id, finalCard: finalCard });
      setIsFlippingBack(false);
      
      // Trigger celebration (haptics if possible)
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 400]);
      }
    }, 300);
  };

  
  

  const [testCycle, setTestCycle] = useState(0);
  const [debugLabel, setDebugLabel] = useState("[DEBUG: Force Meld]");
  const [isDevNavOpen, setIsDevNavOpen] = useState(false);
  const [turnElapsed, setTurnElapsed] = useState(0);
  const [showWarningToast, setShowWarningToast] = useState(false);

  useEffect(() => {
    if (state.hasStarted && !state.winnerId && state.phase !== 'pass-device') {
      const activePlayer = state.players[state.activePlayerIndex];
      // Note: Only apply timer logic to Human players as requested 
      if (activePlayer.isBot || activePlayer.isForfeited || activePlayer.isBankrupt || !state.turnStartTime) {
        setTurnElapsed(0);
        setShowWarningToast(false);
        return;
      }

      const tick = setInterval(() => {
        if (!state.turnStartTime) return;
        const elapsed = Math.floor((Date.now() - state.turnStartTime) / 1000);
        setTurnElapsed(elapsed);
        
        const isFirstTurn = !activePlayer.hasPlayedFirstTurn;
        const forfeitThreshold = isFirstTurn ? 138 : 55;
        const warningThreshold = isFirstTurn ? 108 : 30;
        
        if (elapsed >= forfeitThreshold) {
           dispatch({ type: 'FORFEIT_ACTIVE_PLAYER' } as any);
           setShowWarningToast(false);
        } else if (elapsed >= warningThreshold) {
           setShowWarningToast(true);
        } else {
           setShowWarningToast(false);
        }
      }, 1000);
      return () => clearInterval(tick);
    }
  }, [state.hasStarted, state.winnerId, state.phase, state.turnStartTime, state.activePlayerIndex, state.players]);

  const triggerManualMeldWinTest = () => {
    const testHand: Card[] = [
      // Set 1 (4 cards)
      { id: 'm-1', suit: 'spades', rank: 4, faceUp: true },
      { id: 'm-2', suit: 'hearts', rank: 4, faceUp: true },
      { id: 'm-3', suit: 'diamonds', rank: 4, faceUp: true },
      { id: 'm-4', suit: 'clubs', rank: 4, faceUp: true },
      // Set 2 (3 cards)
      { id: 'm-5', suit: 'spades', rank: 9, faceUp: true },
      { id: 'm-6', suit: 'hearts', rank: 9, faceUp: true },
      { id: 'm-7', suit: 'diamonds', rank: 9, faceUp: true },
      // Run 1 (3 cards)
      { id: 'm-8', suit: 'clubs', rank: 11, faceUp: true },
      { id: 'm-9', suit: 'clubs', rank: 12, faceUp: true },
      { id: 'm-10', suit: 'clubs', rank: 13, faceUp: true },
      // Run 2 (3 cards)
      { id: 'm-11', suit: 'hearts', rank: 1, faceUp: true },
      { id: 'm-12', suit: 'hearts', rank: 2, faceUp: true },
      { id: 'm-13', suit: 'hearts', rank: 3, faceUp: true },
      // Discard card
      { id: 'm-14', suit: 'diamonds', rank: 5, faceUp: true }
    ];
    dispatch({ 
      type: 'DEBUG_FORCE_WIN_STATE', 
      playerId: state.players[0].id,
      hand: testHand,
      melds: []
    });
  };

  const triggerDiscardComboTest = () => {
    const testHand: Card[] = [
      { id: 'dc-1', suit: 'spades', rank: 13, faceUp: true },
      { id: 'dc-2', suit: 'hearts', rank: 13, faceUp: true },
    ];
    dispatch({ type: 'DEBUG_FORCE_HAND', hand: testHand });
    
    // Force a 3rd King onto discard pile
    dispatch({ 
        type: 'DEBUG_FORCE_DISCARD', 
        card: { id: 'dc-d', suit: 'diamonds', rank: 13, faceUp: true } 
    });
  };

  const triggerOpenerTest = () => {
    const testHand: Card[] = [
      { id: 'op-1', suit: 'spades', rank: 9, faceUp: true }, // 9 of Spades
      { id: 'op-2', suit: 'spades', rank: 10, faceUp: true }, // 10 of Spades
      
      { id: 'op-3', suit: 'clubs', rank: 7, faceUp: true },  // 7 of Clubs
      { id: 'op-4', suit: 'diamonds', rank: 7, faceUp: true }, // 7 of Diamonds
      { id: 'op-5', suit: 'hearts', rank: 7, faceUp: true },   // 7 of Hearts
    ];
    dispatch({ type: 'DEBUG_FORCE_HAND', hand: testHand });
    
    // Force Jack of Spades to discard pile
    dispatch({ 
        type: 'DEBUG_FORCE_DISCARD', 
        card: { id: 'op-discard', suit: 'spades', rank: 11, faceUp: true } 
    });
    
    setSelectedCards([]);
  };

  const triggerJokerTest = (testType: 'run' | 'set' | 'double-run') => {
    let testHand: Card[] = [];
    if (testType === 'run') {
       testHand = [
         { id: 'j-run-1', suit: 'hearts', rank: 7, faceUp: true },
         { id: 'j-run-2', suit: 'none', rank: 0, faceUp: true },
         { id: 'j-run-3', suit: 'hearts', rank: 9, faceUp: true },
       ];
    } else if (testType === 'set') {
       testHand = [
         { id: 'j-set-1', suit: 'diamonds', rank: 11, faceUp: true },
         { id: 'j-set-2', suit: 'spades', rank: 11, faceUp: true },
         { id: 'j-set-3', suit: 'none', rank: 0, faceUp: true },
       ];
    } else if (testType === 'double-run') {
       testHand = [
         { id: 'j-dbl-1', suit: 'clubs', rank: 3, faceUp: true },
         { id: 'j-dbl-2', suit: 'none', rank: 0, faceUp: true },
         { id: 'j-dbl-3', suit: 'none', rank: 0, faceUp: true },
         { id: 'j-dbl-4', suit: 'clubs', rank: 6, faceUp: true },
       ];
    }
    dispatch({ type: 'DEBUG_FORCE_HAND', hand: testHand });
    setSelectedCards(testHand.map(c => c.id));
  };

  const triggerStressTestHand = () => {
    const testHand: Card[] = [];
    const suits: ('spades' | 'hearts' | 'diamonds' | 'clubs')[] = ['spades', 'hearts', 'diamonds', 'clubs'];
    const groups = ['g1', 'g2', 'g3', 'g4'];
    let id = 1;
    // 4 groups of 3 cards
    groups.forEach((g, idx) => {
      for(let i=0; i<3; i++) {
        testHand.push({ id: `stress-${id++}`, suit: suits[idx], rank: (id%13)+1, faceUp: true, groupId: g });
      }
    });
    // 2 loose cards
    testHand.push({ id: `stress-${id++}`, suit: 'spades', rank: 1, faceUp: true });
    testHand.push({ id: `stress-${id++}`, suit: 'hearts', rank: 2, faceUp: true });
    dispatch({ type: 'DEBUG_FORCE_HAND', hand: testHand });
    setSelectedCards([]);
  };
  const triggerInstantWinTest = () => {
    const activePlayerId = state.players[state.activePlayerIndex].id;
    const testHand: Card[] = [
      { id: 'w-discard', suit: 'spades', rank: 13, faceUp: true },
    ];
    const testMelds: Meld[] = [
      {
        id: 'w-meld1',
        type: 'run',
        ownerId: activePlayerId,
        cards: [
          { id: 'w-1', suit: 'hearts', rank: 4, faceUp: true },
          { id: 'w-2', suit: 'hearts', rank: 5, faceUp: true },
          { id: 'w-3', suit: 'hearts', rank: 6, faceUp: true },
        ]
      },
      {
        id: 'w-meld2',
        type: 'set',
        ownerId: activePlayerId,
        cards: [
          { id: 'w-4', suit: 'clubs', rank: 9, faceUp: true },
          { id: 'w-5', suit: 'spades', rank: 9, faceUp: true },
          { id: 'w-6', suit: 'diamonds', rank: 9, faceUp: true },
        ]
      }
    ];

    dispatch({
      type: 'DEBUG_FORCE_WIN_STATE',
      playerId: activePlayerId,
      hand: testHand,
      melds: testMelds
    });
  };

  const triggerCPUDrawTest = () => {
     dispatch({ type: 'DEBUG_FORCE_CPU_DRAW_TEST' } as any);
  };

  const handlePerfectMeldClick = (cardId: string) => {
    if (perfectHandData) {
       dispatch({ 
           type: 'AUTO_MELD_HAND', 
           playerId: state.players[state.activePlayerIndex].id, 
           newMelds: perfectHandData.melds, 
           remainingHand: [perfectHandData.remainingCard] 
       });
       setPerfectHandData(null);
       setSelectedCards([]);
    }
  };

  const triggerAutoElevateTest = () => {
    // 13 perfect meld cards + 1 mismatch card
    const testHand: Card[] = [
      { id: 'el-1', suit: 'hearts', rank: 3, faceUp: true },
      { id: 'el-2', suit: 'hearts', rank: 4, faceUp: true },
      { id: 'el-3', suit: 'hearts', rank: 5, faceUp: true },
      { id: 'el-4', suit: 'hearts', rank: 6, faceUp: true },
      
      { id: 'el-5', suit: 'clubs', rank: 11, faceUp: true },
      { id: 'el-6', suit: 'clubs', rank: 12, faceUp: true },
      { id: 'el-7', suit: 'clubs', rank: 13, faceUp: true },
      
      { id: 'el-8', suit: 'spades', rank: 7, faceUp: true },
      { id: 'el-9', suit: 'hearts', rank: 7, faceUp: true },
      { id: 'el-10', suit: 'diamonds', rank: 7, faceUp: true },
      
      { id: 'el-11', suit: 'spades', rank: 9, faceUp: true },
      { id: 'el-12', suit: 'hearts', rank: 9, faceUp: true },
      { id: 'el-13', suit: 'clubs', rank: 9, faceUp: true },
      
      // 1 loose card (makes 14)
      { id: 'el-14', suit: 'diamonds', rank: 2, faceUp: true },
    ];
    dispatch({ type: 'DEBUG_FORCE_HAND', hand: testHand });
    // Make sure we are in action phase for testing
  };

  const triggerFreeDiscardDrawTest = () => {
    dispatch({ type: 'DEBUG_FORCE_OPENED_AND_DRAW_PHASE', playerId: state.players[0].id } as any);
  };

  const triggerDebugResetMacro = () => {
    const testHand: Card[] = [
      // Group 1
      { id: 't1-1', suit: 'hearts', rank: 5, faceUp: true, groupId: 'g1' },
      { id: 't1-2', suit: 'hearts', rank: 6, faceUp: true, groupId: 'g1' },
      { id: 't1-3', suit: 'hearts', rank: 7, faceUp: true, groupId: 'g1' },
      // Group 2
      { id: 't2-1', suit: 'spades', rank: 10, faceUp: true, groupId: 'g2' },
      { id: 't2-2', suit: 'spades', rank: 11, faceUp: true, groupId: 'g2' },
      { id: 't2-3', suit: 'spades', rank: 12, faceUp: true, groupId: 'g2' },
      // Group 3
      { id: 't3-1', suit: 'diamonds', rank: 1, faceUp: true, groupId: 'g3' },
      { id: 't3-2', suit: 'diamonds', rank: 2, faceUp: true, groupId: 'g3' },
      { id: 't3-3', suit: 'diamonds', rank: 3, faceUp: true, groupId: 'g3' },
      // Loose cards
      { id: 't4-1', suit: 'clubs', rank: 5, faceUp: true },
      { id: 't4-2', suit: 'clubs', rank: 9, faceUp: true },
    ];
    dispatch({ type: 'DEBUG_FORCE_HAND', hand: testHand });
    setSelectedCards([]);
    setErrorMessage(null);
    setShakeCards([]);
    setDebugLabel("[DEBUG: Reset & Inject Test Hand]");
    setTimeout(() => {
      setDebugLabel("[DEBUG: Force Meld]");
    }, 2000);
  };

  const triggerDiscardMatchStateTest = () => {
    // 1. Force state phase to Draw
    dispatch({ type: 'DEBUG_FORCE_OPENED_AND_DRAW_PHASE', playerId: state.players[0].id } as any);
    // 2. Set hand to a 2 missing a 3rd
    const testHand: Card[] = [
      { id: 'dmatch-1', suit: 'hearts', rank: 8, faceUp: true },
      { id: 'dmatch-2', suit: 'hearts', rank: 9, faceUp: true },
    ];
    dispatch({ type: 'DEBUG_FORCE_HAND', hand: testHand });
    
    // 3. Force discard top card to the matching 3rd
    dispatch({ type: 'DEBUG_FORCE_DISCARD', card: { id: 'dmatch-target', suit: 'hearts', rank: 10, faceUp: true } });
    
    // 4. Select the cards
    setSelectedCards(['dmatch-1', 'dmatch-2']);
    setDebugLabel("[DEBUG: Discard Match State]");
    setTimeout(() => setDebugLabel("[DEBUG: Force Meld]"), 2000);
  };

  const triggerPredictiveWinTest = () => {
    dispatch({ type: 'DEBUG_FORCE_OPENED_AND_DRAW_PHASE', playerId: state.players[0].id } as any);
    
    // 5,6,7 of Spades on table
    dispatch({ type: 'DEBUG_FORCE_MELDS', playerId: state.players[0].id, melds: [
        [
          { id: 'm-s-5', suit: 'spades', rank: 5, faceUp: true },
          { id: 'm-s-6', suit: 'spades', rank: 6, faceUp: true },
          { id: 'm-s-7', suit: 'spades', rank: 7, faceUp: true }
        ]
    ] });

    // Hand: 8 of Spades, Pair of Jacks
    const testHand: Card[] = [
      { id: 'h-8-s', suit: 'spades', rank: 8, faceUp: true },
      { id: 'j-1', suit: 'hearts', rank: 11, faceUp: true },
      { id: 'j-2', suit: 'diamonds', rank: 11, faceUp: true },
    ];
    dispatch({ type: 'DEBUG_FORCE_HAND', hand: testHand });
    
    // Discard top: Jack
    dispatch({ type: 'DEBUG_FORCE_DISCARD', card: { id: 'j-3', suit: 'clubs', rank: 11, faceUp: true } });
    
    setSelectedCards(['j-1', 'j-2']);
    setDebugLabel("[DEBUG: Force Predictive Win Setup]");
    setTimeout(() => setDebugLabel("[DEBUG: Force Meld]"), 2000);
  };

  const startLanguageCycle = () => {
     let idx = 0;
     const locales: Locale[] = ['en', 'am', 'om', 'ti', 'so'];
     setInterval(() => {
        setLocale(locales[idx]);
        idx = (idx + 1) % locales.length;
     }, 1500);
  };

  const triggerMeldTestGimmick = () => {
    let testHand: Card[] = [];
    let stateLabel = "";

    switch (testCycle % 4) {
      case 0:
        stateLabel = "[DEBUG: State 0 - Joker Test]";
        testHand = [
          { id: 't0-1', suit: 'clubs', rank: 4, faceUp: true },
          { id: 't0-2', suit: 'none', rank: 0, faceUp: true },
          { id: 't0-3', suit: 'clubs', rank: 6, faceUp: true },
          { id: 't0-4', suit: 'diamonds', rank: 8, faceUp: true },
          { id: 't0-5', suit: 'diamonds', rank: 9, faceUp: true },
        ];
        break;
      case 1:
        stateLabel = "[DEBUG: State 1 - Discard Test]";
        testHand = [
          { id: 't1-1', suit: 'spades', rank: 11, faceUp: true },
          { id: 't1-2', suit: 'hearts', rank: 11, faceUp: true },
          { id: 't1-3', suit: 'clubs', rank: 2, faceUp: true },
          { id: 't1-4', suit: 'diamonds', rank: 4, faceUp: true },
          { id: 't1-5', suit: 'spades', rank: 7, faceUp: true },
        ];
        dispatch({ type: 'DEBUG_FORCE_DISCARD', card: { id: 't1-discard', suit: 'diamonds', rank: 11, faceUp: true } });
        break;
      case 2:
        stateLabel = "[DEBUG: State 2 - Ace Test]";
        testHand = [
          { id: 't2-1', suit: 'hearts', rank: 1, faceUp: true },
          { id: 't2-2', suit: 'hearts', rank: 2, faceUp: true },
          { id: 't2-3', suit: 'hearts', rank: 3, faceUp: true },
          { id: 't2-4', suit: 'spades', rank: 12, faceUp: true },
          { id: 't2-5', suit: 'spades', rank: 13, faceUp: true },
          { id: 't2-6', suit: 'spades', rank: 1, faceUp: true },
        ];
        break;
      case 3:
        stateLabel = "[DEBUG: State 3 - Layout Test]";
        testHand = Array.from({ length: 14 }).map((_, i) => {
          const ranks: Rank[] = [1,2,3,4,5,6,7,8,9,10,11,12,13];
          const suits: Suit[] = ['hearts','diamonds','clubs','spades'];
          return {
            id: `t3-${i}`,
            suit: suits[Math.floor(Math.random() * suits.length)],
            rank: ranks[Math.floor(Math.random() * ranks.length)],
            faceUp: true,
          };
        });
        break;
    }

    dispatch({ type: 'DEBUG_FORCE_HAND', hand: testHand });
    
    setDebugLabel(stateLabel);
    setTimeout(() => {
      setDebugLabel("[DEBUG: Force Meld]");
    }, 2000);

    setTimeout(() => {
      if (testCycle % 4 === 0) {
        setSelectedCards(['t0-1', 't0-2', 't0-3']);
      } else if (testCycle % 4 === 1) {
        setSelectedCards(['t1-1', 't1-2']);
      } else if (testCycle % 4 === 2) {
        setSelectedCards(['t2-1', 't2-2', 't2-3', 't2-4', 't2-5', 't2-6']);
      } else if (testCycle % 4 === 3) {
        setSelectedCards(testHand.map(c => c.id).slice(0, 3));
      }
    }, 50);

    setTestCycle(t => t + 1);
  };

  const canConquer = activePlayer && 
    activePlayer.hand.length === 1 && 
    activePlayer.melds.length > 0 && 
    activePlayer.melds.every(m => m.type !== 'invalid');

  if (!state.hasStarted) {
    return (
      <div className="min-h-[100dvh] felt-bg flex flex-col items-center justify-center font-sans text-white relative p-4">
        {/* Decorative Background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-emerald-500/10 blur-3xl rounded-full" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-500/10 blur-3xl rounded-full" />
        </div>

        <div className="absolute top-4 right-4 sm:top-8 sm:right-8 z-50">
           <LanguageDropdown />
        </div>
        
        <div className="glass-panel p-8 rounded-3xl max-w-md w-full relative z-10 card-shadow border-white/10 mt-8">
          <div className="text-center mb-8">
            <h1 className="text-4xl sm:text-5xl font-black tracking-tighter neon-glow font-display mb-2">KONKUR</h1>
            <p className="text-sm text-emerald-400 font-mono tracking-widest uppercase">{getText("ethiopianRummy")}</p>
          </div>

          {isLobbyLoading ? (
            <div className="text-center text-slate-400 py-8 animate-pulse text-xs font-mono uppercase tracking-widest border border-slate-800 rounded-2xl bg-slate-900/50">
               Authenticating with Telegram...
            </div>
          ) : isInMultiplayerRoom ? (
            <div className="text-center py-8 bg-slate-900/50 rounded-2xl border border-emerald-500/20 px-4">
               <h2 className="text-3xl font-black mb-1 text-white font-mono tracking-widest drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">{roomId}</h2>
               <p className="text-emerald-400 text-[10px] font-mono uppercase tracking-widest animate-pulse mb-6">Match Code</p>
               
               <div className="space-y-2 mb-8">
                 {multiplayerRoom?.players.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3 bg-slate-800/80 p-3 rounded-xl border border-white/5">
                      {p.photo_url ? (
                         <img src={p.photo_url} alt={p.name} className="w-8 h-8 rounded-full border border-emerald-500/30 object-cover" />
                      ) : (
                         <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm border border-emerald-500/30">
                            {p.name.charAt(0).toUpperCase()}
                         </div>
                      )}
                      <div className="text-sm font-bold text-slate-200">
                         {p.name} {p.id.toString() === multiplayerRoom.host_id?.toString() && <span className="text-amber-400 ml-1 text-xs px-1 border border-amber-500/30 rounded">HOST</span>}
                      </div>
                    </div>
                 ))}
                 {(multiplayerRoom?.players.length ?? 0) < 4 && (
                    <div className="flex items-center justify-center gap-3 bg-slate-800/30 p-3 rounded-xl border border-dashed border-slate-600/50 text-slate-500 text-xs font-mono uppercase">
                      Waiting for players... ({multiplayerRoom?.players.length ?? 0}/4)
                    </div>
                 )}
               </div>

               {tgUser?.id?.toString() === multiplayerRoom?.host_id?.toString() ? (
                 <button 
                    disabled={(multiplayerRoom?.players.length ?? 0) < 2}
                    onClick={() => {
                        dispatch({ 
                          type: 'START_GAME', 
                          settings: { playerCount: multiplayerRoom?.players.length ?? 2, gameStake: 10, gameMode: 'multiplayer' },
                          multiplayerPlayers: multiplayerRoom?.players
                        });
                    }} 
                    className="w-full mb-4 py-4 bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 hover:bg-emerald-400 text-slate-900 font-black tracking-[0.2em] uppercase rounded-xl transition-all"
                 >
                   START MATCH
                 </button>
               ) : (
                 <p className="text-amber-400 text-xs font-mono uppercase tracking-widest mb-6 animate-pulse">Waiting for host to start...</p>
               )}
               
               <button onClick={() => { 
                   if (tgUser?.id?.toString() === multiplayerRoom?.host_id?.toString()) {
                      supabase.from('rooms').delete().eq('room_id', roomId).then();
                   }
                   setRoomId(null); 
                   setIsInMultiplayerRoom(false); 
                 }} className="text-slate-400 text-[10px] hover:text-rose-400 transition-colors uppercase tracking-widest px-4 py-2 rounded-lg border border-transparent hover:border-rose-500/30">
                 [ Leave Room ]
               </button>
            </div>
          ) : tgUser ? (
            <div className="space-y-6">
               <div className="bg-slate-800/80 p-4 sm:p-5 rounded-2xl border border-white/5 flex items-center justify-between shadow-inner">
                  <div className="flex items-center gap-3 sm:gap-4">
                     {tgUser.photo_url ? (
                        <img src={tgUser.photo_url} alt={tgUser.display_name} className="w-12 h-12 sm:w-14 sm:h-14 object-cover rounded-full border-2 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.3)]" />
                     ) : (
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-black text-xl sm:text-2xl border-2 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                           {tgUser.display_name.charAt(0).toUpperCase()}
                        </div>
                     )}
                     <div>
                        <div className="font-bold text-white text-lg sm:text-xl leading-tight drop-shadow-sm">{tgUser.display_name}</div>
                        <div className="text-[9px] sm:text-[10px] text-slate-400 font-mono uppercase tracking-widest mt-0.5">ID: {tgUser.id}</div>
                     </div>
                  </div>
                  <div className="text-right bg-slate-900/80 px-3 py-2 rounded-xl border border-slate-700/50 min-w-[70px]">
                     <div className="text-amber-400 font-mono font-black text-lg sm:text-xl leading-none">{tgUser.bankroll}</div>
                     <div className="text-[8px] uppercase tracking-widest text-slate-500 mt-1 leading-none">PTS</div>
                  </div>
               </div>
               
               <div className="flex flex-col gap-3">
                  <button onClick={handleCreateMatch} className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-black tracking-[0.2em] uppercase rounded-xl transition-all shadow-lg shadow-emerald-500/20 text-sm active:scale-95">
                     Create Lobby
                  </button>
               </div>

               <div className="bg-slate-800/50 p-4 rounded-xl border border-white/5 space-y-3">
                  <label className="block text-[10px] sm:text-xs font-mono text-slate-400 uppercase tracking-widest">Join Lobby</label>
                  <div className="flex gap-2">
                     <input 
                        type="text" 
                        placeholder="CODE" 
                        value={joinRoomId} 
                        onChange={e => setJoinRoomId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 4))}
                        maxLength={4}
                        className="flex-[2] bg-slate-900 border border-slate-700 rounded-lg px-4 font-mono font-black text-lg text-center uppercase focus:outline-none focus:border-amber-500 transition-colors placeholder:text-slate-700 placeholder:font-normal text-white"
                     />
                     <button onClick={handleJoinMatch} disabled={joinRoomId.length !== 4} className="flex-1 py-3 bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 hover:bg-amber-400 text-slate-900 font-black tracking-widest uppercase rounded-lg transition-all text-[10px] sm:text-xs active:scale-95 disabled:active:scale-100 disabled:shadow-none shadow-md shadow-amber-500/20">
                        Join
                     </button>
                  </div>
               </div>
               
               <div className="pt-6 border-t border-white/5 text-center">
                  <button onClick={() => setTgUser(null)} className="text-[9px] text-slate-500 hover:text-slate-300 transition-colors uppercase tracking-[0.2em]">Play Offline Locally</button>
               </div>
            </div>
          ) : (
            <div className="space-y-6">
            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase mb-3">{getText("numberOfPlayers")}</label>
              <div className="flex gap-2">
                {[2, 3, 4].map(num => (
                  <button
                    key={num}
                    onClick={() => setLobbyPlayerCount(num)}
                    className={`flex-1 py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${lobbyPlayerCount === num ? 'bg-amber-500 text-slate-900 scale-105 shadow-xl shadow-amber-500/20' : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700'}`}
                  >
                    <Users className="w-4 h-4" />
                    {num}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase mb-3">{getText("gameStakes")}</label>
              <div className="flex items-center justify-between bg-slate-800/50 rounded-xl p-2 border border-white/5">
                <button
                  onClick={() => {
                    const currentIndex = GAME_STAKES.indexOf(lobbyStartingPoints);
                    if (currentIndex > 0) setLobbyStartingPoints(GAME_STAKES[currentIndex - 1]);
                  }}
                  disabled={lobbyStartingPoints === GAME_STAKES[0]}
                  className="w-12 h-12 flex items-center justify-center bg-slate-700/50 rounded-lg hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-xl font-bold transition-colors"
                >
                  -
                </button>
                <div className="flex flex-col items-center">
                  <span className="text-2xl font-mono text-amber-400 font-bold leading-none">{lobbyStartingPoints}</span>
                  <span className="text-[9px] uppercase tracking-widest text-slate-400 mt-1">{getText("pts")}</span>
                </div>
                <button
                  onClick={() => {
                    const currentIndex = GAME_STAKES.indexOf(lobbyStartingPoints);
                    if (currentIndex < GAME_STAKES.length - 1) setLobbyStartingPoints(GAME_STAKES[currentIndex + 1]);
                  }}
                  disabled={lobbyStartingPoints === GAME_STAKES[GAME_STAKES.length - 1]}
                  className="w-12 h-12 flex items-center justify-center bg-slate-700/50 rounded-lg hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-xl font-bold transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 uppercase mb-3">{getText("gameMode")}</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setLobbyGameMode('vs-ai')}
                  className={`py-4 px-4 rounded-xl font-bold flex flex-col items-center justify-center gap-2 transition-all ${lobbyGameMode === 'vs-ai' ? 'bg-emerald-500 text-slate-900 scale-105 shadow-xl shadow-emerald-500/20' : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700'}`}
                >
                  <Bot className="w-6 h-6" />
                  <span className="text-xs">{getText("vsAiOpponents")}</span>
                </button>
                <button
                  onClick={() => setLobbyGameMode('pass-and-play')}
                  className={`py-4 px-4 rounded-xl font-bold flex flex-col items-center justify-center gap-2 transition-all ${lobbyGameMode === 'pass-and-play' ? 'bg-fuchsia-500 text-white scale-105 shadow-xl shadow-fuchsia-500/20' : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700'}`}
                >
                  <Users className="w-6 h-6" />
                  <span className="text-xs">{getText("passAndPlay")}</span>
                </button>
              </div>
            </div>

            <button
              onClick={() => dispatch({ type: 'START_GAME', settings: { playerCount: lobbyPlayerCount, gameMode: lobbyGameMode, gameStake: lobbyStartingPoints }, tgUser: tgUser || undefined })}
              className="w-full py-4 mt-4 bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 text-slate-900 font-black text-lg tracking-widest uppercase rounded-xl transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-emerald-500/30 flex items-center justify-center gap-2"
            >
              {getText("startGame")} <Play className="w-5 h-5" />
            </button>
          </div>
          )}
        </div>
      </div>
    );
  }

  const isMyTurn = !isInMultiplayerRoom || (activePlayer?.id === tgUser?.id?.toString());

  return (
    <div className="relative min-h-[100dvh] h-[100dvh] felt-bg font-sans text-white overflow-hidden flex flex-col">
      {/* === START DEBUG NAV SYSTEM === */}
      <div id="dev-debug-navbar" className="fixed top-0 left-0 w-[100vw] box-border z-[9999] flex flex-col items-center pointer-events-none" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="w-full bg-[rgba(20,20,20,0.85)] backdrop-blur-md shadow-2xl pointer-events-auto transition-transform duration-300 border-b border-indigo-500/50">
          <div className="flex items-center justify-between px-4 relative" style={{ height: '35px' }}>
            <div className="text-[10px] font-mono font-bold text-indigo-400 uppercase flex items-center gap-2">
              <span>🛠️ DEV TOOLS</span>
            </div>
            <button 
              onClick={() => setIsDevNavOpen(!isDevNavOpen)} 
              className="absolute right-2 top-1/2 -translate-y-1/2 w-[44px] h-[44px] flex items-center justify-center cursor-pointer"
            >
              <div className="flex items-center justify-center w-full h-full">
                <span className="text-slate-400 text-lg font-bold">☰</span>
              </div>
            </button>
          </div>
          
          <div className={`overflow-y-auto transition-all duration-300 ${isDevNavOpen ? 'max-h-[60vh] opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="flex flex-wrap gap-2 p-[10px]">
              {/* Test Actions */}
              <button
                onClick={() => { triggerMeldTestGimmick(); setIsDevNavOpen(false); }}
                className="flex-[1_1_45%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-white rounded-[6px] border border-[#555] active:scale-95 transition-transform"
              >
                [ Cycle Hand ]
              </button>
              <button
                onClick={() => { triggerInstantWinTest(); setIsDevNavOpen(false); }}
                className="flex-[1_1_45%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-white rounded-[6px] border border-[#555] active:scale-95 transition-transform"
              >
                [ Force Win ]
              </button>
              <button
                onClick={() => { dispatch({ type: 'START_GAME' }); setIsDevNavOpen(false); }}
                className="flex-[1_1_45%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-white rounded-[6px] border border-[#555] active:scale-95 transition-transform"
              >
                [ Clear Test ]
              </button>

              {/* Joker Suite */}
              <button onClick={() => { triggerJokerTest('run'); setIsDevNavOpen(false); }} className="flex-[1_1_45%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-cyan-200 rounded-[6px] border border-cyan-800 active:scale-95 transition-transform">[ Joker Run ]</button>
              <button onClick={() => { triggerJokerTest('set'); setIsDevNavOpen(false); }} className="flex-[1_1_45%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-cyan-200 rounded-[6px] border border-cyan-800 active:scale-95 transition-transform">[ Joker Set ]</button>
              <button onClick={() => { triggerJokerTest('double-run'); setIsDevNavOpen(false); }} className="flex-[1_1_45%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-cyan-200 rounded-[6px] border border-cyan-800 active:scale-95 transition-transform">[ Dbl Joker ]</button>
              
              {/* Opener Suite */}
              <button onClick={() => { setLayoutFriction(prev => !prev); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-zinc-300 rounded-[6px] border border-zinc-800 active:scale-95 transition-transform font-bold">[DEBUG: Toggle Layout Friction]</button>
              <button onClick={() => { triggerStressTestHand(); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-green-300 rounded-[6px] border border-green-800 active:scale-95 transition-transform font-bold">[DEBUG: Stress Test Hand Layout]</button>
              <button onClick={() => { triggerDiscardComboTest(); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-rose-300 rounded-[6px] border border-rose-800 active:scale-95 transition-transform font-bold">[DEBUG: Test 41+ Discard Combo]</button>
              <button onClick={() => { triggerOpenerTest(); setIsDevNavOpen(false); }} className="flex-[1_1_45%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-indigo-200 rounded-[6px] border border-indigo-800 active:scale-95 transition-transform">[ Test Force Discard Meld ]</button>
              <button onClick={() => { triggerDiscardMatchStateTest(); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-emerald-300 rounded-[6px] border border-emerald-800 active:scale-95 transition-transform font-bold">[DEBUG: Toggle Discard Match State]</button>
              <button onClick={() => { triggerPredictiveWinTest(); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-amber-300 rounded-[6px] border border-amber-800 active:scale-95 transition-transform font-bold">[DEBUG: Force Predictive Win Setup]</button>
              <button onClick={() => { startLanguageCycle(); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-cyan-300 rounded-[6px] border border-cyan-800 active:scale-95 transition-transform font-bold">[DEBUG: Cycle Language Layouts]</button>
              <button onClick={() => { triggerManualMeldWinTest(); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-fuchsia-300 rounded-[6px] border border-fuchsia-800 active:scale-95 transition-transform">[DEBUG: Test Manual Meld Win]</button>
              <button onClick={() => { triggerCPUDrawTest(); setIsDevNavOpen(false); }} className="flex-[1_1_45%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-amber-200 rounded-[6px] border border-amber-800 active:scale-95 transition-transform">[ Simulate CPU Draw ]</button>
              <button onClick={() => { triggerAutoElevateTest(); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-emerald-200 rounded-[6px] border border-emerald-800 active:scale-95 transition-transform">[ Test Auto-Elevate Win ]</button>
              <button onClick={() => { triggerFreeDiscardDrawTest(); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-blue-200 rounded-[6px] border border-blue-800 active:scale-95 transition-transform">[ Test Free Discard Draw ]</button>
              <button onClick={() => { triggerDebugResetMacro(); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-purple-200 rounded-[6px] border border-purple-800 active:scale-95 transition-transform font-bold">[DEBUG: Reset & Inject Test Hand]</button>
              <button onClick={() => { dispatch({ type: 'DEBUG_FORCE_TURN_TIMEOUT' }); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-red-300 rounded-[6px] border border-red-800 active:scale-95 transition-transform">[ Force Turn Timeout ]</button>
              <button onClick={() => { dispatch({ type: 'DEBUG_FORCE_ANTE_AND_WIN', playerId: state.players[0].id }); setIsDevNavOpen(false); }} className="flex-[1_1_100%] min-h-[40px] text-[12px] whitespace-normal text-center bg-[#333] text-yellow-300 rounded-[6px] border border-yellow-800 active:scale-95 transition-transform">[DEBUG: Force Ante & Win]</button>
            </div>
          </div>
        </div>
      </div>
      {/* === END DEBUG NAV SYSTEM === */}

      {/* Immersive Header / Top Bar */}
      <header className="p-3 sm:p-8 pt-8 sm:pt-12 flex justify-between items-start z-50 shrink-0">
        <div className="flex gap-2 w-full max-w-full overflow-x-auto pb-2 scrollbar-none">
          {state.players.map((p, idx) => {
            const isActiveHuman = state.activePlayerIndex === idx && !p.isBot && state.phase !== 'pass-device' && !state.winnerId;
            const isFirstTurn = !p.hasPlayedFirstTurn;
            const forfeitThreshold = isFirstTurn ? 138 : 55;
            const warningThreshold = isFirstTurn ? 108 : 30;
            const softLimit = isFirstTurn ? 90 : 30;
            
            let timerColor = 'bg-emerald-500';
            if (isActiveHuman) {
               if (turnElapsed >= warningThreshold) timerColor = 'bg-red-500 animate-pulse';
               else if (turnElapsed >= softLimit) timerColor = 'bg-yellow-500';
            }
            const pct = isActiveHuman ? Math.max(0, 100 - (turnElapsed / forfeitThreshold) * 100) : 0;

            return (
            <div key={p.id} className={`glass-panel rounded-xl p-2 sm:p-4 flex flex-col shrink-0 transition-all ${state.activePlayerIndex === idx ? 'ring-2 ring-emerald-500 scale-105 shadow-lg shadow-emerald-500/20' : 'opacity-70 scale-95'}`}>
              <div className="flex items-center gap-2 sm:gap-4 w-full">
                <div className={`w-8 h-8 sm:w-12 sm:h-12 rounded-full border sm:border-2 overflow-hidden shrink-0 flex items-center justify-center font-bold text-sm sm:text-lg ${state.activePlayerIndex === idx ? 'bg-emerald-500 border-emerald-300 text-slate-900' : 'bg-slate-700 border-slate-500'} ${p.isForfeited || p.isBankrupt ? 'grayscale opacity-50' : ''}`}>
                  {p.isBot ? (
                    <Bot className="w-4 h-4 sm:w-6 sm:h-6" />
                  ) : p.photoUrl ? (
                    <img src={p.photoUrl} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="opacity-80">{p.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="hidden sm:block">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest">{p.isBankrupt ? getText('bankrupt') : (p.isForfeited ? getText('forfeited') : (state.activePlayerIndex === idx ? getText('yourTurn') : getText('waiting')))}</div>
                  <div className={`font-medium truncate ${p.isForfeited || p.isBankrupt ? 'line-through text-slate-500' : ''}`}>{p.name}</div>
                  <div className="text-[10px] text-amber-500 font-mono uppercase">{p.isBankrupt ? getText('out') : `${p.hand.length} ${getText('cards')}`}</div>
                </div>
                <div className="block sm:hidden flex-1 overflow-hidden">
                  <div className={`text-[10px] font-medium truncate ${p.isForfeited || p.isBankrupt ? 'line-through text-slate-500' : ''}`}>{p.name}</div>
                  <div className="text-[8px] text-amber-500 font-mono uppercase">{p.isBankrupt ? getText('out') : `${p.hand.length} CDS`}</div>
                </div>
              </div>
              {isActiveHuman && (
                   <div className="w-full h-1 sm:h-1.5 bg-slate-800 rounded-full mt-2 overflow-hidden">
                     <div className={`h-full ${timerColor} transition-all duration-1000 ease-linear`} style={{ width: `${pct}%` }}></div>
                   </div>
              )}
            </div>
          )})}
        </div>

        {/* Hurry Up Warning Overlays */}
        <AnimatePresence>
          {showWarningToast && !state.winnerId && state.hasStarted && (
            <motion.div 
               initial={{ opacity: 0, scale: 0.8, y: -20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.8, y: -20 }}
               className="absolute top-20 left-1/2 -translate-x-1/2 z-[100] pointer-events-none"
            >
              <div className="bg-red-600/90 font-black text-white px-8 py-3 rounded-full uppercase tracking-[0.3em] shadow-[0_0_40px_rgba(220,38,38,0.7)] animate-pulse text-lg border-2 border-red-400">
                Hurry Up!
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center Title */}
        <div className="text-center absolute left-1/2 -translate-x-1/2 top-4 sm:top-8 pointer-events-none">
          <div className="hidden sm:block text-[10px] text-slate-400 uppercase tracking-widest mb-1">{getText("gameSession")}</div>
          <div className="text-2xl sm:text-3xl font-black tracking-tighter neon-glow font-display">KONKUR</div>
          <div className="hidden sm:block text-[10px] text-amber-500/80 mt-1 uppercase tracking-[0.3em]">{getText("traditionalEthiopianRummy")}</div>
        </div>

        {/* Match Score Panel */}
        <div className="flex flex-col gap-1 sm:gap-2 items-end mt-[calc(10px+env(safe-area-inset-top))] sm:mt-[calc(35px+env(safe-area-inset-top))] relative z-[9800]">
          {/* Language Selector */}
          <LanguageDropdown />
            
          <div className="glass-panel rounded-xl p-2 sm:p-3 max-w-[120px] sm:max-w-[200px] card-shadow bg-slate-900/60 backdrop-blur-md border border-slate-700/50 mt-1">
            <div className="text-[8px] sm:text-[10px] text-slate-400 font-bold uppercase tracking-widest border-b border-slate-700/50 pb-1 mb-1 text-center">{getText("scoreboard")}</div>
            <div className="flex flex-col gap-1">
              {state.players.map(p => (
                <div key={p.id} className="flex justify-between items-center text-[10px] sm:text-xs font-mono font-bold">
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    {p.photoUrl ? (
                      <img src={p.photoUrl} alt={p.name} className="w-4 h-4 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-[8px] text-slate-300 shrink-0">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className={`${p.telegramId === tgUser?.id?.toString() ? 'text-emerald-400' : 'text-amber-400'} truncate mr-2`}>{p.name}</span>
                  </div>
                  <span className="text-white relative">
                    {p.totalBankroll} {getText("pts")}
                    {/* Transfer Floating Text Animation */}
                    <AnimatePresence>
                      {state.pointTransfers && state.winnerId && state.pointTransfers[p.id] && (
                        (p.id === state.winnerId && state.pointTransfers[p.id].earned > 0) || (p.id !== state.winnerId && state.pointTransfers[p.id].penalty > 0)
                      ) && (
                        <motion.span
                          initial={{ opacity: 0, y: 10, scale: 0.5 }}
                          animate={{ opacity: 1, y: -20, scale: 1.2 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 1.5, ease: "easeOut" }}
                          className={`absolute left-0 bottom-full font-black drop-shadow-md whitespace-nowrap pointer-events-none z-50 ${p.id === state.winnerId ? 'text-emerald-400' : 'text-rose-500'}`}
                        >
                          {p.id === state.winnerId ? `+${state.pointTransfers[p.id].earned}` : `-${state.pointTransfers[p.id].penalty}`}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    {/* Ante Deduction Score Dropping Animation */}
                    <AnimatePresence>
                      {animateAnte && !p.isBankrupt && (
                        <motion.span
                          initial={{ opacity: 0, y: -10, scale: 0.8 }}
                          animate={{ opacity: [0, 1, 1, 0], y: [-10, 10, 15, 20], scale: [0.8, 1.2, 1.2, 1] }}
                          transition={{ duration: 2.5, ease: "easeOut" }}
                          className="absolute right-0 top-full text-rose-500 font-black drop-shadow-md whitespace-nowrap pointer-events-none z-50 block text-[10px]"
                        >
                          -{state.settings.gameStake}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                </div>
              ))}
            </div>
            
            {(state.gamePot ?? 0) > 0 && (
               <div className="mt-2 pt-2 border-t border-slate-700/50 flex flex-col items-center">
                 <div className="text-[8px] sm:text-[10px] text-amber-500/80 font-bold uppercase tracking-widest mb-0.5">{getText("pot")}</div>
                 <motion.div 
                    animate={animateAnte ? { scale: [1, 1.3, 1], color: ['#fbbf24', '#fff', '#fbbf24'] } : {}}
                    className="text-sm sm:text-base font-black text-amber-400 flex items-center gap-1 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]"
                 >
                    <Trophy className="w-3 h-3 sm:w-4 sm:h-4 text-amber-500" />
                    {state.gamePot}
                 </motion.div>
               </div>
            )}
          </div>
          <div className="flex gap-1 sm:gap-2 pointer-events-auto">
            <button 
              onClick={() => setShowMenu(true)}
              className="p-2 sm:px-4 sm:py-2 glass-panel rounded-lg hover:bg-white/10 transition-colors flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest"
              title="Menu"
            >
              <Menu className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
              <span className="hidden sm:inline">Menu</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative overflow-hidden h-full">
        {/* Ante Buy-In Temporary Center Overlay */}
        <AnimatePresence>
          {animateAnte && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -10 }}
              className="absolute inset-0 flex items-center justify-center z-[90] pointer-events-none"
            >
              <div className="bg-slate-950/90 backdrop-blur-md border border-amber-500/30 rounded-2xl px-8 py-5 flex flex-col items-center gap-1 shadow-2xl shadow-amber-500/20 pointer-events-auto">
                <span className="text-amber-500/80 uppercase tracking-[0.3em] text-[10px] font-black animate-pulse">ANTE BUY-IN ROUND START</span>
                <span className="text-3xl sm:text-4xl font-medium font-mono text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.6)]">{getText("pot")}: {state.gamePot} {getText("pts")}</span>
                <span className="text-[9px] text-slate-400 mt-1">Stakes deducted from all active players</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Top Section (Opponent & Table) - Roughly 50% */}
        <div className="flex-[4.5] flex flex-col p-2 sm:p-4 pb-0 overflow-hidden relative">
          {/* Opponent Cards (Fan/Stack) */}
          {(() => {
            const localPlayer = isInMultiplayerRoom 
              ? state.players.find(p => p.id === tgUser?.id?.toString()) || state.players[state.activePlayerIndex]
              : state.players[state.activePlayerIndex];
            const opponents = state.players.filter(p => p.id !== localPlayer.id);

            return opponents.length > 0 && (
              <div className={`flex justify-center mb-0 sm:mb-2 overflow-hidden shrink-0 gap-4 sm:gap-8 ${opponents.length > 1 ? 'flex-wrap' : ''}`}>
                {opponents.map(opp => (
                  <div key={opp.id} className="flex flex-col items-center">
                    <div className="flex items-center gap-2 mb-2 bg-slate-900/60 px-3 py-1.5 rounded-full border border-white/5">
                      {opp.photoUrl ? (
                        <img src={opp.photoUrl} alt={opp.name} className="w-6 h-6 rounded-full object-cover border border-emerald-500/30" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400">
                          {opp.isBot ? <Bot className="w-3 h-3"/> : opp.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-xs font-bold text-slate-200">{opp.name}</span>
                      <span className="text-[10px] text-amber-400 font-mono ml-2">{opp.totalBankroll} <span className="text-[8px] text-slate-500">PTS</span></span>
                    </div>
                    
                    {opponents.length === 1 ? (
                      /* 1v1 Full Fan */
                      <div className="flex -space-x-12 sm:-space-x-14 md:-space-x-10 opacity-60 transform scale-[0.6] sm:scale-[0.85] origin-top hover:opacity-100 transition-all pt-2">
                        {opp.hand.map((card, i) => (
                          <div 
                            key={card.id} 
                            className="transform transition-transform hover:-translate-y-4"
                            style={{ rotate: `${(i - (opp.hand.length - 1) / 2) * 2}deg` }}
                          >
                            <CardUI card={card} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      /* Multiplayer Stacked Layout */
                      <div className="flex -space-x-16 opacity-70 transform scale-[0.4] sm:scale-50 origin-top hover:-translate-y-4 hover:opacity-100 transition-all pt-2 group relative">
                        {opp.hand.map((card, i) => (
                          <div key={card.id} className="transform transition-transform group-hover:translate-x-2">
                             <CardUI card={card} />
                          </div>
                        ))}
                        <div className="absolute inset-0 z-10 flex items-center justify-center">
                           <span className="bg-slate-900/80 text-white font-mono font-black text-3xl px-4 py-2 rounded-xl backdrop-blur-md border border-white/10 shadow-2xl">{opp.hand.length}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Opponent Melds */}
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            <div className="text-[9px] text-slate-500/80 uppercase tracking-[0.2em] px-2 font-bold flex items-center gap-2">
              <LayoutGrid className="w-3 h-3" /> {getText("opponentMelds")}
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-3 px-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {state.players.filter(p => p.id !== state.players[state.activePlayerIndex].id && p.isOpened).flatMap(p => p.melds).map(meld => (
                  <motion.div 
                    key={meld.id} 
                    initial={{ opacity: 0, scale: 0.8, filter: 'brightness(2)' }}
                    animate={{ opacity: 1, scale: 1, filter: 'brightness(1)' }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    data-drop-target="meld" 
                    data-meld-id={meld.id} 
                    className="glass-panel rounded-xl p-2 flex flex-col gap-1.5 border-slate-500/20 card-shadow relative group"
                  >
                    <div className="flex flex-wrap gap-1">
                      {meld.cards.map(c => <CardUI key={c.id} card={c} />)}
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-[8px] font-mono text-slate-400/60 uppercase tracking-widest">{meld.type} • {state.players.find(p => p.id === meld.ownerId)?.name}</span>
                        {!state.players[state.activePlayerIndex].isBot && state.phase === 'action' && selectedCards.length === 1 && state.players[state.activePlayerIndex].isOpened && (
                          <button 
                            onClick={() => {
                              const card = state.players[state.activePlayerIndex].hand.find(c => c.id === selectedCards[0]);
                              if (card) handleAttach(card, meld.id);
                            }}
                            className="bg-amber-500 text-black text-[8px] px-2 py-1 rounded font-black hover:bg-amber-400 active:scale-95 transition-all"
                          >
                            ATTACH
                          </button>
                        )}
                    </div>
                  </motion.div>
                ))}
                {state.players.filter(p => p.id !== state.players[state.activePlayerIndex].id).every(p => !p.isOpened || p.melds.length === 0) && (
                  <div className="col-span-full py-6 flex flex-col items-center justify-center border-2 border-dashed border-slate-700/30 rounded-2xl text-slate-600 font-mono text-[9px] uppercase tracking-widest text-center px-4">
                    {getText("noOpponentMelds")}<br/><span className="text-[7px] text-slate-500 mt-1 opacity-70">{getText("opponentsMustOpen")}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Section (Thumb Zone) - Roughly 50% */}
        <div className="flex-[5.5] bg-black/20 backdrop-blur-sm border-t border-white/5 flex flex-col justify-end pt-2">
          {/* Deck & Discard & Your Melds (Horizontal scrollable) */}
          <div className="flex items-center gap-4 sm:gap-6 shrink-0 z-10 px-4 w-full overflow-x-auto scrollbar-hide pb-2 pt-2 relative">
            
            {/* Game Pot Badge */}
            {(state.gamePot || 0) > 0 && (
                <div className="flex flex-col items-center gap-1 shrink-0 animate-pulse">
                   <div className="flex items-center justify-center bg-amber-500/20 border-2 border-amber-500/50 rounded-xl px-4 h-20 sm:h-28 card-shadow shadow-amber-500/20 relative overflow-hidden">
                       <div className="absolute inset-0 bg-gradient-to-t from-amber-500/10 to-transparent"></div>
                       <div className="flex flex-col items-center">
                           <span className="text-[10px] sm:text-xs text-amber-500/80 uppercase tracking-[0.2em] font-bold">{getText("pot")}</span>
                           <span className="text-xl sm:text-3xl font-black font-mono text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]">{state.gamePot}</span>
                       </div>
                   </div>
                </div>
            )}

            <div className="flex items-center gap-4 sm:gap-8 shrink-0">
              {/* Draw Deck */}
            <div className="flex flex-col items-center gap-1 group">
              <div 
                onClick={() => (!isInMultiplayerRoom || isMyTurn) && !state.players[state.activePlayerIndex].isBot && state.phase === 'draw' && dispatch({ type: 'DRAW_FROM_DECK', playerId: state.players[state.activePlayerIndex].id })}
                className={`
                  relative cursor-pointer transition-all duration-300 card-shadow rounded-lg overflow-hidden
                  ${(!isInMultiplayerRoom || isMyTurn) && !state.players[state.activePlayerIndex].isBot && state.phase === 'draw' ? 'scale-[1.05] sm:scale-110 active-glow shadow-emerald-500/20' : 'opacity-40 grayscale'}
                `}
              >
                <div className="w-14 h-20 sm:w-20 sm:h-28 bg-slate-800 border-2 border-amber-500/40 rounded-lg flex flex-col items-center justify-center relative">
                  {state.deck.length > 0 ? (
                      <div className="absolute inset-0 z-10">
                        <CardUI card={{ ...state.deck[state.deck.length - 1], faceUp: false }} />
                      </div>
                  ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-amber-500/40 flex items-center justify-center text-amber-500 font-bold text-lg">+</div>
                  )}
                </div>
                <div className="absolute top-1 right-1 bg-black/60 px-1 rounded text-[8px] font-mono border border-white/10">
                  {state.deck.length}
                </div>
              </div>
              <div className="text-[8px] text-amber-500 uppercase tracking-widest font-bold">{getText("deck")}</div>
            </div>

            <div data-drop-target="discard" className="flex flex-col items-center gap-1 group relative">
              <motion.div 
                onClick={handleDiscardPileClick}
                animate={discardShake ? { x: [-5, 5, -5, 5, 0] } : {}}
                transition={{ duration: 0.3 }}
                className={`
                  relative transition-all duration-300
                  ${(!isInMultiplayerRoom || isMyTurn) && !state.players[state.activePlayerIndex].isBot && state.phase === 'draw' && state.discardPile.length > 0 ? 'cursor-pointer scale-[1.05] sm:scale-110 shadow-emerald-500/20' : 'opacity-40'}
                `}
              >
                {state.discardPile.length > 0 ? (
                  <div className={`w-14 h-20 sm:w-20 sm:h-28 bg-white rounded-lg border border-slate-300 card-shadow flex items-center justify-center 
                    ${openerTest ? 'opacity-20 grayscale' : ''} 
                    ${showDiscardDrawHighlight ? 'shadow-[0_0_35px_theme(colors.amber.400)] ring-4 ring-amber-400 animate-pulse' : ''}
                    ${showPredictiveConquer ? 'shadow-[0_0_40px_theme(colors.amber.500),inset_0_0_20px_theme(colors.purple.500)] ring-4 ring-purple-400 animate-win-pulse' : ''}
                  `}>
                    <CardUI card={state.discardPile[state.discardPile.length - 1]} />
                  </div>
                ) : (
                  <div className="w-14 h-20 sm:w-20 sm:h-28 rounded-lg border-2 border-dashed border-emerald-800/30 flex items-center justify-center text-emerald-900 text-[8px] font-mono uppercase">
                    EMPTY
                  </div>
                )}
              </motion.div>
              <div className="text-[8px] text-slate-400 uppercase tracking-widest font-bold">{getText("discard")}</div>
              
              {/* Error Message Tooltip */}
              <AnimatePresence>
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="absolute -top-16 left-1/2 -translate-x-1/2 w-48 sm:w-64 bg-rose-950/90 border border-rose-500/50 text-rose-200 text-[10px] p-2 rounded shadow-xl text-center z-50 backdrop-blur-sm pointer-events-none"
                  >
                    {errorMessage}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            </div>

            {/* Separator */}
            <div className="w-px h-24 bg-white/10 shrink-0 mx-2 sm:mx-4 block"></div>

            {/* Your Melds */}
            <div className="flex flex-col items-start min-w-0 self-stretch shrink-0 pb-1">
               <div className="text-[9px] text-emerald-400 uppercase tracking-widest font-bold px-2 flex items-center gap-2 mb-2">
                   <div className={`w-2 h-2 rounded-full animate-pulse ${state.players[state.activePlayerIndex].isOpened ? 'bg-emerald-500 shadow-[0_0_8px_theme(colors.emerald.500)]' : 'bg-amber-500 shadow-[0_0_8px_theme(colors.amber.500)]'}`}></div>
                   YOUR MELDS {state.players[state.activePlayerIndex].isOpened ? <span className="text-[8px] text-emerald-500/70 border border-emerald-500/30 px-1 rounded ml-2">OPENED</span> : <span className="text-[8px] text-amber-500/70 border border-amber-500/30 px-1 rounded ml-2 tracking-normal font-medium">NEEDS 41+ PTS</span>}
               </div>
               <div className="flex gap-4 overflow-x-visible items-center pl-2 pb-2">
                  {state.players[state.activePlayerIndex]?.melds.map(meld => (
                    <motion.div 
                      key={meld.id} 
                      initial={{ opacity: 0, scale: 0.8, filter: 'brightness(2)' }}
                      animate={{ opacity: 1, scale: 1, filter: 'brightness(1)' }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                      data-drop-target="meld" 
                      data-meld-id={meld.id} 
                      className={`flex gap-1 py-2 px-2 rounded-2xl border-2 relative transition-all group flex-col shrink-0 min-w-max ${meld.type !== 'invalid' ? 'border-emerald-500/50 bg-emerald-950/40 shadow-[0_0_20px_rgba(16,185,129,0.15)]' : 'border-slate-500/50 bg-slate-800/40'}`}
                    >
                      <div className="flex gap-2 sm:gap-3 scale-[0.85] sm:scale-100 origin-center px-1">
                        {meld.cards.map(c => 
                           <div key={c.id} 
                                className="cursor-pointer hover:-translate-y-3 transition-all duration-200 hover:shadow-xl hover:z-10 relative" 
                                onClick={() => !state.players[state.activePlayerIndex].isBot && state.phase === 'action' && dispatch({type: 'WORKSPACE_REMOVE_CARD', playerId: state.players[state.activePlayerIndex].id, meldId: meld.id, cardId: c.id})}
                           >
                             <CardUI card={c} />
                           </div>
                        )}
                      </div>
                      <div className="absolute inset-x-0 -bottom-3 flex justify-center">
                        <div className={`px-3 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-widest flex items-center gap-1 border shadow-lg ${meld.type !== 'invalid' ? 'bg-black/90 text-emerald-400 border-emerald-500/50' : 'bg-rose-950/90 text-rose-400 border-rose-500/50'}`}>
                          {meld.type !== 'invalid' ? '✓ VALID' : '❌ INVALID'}
                        </div>
                      </div>
                      {/* Attach button if trying to attach */}
                      {!state.players[state.activePlayerIndex].isBot && state.phase === 'action' && selectedCards.length === 1 && (
                        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20">
                          <button 
                            onClick={() => {
                              const card = state.players[state.activePlayerIndex].hand.find(c => c.id === selectedCards[0]);
                              if (card) handleAttach(card, meld.id);
                            }}
                            className="bg-amber-500 text-black text-[12px] px-4 py-2 rounded font-black hover:bg-amber-400 active:scale-95 transition-all shadow-[0_0_15px_rgba(245,158,11,0.4)]"
                          >
                            ATTACH
                          </button>
                        </div>
                      )}
                    </motion.div>
                  ))}
                  {state.players[state.activePlayerIndex]?.melds.length === 0 && (
                     <div className="h-20 sm:h-28 px-10 border-2 border-dashed border-emerald-800/40 rounded-xl text-emerald-700 text-[11px] uppercase tracking-[0.2em] flex items-center justify-center whitespace-nowrap font-mono font-bold shrink-0">
                        No Melds Found
                     </div>
                  )}
               </div>
            </div>
          </div>

          {/* Player Hand (Overlapping Layout) */}
          <div className="relative flex-1 flex flex-col justify-end pb-2 pt-12 sm:pt-16">
            {/* Manual Movement Buttons */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-3 z-[80]">
              <button 
                disabled={selectedCards.length !== 1 || state.players[state.activePlayerIndex].hand.findIndex(c => c.id === selectedCards[0]) === 0}
                onClick={() => dispatch({ type: 'MOVE_CARD_DIRECTION', playerId: state.players[state.activePlayerIndex].id, cardId: selectedCards[0], direction: 'left' })}
                className={`
                  p-2 sm:p-3 rounded-full bg-slate-800/90 border border-white/20 shadow-lg text-white backdrop-blur-md transition-all active:scale-90
                  ${selectedCards.length === 1 && state.players[state.activePlayerIndex].hand.findIndex(c => c.id === selectedCards[0]) !== 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}
                `}
              >
                <div className="flex items-center gap-1">
                   <ChevronUp className="w-4 h-4 -rotate-90 text-emerald-400" />
                   <span className="text-[10px] font-black uppercase text-emerald-400">Move Left</span>
                </div>
              </button>
              
              <button 
                disabled={selectedCards.length !== 1 || state.players[state.activePlayerIndex].hand.findIndex(c => c.id === selectedCards[0]) === state.players[state.activePlayerIndex].hand.length - 1}
                onClick={() => dispatch({ type: 'MOVE_CARD_DIRECTION', playerId: state.players[state.activePlayerIndex].id, cardId: selectedCards[0], direction: 'right' })}
                className={`
                  p-2 sm:p-3 rounded-full bg-slate-800/90 border border-white/20 shadow-lg text-white backdrop-blur-md transition-all active:scale-90
                  ${selectedCards.length === 1 && state.players[state.activePlayerIndex].hand.findIndex(c => c.id === selectedCards[0]) !== state.players[state.activePlayerIndex].hand.length - 1 ? 'opacity-100' : 'opacity-0 pointer-events-none'}
                `}
              >
                <div className="flex items-center gap-1">
                   <span className="text-[10px] font-black uppercase text-emerald-400">Move Right</span>
                   <ChevronUp className="w-4 h-4 rotate-90 text-emerald-400" />
                </div>
              </button>
            </div>

            {!state.players[state.activePlayerIndex].isBot && !state.winnerId && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-0 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-emerald-600 px-4 py-1 rounded-full text-[8px] font-black uppercase tracking-[0.2em] shadow-lg animate-pulse z-[60] whitespace-nowrap"
              >
                {getText("yourTurn")}
              </motion.div>
            )}
            
            {/* Contextual Options Bar removed */}

            <div className="w-full overflow-x-auto overflow-y-visible scrollbar-hide z-[60] relative">
              
              <div className="absolute right-4 top-0 z-50">
                <button 
                  onClick={() => setHandKey(k => k + 1)}
                  className="bg-black/40 hover:bg-black/60 border border-white/10 text-white/70 hover:text-white p-2 rounded-full transition-all flex items-center gap-2 group shadow-xl"
                  title="Align Hand Layout"
                >
                  <motion.div whileTap={{ rotate: 180 }} transition={{ duration: 0.3 }}>
                    <Cigarette className="w-3.5 h-3.5" />
                  </motion.div>
                  <span className="text-[9px] uppercase tracking-widest font-bold pr-1 hidden group-hover:block">Align</span>
                </button>
              </div>

              <div className="min-w-max px-4 sm:px-12 flex justify-center pb-8 pt-4">
                <Reorder.Group 
                  key={handKey}
                  axis="x"
                  values={displayHand}
                  onReorder={(newItems) => {
                     const newHand = newItems.flatMap(item => item.cards);
                     dispatch({ type: 'REORDER_PLAYER_HAND', hand: newHand });
                  }}
                  className={`flex group/hand items-end transition-transform origin-bottom duration-300 ${displayHand.length > 10 ? 'scale-[0.85]' : 'scale-100'}`}
                >
              <AnimatePresence initial={false}>
                {displayHand.map((item, itemIdx) => {
                  const isGroup = item.type === 'group';
                  const isAnySelected = item.cards.some(c => selectedCards.includes(c.id));
                  const isAnyPerfectMeldCard = perfectHandData?.melds.flat().some(pc => item.cards.some(c => c.id === pc.id));
                  const isSelectedOrPerfect = isAnySelected || isAnyPerfectMeldCard;

                  return (
                  <Reorder.Item 
                    key={item.id}
                    value={item}
                    initial={{ opacity: 0, y: 50 }}
                    animate={{ 
                      opacity: 1, 
                      y: isSelectedOrPerfect ? -24 : 0, 
                      x: shakeCards.some(id => item.cards.some(c => c.id === id)) ? [-5, 5, -5, 5, 0] : 0,
                      zIndex: isSelectedOrPerfect ? 50 : itemIdx,
                    }}
                    transition={layoutFriction ? { type: 'spring', stiffness: 500, damping: 35, mass: 0.8 } : { duration: 0 }}
                    layout={layoutFriction}
                    exit={{ opacity: 0, scale: 0.5 }}
                    whileDrag={{ scale: 1.15, zIndex: 100, y: -20 }}
                    onDragStart={() => {
                        // Drop background opacity slightly could be done via global state, but is handled via CSS or just the drag styling below
                    }}
                    onDragEnd={(_e, info) => {
                      if (state.players[state.activePlayerIndex].isBot || state.phase !== "action") return;
                      const element = document.elementFromPoint(info.point.x, info.point.y);
                      const target = element?.closest('[data-drop-target]');
                      if (target) {
                        const dropType = target.getAttribute('data-drop-target');
                        if (dropType === 'discard' && item.cards.length === 1) handleDiscard(item.cards[0]);
                        else if (dropType === 'meld') {
                          const meldId = target.getAttribute('data-meld-id');
                          if (meldId) {
                             if (item.cards.length === 1) handleAttach(item.cards[0], meldId);
                             else if (item.cards.length > 1) {
                                // Multi-card attach handled if valid? For now we only have batch attach if selected explicitly, or we can use handleAttachMeld logic but we'd need to mock the selected cards state.
                                setSelectedCards(item.cards.map(c => c.id));
                                setTimeout(() => handleAttachMeld(meldId), 0);
                             }
                          }
                        }
                      } else if (info.offset.y < -window.innerHeight * 0.25) {
                         // Dragged up enough: try to play/open
                         if (item.cards.length >= 3) {
                             setSelectedCards(item.cards.map(c => c.id));
                         }
                      }
                    }}
                    className={`relative transition-shadow duration-200 shrink-0 touch-none group/item ${
                      itemIdx > 0 ? (isGroup ? '-ml-12 sm:-ml-16' : '-ml-8 sm:-ml-10') : ''
                    }`}
                  >
                     <div className={`relative flex items-center ${isGroup ? 'cursor-grab active:cursor-grabbing neon-glow-gold rounded-[12px] p-0.5' : ''}`}>
                      {item.cards.map((card, innerIdx) => {
                         // Accordion Compaction Implementation
                         const overlapClass = innerIdx > 0 
                            ? `!-ml-10 sm:!-ml-14 group-active/item:!ml-2 sm:group-active/item:!ml-4 transition-all duration-[300ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] delay-[150ms]` 
                            : '';
                         const cardSelected = selectedCards.includes(card.id);
                         const isShaking = shakeCards.includes(card.id);
                         
                         let outlineState: 'cyan' | 'emerald' | 'gold' | 'ruby' | 'purple' | null = null;
                         
                         if (isShaking) {
                             outlineState = 'ruby';
                         } else if (isGroup) {
                             // Let the wrapper handle the group outline
                             outlineState = null;
                         } else if (cardSelected) {
                             if (isValidSelectionAlone) {
                                 outlineState = 'emerald';
                             } else {
                                 outlineState = 'cyan';
                             }
                         } else if (isAnyPerfectMeldCard) {
                             // Keep perfect meld hinting
                             outlineState = 'emerald';
                         }
                         
                         // Purple glow for 1 card conquer
                         const remainingLooseCards = state.players[state.activePlayerIndex].hand.length - (partitions?.flat().length || 0);
                         const isLastCardConquer = remainingLooseCards === 1 && state.players[state.activePlayerIndex].isOpened && partitions && partitions.length > 0 && !selectedCards.includes(card.id);
                         if (isLastCardConquer && !card.groupId && !cardSelected && state.phase === 'action') {
                             outlineState = 'purple';
                         }
                         // Also check true 1 card left
                         if (state.players[state.activePlayerIndex].hand.length === 1 && state.players[state.activePlayerIndex].isOpened && state.phase === 'action') {
                             outlineState = 'purple';
                         }

                         return (
                           <div key={card.id} className={`relative ${overlapClass}`}>
                             <CardUI 
                               card={{ ...card, faceUp: !state.players[state.activePlayerIndex].isBot && !isFlippingBack }} 
                               onClick={() => isAnyPerfectMeldCard ? handlePerfectMeldClick(item.cards[0].id) : toggleCardSelection(card.id)}
                               selected={cardSelected}
                               outlineState={outlineState}
                             />
                           </div>
                         );
                      })}
                    </div>
                  </Reorder.Item>
                )})}
              </AnimatePresence>
                </Reorder.Group>
                
                {openerTest && (
                  <motion.div 
                    initial={{ opacity: 0, x: -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="relative shrink-0 ml-4 sm:ml-8 translate-y-[-24px] shadow-[0_0_30px_theme(colors.fuchsia.500)] ring-2 ring-fuchsia-400 rounded-lg z-50"
                  >
                    <CardUI card={openerTest.discardCard} selected={true} />
                    <div className="absolute -top-3 -right-3 bg-fuchsia-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full z-10 animate-bounce whitespace-nowrap shadow-lg">
                       GRABBED
                    </div>
                  </motion.div>
                )}

              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Sleek Bottom Action Bar (Sticky Targets) */}
      <footer className="h-14 sm:h-16 glass-panel border-t border-white/10 flex items-stretch z-[70] shadow-2xl shrink-0 relative overflow-hidden">
        {(!isMyTurn || activePlayer?.isBot || state.winnerId) && (
           <div className="absolute inset-0 bg-slate-900/95 z-50 flex items-center justify-center border-t border-emerald-500/20 backdrop-blur-sm">
              <span className="text-emerald-400 font-mono text-[10px] uppercase tracking-[0.3em] font-bold animate-pulse">
                 {state.winnerId ? 'Game Over' : `Waiting for ${activePlayer?.name}...`}
              </span>
           </div>
        )}
        
        {activeSubMenu ? (
          <div className="absolute inset-0 flex items-stretch bg-slate-900 z-10 animate-slide-up">
            {activeSubMenu === 'loose_combo' && (
              <>
                <button onClick={() => { handleGroupTogether(); setActiveSubMenu(null); }} className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors border-r border-amber-500/50 bg-amber-600/20 text-amber-300 hover:bg-amber-600/40">
                  <LayoutGrid className="w-4 h-4" />
                  <span className="text-[9px] font-black uppercase tracking-widest leading-none text-center">{getText("lockInHand")}</span>
                </button>
                <button onClick={() => { showOpen41 ? handleOpenPurely() : handlePlayMeld(); setActiveSubMenu(null); }} className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors border-r border-teal-500/50 bg-teal-600/20 text-teal-300 hover:bg-teal-600/40">
                  <Trophy className="w-4 h-4" />
                  <span className="text-[9px] font-black uppercase tracking-widest leading-none text-center">{showOpen41 ? getText("drawOpen") : getText("playToTable")}</span>
                </button>
                <button onClick={() => setActiveSubMenu(null)} className="px-4 flex flex-col items-center justify-center bg-rose-950 text-rose-400 hover:bg-rose-900 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </>
            )}
            
            {activeSubMenu === 'discard_match' && (
              <>
                <button onClick={() => { handleDrawCombo(); setActiveSubMenu(null); }} className="flex-[2] flex flex-col items-center justify-center gap-1 transition-colors border-r border-emerald-500/50 bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40 shadow-[inset_0_0_20px_rgba(16,185,129,0.3)]">
                  <Trophy className="w-4 h-4" />
                  <span className="text-[9px] font-black uppercase tracking-widest leading-none text-center">{getText("drawDiscardMeld")}</span>
                </button>
                <button onClick={() => { dispatch({ type: 'DRAW_FROM_DECK', playerId: state.players[state.activePlayerIndex].id }); setSelectedCards([]); setActiveSubMenu(null); }} className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors border-r border-slate-500/50 bg-slate-600/20 text-slate-300 hover:bg-slate-600/40">
                  <LayoutGrid className="w-4 h-4" />
                  <span className="text-[9px] font-black uppercase tracking-widest leading-none text-center">REGULAR DRAW</span>
                </button>
                <button onClick={() => setActiveSubMenu(null)} className="px-4 flex flex-col items-center justify-center bg-rose-950 text-rose-400 hover:bg-rose-900 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </>
            )}
            
            {activeSubMenu === 'edit_group' && (
              <>
                <button onClick={() => { handleUngroup(); setActiveSubMenu(null); }} className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors border-r border-slate-500/50 bg-slate-600/20 text-slate-300 hover:bg-slate-600/40">
                  <RotateCcw className="w-4 h-4" />
                  <span className="text-[9px] font-black uppercase tracking-widest leading-none text-center">{getText("ungroup")}</span>
                </button>
                <button onClick={() => { handlePlayMeld(); setActiveSubMenu(null); }} className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors border-r border-teal-500/50 bg-teal-600/20 text-teal-300 hover:bg-teal-600/40">
                  <Trophy className="w-4 h-4" />
                  <span className="text-[9px] font-black uppercase tracking-widest leading-none text-center">{getText("playToTable")}</span>
                </button>
                <button onClick={() => setActiveSubMenu(null)} className="px-4 flex flex-col items-center justify-center bg-rose-950 text-rose-400 hover:bg-rose-900 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </>
            )}
            
            {activeSubMenu === 'conquer' && (
              <>
                <button 
                   onClick={() => {
                       if (showDiscardDrawHighlight) {
                          handleDrawCombo();
                       } else if (showGroupCards) {
                          handleGroupTogether();
                       } else if (showOpen41) {
                          handleOpenPurely();
                       } else if (showPlayMeld) {
                          handlePlayMeld();
                       }
                       setActiveSubMenu(null);
                   }} 
                   className="flex-[2] flex flex-col items-center justify-center gap-1 bg-amber-400 text-black shadow-[0_0_30px_rgba(251,191,36,0.6)] animate-win-pulse"
                >
                  <Trophy className="w-6 h-6 mb-1" />
                  <span className="text-xs sm:text-sm font-black uppercase tracking-widest leading-none text-center">{getText("conquer")}</span>
                </button>
                <button onClick={() => setActiveSubMenu(null)} className="flex-[1] flex items-center justify-center bg-zinc-900 text-zinc-400 hover:bg-zinc-800 transition-colors border-l border-zinc-800">
                  <span className="text-[10px] font-black uppercase tracking-widest">{getText("cancel")}</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {(() => {
              if (showPredictiveConquer) {
                 return (
                   <button 
                     onClick={() => {
                        dispatch({ type: 'INSTANT_CONQUER_DRAW', playerId: activePlayer.id, comboCardsIds: predictiveConquerState!.attachComboIds });
                        setSelectedCards([]);
                     }}
                     className="flex-1 flex flex-col items-center justify-center gap-1 transition-all bg-amber-500 text-slate-900 font-black sm:px-4 shadow-[0_0_20px_theme(colors.amber.500),inset_0_0_10px_theme(colors.amber.200)] animate-win-pulse hover:bg-amber-400"
                   >
                     <Trophy className="w-5 h-5 drop-shadow-md" />
                     <span className="text-[10px] sm:text-xs uppercase tracking-widest text-center leading-tight">{getText("drawInstantConquer")}</span>
                   </button>
                 );
              }

              const cardsLeftInHand = state.players[state.activePlayerIndex]?.hand.length - selectedCards.length;
              const isConquerGateway = (showGroupCards || showDiscardDrawHighlight || showUngroup) && (cardsLeftInHand === 0 || cardsLeftInHand === 1);

              if (showGroupCards) {
                return (
                  <button 
                    onClick={() => setActiveSubMenu(isConquerGateway ? 'conquer' : 'loose_combo')}
                    className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors border-r border-indigo-500/50 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/40 sm:px-4 shadow-[inset_0_0_15px_rgba(99,102,241,0.2)]"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    <span className="text-[9px] font-black uppercase tracking-tighter text-center leading-tight">{getText("groupCards")}</span>
                  </button>
                );
              }
              if (showDiscardDrawHighlight) {
                return (
                  <button 
                    onClick={() => setActiveSubMenu(isConquerGateway ? 'conquer' : 'discard_match')}
                    className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors border-r border-indigo-500/50 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/40 sm:px-4 shadow-[inset_0_0_15px_rgba(99,102,241,0.2)]"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    <span className="text-[9px] font-black uppercase tracking-tighter text-center leading-tight">{getText("groupCards")}</span>
                  </button>
                );
              }
              if (showUngroup) {
                return (
                  <button 
                    onClick={() => setActiveSubMenu(isConquerGateway ? 'conquer' : 'edit_group')}
                    className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors border-r border-slate-500/50 bg-slate-600/20 text-slate-300 hover:bg-slate-600/40 sm:px-4"
                  >
                    <LayoutGrid className="w-4 h-4" />
                    <span className="text-[9px] font-black uppercase tracking-tighter text-center leading-tight">{getText("editGroup")}</span>
                  </button>
                );
              }

              return (
                <button 
                  onClick={() => dispatch({ type: 'SORT_HAND', playerId: state.players[state.activePlayerIndex].id })}
                  className="flex-1 flex flex-col items-center justify-center gap-1 hover:bg-white/5 active:bg-white/10 transition-colors border-r border-white/5 sm:px-4"
                >
                  <RotateCcw className="w-4 h-4 text-emerald-400" />
                  <span className="text-[9px] font-black uppercase tracking-tighter hidden sm:block">AUTO SORT</span>
                  <span className="text-[9px] font-black uppercase tracking-tighter sm:hidden">SORT</span>
                </button>
              );
            })()}

            {showAttachMeld ? (
               <button 
                 onClick={() => handleAttachMeld(validMeldsToAttachTo[0].id)}
                 className="flex-1 flex flex-col items-center justify-center gap-1 transition-colors border-r border-fuchsia-500/50 bg-fuchsia-600/20 text-fuchsia-300 hover:bg-fuchsia-600/40 sm:px-4"
               >
                 <LayoutGrid className="w-4 h-4" />
                 <span className="text-[9px] font-black uppercase tracking-tighter text-center leading-tight">{getText("attachMeld")}</span>
               </button>
            ) : !showGroupCards && !showDiscardDrawHighlight && !showUngroup && !openerTest ? (
              <button 
                disabled={state.players[state.activePlayerIndex].isBot || state.phase !== 'action' || !state.players[state.activePlayerIndex].isOpened}
                onClick={() => {
                  const { melds } = findAutoMelds(state.players[state.activePlayerIndex].hand);
                  if (melds.length > 0) {
                    const meldCards = melds[0];
                    const remainingCards = state.players[state.activePlayerIndex].hand.filter(c => !meldCards.some(m => m.id === c.id));
                    const newHand = [...meldCards, ...remainingCards];
                    dispatch({ type: 'REORDER_PLAYER_HAND', hand: newHand });
                    setSelectedCards(meldCards.map(c => c.id));
                    setHandKey(k => k + 1); // Trigger layout animation to push them aside visually
                  } else {
                     showError("No meldable combinations found!");
                  }
                }}
                className={`
                  flex-1 flex flex-col items-center justify-center gap-1 hover:bg-white/5 active:bg-white/10 transition-colors border-r border-white/5 sm:px-4
                  ${!state.players[state.activePlayerIndex].isBot && state.phase === 'action' && state.players[state.activePlayerIndex].isOpened ? 'opacity-100 text-teal-400' : 'opacity-40 grayscale pointer-events-none'}
                `}
              >
                <Bot className="w-4 h-4" />
                <span className="text-[9px] font-black uppercase tracking-tighter hidden sm:block">AUTO MELD</span>
                <span className="text-[9px] font-black uppercase tracking-tighter sm:hidden">AUTO</span>
              </button>
            ) : null}

            {openerTest && (
              <>
                <button 
                 onClick={() => {
                    dispatch({ type: 'MELD_OPENER_BATCH', playerId: state.players[state.activePlayerIndex].id, melds: openerTest.melds, discardCard: openerTest.discardCard });
                    setOpenerTest(null);
                    setSelectedCards([]);
                 }}
                 className="flex-[2] flex flex-col items-center justify-center gap-1 transition-all border-r border-fuchsia-500/50 bg-fuchsia-600/30 text-fuchsia-300 hover:bg-fuchsia-600/40 sm:px-4 shadow-[0_0_15px_theme(colors.fuchsia.500)] animate-pulse"
                >
                 <LayoutGrid className="w-4 h-4 mx-auto drop-shadow-md" />
                 <span className="text-[9px] font-black uppercase tracking-widest leading-none text-center">[ CONFIRM DISCARD MELD & OPEN ]</span>
                </button>
                <button 
                 onClick={() => {
                    setOpenerTest(null);
                    setSelectedCards([]);
                 }}
                 className="flex-[1] flex flex-col items-center justify-center gap-1 transition-all border-r border-rose-500/50 bg-rose-950 text-rose-400 hover:bg-rose-900 sm:px-4"
                >
                 <Trash2 className="w-4 h-4 mx-auto" />
                 <span className="text-[9px] font-black uppercase tracking-widest leading-none">CANCEL</span>
                </button>
              </>
            )}

            <button 
              disabled={selectedCards.length !== 1 || state.players[state.activePlayerIndex].isBot || state.phase !== 'action'}
              onClick={() => {
                const card = state.players[state.activePlayerIndex].hand.find(c => c.id === selectedCards[0]);
                if (card) {
                  if (state.players[state.activePlayerIndex].hand.length === 1) {
                    dispatch({ type: 'CONQUER', playerId: state.players[state.activePlayerIndex].id, finalCard: card });
                    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
                    setSelectedCards([]);
                  } else {
                    handleDiscard(card);
                  }
                }
              }}
              className={`
                flex-1 flex flex-col items-center justify-center gap-1 transition-all border-r border-white/5 sm:px-4
                ${selectedCards.length === 1 && !state.players[state.activePlayerIndex].isBot && state.phase === 'action' ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30' : 'opacity-40 grayscale'}
              `}
            >
              <Trash2 className={`w-4 h-4 ${selectedCards.length === 1 && state.phase === 'action' ? 'text-rose-400 drop-shadow-[0_0_8px_theme(colors.rose.500)]' : 'text-slate-400'}`} />
              <span className="text-[9px] font-black uppercase tracking-tighter">{getText("discard")}</span>
            </button>

            <button 
              disabled={!canConquer || state.players[state.activePlayerIndex].isBot || state.phase !== 'action'}
              onClick={handleConquer}
              className={`
                flex-[1.2] flex items-center justify-center gap-2 transition-all font-black text-[10px] sm:text-xs uppercase tracking-widest px-2 sm:px-4
                ${canConquer ? 'bg-amber-400 text-black shadow-[0_0_20px_rgba(251,191,36,0.6)] animate-win-pulse' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}
              `}
            >
              <Trophy className="w-4 h-4 shrink-0" />
              <span className="truncate">CONQUER</span>
            </button>
          </>
        )}
      </footer>

      {/* Overlays */}
      {state.winnerId && (
         <div className="fixed inset-0 pointer-events-none z-[110] overflow-hidden">
            {[...Array(100)].map((_, i) => (
              <div 
                key={i} 
                className="confetti-piece"
                style={{
                  '--color': ['#10b981', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6'][Math.floor(Math.random() * 5)],
                  '--speed': `${1 + Math.random() * 2}s`,
                  '--delay': `${Math.random() * 1.5}s`,
                  '--left': `${Math.random() * 100}%`
                } as any}
              />
            ))}
         </div>
      )}
      <AnimatePresence>
        {state.winnerId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-lg flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="glass-panel border-2 border-emerald-400/30 p-12 rounded-[2rem] text-center max-w-md shadow-[0_0_50px_rgba(52,211,153,0.2)]"
            >
              <div className="w-24 h-24 bg-amber-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(245,158,11,0.4)]">
                <Trophy className="w-12 h-12 text-black" />
              </div>
              <h2 className="font-display font-black text-5xl mb-2 italic neon-glow">CONQUER!</h2>
              <p className="text-emerald-400 font-mono tracking-widest mb-6">
                {state.players.find(p => p.id === state.winnerId)?.name + " " + getText("reignedSupreme")}
              </p>
              
              <div className="flex flex-col gap-2 mb-8 text-left bg-black/30 p-4 rounded-xl border border-white/5">
                <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-2 border-b border-white/10 pb-1">{getText("finalStandings")}</div>
                {state.players.map(p => (
                   <div key={p.id} className="flex justify-between items-center">
                     <div className="flex items-center gap-2 overflow-hidden">
                        {p.photoUrl ? (
                          <img src={p.photoUrl} alt={p.name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300 shrink-0 border border-slate-600">
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className={`font-mono text-xs truncate ${p.id === state.winnerId ? 'text-emerald-400 font-bold' : 'text-slate-300'}`}>{p.name}</span>
                     </div>
                     <div className="flex items-center gap-2">
                         {state.pointTransfers && state.pointTransfers[p.id] && (
                           ((p.id === state.winnerId && state.pointTransfers[p.id].earned > 0) || (p.id !== state.winnerId && state.pointTransfers[p.id].penalty > 0)) && (
                            <span className={`text-[10px] ${p.id === state.winnerId ? 'text-emerald-500' : 'text-rose-500'}`}>
                               {p.id === state.winnerId ? `+${state.pointTransfers[p.id].earned}` : `-${state.pointTransfers[p.id].penalty}`}
                            </span>
                           )
                         )}
                         <span className={`font-mono text-lg ${p.isBankrupt ? 'text-rose-600 line-through' : 'text-amber-400'}`}>{p.totalBankroll} {getText("pts")}</span>
                     </div>
                   </div>
                ))}
              </div>

              <button 
                onClick={() => dispatch({ type: 'START_GAME' })}
                className="w-full bg-white text-black font-black py-4 rounded-2xl hover:bg-amber-400 transition-colors flex items-center justify-center gap-3 card-shadow"
              >
                {getText("playAgain")} <ArrowRight className="w-5 h-5" />
              </button>
            </motion.div>
          </motion.div>
        )}

        {showMenu && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowMenu(false)}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              onClick={e => e.stopPropagation()}
              className="glass-panel border border-white/10 p-6 sm:p-8 rounded-3xl w-full max-w-sm shadow-2xl relative"
            >
              <button 
                onClick={() => setShowMenu(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <h2 className="font-display font-black text-2xl sm:text-3xl mb-6 text-center neon-glow">{getText("gameMenu")}</h2>
              
              <div className="space-y-3">
                <button 
                  onClick={() => {
                    setShowMenu(false);
                    dispatch({ type: 'START_GAME' });
                  }}
                  className="w-full py-4 bg-slate-800/80 hover:bg-slate-700 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 border border-white/5 active:scale-95"
                >
                  <RotateCcw className="w-5 h-5 text-amber-500" />
                  {getText("restartGame")}
                </button>
                
                <button 
                  onClick={() => {
                    setShowMenu(false);
                    setShowInstructions(true);
                  }}
                  className="w-full py-4 bg-slate-800/80 hover:bg-slate-700 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 border border-white/5 active:scale-95"
                >
                  <Info className="w-5 h-5 text-emerald-400" />
                  {getText("howToPlay")}
                </button>

                <button 
                  onClick={() => {
                    setShowMenu(false);
                    dispatch({ type: 'QUIT_GAME', playerId: tgUser?.id?.toString() });
                    if (isInMultiplayerRoom) {
                       if (tgUser?.id?.toString() === multiplayerRoom?.host_id?.toString()) {
                          supabase.from('rooms').delete().eq('room_id', roomId).then();
                       }
                       setRoomId(null);
                       setIsInMultiplayerRoom(false);
                    }
                  }}
                  className="w-full py-4 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 border border-rose-500/20 mt-4 active:scale-95"
                >
                  <Home className="w-5 h-5" />
                  {getText("quitToMainMenu")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showInstructions && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowInstructions(false)}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              onClick={e => e.stopPropagation()}
              className="glass-panel border border-white/10 p-8 rounded-3xl max-w-lg shadow-2xl relative"
            >
              <h2 className="font-display font-black text-3xl mb-6 flex items-center gap-3">
                <Info className="w-8 h-8 text-amber-500" />
                How to Play Konkur
              </h2>
              
              <div className="space-y-6 text-slate-300 leading-relaxed text-sm">
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-white/10 shrink-0 flex items-center justify-center font-bold">1</div>
                  <p><strong className="text-white">Draw:</strong> Start your turn by drawing from the <span className="text-amber-400 font-bold">Deck</span> or taking the <span className="text-emerald-400 font-bold">Discard pile's</span> top card.</p>
                </div>
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-white/10 shrink-0 flex items-center justify-center font-bold">2</div>
                  <p><strong className="text-white">Meld:</strong> Select 3+ cards of same rank (<span className="italic text-emerald-400">Sets</span>) or suits in sequence (<span className="italic text-emerald-400">Runs</span>) and hit "Lay Meld".</p>
                </div>
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-white/10 shrink-0 flex items-center justify-center font-bold">3</div>
                  <p><strong className="text-white">Attach:</strong> Select 1 card that fits an existing meld on the table and hit "Attach".</p>
                </div>
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-white/10 shrink-0 flex items-center justify-center font-bold">4</div>
                  <p><strong className="text-white">Discard:</strong> End turn by selecting a card and hitting "Discard". You win instantly if your hand reaches 0!</p>
                </div>
              </div>

              <button 
                onClick={() => setShowInstructions(false)}
                className="mt-8 w-full py-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-bold transition-all card-shadow"
              >
                Enter the Arena
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pass Device Overlay */}
      <AnimatePresence>
        {state.phase === 'pass-device' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex items-center justify-center p-4"
          >
             <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="glass-panel p-8 md:p-12 rounded-[2rem] max-w-sm w-full text-center flex flex-col items-center card-shadow border border-white/20"
             >
                <div className="w-20 h-20 bg-fuchsia-500/20 rounded-full flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(217,70,239,0.3)]">
                   <Users className="w-10 h-10 text-fuchsia-400" />
                </div>
                <h2 className="text-3xl font-black font-display mb-2">{state.players[state.activePlayerIndex].name}'s Turn</h2>
                <p className="text-slate-400 text-sm mb-8">Pass the device to the next player. Cards are hidden to prevent peeking.</p>
                <button 
                  onClick={() => dispatch({ type: 'CONTINUE_TURN', playerId: state.players[state.activePlayerIndex].id })}
                  className="w-full py-4 bg-fuchsia-600 hover:bg-fuchsia-500 rounded-xl font-bold uppercase tracking-widest transition-all hover:scale-105 active:scale-95 shadow-xl shadow-fuchsia-500/20"
                >
                  I'm Ready
                </button>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
