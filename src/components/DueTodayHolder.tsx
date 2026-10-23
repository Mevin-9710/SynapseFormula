import React, { useState, useMemo } from 'react';
import {
  Play,
  CheckCircle2,
  FastForward,
  Calendar,
  Timer,
  Layers,
  BookOpen,
  RotateCcw,
  Trophy,
} from 'lucide-react';
import {
  Deck,
  Flashcard,
  DeckSessionState,
  UserSettings,
  GameMode,
  TimeAttackDuration,
} from '../types';
import {
  isCardDueToday,
  getLocalDateKey,
  getDaysLeftBeforeExam,
  buildUnifiedReviewQueue,
  computeRoundProgress,
} from '../services/srsEngine';
import {
  getUserSettings,
  getRemainingTimeAttackSeconds,
  getGameAnalyticsState,
} from '../services/storage';

interface DueTodayHolderProps {
  decks: Deck[];
  cards: Flashcard[];
  dueSessionState?: DeckSessionState;
  settings?: UserSettings;
  onReviewDue: (options?: {
    deckId?: string;
    startCardId?: string;
    startFresh?: boolean;
    gameMode?: GameMode;
    timeLimitSeconds?: TimeAttackDuration;
  }) => void;
  onCatchUpMode?: () => void;
  onStartPractice?: () => void;
  onOpenSettings?: () => void;
}

const TIME_ATTACK_PRESETS: Array<{ seconds: TimeAttackDuration; label: string }> = [
  { seconds: 300, label: '5 min' },
  { seconds: 600, label: '10 min' },
  { seconds: 900, label: '15 min' },
];

/**
 * Calm, Minimal Home Review Experience:
 * - Single prominent primary "Review" action across the unified formula pool.
 * - Mode selector for Classic Mode (untimed 5-card rounds) and Time Attack (5 / 10 / 15 min).
 * - Never displays due counts, total card counts, backlog numbers, or mastery percentages on the home screen.
 * - Keeps unscheduled Practice / Interleaved / Drill separate from normal SRS review.
 */
