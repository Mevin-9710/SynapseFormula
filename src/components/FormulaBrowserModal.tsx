import React, { useState } from 'react';
import { X, Search, Play, Trash2 } from 'lucide-react';
import { Deck, Flashcard } from '../types';
import { FormulaDisplay } from './FormulaDisplay';

interface FormulaBrowserModalProps {
  deck: Deck | null;
  cards: Flashcard[];
  isOpen: boolean;
  onClose: () => void;
  onStudyCard: (deck: Deck, cardIndex: number) => void;
  onDeleteCard?: (cardId: string) => void;
  onDeleteDeck?: (deck: Deck) => void;
}

export const FormulaBrowserModal: React.FC<FormulaBrowserModalProps> = ({
  deck,
  cards,
  isOpen,
  onClose,
  onStudyCard,
  onDeleteCard,
  onDeleteDeck,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmingCardId, setConfirmingCardId] = useState<string | null>(null);
  const [confirmingDeleteDeck, setConfirmingDeleteDeck] = useState(false);

  if (!isOpen || !deck) return null;

  const deckCards = cards.filter(c => c.deckId === deck.id);
  const filtered = deckCards.filter(c =>
    c.statement.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.formula.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.explanation?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-xs">
      <div className="glass-card rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col border border-black/10 shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-black/10 flex items-center justify-between">
          <div className="truncate pr-2">
            <h2 className="text-sm font-bold text-black truncate">
              {deck.name}
            </h2>
            <p className="text-[11px] text-black/50">
              {deckCards.length} formulas
            </p>
          </div>
          <div className="flex items-center gap-1">
            {onDeleteDeck && (
              <button
                onClick={() => setConfirmingDeleteDeck(prev => !prev)}
                className="p-2 rounded-xl text-black/40 hover:text-black cursor-pointer"
                title="Delete this entire deck"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 -mr-2 rounded-xl text-black/50 hover:text-black cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Delete Deck Inline Confirm */}
        {confirmingDeleteDeck && (
          <div className="p-3 bg-black text-white space-y-2 border-b border-white/10 animate-in fade-in duration-150">
            <p className="text-xs font-bold">Delete entire deck "{deck.name}"?</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmingDeleteDeck(false)}
                className="flex-1 py-1 px-2 rounded-lg text-xs bg-white/20 text-white font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmingDeleteDeck(false);
                  onDeleteDeck?.(deck);
                  onClose();
                }}
                className="flex-1 py-1 px-2 rounded-lg text-xs bg-white text-black font-bold cursor-pointer"
              >
                Yes, Delete Deck
              </button>
            </div>
          </div>
        )}

        {/* Search Input */}
        <div className="p-3 border-b border-black/5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search formulas or concepts..."
              className="w-full pl-8 pr-3 py-2 rounded-xl text-xs bg-white border border-black/15 focus:outline-none"
            />
          </div>
        </div>

        {/* Scrollable list: vertically stacked layout for 9:16 mobile screens */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {filtered.length > 0 ? (
            filtered.map((card, idx) => (
              <div
                key={card.id}
                className="glass-panel rounded-xl p-3 border border-black/10 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <span className="text-[10px] text-black/40 block">
                      #{idx + 1} · {card.state}
                    </span>
                    <p className="text-xs font-bold text-black leading-snug break-words">
                      {card.statement}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        onClose();
                        onStudyCard(deck, idx);
                      }}
                      className="p-2 glass-button rounded-lg text-black cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
                      title="Study this formula"
                    >
                      <Play className="w-3 h-3 fill-current" />
                    </button>
                    {onDeleteCard && (
                      confirmingCardId === card.id ? (
                        <div className="flex items-center gap-1 bg-black text-white p-1 rounded-lg animate-in fade-in duration-100">
                          <button
                            onClick={() => setConfirmingCardId(null)}
                            className="px-2 py-1 text-[10px] rounded bg-white/20 hover:bg-white/30 text-white cursor-pointer"
                          >
                            No
                          </button>
                          <button
                            onClick={() => {
                              setConfirmingCardId(null);
                              onDeleteCard(card.id);
                            }}
                            className="px-2 py-1 text-[10px] rounded bg-white text-black font-bold cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmingCardId(card.id)}
                          className="p-2 glass-button rounded-lg text-black/40 hover:text-black cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
                          title="Delete formula"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )
                    )}
                  </div>
                </div>

                <div className="py-2 px-3 rounded-lg bg-white/90 border border-black/5 text-center overflow-x-auto">
                  <FormulaDisplay formula={card.formula} size="md" />
                </div>

                {card.variables && card.variables.length > 0 && (
                  <div className="pt-2 border-t border-black/5 space-y-1.5">
                    {card.variables.map((v, i) => (
                      <div key={i} className="text-[11px] space-y-0.5 bg-black/[0.02] p-2 rounded-lg">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-black">
                            <FormulaDisplay formula={v.symbol} displayMode={false} size="xs" />
                          </span>
                          {v.unit && (
                            <span className="text-black/60 text-[10px] font-mono bg-black/5 px-1.5 py-0.2 rounded">
                              [<FormulaDisplay formula={v.unit} displayMode={false} size="xs" />]
                            </span>
                          )}
                        </div>
                        <p className="text-black/80 text-[11px] break-words">
                          {v.meaning}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-xs text-black/50">
              No matching formulas found.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-black/10 pb-safe">
          <button
            onClick={onClose}
            className="glass-button w-full h-11 rounded-xl text-xs font-semibold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
