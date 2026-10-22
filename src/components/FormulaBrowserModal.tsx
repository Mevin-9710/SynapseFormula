import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  Play,
  Trash2,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { Deck, Flashcard } from '../types';
import { isCardLeech, isCardStable } from '../services/srsEngine';
import { updateCardInStorage, getStoredCards } from '../services/storage';
import { FormulaDisplay } from './FormulaDisplay';
import { BottomSheet } from './BottomSheet';

interface FormulaBrowserModalProps {
  deck: Deck | null;
  cards: Flashcard[];
  isOpen: boolean;
  onClose: () => void;
  onStudyCard: (deck: Deck, cardIndex: number) => void;
  onDeleteCard?: (cardId: string) => void;
  onDeleteDeck?: (deck: Deck) => void;
  onCardsUpdated?: (updatedCards: Flashcard[]) => void;
}

const VIRTUAL_THRESHOLD = 100;
const INITIAL_WINDOW_SIZE = 60;
const WINDOW_STEP = 60;

/**
 * Formula Browser Bottom Sheet (5.6, 5.14, 5.15, 5.16, 5.22):
 * - Uses <BottomSheet> with drag handle, max-h-[85dvh], internal scroll, swipe-down to close
 * - Windowed virtualization above 100 rows so DOM stays small and 60fps
 * - All buttons >= 44x44px, inputs 16px, min font 12px
 */
