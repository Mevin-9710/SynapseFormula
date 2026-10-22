import React, { useState, useMemo } from 'react';
import {
  Play,
  CheckCircle2,
  FastForward,
  Shuffle,
  Calendar,
} from 'lucide-react';
import { Deck, Flashcard, DeckSessionState, UserSettings } from '../types';
import {
  isCardDueToday,
  getLocalDateKey,
  getDaysLeftBeforeExam,
  sortDueCardsMostOverdueFirst,
} from '../services/srsEngine';
import { getUserSettings } from '../services/storage';
import { BottomSheet } from './BottomSheet';

interface DueTodayHolderProps {
  decks: Deck[];
  cards: Flashcard[];
  dueSessionState?: DeckSessionState;
  settings?: UserSettings;
  onReviewDue: (options?: { deckId?: string; startCardId?: string; startFresh?: boolean }) => void;
  onCatchUpMode?: () => void;
  onStartInterleaved?: (selectedDeckIds: string[]) => void;
}

/**
 * Hero Due Today Card (5.1 & 5.3):
 * - One hero "Review N due" (or "Continue · N due") button across all decks at the top, thumb-reachable
 * - Catch-Up mode button when overdue backlog is high
 * - Interleaved mode launcher in a BottomSheet
 * - Exam countdown strip when examDate is active
 */
