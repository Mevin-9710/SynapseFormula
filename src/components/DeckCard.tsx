import React from 'react';
import { Play, RotateCcw, RefreshCw, List, Trash2, BookOpen } from 'lucide-react';
import { Deck, Flashcard, StudySessionMode } from '../types';
import { isSyncDue } from '../services/storage';
import { isCardDueToday } from '../services/srsEngine';

interface DeckCardProps {
  deck: Deck;
  cards: Flashcard[];
  onResume: (deck: Deck, mode: StudySessionMode) => void;
  onStartFresh: (deck: Deck, mode: StudySessionMode) => void;
  onRefreshDrive: (deck: Deck) => void;
  onDeleteDeck: (deck: Deck) => void;
  onBrowseDeck: (deck: Deck) => void;
  isSyncing?: boolean;
}

export const DeckCard: React.FC<DeckCardProps> = ({
  deck,
  cards,
  onResume,
  onStartFresh,
  onRefreshDrive,
  onDeleteDeck,
  onBrowseDeck,
  isSyncing = false,
}) => {
  const syncDue = isSyncDue(deck);

  const dueCards = cards.filter(c => isCardDueToday(c));
  const unseenCards = cards.filter(c => !c.firstTimeReviewedAt && c.repetitionCount === 0);
  const masteredCards = cards.filter(c => c.state === 'mastered');

  const [isConfirmingDelete, setIsConfirmingDelete] = React.useState(false);

  const hasRecallSession = Boolean(
    deck.sessionState &&
    deck.sessionState.remainingQueueIds &&
    deck.sessionState.remainingQueueIds.length > 0
  );

  const hasFirstTimeSession = Boolean(
    deck.firstTimeSessionState &&
    deck.firstTimeSessionState.remainingQueueIds &&
    deck.firstTimeSessionState.remainingQueueIds.length > 0
  );

  // Only show First Time Review on the deck if there are still unseen cards in this deck
  const showFirstTimeReview = unseenCards.length > 0;

  return (
    <div className="glass-card rounded-2xl p-4 sm:p-5 flex flex-col justify-between border border-black/10 shadow-xs relative">
      {/* Top Header */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-base font-bold text-black tracking-tight leading-snug">
            {deck.name}
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            {deck.googleDriveFileId && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRefreshDrive(deck);
                }}
                disabled={isSyncing}
                title={syncDue ? '24h sync due. Tap to update from Drive' : 'Sync up to date'}
                className="p-2 rounded-xl text-black/40 hover:text-black hover:bg-black/5 transition-colors cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-black' : ''}`} />
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsConfirmingDelete(prev => !prev);
              }}
              className="p-2 -mr-1 rounded-xl text-black/40 hover:text-black hover:bg-black/5 active:scale-95 transition-all cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
              title="Delete deck"
              aria-label={`Delete ${deck.name}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Clean Metadata Line */}
        <div className="flex items-center gap-2 text-xs text-black/60 mb-4 tabular-nums">
          <span>{cards.length} formulas</span>
          <span>·</span>
          <span className={dueCards.length > 0 ? 'text-black font-semibold' : ''}>
            {dueCards.length} due
          </span>
          {masteredCards.length > 0 && (
            <>
              <span>·</span>
              <span className="text-black/50">{masteredCards.length} mastered</span>
            </>
          )}
        </div>
      </div>

      {/* Action Area */}
      <div className="space-y-2 pt-2 border-t border-black/5">
        {isConfirmingDelete ? (
          <div className="p-3 rounded-xl bg-black text-white space-y-2 animate-in fade-in duration-150">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5 text-white" />
                Delete "{deck.name}"?
              </span>
            </div>
            <p className="text-[11px] text-white/70 leading-snug">
              This will remove the deck and all {cards.length} formulas.
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(false)}
                className="py-2 px-3 rounded-lg text-xs bg-white/20 hover:bg-white/30 text-white font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsConfirmingDelete(false);
                  onDeleteDeck(deck);
                }}
                className="py-2 px-3 rounded-lg text-xs bg-white text-black font-bold hover:bg-white/90 cursor-pointer shadow-xs"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Primary Study / Resume Button */}
            {hasRecallSession ? (
              <button
                onClick={() => onResume(deck, 'recall')}
                className="glass-button-primary w-full h-11 rounded-xl text-xs font-bold flex items-center justify-between px-4 cursor-pointer shadow-sm"
              >
                <span className="flex items-center gap-2">
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Resume Card #{deck.sessionState!.lastCardIndex + 1}
                </span>
                <span className="text-[11px] text-white/60 font-normal tabular-nums">
                  {deck.sessionState!.remainingQueueIds.length} left
                </span>
              </button>
            ) : (
              <button
                onClick={() => onStartFresh(deck, 'recall')}
                className="glass-button-primary w-full h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{dueCards.length > 0 ? `Study (${dueCards.length} Due)` : 'Study Deck'}</span>
              </button>
            )}

            {/* First Time Review Button — ONLY shown while there are still unseen cards in this deck */}
            {showFirstTimeReview && (
              <button
                onClick={() =>
                  hasFirstTimeSession
                    ? onResume(deck, 'first-time')
                    : onStartFresh(deck, 'first-time')
                }
                className="glass-button w-full h-10 rounded-xl text-xs font-semibold text-black flex items-center justify-between px-3.5 cursor-pointer hover:border-black/30"
              >
                <span className="flex items-center gap-2">
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>
                    {hasFirstTimeSession ? 'Resume First Time Review' : 'First Time Review'}
                  </span>
                </span>
                <span className="text-[11px] text-black/50 font-normal tabular-nums">
                  {unseenCards.length} unseen
                </span>
              </button>
            )}

            {/* Secondary Footer Links: Start Fresh & Browse List */}
            <div className="flex items-center justify-between text-xs text-black/60 pt-0.5 px-0.5">
              {(hasRecallSession || hasFirstTimeSession) ? (
                <button
                  onClick={() =>
                    onStartFresh(deck, hasFirstTimeSession && !hasRecallSession ? 'first-time' : 'recall')
                  }
                  className="hover:text-black flex items-center gap-1 py-1 cursor-pointer min-h-[34px]"
                >
                  <RotateCcw className="w-3 h-3" />
                  Start Fresh
                </button>
              ) : (
                <span />
              )}
              <button
                onClick={() => onBrowseDeck(deck)}
                className="hover:text-black flex items-center gap-1 py-1 cursor-pointer min-h-[34px]"
              >
                <List className="w-3 h-3" />
                Browse List
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