export const DueTodayHolder: React.FC<DueTodayHolderProps> = ({
  decks,
  cards,
  dueSessionState,
  settings: propSettings,
  onReviewDue,
  onCatchUpMode,
  onStartPractice,
  onOpenSettings,
}) => {
  const settings = propSettings || getUserSettings();
  const gameAnalytics = useMemo(() => getGameAnalyticsState(), [dueSessionState]);
  const [selectedGameMode, setSelectedGameMode] = useState<GameMode>(
    dueSessionState?.gameMode || 'classic'
  );
  const [selectedDuration, setSelectedDuration] = useState<TimeAttackDuration>(
    dueSessionState?.timeLimitSeconds || 300
  );

  const activeCards = useMemo(() => cards.filter(c => !c.suspended), [cards]);

  const eligibleReviewQueue = useMemo(
    () => buildUnifiedReviewQueue(cards, decks, settings, new Date()),
    [cards, decks, settings]
  );

  const shouldOfferCatchUp = useMemo(() => {
    const now = new Date();
    const todayKey = getLocalDateKey(now);
    const dueCards = activeCards.filter(c => isCardDueToday(c, now, settings));
    const overdueCards = dueCards.filter(
      c =>
        (c.shiftedFromDate && c.shiftedFromDate < todayKey) ||
        getLocalDateKey(c.dueDate) < todayKey
    );
    return dueCards.length > settings.dailyReviewCap || overdueCards.length >= 15;
  }, [activeCards, settings]);

  const daysLeftBeforeExam = useMemo(
    () => getDaysLeftBeforeExam(settings.examDate),
    [settings.examDate]
  );

  const hasResumableSession = useMemo(() => {
    if (
      !dueSessionState ||
      !Array.isArray(dueSessionState.remainingQueueIds) ||
      dueSessionState.remainingQueueIds.length === 0 ||
      dueSessionState.completedInSession <= 0
    ) {
      return false;
    }
    if (dueSessionState.gameMode === 'time-attack' && dueSessionState.endsAtEpochMs) {
      const remainingSec = getRemainingTimeAttackSeconds(dueSessionState.endsAtEpochMs);
      if (remainingSec <= 0) return false;
    }
    const activeIds = new Set(activeCards.map(c => c.id));
    return dueSessionState.remainingQueueIds.some(id => activeIds.has(id));
  }, [dueSessionState, activeCards]);

  const resumedRoundInfo = useMemo(() => {
    if (!hasResumableSession || !dueSessionState) return null;
    const total =
      dueSessionState.completedInSession + dueSessionState.remainingQueueIds.length;
    return computeRoundProgress(dueSessionState.completedInSession, total);
  }, [hasResumableSession, dueSessionState]);

  const handlePrimaryReview = () => {
    if (hasResumableSession && dueSessionState) {
      onReviewDue({
        startFresh: false,
        gameMode: dueSessionState.gameMode || selectedGameMode,
        timeLimitSeconds: dueSessionState.timeLimitSeconds || selectedDuration,
      });
      return;
    }
    onReviewDue({
      startFresh: true,
      gameMode: selectedGameMode,
      timeLimitSeconds: selectedGameMode === 'time-attack' ? selectedDuration : undefined,
    });
  };

  const handleStartFreshSession = () => {
    onReviewDue({
      startFresh: true,
      gameMode: selectedGameMode,
      timeLimitSeconds: selectedGameMode === 'time-attack' ? selectedDuration : undefined,
    });
  };

  if (activeCards.length === 0) {
    return (
      <div className="py-8">
        <div className="glass-card rounded-2xl p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-black/5 dark:bg-white/10 flex items-center justify-center mx-auto">
            <BookOpen className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold tracking-tight">Formula Review Pool</h1>
            <p className="text-[13px] text-secondary-contrast max-w-xs mx-auto leading-relaxed">
              Import a formula sheet or manage your pool in Settings to begin daily spaced repetition.
            </p>
          </div>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="glass-button-primary min-h-[48px] px-5 rounded-xl text-[15px] font-bold cursor-pointer"
            >
              Open Settings & Import
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      {/* Subtle Exam Countdown Strip (when examDate is configured) */}
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
          <span className="text-xs text-secondary-contrast">
            {daysLeftBeforeExam <= 7 && daysLeftBeforeExam > 0
              ? 'Final-Week Schedule'
              : 'Exam Pacing Active'}
          </span>
        </div>
      )}

      {/* Calm Minimal Hero Card */}
      <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight">Daily Formula Review</h1>
          <p className="text-[13px] text-secondary-contrast leading-relaxed">
            {selectedGameMode === 'classic'
              ? 'Untimed active recall in focused five-card rounds.'
              : 'Timed recall challenge across your active formula pool.'}
          </p>
        </div>

        {/* Game Mode Selector: Classic vs Time Attack */}
        <div className="space-y-2.5">
          <div
            role="group"
            aria-label="Select game mode"
            className="grid grid-cols-2 gap-2 p-1 rounded-2xl glass-panel"
          >
            <button
              type="button"
              onClick={() => setSelectedGameMode('classic')}
              className={`min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                selectedGameMode === 'classic'
                  ? 'glass-button-primary shadow-xs'
                  : 'text-secondary-contrast hover:text-black dark:hover:text-white'
              }`}
            >
              <Layers className="w-4 h-4 shrink-0" />
              <span>Classic</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedGameMode('time-attack')}
              className={`min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                selectedGameMode === 'time-attack'
                  ? 'glass-button-primary shadow-xs'
                  : 'text-secondary-contrast hover:text-black dark:hover:text-white'
              }`}
            >
              <Timer className="w-4 h-4 shrink-0" />
              <span>Time Attack</span>
            </button>
          </div>

          {/* Time Attack Duration Presets: 5 min, 10 min, 15 min */}
          {selectedGameMode === 'time-attack' && (
            <div
              role="group"
              aria-label="Select Time Attack duration"
              className="grid grid-cols-3 gap-2"
            >
              {TIME_ATTACK_PRESETS.map(preset => (
                <button
                  key={preset.seconds}
                  type="button"
                  onClick={() => setSelectedDuration(preset.seconds)}
                  className={`min-h-[44px] rounded-xl text-[13px] font-bold transition-all cursor-pointer ${
                    selectedDuration === preset.seconds
                      ? 'glass-button-primary'
                      : 'glass-button text-secondary-contrast'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* High Score / Personal Bests Display on Home Screen */}
        <div className="glass-panel rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-secondary-contrast flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>High Scores</span>
            </span>
            <span className="text-[11px] font-semibold text-secondary-contrast px-2 py-0.5 rounded-md bg-black/5 dark:bg-white/10">
              {selectedGameMode === 'classic' ? 'Classic Mode' : `${selectedDuration / 60}m Timed`}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div
              className={`p-2.5 rounded-xl border transition-all ${
                selectedGameMode === 'classic'
                  ? 'bg-black/10 dark:bg-white/10 border-black/20 dark:border-white/20'
                  : 'bg-black/5 dark:bg-white/5 border-transparent'
              }`}
            >
              <div className="text-[11px] text-secondary-contrast font-medium">Classic</div>
              <div className="text-base font-bold tabular-nums mt-0.5">
                {gameAnalytics.classicBest ? `${gameAnalytics.classicBest.bestScore} pts` : '—'}
              </div>
              {gameAnalytics.classicBest && (
                <div className="text-[10px] text-secondary-contrast mt-0.5">
                  {gameAnalytics.classicBest.mostCardsCompleted} cards
                </div>
              )}
            </div>

            <div
              className={`p-2.5 rounded-xl border transition-all ${
                selectedGameMode === 'time-attack' && selectedDuration === 300
                  ? 'bg-black/10 dark:bg-white/10 border-black/20 dark:border-white/20'
                  : 'bg-black/5 dark:bg-white/5 border-transparent'
              }`}
            >
              <div className="text-[11px] text-secondary-contrast font-medium">5m Timed</div>
              <div className="text-base font-bold tabular-nums mt-0.5">
                {gameAnalytics.timeAttackBests[300]
                  ? `${gameAnalytics.timeAttackBests[300]?.bestScore} pts`
                  : '—'}
              </div>
              {gameAnalytics.timeAttackBests[300] && (
                <div className="text-[10px] text-secondary-contrast mt-0.5">
                  {gameAnalytics.timeAttackBests[300]?.mostCardsCompleted} cards
                </div>
              )}
            </div>

            <div
              className={`p-2.5 rounded-xl border transition-all ${
                selectedGameMode === 'time-attack' && selectedDuration === 600
                  ? 'bg-black/10 dark:bg-white/10 border-black/20 dark:border-white/20'
                  : 'bg-black/5 dark:bg-white/5 border-transparent'
              }`}
            >
              <div className="text-[11px] text-secondary-contrast font-medium">10m Timed</div>
              <div className="text-base font-bold tabular-nums mt-0.5">
                {gameAnalytics.timeAttackBests[600]
                  ? `${gameAnalytics.timeAttackBests[600]?.bestScore} pts`
                  : '—'}
              </div>
              {gameAnalytics.timeAttackBests[600] && (
                <div className="text-[10px] text-secondary-contrast mt-0.5">
                  {gameAnalytics.timeAttackBests[600]?.mostCardsCompleted} cards
                </div>
              )}
            </div>

            <div
              className={`p-2.5 rounded-xl border transition-all ${
                selectedGameMode === 'time-attack' && selectedDuration === 900
                  ? 'bg-black/10 dark:bg-white/10 border-black/20 dark:border-white/20'
                  : 'bg-black/5 dark:bg-white/5 border-transparent'
              }`}
            >
              <div className="text-[11px] text-secondary-contrast font-medium">15m Timed</div>
              <div className="text-base font-bold tabular-nums mt-0.5">
                {gameAnalytics.timeAttackBests[900]
                  ? `${gameAnalytics.timeAttackBests[900]?.bestScore} pts`
                  : '—'}
              </div>
              {gameAnalytics.timeAttackBests[900] && (
                <div className="text-[10px] text-secondary-contrast mt-0.5">
                  {gameAnalytics.timeAttackBests[900]?.mostCardsCompleted} cards
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Single Prominent Primary Action */}
        {eligibleReviewQueue.length > 0 || hasResumableSession ? (
          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              onClick={handlePrimaryReview}
              className="glass-button-primary w-full min-h-[56px] rounded-2xl px-5 py-3.5 text-base font-bold flex items-center justify-center gap-2.5 cursor-pointer shadow-sm"
            >
              <Play className="w-4 h-4 fill-current shrink-0" />
              <span>
                {hasResumableSession && resumedRoundInfo
                  ? `Continue Review · Round ${resumedRoundInfo.currentRound}`
                  : selectedGameMode === 'time-attack'
                  ? `Start Time Attack (${selectedDuration / 60} min)`
                  : 'Review'}
              </span>
            </button>

            {hasResumableSession && (
              <button
                type="button"
                onClick={handleStartFreshSession}
                className="glass-button w-full min-h-[44px] rounded-xl px-4 py-2 text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer text-secondary-contrast"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Start New {selectedGameMode === 'time-attack' ? 'Time Attack' : 'Classic'} Session
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="p-4 rounded-2xl glass-panel flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-black/5 dark:bg-white/10 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold tracking-tight">All Caught Up</h2>
                <p className="text-[13px] text-secondary-contrast">
                  Today’s scheduled review queue is complete.
                </p>
              </div>
            </div>

            {onStartPractice && (
              <button
                type="button"
                onClick={onStartPractice}
                className="glass-button-primary w-full min-h-[52px] rounded-2xl px-4 py-3 text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current shrink-0" />
                <span>Practice Unscheduled</span>
              </button>
            )}
          </div>
        )}

        {/* Secondary Pacing Actions (Interleaved & Cloze removed; shuffling handled in bg) */}
        {(onStartPractice || (onCatchUpMode && shouldOfferCatchUp)) && (
          <div className="pt-2 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap flex-1">
              {eligibleReviewQueue.length > 0 && onStartPractice && (
                <button
                  type="button"
                  onClick={onStartPractice}
                  className="glass-button flex-1 min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>Practice Unscheduled</span>
                </button>
              )}
            </div>

            {onCatchUpMode && shouldOfferCatchUp && (
              <button
                type="button"
                onClick={onCatchUpMode}
                className="glass-button min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                title="Spread excess overdue reviews across the next 3 days"
              >
                <FastForward className="w-3.5 h-3.5 shrink-0" />
                <span>Catch-Up Pacing</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