export const DueTodayHolder: React.FC<DueTodayHolderProps> = ({
  decks,
  cards,
  dueSessionState,
  settings: propSettings,
  onReviewDue,
  onCatchUpMode,
  onStartInterleaved,
}) => {
  const settings = propSettings || getUserSettings();
  const [showInterleavedSheet, setShowInterleavedSheet] = useState(false);
  const [selectedInterleavedDecks, setSelectedInterleavedDecks] = useState<Record<string, boolean>>(
    {}
  );

  const activeCards = useMemo(() => cards.filter(c => !c.suspended), [cards]);
  const dueCards = useMemo(
    () =>
      sortDueCardsMostOverdueFirst(
        activeCards.filter(c => isCardDueToday(c, new Date(), settings))
      ),
    [activeCards, settings]
  );

  const overdueCount = useMemo(() => {
    const todayKey = getLocalDateKey(new Date());
    return dueCards.filter(
      c =>
        (c.shiftedFromDate && c.shiftedFromDate < todayKey) ||
        getLocalDateKey(c.dueDate) < todayKey
    ).length;
  }, [dueCards]);

  const daysLeftBeforeExam = useMemo(
    () => getDaysLeftBeforeExam(settings.examDate),
    [settings.examDate]
  );

  const hasActiveDueSession = Boolean(
    dueCards.length > 0 &&
      dueSessionState &&
      dueSessionState.remainingQueueIds &&
      dueSessionState.remainingQueueIds.length > 0 &&
      dueSessionState.completedInSession > 0
  );

  const handleLaunchInterleaved = () => {
    if (!onStartInterleaved) return;
    const chosen = Object.keys(selectedInterleavedDecks).filter(id => selectedInterleavedDecks[id]);
    onStartInterleaved(chosen.length > 0 ? chosen : decks.map(d => d.id));
    setShowInterleavedSheet(false);
  };

  return (
    <div className="space-y-3">
      {/* Exam Countdown Banner (2.3) */}
      {daysLeftBeforeExam !== null && (
        <div className="glass-panel rounded-2xl px-4 py-3 flex items-center justify-between gap-2 text-[13px]">
          <div className="flex items-center gap-2 font-bold">
            <Calendar className="w-4 h-4 shrink-0" />
            <span>
              {daysLeftBeforeExam > 0
                ? `${daysLeftBeforeExam} ${daysLeftBeforeExam === 1 ? 'day' : 'days'} until Exam`
                : daysLeftBeforeExam === 0
                ? 'Exam Day is Today'
                : 'Exam Date Passed'}
            </span>
          </div>
          <span className="text-xs text-secondary-contrast tabular-nums">
            {daysLeftBeforeExam <= 7 && daysLeftBeforeExam > 0
              ? 'Final-Week (≤3d cap)'
              : `Cap: ${Math.max(1, Math.min(settings.maxIntervalDays, daysLeftBeforeExam - 1))}d`}
          </span>
        </div>
      )}

      {/* Hero Review N Due Card (5.1) */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        {dueCards.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => onReviewDue()}
              className="glass-button-primary w-full min-h-[54px] rounded-2xl px-4 py-3 text-[15px] font-bold flex items-center justify-between gap-3 cursor-pointer shadow-sm"
            >
              <span className="flex items-center gap-2.5">
                <Play className="w-4 h-4 fill-current shrink-0" />
                <span>
                  {hasActiveDueSession
                    ? `Continue (${dueCards.length} due)`
                    : `Review ${dueCards.length} due`}
                </span>
              </span>
              <span className="text-[13px] opacity-85 font-normal tabular-nums">
                {overdueCount > 0 ? `${overdueCount} overdue` : 'All decks'}
              </span>
            </button>

            {/* Secondary row: Catch-Up Mode (when backlog is large) & Interleaved */}
            {(onCatchUpMode &&
              (dueCards.length > settings.dailyReviewCap || overdueCount >= 15)) ||
            (onStartInterleaved && decks.length > 0) ? (
              <div className="flex items-center gap-2 flex-wrap">
                {onCatchUpMode &&
                  (dueCards.length > settings.dailyReviewCap || overdueCount >= 15) && (
                    <button
                      type="button"
                      onClick={onCatchUpMode}
                      className="glass-button flex-1 min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                      title="Keep most-overdue cards today and spread excess across the next 3 days"
                    >
                      <FastForward className="w-4 h-4 shrink-0" />
                      <span>Catch-Up Mode</span>
                    </button>
                  )}

                {onStartInterleaved && decks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowInterleavedSheet(true)}
                    className="glass-button flex-1 min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Shuffle className="w-4 h-4 shrink-0" />
                    <span>Interleaved</span>
                  </button>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-black/5 dark:bg-white/10 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold tracking-tight">All Caught Up</h2>
                <p className="text-[13px] text-secondary-contrast truncate">
                  0 due right now across your decks
                </p>
              </div>
            </div>

            {onStartInterleaved && decks.length > 0 && (
              <button
                type="button"
                onClick={() => setShowInterleavedSheet(true)}
                className="glass-button min-h-[44px] px-3.5 py-2 rounded-xl text-[13px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Shuffle className="w-4 h-4" />
                <span>Interleaved</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Interleaved Deck Selector Bottom Sheet (5.6 & 2.7) */}
      <BottomSheet
        isOpen={showInterleavedSheet}
        onClose={() => setShowInterleavedSheet(false)}
        title="Interleaved Recall"
        subtitle="Shuffled 'Which formula applies?' practice across selected decks"
        footer={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowInterleavedSheet(false)}
              className="glass-button flex-1 min-h-[44px] rounded-xl text-[13px] font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLaunchInterleaved}
              className="glass-button-primary flex-1 min-h-[44px] rounded-xl text-[13px] font-bold cursor-pointer"
            >
              Start Interleaved
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          {decks.map(d => {
            const checked = selectedInterleavedDecks[d.id] ?? true;
            return (
              <label
                key={d.id}
                className="flex items-center justify-between p-3 rounded-xl glass-panel min-h-[48px] text-[15px] cursor-pointer gap-3"
              >
                <span className="font-semibold truncate">{d.name}</span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e =>
                    setSelectedInterleavedDecks(prev => ({
                      ...prev,
                      [d.id]: e.target.checked,
                    }))
                  }
                  className="w-5 h-5 rounded"
                />
              </label>
            );
          })}
        </div>
      </BottomSheet>
    </div>
  );
};
