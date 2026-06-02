/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'none';
export type Rank = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
  groupId?: string;
  layoutState?: 'loose' | 'selected' | 'grouped' | 'table';
}

export type MeldType = 'set' | 'run' | 'invalid';

export interface Meld {
  id: string;
  type: MeldType;
  cards: Card[];
  ownerId: string;
}

export type PlayerId = string;

export interface PlayerState {
  id: string;
  name: string;
  telegramId?: number | string;
  photoUrl?: string;
  hand: Card[];
  melds: Meld[];
  isBot: boolean;
  isOpened: boolean;
  totalBankroll: number;
  isBankrupt?: boolean;
  hasPlayedFirstTurn?: boolean;
  isForfeited?: boolean;
}

export interface GameSettings {
  playerCount: number;
  gameMode: 'pass-and-play' | 'vs-ai' | 'multiplayer';
  gameStake: number;
}

export interface GameState {
  hasStarted: boolean;
  settings: GameSettings;
  deck: Card[];
  discardPile: Card[];
  players: PlayerState[];
  activePlayerIndex: number; // Replaces turn
  phase: 'draw' | 'action' | 'discard' | 'pass-device';
  winnerId: string | null;
  lastDrawnCard: Card | null;
  pointTransfers?: { [playerId: string]: { penalty: number, earned: number } };
  gamePot?: number;
  turnStartTime?: number;
}
