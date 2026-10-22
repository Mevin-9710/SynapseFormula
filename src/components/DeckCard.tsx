import React, { useState } from 'react';
import {
  Play,
  MoreHorizontal,
  RotateCcw,
  RefreshCw,
  List,
  Trash2,
  BookOpen,
  SlidersHorizontal,
  Target,
} from 'lucide-react';
import { Deck, Flashcard, StudySessionMode, UserSettings } from '../types';
import { isSyncDue, getNewCardQuotaForDeck, getUserSettings } from '../services/storage';
import { isCardDueToday, isCardStable, isCardLeech } from '../services/srsEngine';
import { BottomSheet } from './BottomSheet';

interface DeckCardProps {
  deck: Deck;
  cards: Flashcard[];
  allCards?: Flashcard[];
  settings?: UserSettings;
  onResume: (deck: Deck, mode: StudySessionMode) => void;
  onStartFresh: (deck: Deck, mode: StudySessionMode) => void;
  onRefreshDrive: (deck: Deck) => void;
  onDeleteDeck: (deck: Deck) => void;
  onBrowseDeck: (deck: Deck) => void;
  onUpdateDeckOverride?: (deckId: string, newCardsPerDayOverride?: number) => void;
  isSyncing?: boolean;
}

/**
 * Compact Deck Row (5.2, 5.3, 5.6, 5.20):
 * - Fake glass (.glass-panel, NO backdrop-filter for 60fps scrolling)
 * - Displays deck name, "N due · N new", and ONE primary action ("Continue" / "Review" / "Learn new" / "Practice")
 * - "⋯" button opens a BottomSheet with Browse, Learn new, Drill (Cloze/MCQ), Sync, Start Fresh, Quota override, and Delete (with confirm)
 */
