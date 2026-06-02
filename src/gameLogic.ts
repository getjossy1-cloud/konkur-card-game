/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card, Suit, Rank, Meld, PlayerId, MeldType } from './types';

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
export const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export const createDeck = (deckIndex: number = 0): Card[] => {
  const deck: Card[] = [];
  SUITS.forEach((suit) => {
    RANKS.forEach((rank) => {
      deck.push({
        id: `d${deckIndex}-${suit}-${rank}`,
        suit,
        rank,
        faceUp: false,
      });
    });
  });
  
  // 2 Wild Jokers per deck
  deck.push({ id: `d${deckIndex}-joker-1`, suit: 'none', rank: 0, faceUp: false });
  deck.push({ id: `d${deckIndex}-joker-2`, suit: 'none', rank: 0, faceUp: false });
  
  return shuffle(deck);
};

export const shuffle = <T>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

export const isSet = (cards: Card[]): boolean => {
  if (cards.length < 3) return false;
  const nonJokers = cards.filter(c => c.rank !== 0);
  if (nonJokers.length <= 1) return true; // All jokers or 1 non-joker => valid set
  
  const firstRank = nonJokers[0].rank;
  return nonJokers.every((c) => c.rank === firstRank);
};

export const isRun = (cards: Card[]): boolean => {
  if (cards.length < 3) return false;
  const nonJokers = cards.filter(c => c.rank !== 0);
  if (nonJokers.length <= 1 && cards.length <= 13) return true;

  const suit = nonJokers[0].suit;
  if (!nonJokers.every(c => c.suit === suit)) return false;

  const checkSequence = (baseRanks: number[]): boolean => {
    const ranks = [...baseRanks].sort((a,b) => a - b);
    for (let i = 0; i < ranks.length - 1; i++) {
       if (ranks[i] === ranks[i+1]) return false;
    }
    const minRank = ranks[0];
    const maxRank = ranks[ranks.length - 1];
    return cards.length >= (maxRank - minRank + 1) && cards.length <= 13;
  };

  const ranksLow = nonJokers.map(c => c.rank);
  const ranksHigh = nonJokers.map(c => c.rank === 1 ? 14 : c.rank);

  return checkSequence(ranksLow) || checkSequence(ranksHigh);
};

export const isValidMeld = (cards: Card[]): boolean => {
  return isSet(cards) || isRun(cards);
};

export const canAttachToMeld = (meld: Meld, card: Card): boolean => {
  const newCards = [...meld.cards, card];
  if (meld.type === 'set') return isSet(newCards);
  if (meld.type === 'run') return isRun(newCards);
  return false;
};

export const sortMeld = (cards: Card[], type: MeldType): Card[] => {
  if (type === 'set' || type === 'invalid') {
    return [...cards].sort((a,b) => a.rank - b.rank);
  }
  
  // Visual order for runs
  let nonJokers = cards.filter(c => c.rank !== 0).sort((a,b) => a.rank - b.rank);
  
  // Detect if A is high (A-K-Q)
  if (nonJokers.length >= 2) {
    const hasAce = nonJokers[0].rank === 1;
    const hasHighCard = nonJokers[nonJokers.length - 1].rank >= 10;
    const hasLowCard = nonJokers.some(c => c.rank > 1 && c.rank <= 5);
    
    // If we have an Ace and a High card but NO low cards, treat Ace as High (14)
    if (hasAce && hasHighCard && !hasLowCard) {
      nonJokers = nonJokers.map(c => c.rank === 1 ? { ...c, tempRank: 14 } : c)
                           .sort((a: any, b: any) => (a.tempRank || a.rank) - (b.tempRank || b.rank));
    }
  }

  const jokers = cards.filter(c => c.rank === 0);
  if (nonJokers.length === 0) return [...jokers];
  
  const result: Card[] = [];
  let currentRank = (nonJokers[0] as any).tempRank || nonJokers[0].rank;
  let njIdx = 0;
  
  while (njIdx < nonJokers.length) {
    const njRank = (nonJokers[njIdx] as any).tempRank || nonJokers[njIdx].rank;
    if (njRank === currentRank) {
      result.push(nonJokers[njIdx]);
      njIdx++;
    } else {
      if (jokers.length > 0) result.push(jokers.pop()!);
    }
    currentRank++;
  }
  
  while (jokers.length > 0) {
    // prepend remaining jokers before the start
    result.unshift(jokers.pop()!);
  }
  
  // Strip tempRank before returning
  return result.map(c => {
    const { tempRank, ...rest } = c as any;
    return rest;
  });
};

