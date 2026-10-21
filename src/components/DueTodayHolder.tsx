import React, { useState } from 'react';
import {
  Play,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Deck, Flashcard, DeckSessionState } from '../types';
import { isCardDueToday, formatRepeatScheduleLabel } from '../services/srsEngine';
import { FormulaDisplay } from './FormulaDisplay';

interface DueTodayHolderProps {
  decks: Deck[];
  cards: Flashcard[];
  dueSessionState?: DeckSessionState;
  onReviewDue: (options?: { deckId?: string; startCardId?: string; startFresh?: boolean }) => void;
  showExpandedCardsByDefault?: boolean;
}

export const DueTodayHolder: React.FC<DueTodayHolderProps> = ({
  decks,
  cards,
  onReviewDue,
  showExpandedCardsByDefault = false,
}) => {
  const [expandedDeckIds, setExpandedDeckIds] = useState<Record<string, boolean>>({});

  const dueCards = cards.filter(c => isCardDueToday(c));

  // Group due cards deck-wise
  const deckGroups = decks
    .map(deck => {
      const deckDueCards = dueCards.filter(c => c.deckId === deck.id);
      return {
        deck,
        dueCards: deckDueCards,
      };
    })
    .filter(g => g.dueCards.length > 0);

  const toggleDeckExpand = (deckId: string) => {
    setExpandedDeckIds(prev => ({
      ...prev,
      [deckId]: !(prev[deckId] ?? showExpandedCardsByDefault),
    }));
  };

  if (dueCards.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-4 sm:p-5 border border-black/10 shadow-xs flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-black/5 flex items-center justify-center shrink-0 text-black">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-black tracking-tight">
            Due Today · All Caught Up
          </h2>
          <p className="text-xs text-black/55 truncate">
            Zero formulas due right now.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-5 border border-black/10 shadow-xs space-y-3">
      {/* Clean Header */}
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-black tracking-tight">
          Due Today ({dueCards.length})
        </h2>
        <span className="text-xs text-black/50 tabular-nums">
          {deckGroups.length} {deckGroups.length === 1 ? 'deck' : 'decks'}
        </span>
      </div>

      {/* Deck-Wise Segregated List */}
      <div className="space-y-2">
        {deckGroups.map(({ deck, dueCards: deckDue }) => {
          const isExpanded = expandedDeckIds[deck.id] ?? showExpandedCardsByDefault;
          return (
            <div
              key={deck.id}
              className="rounded-xl bg-black/[0.025] border border-black/10 p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => toggleDeckExpand(deck.id)}
                  className="text-left min-w-0 flex-1 cursor-pointer group"
                >
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-black truncate group-hover:underline">
                      {deck.name}
                    </p>
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-black/40 shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-black/40 shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-black/55 tabular-nums">
                    {deckDue.length} {deckDue.length === 1 ? 'formula' : 'formulas'} due
                  </p>
                </button>

                <button
                  onClick={() => onReviewDue({ deckId: deck.id })}
                  className="glass-button-primary px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 min-h-[36px] cursor-pointer shrink-0"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Review</span>
                </button>
              </div>

              {/* Expandable Deck Due Cards */}
              {isExpanded && (
                <div className="space-y-1.5 pt-2 border-t border-black/5">
                  {deckDue.map((card, i) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() =>
                        onReviewDue({
                          deckId: deck.id,
                          startCardId: card.id,
                        })
                      }
                      className="w-full text-left p-2.5 rounded-lg bg-white/90 hover:bg-white border border-black/5 flex items-center justify-between gap-2 text-xs cursor-pointer transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[10px] text-black/45 tabular-nums">
                          <span>#{i + 1}</span>
                          <span>·</span>
                          <span>{formatRepeatScheduleLabel(card)}</span>
                        </div>
                        <p className="text-xs font-semibold text-black truncate">
                          {card.statement}
                        </p>
                        <div className="text-xs text-black/80 truncate">
                          <FormulaDisplay formula={card.formula} displayMode={false} size="xs" />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
