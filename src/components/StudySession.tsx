import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  Trash2,
  FastForward,
  BookOpen,
  Undo2,
  AlertTriangle,
  PauseCircle,
  Edit3,
  Split,
  ShieldCheck,
  MoreHorizontal,
  PenTool,
  RotateCcw,
  Check,
  Zap,
  Timer,
  Trophy,
} from 'lucide-react';
import {
  Flashcard,
  Deck,
  CardStage,
  SrsRating,
  StudySessionMode,
  UserSettings,
  GameMode,
  TimeAttackDuration,
} from '../types';
import {
  calculateNextReview,
  previewRatingIntervals,
  isCardDueToday,
  isCardLeech,
  isCardStable,
  sortDueCardsMostOverdueFirst,
  buildUnifiedReviewQueue,
  calculateRatingScoreDelta,
  computeRoundProgress,
} from '../services/srsEngine';
import {
  updateCardInStorage,
  saveDeckSessionState,
  clearDeckSessionState,
  shiftRemainingTodayCardsToTomorrow,
  getStoredCards,
  getUserSettings,
  getNewCardQuotaForDeck,
  splitCardInStorage,
  markFirstSessionCompleted,
  getRemainingTimeAttackSeconds,
  recordCompletedGameSession,
  getGameAnalyticsState,
} from '../services/storage';
import { appendReviewLog, removeReviewLogById } from '../services/reviewLog';
import { FormulaDisplay, preloadFormulaRender } from './FormulaDisplay';
import { FormattedText } from './FormattedText';
import { Scratchpad } from './Scratchpad';
import { BottomSheet } from './BottomSheet';

interface StudySessionProps {
  deck: Deck;
  cards: Flashcard[];
  allDecks?: Deck[];
  allCards?: Flashcard[];
  mode?: StudySessionMode;
  gameMode?: GameMode;
  timeLimitSeconds?: TimeAttackDuration;
  resumeFromSession?: boolean;
  initialCardIndex?: number;
  settings?: UserSettings;
  onExit: () => void;
  onDeleteCard?: (cardId: string) => void;
  onCardsMutated?: (updatedCards: Flashcard[], updatedDecks?: Deck[]) => void;
}

interface UndoSnapshot {
  cardBeforeRating: Flashcard;
  queueBeforeRating: Flashcard[];
  indexBeforeRating: number;
  completedBeforeRating: number;
  scoreBeforeRating: number;
  correctBeforeRating: number;
  incorrectBeforeRating: number;
  reviewLogId?: string;
  ratingLabel: string;
}

const formatCountdownMmSs = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