export const formatRank = (rank: Rank): string => {
  switch (rank) {
    case 0: return '★'; // Joker
    case 1: return 'A';
    case 11: return 'J';
    case 12: return 'Q';
    case 13: return 'K';
    default: return rank.toString();
  }
};

export const getSuitColor = (suit: Suit): string => {
  if (suit === 'none') return 'text-purple-500';
  return (suit === 'hearts' || suit === 'diamonds') ? 'text-rose-500' : 'text-slate-900';
};

export const perfectlyPartitionMelds = (selectedCards: Card[]): Card[][] | null => {
  if (selectedCards.length === 0) return null;
  
  // Backtracking function to perfectly partition
  const allCombinations: Card[][] = [];
  const getCombs = (prefix: Card[], idx: number) => {
    if (prefix.length >= 3) {
      if (isValidMeld(prefix)) {
        allCombinations.push([...prefix]);
      }
    }
    for (let i = idx; i < selectedCards.length; i++) {
        getCombs([...prefix, selectedCards[i]], i + 1);
    }
  };
  getCombs([], 0);

  const findPartition = (currentMelds: Card[][], usedIds: Set<string>): Card[][] | null => {
    if (usedIds.size === selectedCards.length) {
      return [...currentMelds];
    }

    for (const comb of allCombinations) {
      if (!comb.some(c => usedIds.has(c.id))) {
        const newUsedIds = new Set(usedIds);
        comb.forEach(c => newUsedIds.add(c.id));
        currentMelds.push(comb);
        const res = findPartition(currentMelds, newUsedIds);
        if (res) return res;
        currentMelds.pop();
      }
    }
    return null;
  };

  return findPartition([], new Set());
};

export const getBaseCardValue = (rank: Rank | number): number => {
  if (rank >= 11 && rank <= 13) return 10;
  if (rank >= 2 && rank <= 10) return rank;
  if (rank === 1 || rank === 14) return 11; // Default Ace
  return 0;
}

export const calculateMeldValue = (meld: Meld): number => {
  if (meld.type === 'invalid') return 0;
  
  if (meld.type === 'set') {
    const nonJokers = meld.cards.filter(c => c.rank !== 0);
    const targetRank = nonJokers.length > 0 ? nonJokers[0].rank : 1;
    const baseVal = getBaseCardValue(targetRank);
    return meld.cards.length * baseVal;
  }
  
  if (meld.type === 'run') {
    const sorted = sortMeld(meld.cards, 'run');
    let firstRank = 1;
    const firstNonJokerIdx = sorted.findIndex(c => c.rank !== 0);
    if (firstNonJokerIdx !== -1) {
       firstRank = sorted[firstNonJokerIdx].rank - firstNonJokerIdx;
    }
    
    let total = 0;
    for (let i = 0; i < sorted.length; i++) {
       const currentRank = firstRank + i;
       if (currentRank === 1) {
           total += 1; // Ace in A-2-3 (low run) is 1 point
       } else {
           total += getBaseCardValue(currentRank);
       }
    }
    return total;
  }
  return 0;
};



const calculateMeldListValue = (melds: Card[][]): number => {
  return melds.reduce((sum, meld) => {
    const type = isSet(meld) ? 'set' : 'run';
    const fakeMeld = { id: '', type, cards: sortMeld(meld, type), ownerId: '' };
    return sum + calculateMeldValue(fakeMeld as any);
  }, 0);
};

