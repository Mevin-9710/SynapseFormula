import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  RotateCcw,
  PenTool,
  Eye,
  Trash2,
  BookOpen,
} from 'lucide-react';
import {
  Deck,
  Flashcard,
  SrsRating,
  CardStage,
  DeckSessionState,
  StudySessionMode,
} from '../types';
import {
  calculateNextReview,
  generateFormulaCloze,
  previewRatingIntervals,
  isCardDueToday,
  formatRepeatScheduleLabel,
} from '../services/srsEngine';
import {
  updateCardInStorage,
  saveDeckSessionState,
} from '../services/storage';
import { FormulaDisplay } from './FormulaDisplay';
import { Scratchpad } from './Scratchpad';

interface StudySessionProps {
  deck: Deck;
  cards: Flashcard[];
  allDecks?: Deck[];
  mode?: StudySessionMode;
  resumeFromSession?: boolean;
  initialCardIndex?: number;
  onExit: () => void;
  onDeleteCard?: (cardId: string) => void;
}

export const StudySession: React.FC<StudySessionProps> = ({
  deck,
  cards,
  allDecks = [],
  mode = 'recall',
  resumeFromSession = false,
  initialCardIndex = 0,
  onExit,
  onDeleteCard,
}) => {
  const activeSavedSession =
    mode === 'first-time' ? deck.firstTimeSessionState : deck.sessionState;

  const initialQueue = useMemo(() => {
    if (resumeFromSession && activeSavedSession?.remainingQueueIds?.length) {
      const remaining = activeSavedSession.remainingQueueIds
        .map(id => cards.find(c => c.id === id))
        .filter((c): c is Flashcard => c !== undefined);
      if (remaining.length > 0) return remaining;
    }

    if (mode === 'first-time' || mode === 'due-continuous') {
      return [...cards];
    }

    const due = cards.filter(c => isCardDueToday(c));
    return due.length > 0 ? due : [...cards];
  }, [deck, cards, resumeFromSession, mode, activeSavedSession]);

  const [queue, setQueue] = useState<Flashcard[]>(initialQueue);
  const [currentIndex, setCurrentIndex] = useState<number>(() => {
    if (initialCardIndex > 0 && initialCardIndex < initialQueue.length) {
      return initialCardIndex;
    }
    return 0;
  });

  const [isRevealed, setIsRevealed] = useState<boolean>(mode === 'first-time');
  const [activeStage, setActiveStage] = useState<CardStage>('statement');
  const [showScratchpad, setShowScratchpad] = useState(false);
  const [revealedCloze, setRevealedCloze] = useState(false);
  const [selectedClozeOption, setSelectedClozeOption] = useState<string | null>(null);
  const [completedCount, setCompletedCount] = useState<number>(() => {
    if (resumeFromSession && activeSavedSession) {
      return activeSavedSession.completedInSession || 0;
    }
    return 0;
  });
  const [isConfirmingCardDelete, setIsConfirmingCardDelete] = useState(false);

  const currentCard = queue[currentIndex];
  const totalCardsInSession = queue.length;

  const currentCardDeckName = useMemo(() => {
    if (!currentCard) return deck.name;
    const found = allDecks.find(d => d.id === currentCard.deckId);
    return found ? found.name : deck.name;
  }, [currentCard, allDecks, deck.name]);

  const ratingIntervals = useMemo(() => {
    if (!currentCard) {
      return {
        'first-time': '1d',
        again: '1m',
        hard: '10m',
        good: '1d',
        easy: '3d',
      };
    }
    return previewRatingIntervals(currentCard);
  }, [currentCard]);

  const handleConfirmDeleteCurrent = () => {
    if (!currentCard) return;
    const cardId = currentCard.id;
    setIsConfirmingCardDelete(false);
    onDeleteCard?.(cardId);

    const nextQueue = queue.filter(c => c.id !== cardId);
    if (nextQueue.length === 0) {
      setQueue([]);
      saveDeckSessionState(deck.id, undefined, mode);
    } else {
      setQueue(nextQueue);
      if (currentIndex >= nextQueue.length) {
        setCurrentIndex(nextQueue.length - 1);
      }
      setIsRevealed(mode === 'first-time');
      setActiveStage('statement');
    }
  };

  // Auto-save session state so exiting always resumes where the user left off
  useEffect(() => {
    if (!currentCard) return;

    const sessionState: DeckSessionState = {
      lastCardId: currentCard.id,
      lastCardIndex: currentIndex,
      stage: activeStage,
      remainingQueueIds: queue.slice(currentIndex).map(c => c.id),
      totalInSession: totalCardsInSession,
      completedInSession: completedCount,
      lastStudiedAt: new Date().toISOString(),
      mode,
    };

    saveDeckSessionState(deck.id, sessionState, mode);
  }, [currentIndex, activeStage, queue, deck.id, currentCard, totalCardsInSession, completedCount, mode]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!isRevealed) setIsRevealed(true);
      } else if (e.key === 's' || e.key === 'S') {
        setShowScratchpad(prev => !prev);
      } else if (e.key === 'f' || e.key === 'F' || e.key === '0') {
        handleRate('first-time');
      } else if (e.key === 'Escape') {
        onExit();
      } else if (isRevealed) {
        if (e.key === '1') handleRate('again');
        if (e.key === '2') handleRate('hard');
        if (e.key === '3') handleRate('good');
        if (e.key === '4') handleRate('easy');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRevealed, currentCard, currentIndex, queue]);

  const clozeData = useMemo(() => {
    if (!currentCard) return null;
    return generateFormulaCloze(currentCard.formula);
  }, [currentCard]);

  const handleRate = (rating: SrsRating) => {
    if (!currentCard) return;

    const nowIso = new Date().toISOString();
    const srsUpdate = calculateNextReview(currentCard, rating);
    const updatedCard: Flashcard = {
      ...currentCard,
      intervalDays: srsUpdate.nextIntervalDays,
      easeFactor: srsUpdate.nextEaseFactor,
      repetitionCount: srsUpdate.nextRepetitionCount,
      dueDate: srsUpdate.nextDueDate,
      state: srsUpdate.nextState,
      lastReviewedAt: nowIso,
      firstTimeReviewedAt:
        rating === 'first-time'
          ? nowIso
          : currentCard.firstTimeReviewedAt || nowIso,
    };

    updateCardInStorage(updatedCard);

    const nextQueue = [...queue];
    nextQueue[currentIndex] = updatedCard;

    if (rating === 'again') {
      nextQueue.push(updatedCard);
    }

    setCompletedCount(prev => prev + 1);

    if (currentIndex + 1 < nextQueue.length) {
      setQueue(nextQueue);
      setCurrentIndex(prev => prev + 1);
      setIsRevealed(mode === 'first-time');
      setActiveStage('statement');
      setRevealedCloze(false);
      setSelectedClozeOption(null);
    } else {
      setQueue([]);
      saveDeckSessionState(deck.id, undefined, mode);
    }
  };

  const handleRestartFresh = () => {
    const freshList =
      mode === 'first-time' || mode === 'due-continuous'
        ? [...cards]
        : (() => {
            const due = cards.filter(c => isCardDueToday(c));
            return due.length > 0 ? due : [...cards];
          })();

    setQueue(freshList);
    setCurrentIndex(0);
    setIsRevealed(mode === 'first-time');
    setActiveStage('statement');
    setRevealedCloze(false);
    setSelectedClozeOption(null);
    setCompletedCount(0);
  };

  if (!currentCard || queue.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-card rounded-2xl p-6 text-center w-full max-w-sm space-y-4">
          <CheckCircle2 className="w-12 h-12 mx-auto text-black" />
          <h2 className="text-xl font-bold text-black">
            Session Finished
          </h2>
          <p className="text-xs text-black/60 leading-relaxed">
            {mode === 'first-time'
              ? `You have reviewed all formulas in ${deck.name} for the first time.`
              : `All due formulas completed for ${deck.name}.`}
          </p>
          <div className="space-y-2 pt-2">
            <button
              onClick={handleRestartFresh}
              className="glass-button w-full h-11 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Start Fresh
            </button>
            <button
              onClick={onExit}
              className="glass-button-primary w-full h-11 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Back to Decks
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col pb-44">
      {/* Top Header */}
      <header className="sticky top-0 z-30 glass-panel border-b border-black/10 px-4 py-2.5 flex items-center justify-between gap-2">
        <button
          onClick={onExit}
          className="p-2 -ml-2 rounded-xl text-black/70 hover:text-black min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
          title="Save & Exit"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="text-center truncate px-1 flex-1">
          <p className="text-xs font-bold text-black truncate">
            {currentCardDeckName}
          </p>
          <p className="text-[11px] text-black/50 tabular-nums">
            {currentIndex + 1} / {queue.length}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleRestartFresh}
            className="p-2 rounded-xl text-black/60 hover:text-black min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
            title="Start Fresh"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {onDeleteCard && (
            <button
              onClick={() => setIsConfirmingCardDelete(prev => !prev)}
              className="p-2 rounded-xl text-black/40 hover:text-black min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
              title="Delete formula from deck"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setShowScratchpad(prev => !prev)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1 min-h-[40px] cursor-pointer ${
              showScratchpad ? 'bg-black text-white' : 'glass-button text-black'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Draw</span>
          </button>
        </div>
      </header>

      {/* Delete Formula Inline Confirmation */}
      {isConfirmingCardDelete && (
        <div className="bg-black text-white px-4 py-2.5 flex items-center justify-between text-xs animate-in fade-in duration-100 z-30">
          <span className="text-[11px] font-semibold truncate pr-2">
            Delete this formula from deck?
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setIsConfirmingCardDelete(false)}
              className="px-2.5 py-1 rounded-md text-[11px] bg-white/20 text-white hover:bg-white/30 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDeleteCurrent}
              className="px-2.5 py-1 rounded-md text-[11px] bg-white text-black font-bold hover:bg-white/90 cursor-pointer"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Progress Line */}
      <div className="w-full bg-black/5 h-1">
        <div
          className="bg-black h-full transition-all duration-300"
          style={{ width: `${((currentIndex + 1) / queue.length) * 100}%` }}
        />
      </div>

      {/* Main Flashcard Container */}
      <div className="flex-1 max-w-md mx-auto w-full p-4 flex flex-col justify-start space-y-3">
        {/* Mobile Scratchpad Drawer overlay when open */}
        {showScratchpad && (
          <div className="animate-in slide-in-from-top-2 duration-150">
            <Scratchpad className="h-[200px]" />
          </div>
        )}

        <div className="glass-card rounded-2xl p-4 sm:p-5 border border-black/10 shadow-xs flex flex-col space-y-4">
          {/* Card Category & Schedule Header */}
          <div className="flex items-center justify-between text-[11px] text-black/45 pb-2 border-b border-black/5">
            <span className="truncate pr-2">
              {currentCard.category || 'Physics'}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatRepeatScheduleLabel(currentCard)}
            </span>
          </div>

          {/* Statement */}
          <div className="text-center py-2">
            <p className="text-sm sm:text-base font-medium text-black leading-relaxed break-words">
              {currentCard.statement}
            </p>
          </div>

          {/* Formula Stage (if revealed) */}
          {isRevealed && (
            <div className="space-y-3 pt-2 border-t border-black/5 animate-in fade-in duration-150">
              {/* Minimal segmented control for stage */}
              <div className="flex items-center justify-center bg-black/5 p-1 rounded-xl text-xs">
                <button
                  onClick={() => setActiveStage('statement')}
                  className={`flex-1 py-1.5 rounded-lg text-center font-medium cursor-pointer ${
                    activeStage === 'statement' ? 'bg-white text-black font-bold shadow-xs' : 'text-black/50'
                  }`}
                >
                  Formula
                </button>
                <button
                  onClick={() => setActiveStage('cloze')}
                  className={`flex-1 py-1.5 rounded-lg text-center font-medium cursor-pointer ${
                    activeStage === 'cloze' ? 'bg-white text-black font-bold shadow-xs' : 'text-black/50'
                  }`}
                >
                  Cloze (?)
                </button>
                {currentCard.variables && currentCard.variables.length > 0 && (
                  <button
                    onClick={() => setActiveStage('variables')}
                    className={`flex-1 py-1.5 rounded-lg text-center font-medium cursor-pointer ${
                      activeStage === 'variables' ? 'bg-white text-black font-bold shadow-xs' : 'text-black/50'
                    }`}
                  >
                    Variables
                  </button>
                )}
              </div>

              {/* View 1: Formula */}
              {activeStage === 'statement' && (
                <div className="py-3 px-2 text-center bg-white/90 rounded-xl border border-black/5 overflow-hidden">
                  <FormulaDisplay formula={currentCard.formula} size="lg" />
                  {currentCard.explanation && (
                    <p className="text-[11px] text-black/60 mt-2 italic leading-relaxed break-words">
                      {currentCard.explanation}
                    </p>
                  )}
                </div>
              )}

              {/* View 2: Cloze Drill */}
              {activeStage === 'cloze' && clozeData && (
                <div className="py-3 px-3 text-center bg-white/90 rounded-xl border border-black/5 space-y-3 overflow-hidden">
                  <div className="py-1">
                    <FormulaDisplay
                      formula={revealedCloze ? currentCard.formula : clozeData.maskedFormula}
                      size="lg"
                    />
                  </div>

                  {!revealedCloze ? (
                    <div className="space-y-2.5 pt-1">
                      <span className="text-[11px] text-black/60 block">
                        Select the term that replaces <span className="font-bold text-black font-mono">?</span>:
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {clozeData.options.map((opt, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setSelectedClozeOption(opt);
                              setRevealedCloze(true);
                            }}
                            className="glass-button p-2.5 rounded-xl text-black hover:border-black transition-colors cursor-pointer min-h-[46px] flex items-center justify-center shadow-xs"
                          >
                            <FormulaDisplay formula={opt} displayMode={false} size="sm" />
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setRevealedCloze(true)}
                        className="text-[11px] text-black/40 hover:text-black underline block mx-auto pt-1 cursor-pointer"
                      >
                        Reveal without selecting
                      </button>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-black/5 text-xs text-black flex flex-col sm:flex-row items-center justify-center gap-1.5">
                      <span className="text-black/60 text-[11px]">Missing term:</span>
                      <span className="font-bold">
                        <FormulaDisplay formula={clozeData.hiddenTerm} displayMode={false} size="md" />
                      </span>
                      {selectedClozeOption && (
                        <span className="text-[10px] text-black/50">
                          {selectedClozeOption === clozeData.hiddenTerm ? '(Correct!)' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* View 3: Variables & Units */}
              {activeStage === 'variables' && (
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {currentCard.variables?.map((v, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-xl bg-white/95 border border-black/10 text-xs space-y-1 shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold text-black text-sm">
                          <FormulaDisplay formula={v.symbol} displayMode={false} size="sm" />
                        </div>
                        {v.unit && (
                          <div className="text-[10px] text-black/70 bg-black/5 px-2 py-0.5 rounded-md font-mono shrink-0">
                            [<FormulaDisplay formula={v.unit} displayMode={false} size="xs" />]
                          </div>
                        )}
                      </div>
                      <p className="text-black/80 text-xs leading-relaxed break-words pt-0.5">
                        {v.meaning}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!isRevealed && (
            <div className="text-center text-[11px] text-black/40 pt-2">
              Tap bottom button to reveal formula
            </div>
          )}
        </div>
      </div>

      {/* Pinned Thumb Zone Action Bar with "First Time Review" + 4 Recall Ratings */}
      <div className="fixed bottom-0 left-0 right-0 z-40 glass-panel border-t border-black/10 p-3 pb-safe bg-white/95">
        <div className="max-w-md mx-auto space-y-2">
          {!isRevealed ? (
            <button
              onClick={() => setIsRevealed(true)}
              className="glass-button-primary w-full h-13 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <Eye className="w-4 h-4" />
              Reveal Formula (Space)
            </button>
          ) : (
            <div className="space-y-2">
              {/* First Time Review button: shown while card is unseen or during a First Time Review walkthrough */}
              {(mode === 'first-time' || (!currentCard.firstTimeReviewedAt && currentCard.repetitionCount === 0)) && (
                <button
                  onClick={() => handleRate('first-time')}
                  className="glass-button w-full h-11 rounded-xl px-3 flex items-center justify-between text-xs text-black font-semibold hover:border-black/30 cursor-pointer"
                >
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <BookOpen className="w-3.5 h-3.5 shrink-0" />
                    <span>First Time Review</span>
                  </span>
                  <span className="text-[10px] text-black/50 tabular-nums whitespace-nowrap">
                    {ratingIntervals['first-time']}
                  </span>
                </button>
              )}

              {/* 4 Active Recall Rating Buttons: Again, Hard, Good, Easy */}
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => handleRate('again')}
                  className="glass-button h-12 rounded-xl flex flex-col items-center justify-center cursor-pointer"
                >
                  <span className="text-xs font-bold text-black">Again</span>
                  <span className="text-[10px] text-black/50 tabular-nums">
                    {ratingIntervals.again}
                  </span>
                </button>
                <button
                  onClick={() => handleRate('hard')}
                  className="glass-button h-12 rounded-xl flex flex-col items-center justify-center cursor-pointer"
                >
                  <span className="text-xs font-bold text-black">Hard</span>
                  <span className="text-[10px] text-black/50 tabular-nums">
                    {ratingIntervals.hard}
                  </span>
                </button>
                <button
                  onClick={() => handleRate('good')}
                  className="glass-button h-12 rounded-xl flex flex-col items-center justify-center cursor-pointer"
                >
                  <span className="text-xs font-bold text-black">Good</span>
                  <span className="text-[10px] text-black/50 tabular-nums">
                    {ratingIntervals.good}
                  </span>
                </button>
                <button
                  onClick={() => handleRate('easy')}
                  className="glass-button-primary h-12 rounded-xl flex flex-col items-center justify-center cursor-pointer shadow-xs"
                >
                  <span className="text-xs font-bold text-white">Easy</span>
                  <span className="text-[10px] text-white/70 tabular-nums">
                    {ratingIntervals.easy}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
