/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { Card, Suit } from '../types';
import { formatRank, getSuitColor } from '../gameLogic';
import { Heart, Diamond, Club, Spade, Star } from 'lucide-react';

interface CardUIProps {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  outlineState?: 'cyan' | 'emerald' | 'gold' | 'ruby' | 'purple' | null;
  disabled?: boolean;
  key?: React.Key;
}

const SuitIcon = ({ suit, className }: { suit: Suit; className?: string }) => {
  switch (suit) {
    case 'hearts': return <Heart className={className} />;
    case 'diamonds': return <Diamond className={className} />;
    case 'clubs': return <Club className={className} />;
    case 'spades': return <Spade className={className} />;
    case 'none': return <Star className={className} />;
  }
};

export const CardUI = ({ card, onClick, selected, outlineState, disabled }: CardUIProps) => {
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  
  let currentOutline = '';
  if (outlineState) {
     currentOutline = `neon-glow-${outlineState} z-50 rounded-xl glow-animation`;
  } else if (card.layoutState === 'selected' || selected) {
     currentOutline = 'neon-glow-cyan z-50 rounded-xl glow-animation';
  } else if (card.layoutState === 'grouped') {
     // No explicit border here, handled by CardGroup container
  }

  return (
    <motion.div
      layoutId={card.id}
      onClick={disabled || !card.faceUp ? undefined : onClick}
      whileHover={disabled || !card.faceUp ? {} : { y: -12 }}
      whileTap={disabled || !card.faceUp ? {} : { scale: 0.95 }}
      initial={{ rotateY: 180 }}
      animate={{ rotateY: card.faceUp ? 0 : 180 }}
      transition={{ duration: 0.3, type: "spring", stiffness: 200, damping: 20 }}
      style={{ transformStyle: 'preserve-3d' }}
      className={`
        relative w-14 h-20 sm:w-20 sm:h-28 flex flex-col cursor-pointer select-none
        ${currentOutline}
        ${disabled ? 'opacity-80 grayscale-[0.2]' : ''}
      `}
    >
      {/* FRONT OF CARD */}
      <div 
        className={`absolute inset-0 w-full h-full rounded-xl bg-white border-slate-300 border p-2 card-shadow flex flex-col justify-between ${isRed && card.faceUp ? 'card-red' : 'text-black'}`}
        style={{ backfaceVisibility: 'hidden' }}
      >
        {card.faceUp && (
          <>
            <div className="flex flex-col items-start gap-0.5">
              <span className="font-display font-black text-[11px] sm:text-[14px] leading-none shrink-0 tracking-tighter">{formatRank(card.rank)}</span>
              <SuitIcon suit={card.suit} className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 fill-current shrink-0" />
            </div>
            
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <SuitIcon suit={card.suit} className="w-6 h-6 sm:w-10 sm:h-10 fill-current opacity-10" />
            </div>

            <div className="flex flex-col items-start gap-0.5 rotate-180 self-end">
              <span className="font-display font-black text-[11px] sm:text-[14px] leading-none shrink-0 tracking-tighter">{formatRank(card.rank)}</span>
              <SuitIcon suit={card.suit} className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 fill-current shrink-0" />
            </div>
          </>
        )}
      </div>

      {/* BACK OF CARD */}
      <div 
        className="absolute inset-0 w-full h-full rounded-xl bg-slate-800 border border-slate-700/50 flex items-center justify-center card-shadow overflow-hidden"
        style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
      >
        <div className="absolute inset-1 border border-slate-700/30 rounded flex items-center justify-center opacity-20">
          <div className="w-10 h-14 border border-emerald-400/10 rounded" />
        </div>
      </div>
    </motion.div>
  );
};