export const findOptimalOpener = (hand: Card[], requiredCard?: Card): Card[][] | null => {
  const allCombinations: Card[][] = [];
  const getCombs = (prefix: Card[], idx: number) => {
    if (prefix.length >= 3) {
      if (isValidMeld(prefix)) {
        allCombinations.push([...prefix]);
      }
    }
    for (let i = idx; i < hand.length; i++) {
        getCombs([...prefix, hand[i]], i + 1);
    }
  };
  getCombs([], 0);

  let bestScore = -1;
  let bestCombos: Card[][] | null = null;

  const findDisjoint = (currentMelds: Card[][], currentScore: number, idx: number, usedIds: Set<string>) => {
    if (idx === allCombinations.length) {
      if (requiredCard) {
        let hasReq = false;
        for (const m of currentMelds) {
          if (m.some(c => c.id === requiredCard.id)) hasReq = true;
        }
        if (!hasReq) return;
      }
      
      if (currentScore > bestScore && currentScore >= 41) {
        bestScore = currentScore;
        bestCombos = [...currentMelds];
      }
      return;
    }

    // skip branch if we don't pick this
    findDisjoint(currentMelds, currentScore, idx + 1, usedIds);

    // try pick
    const comb = allCombinations[idx];
    if (!comb.some(c => usedIds.has(c.id))) {
      const newUsedIds = new Set(usedIds);
      comb.forEach(c => newUsedIds.add(c.id));
      const score = calculateMeldListValue([comb]);
      currentMelds.push(comb);
      findDisjoint(currentMelds, currentScore + score, idx + 1, newUsedIds);
      currentMelds.pop();
    }
  };

  findDisjoint([], 0, 0, new Set());
  return bestCombos || null;
};

export const findAutoMelds = (hand: Card[]): { melds: Card[][], remainingHand: Card[] } => {
  let remaining = [...hand];
  const melds: Card[][] = [];

  let foundNewMeld = true;
  while (foundNewMeld) {
    foundNewMeld = false;

    // Try to find a set (3 or 4 of same rank)
    for (let rank = 1 as Rank; rank <= 13; rank++) {
      const cardsOfRank = remaining.filter(c => c.rank === rank);
      if (cardsOfRank.length >= 3) {
        melds.push(cardsOfRank);
        remaining = remaining.filter(c => c.rank !== rank);
        foundNewMeld = true;
        break; // Restart loop to cleanly parse again
      }
    }
    if (foundNewMeld) continue;

    // Try to find a run (3+ of same suit in sequence)
    for (const suit of SUITS) {
      const cardsOfSuit = remaining.filter(c => c.suit === suit).sort((a, b) => a.rank - b.rank);
      if (cardsOfSuit.length >= 3) {
        let currentRun: Card[] = [cardsOfSuit[0]];
        let bestRun: Card[] = [];

        for (let i = 1; i < cardsOfSuit.length; i++) {
          if (cardsOfSuit[i].rank === currentRun[currentRun.length - 1].rank + 1) {
            currentRun.push(cardsOfSuit[i]);
          } else if (cardsOfSuit[i].rank !== currentRun[currentRun.length - 1].rank) {
             // Not continuing run. Check if valid run before resetting
             if (currentRun.length >= 3 && currentRun.length > bestRun.length) {
                bestRun = [...currentRun];
             }
             currentRun = [cardsOfSuit[i]];
          }
        }
        if (currentRun.length >= 3 && currentRun.length > bestRun.length) {
          bestRun = [...currentRun];
        }

        if (bestRun.length >= 3) {
          melds.push(bestRun);
          const bestRunIds = bestRun.map(c => c.id);
          remaining = remaining.filter(c => !bestRunIds.includes(c.id));
          foundNewMeld = true;
          break; // Restart loop
        }
      }
    }
  }

  return { melds, remainingHand: remaining };
};