export const FormulaBrowserModal: React.FC<FormulaBrowserModalProps> = ({
  deck,
  cards,
  isOpen,
  onClose,
  onStudyCard,
  onDeleteCard,
  onDeleteDeck,
  onCardsUpdated,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmingCardId, setConfirmingCardId] = useState<string | null>(null);
  const [confirmingDeleteDeck, setConfirmingDeleteDeck] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_WINDOW_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const deckCards = useMemo(
    () => (deck ? cards.filter(c => c.deckId === deck.id) : []),
    [cards, deck]
  );

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return deckCards;
    return deckCards.filter(
      c =>
        c.statement.toLowerCase().includes(q) ||
        c.formula.toLowerCase().includes(q) ||
        c.explanation?.toLowerCase().includes(q) ||
        c.conditions?.toLowerCase().includes(q)
    );
  }, [deckCards, searchTerm]);

  useEffect(() => {
    setVisibleCount(
      filtered.length > VIRTUAL_THRESHOLD ? INITIAL_WINDOW_SIZE : filtered.length
    );
  }, [searchTerm, deck?.id, filtered.length]);

  useEffect(() => {
    if (!isOpen || filtered.length <= VIRTUAL_THRESHOLD) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount(prev => Math.min(filtered.length, prev + WINDOW_STEP));
        }
      },
      { rootMargin: '240px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isOpen, filtered.length, visibleCount]);

  if (!isOpen || !deck) return null;

  const handleToggleSuspend = (card: Flashcard) => {
    const updated: Flashcard = {
      ...card,
      suspended: !card.suspended,
    };
    updateCardInStorage(updated);
    onCardsUpdated?.(getStoredCards());
  };

  const visibleSlice =
    filtered.length > VIRTUAL_THRESHOLD ? filtered.slice(0, visibleCount) : filtered;

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={deck.name}
      subtitle={`${deckCards.length} formulas${
        deck.sheetName ? ` · Sheet: ${deck.sheetName}` : ''
      }`}
      headerRight={
        onDeleteDeck ? (
          <button
            type="button"
            onClick={() => setConfirmingDeleteDeck(prev => !prev)}
            className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
            title="Delete this entire deck"
            aria-label="Delete deck"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        ) : undefined
      }
      footer={
        <button
          type="button"
          onClick={onClose}
          className="glass-button w-full min-h-[48px] rounded-xl text-[15px] font-semibold cursor-pointer"
        >
          Close
        </button>
      }
    >
      <div className="space-y-3">
        {/* Delete Deck Inline Confirm */}
        {confirmingDeleteDeck && (
          <div className="p-3.5 rounded-2xl bg-black dark:bg-white text-white dark:text-black space-y-2.5">
            <p className="text-[15px] font-bold">
              Delete entire deck "{deck.name}"?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDeleteDeck(false)}
                className="min-h-[44px] rounded-xl text-[13px] bg-white/20 dark:bg-black/20 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDeleteDeck(false);
                  onDeleteDeck?.(deck);
                  onClose();
                }}
                className="min-h-[44px] rounded-xl text-[13px] bg-white dark:bg-black text-black dark:text-white font-bold cursor-pointer"
              >
                Yes, Delete Deck
              </button>
            </div>
          </div>
        )}

        {/* Search Input (16px font size to prevent iOS focus-zoom) */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60" />
          <input
            type="search"
            enterKeyHint="search"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search formulas, conditions, or concepts..."
            className="w-full min-h-[44px] pl-10 pr-3.5 py-2 rounded-xl text-base bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 focus:outline-none"
          />
        </div>

        {/* Formula Rows */}
        <div className="space-y-3">
          {visibleSlice.length > 0 ? (
            <>
              {visibleSlice.map((card, idx) => {
                const leech = isCardLeech(card);
                const stable = isCardStable(card);
                const deriv = card.derivation || card.derivationSummary;
                return (
                  <div
                    key={card.id}
                    className={`glass-panel rounded-2xl p-3.5 space-y-2.5 ${
                      card.suspended ? 'opacity-65' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap text-xs text-secondary-contrast tabular-nums">
                          <span>
                            #{idx + 1} · {card.state} ({card.intervalDays}d)
                          </span>
                          {stable && (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1 font-bold text-black dark:text-white">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Stable
                              </span>
                            </>
                          )}
                          {leech && (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1 font-bold text-black dark:text-white underline underline-offset-2">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Leech ({card.lapses})
                              </span>
                            </>
                          )}
                          {card.suspended && (
                            <>
                              <span>·</span>
                              <span className="font-bold">Suspended</span>
                            </>
                          )}
                        </div>
                        <p className="text-[15px] font-bold leading-snug break-words">
                          {card.statement}
                        </p>
                      </div>

                      {/* Row actions: all >= 44x44px with 8px gap */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleSuspend(card)}
                          className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
                          title={
                            card.suspended
                              ? 'Unsuspend card'
                              : 'Suspend card from due queue'
                          }
                          aria-label={card.suspended ? 'Unsuspend card' : 'Suspend card'}
                        >
                          {card.suspended ? (
                            <PlayCircle className="w-4 h-4" />
                          ) : (
                            <PauseCircle className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onStudyCard(deck, idx);
                          }}
                          className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
                          title="Study this formula"
                          aria-label="Study this formula"
                        >
                          <Play className="w-4 h-4 fill-current" />
                        </button>

                        {onDeleteCard &&
                          (confirmingCardId === card.id ? (
                            <div className="flex items-center gap-2 bg-black dark:bg-white text-white dark:text-black p-1 rounded-xl">
                              <button
                                type="button"
                                onClick={() => setConfirmingCardId(null)}
                                className="min-h-[44px] px-3 text-xs rounded-lg bg-white/20 dark:bg-black/20 font-semibold cursor-pointer"
                              >
                                No
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmingCardId(null);
                                  onDeleteCard(card.id);
                                }}
                                className="min-h-[44px] px-3 text-xs rounded-lg bg-white dark:bg-black text-black dark:text-white font-bold cursor-pointer"
                              >
                                Delete
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmingCardId(card.id)}
                              className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
                              title="Delete formula"
                              aria-label="Delete formula"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          ))}
                      </div>
                    </div>

                    <div className="py-2.5 px-3 rounded-xl bg-white/90 dark:bg-zinc-900/90 border border-black/10 dark:border-white/10 text-center">
                      <FormulaDisplay formula={card.formula} size="md" />
                    </div>

                    {card.conditions && (
                      <div className="text-[13px] glass-panel px-3 py-2 rounded-xl">
                        <strong>Conditions:</strong> {card.conditions}
                      </div>
                    )}

                    {deriv && (
                      <div className="text-[13px] glass-panel px-3 py-2 rounded-xl text-secondary-contrast">
                        <strong>Derivation:</strong> {deriv}
                      </div>
                    )}

                    {card.variables && card.variables.length > 0 && (
                      <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-1.5">
                        {card.variables.map((v, i) => (
                          <div
                            key={i}
                            className="text-[13px] space-y-0.5 glass-panel p-2.5 rounded-xl"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold">
                                <FormulaDisplay
                                  formula={v.symbol}
                                  displayMode={false}
                                  size="xs"
                                />
                              </span>
                              {v.unit && (
                                <span className="text-xs text-secondary-contrast font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10">
                                  [
                                  <FormulaDisplay
                                    formula={v.unit}
                                    displayMode={false}
                                    size="xs"
                                  />
                                  ]
                                </span>
                              )}
                            </div>
                            <p className="text-secondary-contrast text-[13px] break-words">
                              {v.meaning}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {filtered.length > visibleCount && (
                <div ref={sentinelRef} className="py-3 text-center">
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleCount(prev => Math.min(filtered.length, prev + WINDOW_STEP))
                    }
                    className="glass-button min-h-[44px] px-4 rounded-xl text-[13px] font-semibold cursor-pointer"
                  >
                    Show more ({filtered.length - visibleCount} remaining)
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="py-8 text-center text-[15px] text-secondary-contrast">
              No matching formulas found.
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
};