export const DeckCard: React.FC<DeckCardProps> = ({
  deck,
  cards,
  allCards,
  settings: propSettings,
  onResume,
  onStartFresh,
  onRefreshDrive,
  onDeleteDeck,
  onBrowseDeck,
  onUpdateDeckOverride,
  isSyncing = false,
}) => {
  const settings = propSettings || getUserSettings();
  const syncDue = isSyncDue(deck);

  const activeCards = cards.filter(c => !c.suspended);
  const dueCards = activeCards.filter(c => isCardDueToday(c, new Date(), settings));
  const stableCards = activeCards.filter(c => isCardStable(c, settings));
  const leechCards = activeCards.filter(c => isCardLeech(c));

  const quotaInfo = getNewCardQuotaForDeck(
    deck,
    cards,
    allCards || cards,
    settings
  );

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [overrideInput, setOverrideInput] = useState(
    deck.newCardsPerDayOverride ? String(deck.newCardsPerDayOverride) : ''
  );

  const hasRecallSession = Boolean(
    dueCards.length > 0 &&
      deck.sessionState &&
      deck.sessionState.remainingQueueIds &&
      deck.sessionState.remainingQueueIds.length > 0 &&
      deck.sessionState.completedInSession > 0
  );

  const hasFirstTimeSession = Boolean(
    quotaInfo.unseenLeftInDeck > 0 &&
      deck.firstTimeSessionState &&
      deck.firstTimeSessionState.remainingQueueIds &&
      deck.firstTimeSessionState.remainingQueueIds.length > 0 &&
      deck.firstTimeSessionState.completedInSession > 0
  );

  // Determine the single primary action (5.2 & 5.3): Continue / Review / Learn new / Practice
  const handlePrimaryAction = () => {
    if (hasRecallSession) {
      onResume(deck, 'recall');
    } else if (dueCards.length > 0) {
      onStartFresh(deck, 'recall');
    } else if (hasFirstTimeSession) {
      onResume(deck, 'first-time');
    } else if (quotaInfo.availableToday > 0) {
      onStartFresh(deck, 'first-time');
    } else {
      onStartFresh(deck, 'practice');
    }
  };

  const primaryLabel =
    hasRecallSession || (dueCards.length === 0 && hasFirstTimeSession)
      ? 'Continue'
      : dueCards.length > 0
      ? 'Review'
      : quotaInfo.availableToday > 0
      ? 'Learn new'
      : 'Practice';

  const isPrimarySolid = dueCards.length > 0 || quotaInfo.availableToday > 0;

  return (
    <>
      <div className="glass-panel rounded-2xl px-3.5 py-3 flex items-center justify-between gap-2">
        {/* Left: Deck Name + "N due · N new" */}
        <div
          onClick={() => onBrowseDeck(deck)}
          className="min-w-0 flex-1 cursor-pointer py-0.5"
        >
          <h3 className="text-[15px] font-bold tracking-tight truncate">
            {deck.name}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-secondary-contrast tabular-nums mt-0.5">
            <span className={dueCards.length > 0 ? 'font-bold text-black dark:text-white' : ''}>
              {dueCards.length} due
            </span>
            <span>·</span>
            <span>
              {quotaInfo.availableToday} new today / {quotaInfo.unseenLeftInDeck} left in deck
            </span>
            {stableCards.length > 0 && (
              <>
                <span>·</span>
                <span>{stableCards.length} stable</span>
              </>
            )}
            {leechCards.length > 0 && (
              <>
                <span>·</span>
                <span className="font-semibold">{leechCards.length} leech</span>
              </>
            )}
          </div>
        </div>

        {/* Right: Single Primary Action + "⋯" Menu Button (all >= 44x44px, 8px spacing) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handlePrimaryAction}
            className={`min-h-[44px] px-3.5 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
              isPrimarySolid ? 'glass-button-primary' : 'glass-button'
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current shrink-0" />
            <span>{primaryLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsConfirmingDelete(false);
              setIsMenuOpen(true);
            }}
            aria-label={`More options for ${deck.name}`}
            className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* "⋯" Deck Options Bottom Sheet (5.2 & 5.6) */}
      <BottomSheet
        isOpen={isMenuOpen}
        onClose={() => {
          setIsMenuOpen(false);
          setIsConfirmingDelete(false);
        }}
        title={deck.name}
        subtitle={`${cards.length} formulas · ${dueCards.length} due · ${quotaInfo.availableToday} new available today / ${quotaInfo.unseenLeftInDeck} left in deck${
          deck.sheetName ? ` · Sheet: ${deck.sheetName}` : ''
        }`}
      >
        <div className="space-y-2.5">
          {/* Primary / Mode Actions */}
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen(false);
              onBrowseDeck(deck);
            }}
            className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <List className="w-4 h-4" />
              <span>Browse Formulas</span>
            </span>
            <span className="text-[13px] text-secondary-contrast tabular-nums">
              {cards.length} cards
            </span>
          </button>

          {quotaInfo.unseenLeftInDeck > 0 && (
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                if (hasFirstTimeSession) {
                  onResume(deck, 'first-time');
                } else {
                  onStartFresh(deck, 'first-time');
                }
              }}
              className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                <BookOpen className="w-4 h-4" />
                <span>Learn new</span>
              </span>
              <span className="text-[13px] text-secondary-contrast tabular-nums">
                {quotaInfo.availableToday} new available today / {quotaInfo.unseenLeftInDeck} left in deck
              </span>
            </button>
          )}

          {/* Separate Drill Mode (Cloze / MCQ) (5.7) */}
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen(false);
              onStartFresh(deck, 'drill');
            }}
            className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <Target className="w-4 h-4" />
              <span>Drill (Cloze & MCQ)</span>
            </span>
            <span className="text-[13px] text-secondary-contrast">Active term recall</span>
          </button>

          {/* Practice Mode (No Scheduling) (1.4 & 5.3) */}
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen(false);
              onStartFresh(deck, 'practice');
            }}
            className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <Play className="w-4 h-4" />
              <span>Practice (No Scheduling)</span>
            </span>
            <span className="text-[13px] text-secondary-contrast">Safe cramming</span>
          </button>

          {/* Start Fresh */}
          {(hasRecallSession || hasFirstTimeSession || dueCards.length > 0) && (
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                onStartFresh(deck, dueCards.length > 0 ? 'recall' : 'first-time');
              }}
              className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                <RotateCcw className="w-4 h-4" />
                <span>Start Fresh</span>
              </span>
              <span className="text-[13px] text-secondary-contrast">Restart queue from #1</span>
            </button>
          )}

          {/* Google Drive Re-sync */}
          {deck.googleDriveFileId && (
            <button
              type="button"
              disabled={isSyncing}
              onClick={() => {
                setIsMenuOpen(false);
                onRefreshDrive(deck);
              }}
              className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Sync with Google Drive</span>
              </span>
              <span className="text-[13px] text-secondary-contrast">
                {syncDue ? 'Update due' : deck.sheetName || 'Up to date'}
              </span>
            </button>
          )}

          {/* Per-Deck New Cards/Day Override (2.1) */}
          {onUpdateDeckOverride && (
            <div className="p-3.5 rounded-2xl glass-panel space-y-2">
              <label className="text-[13px] font-bold flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4" />
                <span>New cards / day override for this deck</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  enterKeyHint="done"
                  min={1}
                  max={500}
                  value={overrideInput}
                  onChange={e => setOverrideInput(e.target.value)}
                  placeholder={`Global default (${settings.newCardsPerDay}/day)`}
                  className="flex-1 min-h-[44px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-base tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => {
                    const num = Number(overrideInput);
                    onUpdateDeckOverride(
                      deck.id,
                      !Number.isNaN(num) && num > 0 ? Math.floor(num) : undefined
                    );
                    setIsMenuOpen(false);
                  }}
                  className="glass-button-primary min-h-[44px] px-4 rounded-xl text-[13px] font-bold cursor-pointer"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {/* Delete Deck (with Confirmation) */}
          <div className="pt-2 border-t border-black/10 dark:border-white/10">
            {isConfirmingDelete ? (
              <div className="p-3.5 rounded-2xl bg-black dark:bg-white text-white dark:text-black space-y-3">
                <p className="text-[15px] font-bold">
                  Delete "{deck.name}" and all {cards.length} formulas?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setIsConfirmingDelete(false)}
                    className="min-h-[44px] rounded-xl text-[13px] font-semibold bg-white/20 dark:bg-black/20 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsConfirmingDelete(false);
                      setIsMenuOpen(false);
                      onDeleteDeck(deck);
                    }}
                    className="min-h-[44px] rounded-xl text-[13px] font-bold bg-white dark:bg-black text-black dark:text-white cursor-pointer"
                  >
                    Yes, Delete
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(true)}
                className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
              >
                <span className="flex items-center gap-2.5">
                  <Trash2 className="w-4 h-4" />
                  <span>Delete Deck</span>
                </span>
                <span className="text-[13px] text-secondary-contrast">Requires confirm</span>
              </button>
            )}
          </div>
        </div>
      </BottomSheet>
    </>
  );
};