export const StudySession: React.FC<StudySessionProps> = ({
  deck,
  cards,
  allDecks = [],
  allCards = [],
  mode = 'recall',
  gameMode: propGameMode = 'classic',
  timeLimitSeconds: propTimeLimitSeconds = 300,
  resumeFromSession = false,
  initialCardIndex = 0,
  settings: propSettings,
  onExit,
  onDeleteCard,
  onCardsMutated,
}) => {
  const settings = useMemo(() => propSettings || getUserSettings(), [propSettings]);
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [stage, setStage] = useState<CardStage>('statement');
  const [isRevealed, setIsRevealed] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [timeExpired, setTimeExpired] = useState(false);
  const [shiftedToTomorrowCount, setShiftedToTomorrowCount] = useState<number | null>(null);

  // Game Mode, Score, Accuracy & Timer State
  const [activeGameMode, setActiveGameMode] = useState<GameMode>(propGameMode);
  const [activeTimeLimit, setActiveTimeLimit] = useState<TimeAttackDuration>(propTimeLimitSeconds);
  const [sessionId, setSessionId] = useState<string>(
    () => `gsess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );
  const [score, setScore] = useState<number>(0);
  const [correctCount, setCorrectCount] = useState<number>(0);
  const [incorrectCount, setIncorrectCount] = useState<number>(0);
  const [startedAtEpochMs, setStartedAtEpochMs] = useState<number>(() => Date.now());
  const [endsAtEpochMs, setEndsAtEpochMs] = useState<number | undefined>(undefined);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(propTimeLimitSeconds);
  const [isNewPersonalBest, setIsNewPersonalBest] = useState<boolean>(false);

  // Celebratory Round-Completion Pop Up Modal after each 5-card round
  const [completedRoundModal, setCompletedRoundModal] = useState<{
    roundNumber: number;
    scoreAtRound: number;
  } | null>(null);
  const roundModalOpenTimeRef = useRef<number | null>(null);
  const hasEndedSessionRef = useRef<boolean>(false);

  // Leave mid-session confirmation pop up modal
  const [showLeaveConfirmModal, setShowLeaveConfirmModal] = useState<boolean>(false);

  // Header "⋯" Menu & Scratchpad Draw state (5.9 & 5.13)
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [showScratchpad, setShowScratchpad] = useState(false);
  const [confirmDeleteCurrent, setConfirmDeleteCurrent] = useState(false);

  // Undo last rating state + 5s Undo Toast for swipe gestures (2.6 & 5.10)
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [undoToastVisible, setUndoToastVisible] = useState(false);
  const undoToastTimerRef = useRef<number | null>(null);

  // Swipe gesture tracking (5.10: optional setting, off by default)
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  // Leech / Card Edit & Split state (2.4)
  const [leechActionMode, setLeechActionMode] = useState<'none' | 'edit' | 'split'>('none');
  const [editStatement, setEditStatement] = useState('');
  const [editFormula, setEditFormula] = useState('');
  const [editConditions, setEditConditions] = useState('');
  const [splitStatementB, setSplitStatementB] = useState('');
  const [splitFormulaB, setSplitFormulaB] = useState('');

  // Track time spent on current card for ReviewLog (2.5)
  const cardStartTimeRef = useRef<number>(Date.now());
  // Track how many new cards were introduced in this session for quota spreading (2.1)
  const sessionNewIntroducedRef = useRef<number>(0);

  const deckQuotaInfo = useMemo(() => {
    const pool = allCards.length > 0 ? allCards : getStoredCards();
    return getNewCardQuotaForDeck(deck, cards, pool, settings);
  }, [deck, cards, allCards, settings]);

  const showRoundCompletionPopup = (roundNum: number, scoreAtRound: number) => {
    roundModalOpenTimeRef.current = Date.now();
    setCompletedRoundModal({ roundNumber: roundNum, scoreAtRound });
  };

  const handleDismissRoundModal = () => {
    if (roundModalOpenTimeRef.current && endsAtEpochMs) {
      const elapsedModalMs = Math.max(0, Date.now() - roundModalOpenTimeRef.current);
      // Pause countdown timer during round celebration so user isn't penalized
      setEndsAtEpochMs(prev => (prev ? prev + elapsedModalMs : prev));
    }
    roundModalOpenTimeRef.current = null;
    setCompletedRoundModal(null);
  };

  useEffect(() => {
    return () => {
      if (undoToastTimerRef.current) {
        window.clearTimeout(undoToastTimerRef.current);
      }
    };
  }, []);

  // Screen Wake Lock API (5.12): Keep screen awake during a study session
  useEffect(() => {
    let wakeLockSentinel: any = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && (navigator as any).wakeLock?.request) {
          wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // WakeLock may fail on low battery or unsupported browser; fail silently
      }
    };
    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockSentinel && typeof wakeLockSentinel.release === 'function') {
        wakeLockSentinel.release().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    cardStartTimeRef.current = Date.now();
  }, [currentIndex, queue]);

  // Finalize session & record game analytics idempotently (once per sessionId)
  const finalizeGameSession = useCallback(
    (finalParams: {
      finalScore: number;
      finalCompleted: number;
      finalCorrect: number;
      finalIncorrect: number;
      expiredByTimer?: boolean;
    }) => {
      if (hasEndedSessionRef.current) return;
      hasEndedSessionRef.current = true;

      clearDeckSessionState(deck.id, mode);

      if (mode !== 'practice' && mode !== 'first-time') {
        const res = recordCompletedGameSession({
          id: sessionId,
          mode: activeGameMode,
          durationSeconds: activeGameMode === 'time-attack' ? activeTimeLimit : undefined,
          score: finalParams.finalScore,
          cardsCompleted: finalParams.finalCompleted,
          correctCount: finalParams.finalCorrect,
          incorrectCount: finalParams.finalIncorrect,
          roundsCompleted: Math.floor(finalParams.finalCompleted / 5),
          completedAt: new Date().toISOString(),
        });
        setIsNewPersonalBest(res.isNewPersonalBest);
      }

      if (finalParams.expiredByTimer) {
        setTimeExpired(true);
      }
      setSessionFinished(true);
    },
    [deck.id, mode, sessionId, activeGameMode, activeTimeLimit]
  );

  useEffect(() => {
    const activeCards = cards.filter(c => !c.suspended);
    if (activeCards.length === 0) {
      setQueue([]);
      return;
    }

    hasEndedSessionRef.current = false;
    setTimeExpired(false);
    setIsNewPersonalBest(false);
    setCompletedRoundModal(null);

    const savedSession =
      mode === 'first-time' ? deck.firstTimeSessionState : deck.sessionState;

    if (
      resumeFromSession &&
      mode !== 'practice' &&
      mode !== 'drill' &&
      savedSession &&
      savedSession.remainingQueueIds.length > 0
    ) {
      // If resuming a Time Attack session whose wall-clock deadline already passed, start fresh or end cleanly
      const resumedGameMode = savedSession.gameMode || propGameMode;
      const resumedLimit = savedSession.timeLimitSeconds || propTimeLimitSeconds;
      const isExpiredTimeAttack =
        resumedGameMode === 'time-attack' &&
        savedSession.endsAtEpochMs &&
        getRemainingTimeAttackSeconds(savedSession.endsAtEpochMs) <= 0;

      if (!isExpiredTimeAttack) {
        const lookupPool = allCards.length > 0 ? allCards.filter(c => !c.suspended) : activeCards;
        const remaining = savedSession.remainingQueueIds
          .map(id => lookupPool.find(c => c.id === id))
          .filter((c): c is Flashcard => Boolean(c));

        if (remaining.length > 0) {
          setQueue(remaining);
          setCurrentIndex(0);
          setStage('statement');
          setCompletedCount(savedSession.completedInSession || 0);
          setScore(savedSession.score || 0);
          setCorrectCount(savedSession.correctCount || 0);
          setIncorrectCount(savedSession.incorrectCount || 0);
          setActiveGameMode(resumedGameMode);
          setActiveTimeLimit(resumedLimit);
          setSessionId(
            savedSession.sessionId ||
              `gsess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
          );
          const nowMs = Date.now();
          setStartedAtEpochMs(savedSession.startedAtEpochMs || nowMs);
          if (resumedGameMode === 'time-attack') {
            const deadline =
              savedSession.endsAtEpochMs || nowMs + resumedLimit * 1000;
            setEndsAtEpochMs(deadline);
            setRemainingSeconds(getRemainingTimeAttackSeconds(deadline, nowMs));
          } else {
            setEndsAtEpochMs(undefined);
          }
          return;
        }
      }
    }

    // Fresh session initialization
    const freshSessionId = `gsess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const nowMs = Date.now();
    setSessionId(freshSessionId);
    setScore(0);
    setCorrectCount(0);
    setIncorrectCount(0);
    setCompletedCount(0);
    setActiveGameMode(propGameMode);
    setActiveTimeLimit(propTimeLimitSeconds);
    setStartedAtEpochMs(nowMs);
    if (propGameMode === 'time-attack' && mode !== 'practice' && mode !== 'first-time') {
      const deadline = nowMs + propTimeLimitSeconds * 1000;
      setEndsAtEpochMs(deadline);
      setRemainingSeconds(propTimeLimitSeconds);
    } else {
      setEndsAtEpochMs(undefined);
    }

    if (mode === 'first-time') {
      const unseenCards = activeCards.filter(
        c => !c.firstTimeReviewedAt && c.repetitionCount === 0
      );
      const firstTimeQueue = unseenCards.length > 0 ? unseenCards : [...activeCards];
      const safeStart = Math.min(Math.max(0, initialCardIndex), firstTimeQueue.length - 1);
      const sliced =
        safeStart > 0
          ? [...firstTimeQueue.slice(safeStart), ...firstTimeQueue.slice(0, safeStart)]
          : firstTimeQueue;
      setQueue(sliced);
      setCurrentIndex(0);
      setStage('statement');
      return;
    }

    if (mode === 'practice' || mode === 'drill') {
      const safeStart = Math.min(Math.max(0, initialCardIndex), activeCards.length - 1);
      const practiceQueue =
        safeStart > 0
          ? [...activeCards.slice(safeStart), ...activeCards.slice(0, safeStart)]
          : [...activeCards];
      setQueue(practiceQueue);
      setCurrentIndex(0);
      setStage('statement');
      return;
    }

    if (mode === 'due-continuous') {
      // If deck is the unified review pool, cards passed in are already priority-shuffled by buildUnifiedReviewQueue
      const baseDue =
        deck.id === '__due_today__'
          ? activeCards.slice(0, settings.dailyReviewCap)
          : sortDueCardsMostOverdueFirst(activeCards).slice(0, settings.dailyReviewCap);
      const safeStart = Math.min(Math.max(0, initialCardIndex), Math.max(0, baseDue.length - 1));
      const dueQueue =
        safeStart > 0
          ? [...baseDue.slice(safeStart), ...baseDue.slice(0, safeStart)]
          : baseDue;
      setQueue(dueQueue);
      setCurrentIndex(0);
      setStage('statement');
      return;
    }

    // Standard 'recall' mode: use unified priority queue for eligible due + quota new cards
    const unifiedEligible = buildUnifiedReviewQueue(
      activeCards,
      allDecks,
      settings,
      new Date()
    );
    const baseQueue = unifiedEligible.length > 0 ? unifiedEligible : [...activeCards];
    const safeStart = Math.min(Math.max(0, initialCardIndex), baseQueue.length - 1);
    const orderedQueue =
      safeStart > 0
        ? [...baseQueue.slice(safeStart), ...baseQueue.slice(0, safeStart)]
        : baseQueue;

    setQueue(orderedQueue);
    setCurrentIndex(0);
    setStage('statement');
  }, [
    deck.id,
    cards.length,
    resumeFromSession,
    initialCardIndex,
    mode,
    propGameMode,
    propTimeLimitSeconds,
  ]);

  // Wall-clock Time Attack countdown effect (survives background tabs & refreshes without drift)
  useEffect(() => {
    if (
      activeGameMode !== 'time-attack' ||
      !endsAtEpochMs ||
      sessionFinished ||
      queue.length === 0 ||
      mode === 'practice' ||
      mode === 'first-time'
    ) {
      return;
    }

    const tick = () => {
      const rem = getRemainingTimeAttackSeconds(endsAtEpochMs, Date.now());
      setRemainingSeconds(rem);
      if (rem <= 0) {
        // End session cleanly without rating the unanswered card or altering its SRS schedule
        finalizeGameSession({
          finalScore: score,
          finalCompleted: completedCount,
          finalCorrect: correctCount,
          finalIncorrect: incorrectCount,
          expiredByTimer: true,
        });
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 250);
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        tick();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [
    activeGameMode,
    endsAtEpochMs,
    sessionFinished,
    queue.length,
    mode,
    score,
    completedCount,
    correctCount,
    incorrectCount,
    finalizeGameSession,
  ]);

  const currentCard = queue[currentIndex];
  const nextCard = queue[currentIndex + 1];

  // Total cards in this session (preserved across resumptions and adjusted if cards are deleted/suspended)
  const totalCardsInSession = useMemo(
    () => completedCount + Math.max(0, queue.length - currentIndex),
    [completedCount, queue.length, currentIndex]
  );

  const roundProgress = useMemo(
    () => computeRoundProgress(completedCount, totalCardsInSession, 5),
    [completedCount, totalCardsInSession]
  );

  // Requirement 5.24: Preload the next card's formula render while the current card is shown
  useEffect(() => {
    if (nextCard?.formula) {
      preloadFormulaRender(nextCard.formula, true);
      if (nextCard.variables) {
        for (const v of nextCard.variables) {
          preloadFormulaRender(v.symbol, false);
          if (v.unit) preloadFormulaRender(v.unit, false);
        }
      }
    }
  }, [nextCard]);

  const currentCardDeckName = useMemo(() => {
    if (!currentCard) return deck.name;
    const found = allDecks.find(d => d.id === currentCard.deckId);
    return found ? found.name : deck.name;
  }, [currentCard, allDecks, deck.name]);

  const ratingPreviews = useMemo(() => {
    if (!currentCard) return null;
    return previewRatingIntervals(currentCard, {
      maxIntervalDays: settings.maxIntervalDays,
      examDate: settings.examDate,
    });
  }, [currentCard, settings.maxIntervalDays, settings.examDate]);

  // Save session progress whenever card, round, or score changes (except in practice / drill mode)
  useEffect(() => {
    if (
      !currentCard ||
      sessionFinished ||
      queue.length === 0 ||
      mode === 'practice' ||
      mode === 'drill'
    ) {
      return;
    }

    const remainingIds = queue.slice(currentIndex).map(c => c.id);
    saveDeckSessionState(
      deck.id,
      {
        lastCardId: currentCard.id,
        lastCardIndex: currentIndex,
        stage,
        remainingQueueIds: remainingIds,
        totalInSession: totalCardsInSession,
        completedInSession: completedCount,
        lastStudiedAt: new Date().toISOString(),
        mode,
        sessionId,
        gameMode: activeGameMode,
        score,
        correctCount,
        incorrectCount,
        timeLimitSeconds: activeGameMode === 'time-attack' ? activeTimeLimit : undefined,
        startedAtEpochMs,
        endsAtEpochMs,
      },
      mode
    );
  }, [
    currentIndex,
    stage,
    currentCard?.id,
    sessionFinished,
    mode,
    deck.id,
    queue,
    totalCardsInSession,
    completedCount,
    sessionId,
    activeGameMode,
    score,
    correctCount,
    incorrectCount,
    activeTimeLimit,
    startedAtEpochMs,
    endsAtEpochMs,
  ]);

  // Keyboard shortcuts for rapid study (Again = 1, Good = 2 or 3, Easy = 4; Hard removed)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showLeaveConfirmModal) {
        e.preventDefault();
        setShowLeaveConfirmModal(false);
        return;
      }

      if (
        sessionFinished ||
        !currentCard ||
        leechActionMode !== 'none' ||
        isMoreMenuOpen ||
        showLeaveConfirmModal
      ) {
        return;
      }
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey || !isRevealed)) {
        if (undoSnapshot) {
          e.preventDefault();
          handleUndoLastRating();
          return;
        }
      }

      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault();
        if (!isRevealed) {
          setIsRevealed(true);
        } else if (mode === 'practice') {
          handlePracticeNext();
        } else if (mode === 'first-time') {
          handleRateCard('first-time');
        }
      } else if (mode === 'first-time' && (e.key === 'f' || e.key === 'F' || e.key === '0')) {
        e.preventDefault();
        if (isRevealed) {
          handleRateCard('first-time');
        } else {
          setIsRevealed(true);
        }
      } else if (isRevealed && mode !== 'first-time' && mode !== 'practice') {
        if (e.key === '1') handleRateCard('again');
        if (e.key === '2' || e.key === '3') handleRateCard('good');
        if (e.key === '4') handleRateCard('easy');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isRevealed,
    currentIndex,
    stage,
    sessionFinished,
    currentCard,
    mode,
    undoSnapshot,
    leechActionMode,
    isMoreMenuOpen,
  ]);

  const triggerHapticTick = () => {
    if (settings.hapticsEnabled !== false && typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(10);
      } catch {
        // ignore on unsupported devices
      }
    }
  };

  const showUndoToast5s = () => {
    if (undoToastTimerRef.current) {
      window.clearTimeout(undoToastTimerRef.current);
    }
    setUndoToastVisible(true);
    undoToastTimerRef.current = window.setTimeout(() => {
      setUndoToastVisible(false);
    }, 5000);
  };

  const resetCardInteractionState = () => {
    setIsRevealed(false);
    setConfirmDeleteCurrent(false);
    setLeechActionMode('none');
  };

  const handlePracticeNext = () => {
    triggerHapticTick();
    const nextCompleted = completedCount + 1;
    const nextRoundInfo = computeRoundProgress(nextCompleted, totalCardsInSession, 5);
    if (nextRoundInfo.justCompletedRound !== null) {
      showRoundCompletionPopup(nextRoundInfo.justCompletedRound, score);
    }

    if (currentIndex + 1 < queue.length) {
      setCurrentIndex(prev => prev + 1);
      setCompletedCount(nextCompleted);
      resetCardInteractionState();
    } else {
      setCompletedCount(nextCompleted);
      markFirstSessionCompleted();
      setSessionFinished(true);
    }
  };

  const handleRateCard = async (rating: SrsRating, viaSwipe = false) => {
    if (!currentCard || sessionFinished) return;

    // Guard: prevent 'first-time' rating outside of first-time mode
    if (rating === 'first-time' && mode !== 'first-time') {
      return;
    }

    // Guard: Practice mode never writes SRS fields
    if (mode === 'practice') {
      handlePracticeNext();
      return;
    }

    // If Time Attack timer already expired right as user tapped, end cleanly without rating
    if (
      activeGameMode === 'time-attack' &&
      endsAtEpochMs &&
      getRemainingTimeAttackSeconds(endsAtEpochMs, Date.now()) <= 0
    ) {
      finalizeGameSession({
        finalScore: score,
        finalCompleted: completedCount,
        finalCorrect: correctCount,
        finalIncorrect: incorrectCount,
        expiredByTimer: true,
      });
      return;
    }

    triggerHapticTick();

    // Calculate spreadDayOffset if in 'first-time' mode and over today's new card quota
    let spreadDayOffset = 1;
    if (rating === 'first-time') {
      sessionNewIntroducedRef.current += 1;
      const quotaLeftBeforeThisCard =
        deckQuotaInfo.availableToday - (sessionNewIntroducedRef.current - 1);
      if (quotaLeftBeforeThisCard <= 0) {
        const overQuotaIndex = Math.abs(quotaLeftBeforeThisCard);
        const dailyLimit = Math.max(1, deckQuotaInfo.dailyLimitForDeck);
        spreadDayOffset = 1 + Math.ceil((overQuotaIndex + 1) / dailyLimit);
      }
    }

    // Learned-only scoring: +3 for Good/Easy and -1 for Again ONLY when testing a formula already learned
    const scoreDeltaInfo = calculateRatingScoreDelta(currentCard, rating);
    const nextScore = score + scoreDeltaInfo.pointsDelta;
    const nextCorrect =
      correctCount + (scoreDeltaInfo.isRecallTrial && scoreDeltaInfo.isCorrectRecall ? 1 : 0);
    const nextIncorrect =
      incorrectCount + (scoreDeltaInfo.isRecallTrial && !scoreDeltaInfo.isCorrectRecall ? 1 : 0);
    const nextCompleted = completedCount + 1;

    const prevInterval = currentCard.intervalDays;
    const elapsedMs = Math.max(100, Date.now() - cardStartTimeRef.current);

    const srsResult = calculateNextReview(currentCard, rating, {
      maxIntervalDays: settings.maxIntervalDays,
      examDate: settings.examDate,
      spreadDayOffset,
    });

    const nowIso = new Date().toISOString();
    const updatedCard: Flashcard = {
      ...currentCard,
      intervalDays: srsResult.nextIntervalDays,
      easeFactor: srsResult.nextEaseFactor,
      repetitionCount: srsResult.nextRepetitionCount,
      dueDate: srsResult.nextDueDate,
      state: srsResult.nextState,
      lapses: srsResult.nextLapses,
      consecutiveGoods: srsResult.nextConsecutiveGoods,
      lastReviewedAt: rating === 'first-time' ? currentCard.lastReviewedAt : nowIso,
      firstTimeReviewedAt:
        rating === 'first-time'
          ? nowIso
          : currentCard.firstTimeReviewedAt || nowIso,
      shiftedFromDate: undefined,
      repetitionStage: 'statement',
    };

    const logEntry = await appendReviewLog({
      cardId: currentCard.id,
      deckId: currentCard.deckId,
      ts: Date.now(),
      rating,
      prevInterval,
      newInterval: srsResult.nextIntervalDays,
      ms: elapsedMs,
    });

    // Save single-level undo snapshot including score and accuracy before rating
    setUndoSnapshot({
      cardBeforeRating: { ...currentCard },
      queueBeforeRating: [...queue],
      indexBeforeRating: currentIndex,
      completedBeforeRating: completedCount,
      scoreBeforeRating: score,
      correctBeforeRating: correctCount,
      incorrectBeforeRating: incorrectCount,
      reviewLogId: logEntry.id,
      ratingLabel: rating === 'first-time' ? 'Learn' : rating.toUpperCase(),
    });

    if (viaSwipe) {
      showUndoToast5s();
    }

    updateCardInStorage(updatedCard);
    markFirstSessionCompleted();

    setScore(nextScore);
    setCorrectCount(nextCorrect);
    setIncorrectCount(nextIncorrect);
    setCompletedCount(nextCompleted);

    const updatedQueue = [...queue];
    updatedQueue[currentIndex] = updatedCard;
    setQueue(updatedQueue);

    const nextRoundInfo = computeRoundProgress(nextCompleted, totalCardsInSession, 5);
    if (nextRoundInfo.justCompletedRound !== null) {
      showRoundCompletionPopup(nextRoundInfo.justCompletedRound, nextScore);
    }

    if (currentIndex + 1 < queue.length) {
      setCurrentIndex(prev => prev + 1);
      resetCardInteractionState();
    } else {
      finalizeGameSession({
        finalScore: nextScore,
        finalCompleted: nextCompleted,
        finalCorrect: nextCorrect,
        finalIncorrect: nextIncorrect,
        expiredByTimer: false,
      });
    }
  };

  const handleUndoLastRating = async () => {
    if (!undoSnapshot) return;
    const {
      cardBeforeRating,
      queueBeforeRating,
      indexBeforeRating,
      completedBeforeRating,
      scoreBeforeRating,
      correctBeforeRating,
      incorrectBeforeRating,
      reviewLogId,
    } = undoSnapshot;

    updateCardInStorage(cardBeforeRating);
    if (reviewLogId) {
      await removeReviewLogById(reviewLogId);
    }

    hasEndedSessionRef.current = false;
    setQueue(queueBeforeRating);
    setCurrentIndex(indexBeforeRating);
    setCompletedCount(completedBeforeRating);
    setScore(scoreBeforeRating);
    setCorrectCount(correctBeforeRating);
    setIncorrectCount(incorrectBeforeRating);
    setCompletedRoundModal(null);
    setSessionFinished(false);
    setTimeExpired(false);
    setUndoSnapshot(null);
    setUndoToastVisible(false);
    resetCardInteractionState();
  };

  // Optional swipe gestures (5.10: off by default, swipe left = Again, swipe right = Good)
  const handleCardTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!settings.swipeGesturesEnabled || !isRevealed || showScratchpad) return;
    const t = e.touches[0];
    swipeStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleCardTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!settings.swipeGesturesEnabled || !isRevealed || !swipeStartRef.current || showScratchpad) {
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStartRef.current.x;
    const dy = t.clientY - swipeStartRef.current.y;
    swipeStartRef.current = null;

    if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      if (mode === 'first-time') {
        handleRateCard('first-time', true);
      } else if (mode === 'practice') {
        handlePracticeNext();
      } else if (dx < 0) {
        handleRateCard('again', true);
      } else {
        handleRateCard('good', true);
      }
    }
  };

  const handleShiftRemainingToTomorrow = () => {
    const allStoredCards = getStoredCards();
    const targetDeckId =
      deck.id === '__due_today__' ||
      deck.id === '__custom_calendar_session__' ||
      deck.id === '__interleaved_session__'
        ? undefined
        : deck.id;

    const { shiftedCount } = shiftRemainingTodayCardsToTomorrow(allStoredCards, targetDeckId);
    clearDeckSessionState(deck.id, mode);
    setIsMoreMenuOpen(false);
    setShiftedToTomorrowCount(shiftedCount);
    setSessionFinished(true);
  };

  const handleSuspendCurrentCard = () => {
    if (!currentCard) return;
    const suspendedCard: Flashcard = {
      ...currentCard,
      suspended: true,
    };
    updateCardInStorage(suspendedCard);
    onCardsMutated?.(getStoredCards());
    setIsMoreMenuOpen(false);

    const nextQueue = queue.filter(c => c.id !== currentCard.id);
    if (nextQueue.length === 0 || currentIndex >= nextQueue.length) {
      finalizeGameSession({
        finalScore: score,
        finalCompleted: completedCount,
        finalCorrect: correctCount,
        finalIncorrect: incorrectCount,
      });
      return;
    }
    setQueue(nextQueue);
    resetCardInteractionState();
  };

  const handleOpenLeechEdit = () => {
    if (!currentCard) return;
    setEditStatement(currentCard.statement);
    setEditFormula(currentCard.formula);
    setEditConditions(currentCard.conditions || '');
    setIsMoreMenuOpen(false);
    setLeechActionMode('edit');
  };

  const handleSaveLeechEdit = () => {
    if (!currentCard || !editStatement.trim() || !editFormula.trim()) return;
    const updated: Flashcard = {
      ...currentCard,
      statement: editStatement.trim(),
      formula: editFormula.trim(),
      conditions: editConditions.trim() || undefined,
    };
    updateCardInStorage(updated);
    onCardsMutated?.(getStoredCards());
    const nextQueue = [...queue];
    nextQueue[currentIndex] = updated;
    setQueue(nextQueue);
    setLeechActionMode('none');
  };

  const handleOpenLeechSplit = () => {
    if (!currentCard) return;
    setEditStatement(currentCard.statement);
    setEditFormula(currentCard.formula);
    setEditConditions(currentCard.conditions || '');
    setSplitStatementB(`${currentCard.statement} (Part 2)`);
    setSplitFormulaB(currentCard.formula);
    setIsMoreMenuOpen(false);
    setLeechActionMode('split');
  };

  const handleConfirmLeechSplit = () => {
    if (
      !currentCard ||
      !editStatement.trim() ||
      !editFormula.trim() ||
      !splitStatementB.trim() ||
      !splitFormulaB.trim()
    ) {
      return;
    }
    const { updatedCards, updatedDecks, cardA, cardB } = splitCardInStorage(
      currentCard,
      { statement: editStatement, formula: editFormula, conditions: editConditions },
      { statement: splitStatementB, formula: splitFormulaB, conditions: editConditions }
    );
    onCardsMutated?.(updatedCards, updatedDecks);
    const nextQueue = [...queue];
    nextQueue.splice(currentIndex, 1, cardA, cardB);
    setQueue(nextQueue);
    setLeechActionMode('none');
  };

  const handleDeleteCurrentCard = () => {
    if (!currentCard || !onDeleteCard) return;
    const deletedId = currentCard.id;
    onDeleteCard(deletedId);

    const nextQueue = queue.filter(c => c.id !== deletedId);
    setConfirmDeleteCurrent(false);
    setIsMoreMenuOpen(false);

    if (nextQueue.length === 0 || currentIndex >= nextQueue.length) {
      finalizeGameSession({
        finalScore: score,
        finalCompleted: completedCount,
        finalCorrect: correctCount,
        finalIncorrect: incorrectCount,
      });
      return;
    }

    setQueue(nextQueue);
    resetCardInteractionState();
  };

  const formatStatementText = (text: string) => {
    return <FormattedText text={text} />;
  };

  const handleBackClick = () => {
    if (sessionFinished || queue.length === 0) {
      onExit();
      return;
    }
    setShowLeaveConfirmModal(true);
  };

  const handleConfirmLeaveAndSave = () => {
    setShowLeaveConfirmModal(false);

    if (mode !== 'practice' && mode !== 'first-time') {
      recordCompletedGameSession(
        {
          id: sessionId,
          mode: activeGameMode,
          durationSeconds: activeGameMode === 'time-attack' ? activeTimeLimit : undefined,
          score,
          cardsCompleted: completedCount,
          correctCount,
          incorrectCount,
          roundsCompleted: Math.floor(completedCount / 5),
          completedAt: new Date().toISOString(),
        },
        { forceHighScore: true }
      );
    }

    onExit();
  };

  if (queue.length === 0) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 glass-card rounded-2xl text-center space-y-4">
        <CheckCircle2 className="w-8 h-8 mx-auto" />
        <h2 className="text-[15px] font-bold">All Caught Up</h2>
        <p className="text-[13px] text-secondary-contrast">No active flashcards in this queue.</p>
        <button
          onClick={onExit}
          className="glass-button-primary min-h-[44px] px-5 py-2.5 rounded-xl text-[13px] font-bold cursor-pointer"
        >
          Back
        </button>
      </div>
    );
  }

  if (sessionFinished) {
    const gameStats = getGameAnalyticsState();
    const modePersonalBest =
      activeGameMode === 'time-attack'
        ? gameStats.timeAttackBests[activeTimeLimit]
        : gameStats.classicBest;
    const recallTotal = correctCount + incorrectCount;
    const accuracyPct =
      recallTotal > 0 ? Math.round((correctCount / recallTotal) * 100) : null;

    return (
      <div className="max-w-md mx-auto my-10 px-4">
        <div className="p-6 glass-card rounded-2xl text-center space-y-5">
          <div className="w-11 h-11 rounded-full bg-black dark:bg-white text-white dark:text-black flex items-center justify-center mx-auto">
            {timeExpired ? <Timer className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6" />}
          </div>

          <div className="space-y-1.5">
            <h2 className="text-lg font-bold">
              {shiftedToTomorrowCount !== null
                ? 'Shifted to Tomorrow'
                : timeExpired
                ? `Time’s Up (${activeTimeLimit / 60} min)`
                : mode === 'first-time'
                ? 'Learn Session Complete'
                : mode === 'practice'
                ? 'Practice Complete'
                : mode === 'drill'
                ? 'Drill Complete'
                : activeGameMode === 'time-attack'
                ? 'Time Attack Complete'
                : 'Session Complete'}
            </h2>
            <p className="text-[13px] text-secondary-contrast">
              {shiftedToTomorrowCount !== null ? (
                <>
                  Moved <span className="font-bold">{shiftedToTomorrowCount}</span> remaining due{' '}
                  {shiftedToTomorrowCount === 1 ? 'card' : 'cards'} to Tomorrow’s schedule.
                </>
              ) : mode === 'practice' ? (
                <>
                  Practiced <span className="font-bold">{completedCount}</span> formulas without
                  altering your SRS schedule.
                </>
              ) : (
                <>
                  Completed <span className="font-bold">{completedCount}</span>{' '}
                  {completedCount === 1 ? 'card' : 'cards'} across{' '}
                  <span className="font-bold">{Math.floor(completedCount / 5)}</span> full{' '}
                  {Math.floor(completedCount / 5) === 1 ? 'round' : 'rounds'}.
                </>
              )}
            </p>
          </div>

          {shiftedToTomorrowCount === null && mode !== 'practice' && mode !== 'first-time' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-3 rounded-xl glass-panel">
                  <div className="text-xs font-bold uppercase text-secondary-contrast">Score</div>
                  <div className="text-lg font-extrabold tabular-nums">
                    {score > 0 ? `+${score}` : score}
                  </div>
                </div>
                <div className="p-3 rounded-xl glass-panel">
                  <div className="text-xs font-bold uppercase text-secondary-contrast">Cards</div>
                  <div className="text-lg font-extrabold tabular-nums">{completedCount}</div>
                </div>
                <div className="p-3 rounded-xl glass-panel">
                  <div className="text-xs font-bold uppercase text-secondary-contrast">Recall</div>
                  <div className="text-lg font-extrabold tabular-nums">
                    {accuracyPct !== null ? `${accuracyPct}%` : '—'}
                  </div>
                </div>
              </div>

              {modePersonalBest && (
                <div className="p-3 rounded-xl glass-panel flex items-center justify-between text-xs">
                  <span className="font-semibold flex items-center gap-1.5 text-secondary-contrast">
                    <Trophy className="w-3.5 h-3.5" />
                    <span>
                      {activeGameMode === 'time-attack'
                        ? `Time Attack (${activeTimeLimit / 60}m) Personal Best`
                        : 'Classic Mode Personal Best'}
                    </span>
                  </span>
                  <span className="font-bold tabular-nums">
                    {modePersonalBest.bestScore > 0
                      ? `+${modePersonalBest.bestScore}`
                      : modePersonalBest.bestScore}{' '}
                    pts · {modePersonalBest.mostCardsCompleted} cards
                    {isNewPersonalBest ? ' (New!)' : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1">
            {undoSnapshot && shiftedToTomorrowCount === null && !timeExpired && (
              <button
                onClick={handleUndoLastRating}
                className="glass-button min-h-[44px] rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Undo2 className="w-4 h-4" />
                <span>Undo Last Rating</span>
              </button>
            )}
            <button
              onClick={onExit}
              className="glass-button-primary min-h-[48px] rounded-xl text-[15px] font-bold cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentIsLeech = isCardLeech(currentCard);
  const currentIsStable = isCardStable(currentCard, settings);
  const cardDerivation = currentCard.derivation || currentCard.derivationSummary;

  return (
    <div className="min-h-dvh w-full max-w-xl landscape:max-w-4xl mx-auto flex flex-col pt-safe pl-safe pr-safe">
      {/* Header: Sticky top bar with Back, 5-Card Round & Overall Progress, Score, Timer, Undo, and "⋯" menu */}
      <header className="sticky top-0 z-20 glass-chrome border-b px-4 pt-2.5 pb-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleBackClick}
            aria-label="Back to review home"
            className="glass-button min-h-[44px] min-w-[44px] px-3 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </button>

          {/* Round Indicator & Round Progress Bar */}
          <div className="flex-1 min-w-0 px-2 text-center space-y-1">
            <div className="flex items-center justify-center gap-2 text-xs sm:text-[13px] font-bold tabular-nums flex-wrap">
              <span>Round {roundProgress.currentRound}</span>

              {mode !== 'practice' && mode !== 'first-time' && (
                <span className="px-2 py-0.5 rounded-lg bg-black/5 dark:bg-white/10 font-mono text-xs">
                  {score > 0 ? `+${score}` : score} pts
                </span>
              )}

              {activeGameMode === 'time-attack' && endsAtEpochMs && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono text-xs ${
                    remainingSeconds <= 30
                      ? 'bg-black text-white dark:bg-white dark:text-black'
                      : 'bg-black/5 dark:bg-white/10'
                  }`}
                >
                  <Timer className="w-3 h-3 shrink-0" />
                  <span>{formatCountdownMmSs(remainingSeconds)}</span>
                </span>
              )}
            </div>

            <div
              className="w-full h-1.5 bg-black/10 dark:bg-white/15 rounded-full overflow-hidden"
              role="progressbar"
              aria-label={`Round ${roundProgress.currentRound} progress`}
              aria-valuenow={roundProgress.roundPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-black dark:bg-white transition-all duration-150"
                style={{ width: `${roundProgress.roundPercent}%` }}
              />
            </div>
          </div>

          {/* Right controls: Visible Undo button + "⋯" Menu */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleUndoLastRating}
              disabled={!undoSnapshot}
              aria-label="Undo last rating"
              title="Undo last rating (Z)"
              className="glass-button min-h-[44px] min-w-[44px] px-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1 disabled:opacity-35 cursor-pointer"
            >
              <Undo2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                setConfirmDeleteCurrent(false);
                setIsMoreMenuOpen(true);
              }}
              aria-label="Card options menu"
              className="glass-button min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center cursor-pointer"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Leave Mid-Session Confirmation Pop Up Modal */}
      {showLeaveConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-session-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
        >
          <div className="glass-card max-w-sm w-full rounded-3xl p-6 text-center space-y-5 border shadow-2xl relative">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center shadow-inner">
              <Trophy className="w-7 h-7" />
            </div>

            <div className="space-y-2">
              <h2 id="leave-session-title" className="text-xl font-bold tracking-tight">
                Leave Session?
              </h2>
              <p className="text-[14px] text-secondary-contrast leading-relaxed font-medium">
                Are you sure you want to leave? Your current score will be saved as your high score.
              </p>
            </div>

            <div className="p-3 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 flex items-center justify-around text-center">
              <div>
                <div className="text-[11px] font-medium text-secondary-contrast uppercase tracking-wider">
                  Current Score
                </div>
                <div className="text-lg font-bold tabular-nums mt-0.5">
                  {score > 0 ? `+${score}` : score} pts
                </div>
              </div>
              <div className="h-8 w-px bg-black/10 dark:bg-white/10" />
              <div>
                <div className="text-[11px] font-medium text-secondary-contrast uppercase tracking-wider">
                  Cards Rated
                </div>
                <div className="text-lg font-bold tabular-nums mt-0.5">
                  {completedCount}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowLeaveConfirmModal(false)}
                className="glass-button min-h-[48px] rounded-xl text-[14px] font-semibold cursor-pointer"
              >
                Stay
              </button>
              <button
                type="button"
                autoFocus
                onClick={handleConfirmLeaveAndSave}
                className="glass-button-primary min-h-[48px] rounded-xl text-[14px] font-bold cursor-pointer shadow-sm"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Celebratory Congratulatory Pop Up Modal after each 5-card round */}
      {completedRoundModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="round-complete-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
        >
          <div className="glass-card max-w-sm w-full rounded-3xl p-6 text-center space-y-5 border shadow-2xl relative">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center shadow-inner">
              <Trophy className="w-8 h-8" />
            </div>

            <div className="space-y-1.5">
              <h2 id="round-complete-title" className="text-xl font-bold tracking-tight">
                Round {completedRoundModal.roundNumber} Complete!
              </h2>
              <p className="text-[13px] text-secondary-contrast leading-relaxed">
                {completedRoundModal.roundNumber === 1
                  ? "Great job! First round in the books — keep up the fantastic momentum!"
                  : `Terrific focus! You have conquered ${completedRoundModal.roundNumber * 5} formulas so far.`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 text-center">
              <div>
                <div className="text-[11px] font-medium text-secondary-contrast uppercase tracking-wider">
                  Score
                </div>
                <div className="text-lg font-bold tabular-nums mt-0.5">
                  {completedRoundModal.scoreAtRound > 0
                    ? `+${completedRoundModal.scoreAtRound}`
                    : completedRoundModal.scoreAtRound}{' '}
                  pts
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-secondary-contrast uppercase tracking-wider">
                  Formulas
                </div>
                <div className="text-lg font-bold tabular-nums mt-0.5">
                  {completedRoundModal.roundNumber * 5}
                </div>
              </div>
            </div>

            <button
              type="button"
              autoFocus
              onClick={handleDismissRoundModal}
              className="glass-button-primary w-full min-h-[50px] rounded-xl text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <span>Continue to Round {completedRoundModal.roundNumber + 1}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area: Natural mobile vertical scroll; Portrait = stacked; Landscape (5.19) = side-by-side */}
      <div className="flex-1 flex flex-col landscape:flex-row landscape:items-start landscape:gap-4 px-4 pt-3 pb-36 landscape:pb-6">
        {/* Flashcard Column */}
        <div className="flex-1 w-full flex flex-col my-1 space-y-3 min-w-0">
          <div
            onTouchStart={handleCardTouchStart}
            onTouchEnd={handleCardTouchEnd}
            onClick={() => {
              if (
                !isRevealed &&
                mode !== 'interleaved' &&
                mode !== 'drill' &&
                leechActionMode === 'none'
              ) {
                setIsRevealed(true);
              }
            }}
            className={`glass-card rounded-2xl p-4 sm:p-5 min-h-[260px] flex flex-col justify-between transition-colors ${
              !isRevealed && mode !== 'interleaved' && mode !== 'drill'
                ? 'cursor-pointer'
                : ''
            }`}
          >
            {/* Top Metadata Line (Clean unboxed text + Leech/Stable indicators) */}
            <div className="space-y-2 mb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-secondary-contrast">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold">{currentCardDeckName}</span>
                  {currentCard.category && (
                    <>
                      <span>·</span>
                      <span>{currentCard.category}</span>
                    </>
                  )}
                  {currentIsStable && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 font-bold text-black dark:text-white">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Stable
                      </span>
                    </>
                  )}
                  {currentIsLeech && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 font-bold text-black dark:text-white underline underline-offset-2">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Leech ({currentCard.lapses} lapses)
                      </span>
                    </>
                  )}
                </div>

                {currentCard.shiftedFromDate && (
                  <span className="text-xs text-secondary-contrast">
                    Due {currentCard.shiftedFromDate}
                  </span>
                )}
              </div>

              {/* Leech Action Banner: Edit / Split / Suspend (2.4) */}
              {currentIsLeech && leechActionMode === 'none' && (
                <div
                  onClick={e => e.stopPropagation()}
                  className="p-3 rounded-xl glass-panel flex items-center justify-between gap-2 flex-wrap text-[13px]"
                >
                  <span className="font-semibold">
                    Leech card ({currentCard.lapses} lapses):
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleOpenLeechEdit}
                      className="glass-button min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenLeechSplit}
                      className="glass-button min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Split className="w-3.5 h-3.5" />
                      <span>Split</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSuspendCurrentCard}
                      className="glass-button-primary min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <PauseCircle className="w-3.5 h-3.5" />
                      <span>Suspend</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Inline Leech Edit / Split Editor (inputs 16px text-base) */}
              {leechActionMode !== 'none' && (
                <div
                  onClick={e => e.stopPropagation()}
                  className="p-3.5 rounded-2xl glass-panel space-y-3"
                >
                  <div className="text-[15px] font-bold">
                    {leechActionMode === 'edit' ? 'Edit Formula Card' : 'Split into 2 Cards'}
                  </div>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editStatement}
                      onChange={e => setEditStatement(e.target.value)}
                      placeholder="Statement (Card 1)"
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-base"
                    />
                    <input
                      type="text"
                      value={editFormula}
                      onChange={e => setEditFormula(e.target.value)}
                      placeholder="LaTeX Formula (Card 1)"
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-base font-mono"
                    />
                    <input
                      type="text"
                      value={editConditions}
                      onChange={e => setEditConditions(e.target.value)}
                      placeholder="Conditions (optional, e.g. constant acceleration only)"
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-base"
                    />
                  </div>
                  {leechActionMode === 'split' && (
                    <div className="space-y-2 pt-2 border-t border-black/10 dark:border-white/10">
                      <input
                        type="text"
                        value={splitStatementB}
                        onChange={e => setSplitStatementB(e.target.value)}
                        placeholder="Statement (Card 2)"
                        className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-base"
                      />
                      <input
                        type="text"
                        value={splitFormulaB}
                        onChange={e => setSplitFormulaB(e.target.value)}
                        placeholder="LaTeX Formula (Card 2)"
                        className="w-full min-h-[44px] px-3 rounded-xl bg-white dark:bg-zinc-900 border border-black/15 dark:border-white/15 text-base font-mono"
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setLeechActionMode('none')}
                      className="glass-button min-h-[44px] px-4 rounded-xl text-[13px] font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={
                        leechActionMode === 'edit' ? handleSaveLeechEdit : handleConfirmLeechSplit
                      }
                      className="glass-button-primary min-h-[44px] px-4 rounded-xl text-[13px] font-bold cursor-pointer"
                    >
                      {leechActionMode === 'edit' ? 'Save Card' : 'Split Card'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Standard Flow: Statement -> Reveal -> Formula + Variables -> Rate */}
            <div className="space-y-5 my-auto">
              <h2 className="text-[17px] sm:text-lg font-semibold leading-relaxed break-words">
                {formatStatementText(currentCard.statement)}
              </h2>

              {isRevealed ? (
                <div className="pt-4 border-t border-black/10 dark:border-white/10 space-y-4">
                  <div className="p-4 rounded-xl bg-white/95 dark:bg-zinc-900/95 border border-black/10 dark:border-white/10 text-center">
                    <FormulaDisplay formula={currentCard.formula} size="lg" />
                  </div>

                  <CardPostRevealDetails card={currentCard} derivation={cardDerivation} />
                </div>
              ) : (
                <div className="pt-8 text-center">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      setIsRevealed(true);
                    }}
                    className="glass-button w-full min-h-[52px] rounded-xl text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Tap anywhere to reveal formula</span>
                  </button>
                </div>
              )}
            </div>

            <div />
          </div>

          {/* Optional Drawing Scratchpad (5.13: toggled from ⋯ menu) */}
          {showScratchpad && <Scratchpad />}
        </div>

        {/* Fixed Bottom Rating Bar in Portrait / Side-by-Side in Landscape (5.8 & 5.19) */}
        <div className="fixed bottom-0 left-0 right-0 z-30 glass-chrome border-t px-4 pt-2.5 pb-safe pl-safe pr-safe landscape:static landscape:w-64 landscape:border landscape:rounded-2xl landscape:p-3 landscape:flex landscape:flex-col landscape:justify-center shrink-0">
          <div className="max-w-xl mx-auto w-full">
            {isRevealed ? (
              mode === 'practice' ? (
                <button
                  type="button"
                  onClick={handlePracticeNext}
                  className="glass-button-primary w-full min-h-[56px] rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <span>Next Practice Card →</span>
                </button>
              ) : mode === 'first-time' && ratingPreviews ? (
                <button
                  type="button"
                  onClick={() => handleRateCard('first-time')}
                  className="glass-button-primary w-full min-h-[56px] rounded-2xl text-[15px] font-bold flex items-center justify-between px-4 cursor-pointer shadow-sm"
                >
                  <span className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4" />
                    <span>Learn · Got It</span>
                  </span>
                  <span className="text-[13px] opacity-85 font-mono tabular-nums">
                    {ratingPreviews['first-time']}
                  </span>
                </button>
              ) : ratingPreviews ? (
                /* 3 Equal Rating Buttons: Again (-1 when learned), Good (+3 when learned), Easy (+3 when learned) */
                <div className="grid grid-cols-3 landscape:grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => handleRateCard('again')}
                    className="glass-button min-h-[56px] py-2 px-1.5 rounded-xl border-dashed border-2 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                  >
                    <span className="text-[13px] font-bold flex items-center gap-1">
                      <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                      <span>Again</span>
                    </span>
                    <span className="text-xs font-mono text-secondary-contrast tabular-nums">
                      {ratingPreviews.again}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRateCard('good')}
                    className="glass-button-primary min-h-[56px] py-2 px-1.5 rounded-xl flex flex-col items-center justify-center gap-0.5 cursor-pointer shadow-xs"
                  >
                    <span className="text-[13px] font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span>Good</span>
                    </span>
                    <span className="text-xs font-mono opacity-85 tabular-nums">
                      {ratingPreviews.good}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRateCard('easy')}
                    className="glass-button min-h-[56px] py-2 px-1.5 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 cursor-pointer"
                  >
                    <span className="text-[13px] font-bold flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 shrink-0" />
                      <span>Easy</span>
                    </span>
                    <span className="text-xs font-mono text-secondary-contrast tabular-nums">
                      {ratingPreviews.easy}
                    </span>
                  </button>
                </div>
              ) : null
            ) : (
              <button
                type="button"
                onClick={() => setIsRevealed(true)}
                className="glass-button-primary w-full min-h-[56px] rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>Show Formula</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 5s Undo Toast for Swipe Gestures (5.10) */}
      {undoToastVisible && undoSnapshot && (
        <div className="fixed bottom-24 left-4 right-4 max-w-sm mx-auto z-40 glass-chrome rounded-xl px-4 py-2.5 border flex items-center justify-between gap-3 shadow-lg">
          <span className="text-[13px] font-semibold">
            Rated {undoSnapshot.ratingLabel}
          </span>
          <button
            type="button"
            onClick={handleUndoLastRating}
            className="glass-button-primary min-h-[44px] px-3.5 rounded-xl text-[13px] font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>
        </div>
      )}

      {/* Header "⋯" Bottom Sheet (5.9): Edit, Split, Suspend, Draw — Delete separated at bottom, never next to Draw */}
      <BottomSheet
        isOpen={isMoreMenuOpen}
        onClose={() => {
          setIsMoreMenuOpen(false);
          setConfirmDeleteCurrent(false);
        }}
        title="Card Actions"
        subtitle={currentCardDeckName}
      >
        <div className="space-y-2.5">
          {/* Draw / Scratchpad Toggle (placed at top, far away from Delete) */}
          <button
            type="button"
            onClick={() => {
              setShowScratchpad(prev => !prev);
              setIsMoreMenuOpen(false);
            }}
            className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <PenTool className="w-4 h-4" />
              <span>{showScratchpad ? 'Hide Drawing Pad' : 'Open Drawing Pad'}</span>
            </span>
            <span className="text-[13px] text-secondary-contrast">Scratchpad</span>
          </button>

          {/* Edit Card */}
          <button
            type="button"
            onClick={handleOpenLeechEdit}
            className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <Edit3 className="w-4 h-4" />
              <span>Edit Formula Card</span>
            </span>
          </button>

          {/* Split Card */}
          <button
            type="button"
            onClick={handleOpenLeechSplit}
            className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <Split className="w-4 h-4" />
              <span>Split into 2 Cards</span>
            </span>
          </button>

          {/* Suspend Card */}
          <button
            type="button"
            onClick={handleSuspendCurrentCard}
            className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <PauseCircle className="w-4 h-4" />
              <span>Suspend Card</span>
            </span>
            <span className="text-[13px] text-secondary-contrast">Exclude from due</span>
          </button>

          {/* Postpone Remaining to Tomorrow */}
          {mode !== 'first-time' && mode !== 'practice' && (
            <button
              type="button"
              onClick={handleShiftRemainingToTomorrow}
              className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                <FastForward className="w-4 h-4" />
                <span>Move Remaining Due to Tomorrow</span>
              </span>
            </button>
          )}

          {/* Delete Card — Separated at bottom with divider + confirmation (never next to Draw) */}
          {onDeleteCard && (
            <div className="pt-4 mt-2 border-t border-black/10 dark:border-white/10">
              {confirmDeleteCurrent ? (
                <div className="p-3.5 rounded-2xl bg-black dark:bg-white text-white dark:text-black space-y-3">
                  <p className="text-[15px] font-bold">
                    Delete this formula card permanently?
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteCurrent(false)}
                      className="min-h-[44px] rounded-xl text-[13px] font-semibold bg-white/20 dark:bg-black/20 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteCurrentCard}
                      className="min-h-[44px] rounded-xl text-[13px] font-bold bg-white dark:bg-black text-black dark:text-white cursor-pointer"
                    >
                      Yes, Delete
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteCurrent(true)}
                  className="glass-button w-full min-h-[48px] px-4 rounded-xl text-[15px] font-semibold flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2.5">
                    <Trash2 className="w-4 h-4" />
                    <span>Delete Formula Card</span>
                  </span>
                  <span className="text-[13px] text-secondary-contrast">Requires confirm</span>
                </button>
              )}
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
};

const CardPostRevealDetails: React.FC<{
  card: Flashcard;
  derivation?: string;
}> = ({ card, derivation }) => {
  return (
    <div className="space-y-3 text-left">
      {/* Validity Conditions (2.9) */}
      {card.conditions && (
        <div className="p-3 rounded-xl glass-panel text-[13px]">
          <span className="text-xs font-bold uppercase tracking-wider text-secondary-contrast block mb-0.5">
            Conditions / Regime
          </span>
          <FormattedText as="p" text={card.conditions} className="text-[15px] leading-snug break-words" />
        </div>
      )}

      {/* Variable Meanings */}
      {card.variables && card.variables.length > 0 && (
        <div className="space-y-2 pt-1">
          {card.variables.map((v, idx) => (
            <div
              key={idx}
              className="p-3 rounded-xl glass-panel space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">
                  <FormulaDisplay formula={v.symbol} displayMode={false} size="sm" />
                </span>
                {v.unit && (
                  <span className="text-xs text-secondary-contrast font-mono px-2 py-0.5 rounded bg-black/5 dark:bg-white/10">
                    [<FormulaDisplay formula={v.unit} displayMode={false} size="xs" />]
                  </span>
                )}
              </div>
              <FormattedText
                as="p"
                text={v.meaning}
                className="text-[15px] text-secondary-contrast break-words leading-snug"
              />
            </div>
          ))}
        </div>
      )}

      {/* Derivation (2.9) */}
      {derivation && (
        <div className="p-3 rounded-xl glass-panel text-[13px]">
          <span className="text-xs font-bold uppercase tracking-wider text-secondary-contrast block mb-0.5">
            Derivation
          </span>
          <FormattedText
            as="p"
            text={derivation}
            className="text-[15px] text-secondary-contrast leading-relaxed break-words"
          />
        </div>
      )}

      {/* Explanation */}
      {card.explanation && (
        <FormattedText
          as="p"
          text={card.explanation}
          className="text-[15px] text-secondary-contrast leading-relaxed pt-1 break-words"
        />
      )}
    </div>
  );
};
