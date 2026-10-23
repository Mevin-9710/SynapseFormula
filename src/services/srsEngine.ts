import { Deck, Flashcard, RoundProgressInfo, SrsRating, UserSettings } from '../types';

export const DEFAULT_USER_SETTINGS: UserSettings = {
  maxIntervalDays: 4,
  newCardsPerDay: 25,
  dailyReviewCap: 150,
  swipeGesturesEnabled: false,
  hapticsEnabled: true,
  reduceEffects: false,
  themeMode: 'light',
};

export const LEECH_LAPSE_THRESHOLD = 5;

export interface SrsCalculationOptions {
  maxIntervalDays?: number;
  examDate?: string;
  now?: Date;
  spreadDayOffset?: number; // Used by First Time Review to spread beyond today's new card quota
}

export interface SrsCalculationResult {
  nextIntervalDays: number;
  nextEaseFactor: number;
  nextRepetitionCount: number;
  nextDueDate: string;
  nextState: Flashcard['state'];
  nextLapses: number;
  nextConsecutiveGoods: number;
  isLeech: boolean;
  isStable: boolean;
  readableNextInterval: string;
}

/**
 * Returns YYYY-MM-DD in the user's local timezone for calendar grouping and rollover checks.
 */
export const getLocalDateKey = (dateInput: string | Date | number = new Date()): string => {
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    return dateInput.trim();
  }
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date();
    return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`;
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Computes full calendar days remaining until the user's exam date.
 * Returns null if no valid examDate is configured.
 */
export const getDaysLeftBeforeExam = (
  examDate?: string,
  referenceDate: Date = new Date()
): number | null => {
  if (!examDate || !/^\d{4}-\d{2}-\d{2}$/.test(examDate.trim())) return null;
  const [ey, em, ed] = examDate.trim().split('-').map(Number);
  const examMidnight = new Date(ey, em - 1, ed, 0, 0, 0, 0);
  const todayMidnight = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    0,
    0,
    0,
    0
  );
  const diffMs = examMidnight.getTime() - todayMidnight.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
};

/**
 * Computes the effective maximum interval cap in days.
 * Default setting is 4 days. When an exam date is set, cap = min(setting, days left before exam - 1).
 * In the final week (<= 7 days before exam), caps intervals at <= 3 days so every card is reviewed in the last 3 days.
 */
export const getEffectiveMaxIntervalDays = (
  options?: SrsCalculationOptions | Partial<UserSettings>,
  referenceDate: Date = new Date()
): number => {
  const baseSetting = Math.max(1, Math.round(options?.maxIntervalDays ?? DEFAULT_USER_SETTINGS.maxIntervalDays));
  const daysLeft = getDaysLeftBeforeExam(options?.examDate, referenceDate);

  if (daysLeft === null) {
    return baseSetting;
  }

  if (daysLeft <= 1) {
    return 1;
  }

  let cap = Math.max(1, Math.min(baseSetting, daysLeft - 1));
  if (daysLeft <= 7) {
    // Final-week mode: ensure everything gets reviewed at least once in the last 3 days
    cap = Math.max(1, Math.min(cap, 3, daysLeft - 1));
  }
  return cap;
};

/**
 * Shows "stable" only when interval >= the cap on 3 consecutive Goods.
 */
export const isCardStable = (
  card: Flashcard,
  options?: SrsCalculationOptions | Partial<UserSettings>,
  referenceDate: Date = new Date()
): boolean => {
  const cap = getEffectiveMaxIntervalDays(options, referenceDate);
  return (card.consecutiveGoods || 0) >= 3 && card.intervalDays >= cap;
};

export const isCardLeech = (card: Flashcard): boolean => {
  return (card.lapses || 0) >= LEECH_LAPSE_THRESHOLD;
};

/**
 * Returns true if a card has already been introduced/learned at least once.
 * Unseen cards (state === 'new', repetitionCount === 0, and no firstTimeReviewedAt) return false.
 */
export const isCardLearned = (card: Flashcard): boolean => {
  return (
    (card.repetitionCount || 0) > 0 ||
    Boolean(card.firstTimeReviewedAt) ||
    card.state !== 'new'
  );
};

/**
 * Calculates session score points delta and recall accuracy flags for a rating.
 * - Points (+3 for Good/Easy, -1 for Again) are awarded ONLY when testing a formula already learned.
 * - Introducing or revealing a formula for the first time earns 0 points and does not count as a recall accuracy trial.
 */
export const calculateRatingScoreDelta = (
  cardBeforeRating: Flashcard,
  rating: SrsRating
): {
  pointsDelta: number;
  isRecallTrial: boolean;
  isCorrectRecall: boolean;
} => {
  if (rating === 'first-time' || !isCardLearned(cardBeforeRating)) {
    return {
      pointsDelta: 0,
      isRecallTrial: false,
      isCorrectRecall: false,
    };
  }

  if (rating === 'again') {
    return {
      pointsDelta: -1,
      isRecallTrial: true,
      isCorrectRecall: false,
    };
  }

  return {
    pointsDelta: 3,
    isRecallTrial: true,
    isCorrectRecall: true,
  };
};

/**
 * Reusable 5-card round progress calculation.
 * - 5 completed cards constitute a round.
 * - A 50-card session has 10 rounds.
 * - A 63-card session has 12 rounds of 5 and a final round of 3.
 */
export const computeRoundProgress = (
  completedCount: number,
  totalInSession: number,
  roundSize = 5
): RoundProgressInfo => {
  const safeRoundSize = Math.max(1, roundSize);
  const safeTotal = Math.max(0, totalInSession);
  const safeCompleted = Math.max(0, Math.min(completedCount, safeTotal));

  if (safeTotal === 0) {
    return {
      roundSize: safeRoundSize,
      currentRound: 1,
      totalRounds: 1,
      cardInRound: 0,
      cardsInCurrentRound: 0,
      justCompletedRound: null,
      overallPercent: 0,
      roundPercent: 0,
    };
  }

  const totalRounds = Math.max(1, Math.ceil(safeTotal / safeRoundSize));
  const isFinished = safeCompleted >= safeTotal;
  const currentRound = isFinished
    ? totalRounds
    : Math.min(totalRounds, Math.floor(safeCompleted / safeRoundSize) + 1);

  const roundStartIdx = (currentRound - 1) * safeRoundSize;
  const cardsInCurrentRound = Math.max(
    1,
    Math.min(safeRoundSize, safeTotal - roundStartIdx)
  );

  const cardInRound = isFinished
    ? cardsInCurrentRound
    : Math.min(cardsInCurrentRound, (safeCompleted % safeRoundSize) + 1);

  const justCompletedRound =
    safeCompleted > 0 &&
    safeCompleted < safeTotal &&
    safeCompleted % safeRoundSize === 0
      ? safeCompleted / safeRoundSize
      : null;

  const overallPercent = Math.min(100, Math.round((safeCompleted / safeTotal) * 100));
  const completedInCurrentRound = isFinished
    ? cardsInCurrentRound
    : safeCompleted % safeRoundSize;
  const roundPercent = Math.min(
    100,
    Math.round((completedInCurrentRound / cardsInCurrentRound) * 100)
  );

  return {
    roundSize: safeRoundSize,
    currentRound,
    totalRounds,
    cardInRound,
    cardsInCurrentRound,
    justCompletedRound,
    overallPercent,
    roundPercent,
  };
};

/**
 * Checks if a card is due today (any time up to 23:59:59 today) or earlier.
 * Excludes suspended cards. In final-week mode (last 3 days before exam),
 * also surfaces seen cards not yet reviewed within the last 3 days.
 */
export const isCardDueToday = (
  card: Flashcard,
  referenceDate: Date = new Date(),
  settings?: Partial<UserSettings>
): boolean => {
  if (card.suspended) return false;

  const todayKey = getLocalDateKey(referenceDate);
  const cardKey = getLocalDateKey(card.dueDate);
  if (cardKey <= todayKey) return true;

  if (settings?.examDate) {
    const daysLeft = getDaysLeftBeforeExam(settings.examDate, referenceDate);
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 3 && card.state !== 'new') {
      // Final-week mode: everything gets reviewed at least once in the last 3 days
      if (!card.lastReviewedAt) return true;
      const lastReviewedDate = new Date(card.lastReviewedAt);
      const daysSinceReview =
        (referenceDate.getTime() - lastReviewedDate.getTime()) / (24 * 60 * 60 * 1000);
      if (daysSinceReview >= 1) return true;
    }
  }

  return false;
};

/**
 * Sorts due cards most-overdue first using shiftedFromDate (if rolled over) or dueDate ascending.
 */
export const sortDueCardsMostOverdueFirst = (cards: Flashcard[]): Flashcard[] => {
  return [...cards].sort((a, b) => {
    const aOrigin = a.shiftedFromDate ? `${a.shiftedFromDate}T00:00:00.000Z` : a.dueDate;
    const bOrigin = b.shiftedFromDate ? `${b.shiftedFromDate}T00:00:00.000Z` : b.dueDate;
    const aTime = new Date(aOrigin).getTime() || 0;
    const bTime = new Date(bOrigin).getTime() || 0;
    if (aTime !== bTime) return aTime - bTime;
    return (new Date(a.dueDate).getTime() || 0) - (new Date(b.dueDate).getTime() || 0);
  });
};

function shuffleWithRandom<T>(items: T[], randomFn: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

/**
 * Builds the unified priority-shuffled review queue across all decks:
 * 1. Overdue learned cards first (grouped by overdue day-bucket, oldest bucket first, shuffled within each bucket).
 * 2. Other learned cards due today (shuffled within the tier).
 * 3. Unseen new cards mixed in small numbers (1 new card per 3 due cards) up to remaining daily new-card quota.
 * 4. Never includes learned cards that are not due today, and never duplicates cards.
 */
export const buildUnifiedReviewQueue = (
  allCards: Flashcard[],
  decks: Deck[] = [],
  settings: Partial<UserSettings> = DEFAULT_USER_SETTINGS,
  now: Date = new Date(),
  randomFn: () => number = Math.random
): Flashcard[] => {
  const todayKey = getLocalDateKey(now);
  const dailyReviewCap = Math.max(
    1,
    settings.dailyReviewCap ?? DEFAULT_USER_SETTINGS.dailyReviewCap
  );
  const globalNewLimit = Math.max(
    0,
    settings.newCardsPerDay ?? DEFAULT_USER_SETTINGS.newCardsPerDay
  );

  // Deduplicate active, non-suspended cards
  const seenIds = new Set<string>();
  const activePool: Flashcard[] = [];
  for (const card of allCards) {
    if (!card || card.suspended || !card.id || seenIds.has(card.id)) continue;
    seenIds.add(card.id);
    activePool.push(card);
  }

  const overdueByBucket = new Map<string, Flashcard[]>();
  const dueTodayTier: Flashcard[] = [];
  const unseenCandidates: Flashcard[] = [];

  for (const card of activePool) {
    if (isCardLearned(card)) {
      if (!isCardDueToday(card, now, settings)) {
        // Strict eligibility: never include learned cards that are not due today
        continue;
      }
      const effectiveDateKey =
        card.shiftedFromDate && card.shiftedFromDate < todayKey
          ? card.shiftedFromDate
          : getLocalDateKey(card.dueDate);

      if (effectiveDateKey < todayKey) {
        const bucket = overdueByBucket.get(effectiveDateKey) || [];
        bucket.push(card);
        overdueByBucket.set(effectiveDateKey, bucket);
      } else {
        dueTodayTier.push(card);
      }
    } else {
      unseenCandidates.push(card);
    }
  }

  // Sort overdue buckets oldest dateKey first, shuffling cards within each comparable day bucket
  const sortedOverdueKeys = Array.from(overdueByBucket.keys()).sort();
  const overdueQueue: Flashcard[] = [];
  for (const key of sortedOverdueKeys) {
    const bucket = overdueByBucket.get(key) || [];
    overdueQueue.push(...shuffleWithRandom(bucket, randomFn));
  }

  const dueTodayQueue = shuffleWithRandom(dueTodayTier, randomFn);
  const dueQueue = [...overdueQueue, ...dueTodayQueue];

  // Calculate remaining new-card quota today (global and per-deck overrides)
  const deckMap = new Map<string, Deck>(decks.map(d => [d.id, d]));
  const introducedTodayByDeck: Record<string, number> = {};
  let introducedTodayGlobal = 0;

  for (const c of allCards) {
    if (!c) continue;
    const introToday =
      (c.firstTimeReviewedAt && getLocalDateKey(c.firstTimeReviewedAt) === todayKey) ||
      (c.lastReviewedAt && c.repetitionCount === 1 && getLocalDateKey(c.lastReviewedAt) === todayKey);
    if (introToday) {
      introducedTodayGlobal += 1;
      introducedTodayByDeck[c.deckId] = (introducedTodayByDeck[c.deckId] || 0) + 1;
    }
  }

  let remainingGlobalNew = Math.max(0, globalNewLimit - introducedTodayGlobal);
  const shuffledUnseen = shuffleWithRandom(unseenCandidates, randomFn);
  const selectedNewCards: Flashcard[] = [];
  const pickedNewByDeck: Record<string, number> = {};

  for (const candidate of shuffledUnseen) {
    const deck = deckMap.get(candidate.deckId);
    const hasOverride =
      deck && typeof deck.newCardsPerDayOverride === 'number' && deck.newCardsPerDayOverride > 0;
    const deckLimit = hasOverride ? deck!.newCardsPerDayOverride! : globalNewLimit;
    const alreadyInDeck =
      (introducedTodayByDeck[candidate.deckId] || 0) + (pickedNewByDeck[candidate.deckId] || 0);

    if (alreadyInDeck >= deckLimit) continue;
    if (!hasOverride && remainingGlobalNew <= 0) continue;

    selectedNewCards.push(candidate);
    pickedNewByDeck[candidate.deckId] = (pickedNewByDeck[candidate.deckId] || 0) + 1;
    if (!hasOverride) {
      remainingGlobalNew = Math.max(0, remainingGlobalNew - 1);
    }
  }

  // Interleave new cards in small numbers (1 new card after every 3 due cards)
  const interleavedQueue: Flashcard[] = [];
  let dueIdx = 0;
  let newIdx = 0;
  const NEW_CARD_STRIDE = 3;

  while (
    (dueIdx < dueQueue.length || newIdx < selectedNewCards.length) &&
    interleavedQueue.length < dailyReviewCap
  ) {
    let addedDueInCycle = 0;
    while (
      dueIdx < dueQueue.length &&
      addedDueInCycle < NEW_CARD_STRIDE &&
      interleavedQueue.length < dailyReviewCap
    ) {
      interleavedQueue.push(dueQueue[dueIdx++]);
      addedDueInCycle += 1;
    }

    if (newIdx < selectedNewCards.length && interleavedQueue.length < dailyReviewCap) {
      interleavedQueue.push(selectedNewCards[newIdx++]);
    }
  }

  return interleavedQueue;
};

/**
 * Computes graduated card-level mastery score in [0, 1]:
 * - Unseen / New (not yet learned): 0 (0%)
 * - Learning or repetitionCount === 0: 0.25 (25%)
 * - Active Review (not yet stable): 0.35 to 0.85 based on consecutiveGoods and interval progress toward cap
 * - Stable (3+ consecutiveGoods and intervalDays >= effectiveCap): 1.0 (100%)
 */
export const computeCardMasteryScore = (
  card: Flashcard,
  settings?: Partial<UserSettings>,
  referenceDate: Date = new Date()
): number => {
  if (card.suspended || !isCardLearned(card)) {
    return 0;
  }
  if (isCardStable(card, settings, referenceDate)) {
    return 1;
  }
  if (card.state === 'learning' || (card.repetitionCount || 0) === 0) {
    return 0.25;
  }
  const cap = getEffectiveMaxIntervalDays(settings, referenceDate);
  const goodsRatio = Math.min(1, (card.consecutiveGoods || 0) / 3);
  const intervalRatio = Math.min(1, Math.max(0, card.intervalDays || 0) / Math.max(1, cap));
  return Math.min(0.85, Number((0.35 + 0.25 * goodsRatio + 0.25 * intervalRatio).toFixed(4)));
};

export interface TopicMasteryItem {
  category: string;
  masteryPct: number;
  cardCount: number;
  stableCount: number;
  dueCount: number;
}

/**
 * Computes overall pool mastery percentage and topic-level mastery breakdown from real card SRS state.
 */
export const computePoolAndTopicMastery = (
  cards: Flashcard[],
  settings?: Partial<UserSettings>,
  referenceDate: Date = new Date()
): {
  overallMasteryPct: number;
  activeCount: number;
  stableCount: number;
  topics: TopicMasteryItem[];
} => {
  const activeCards = cards.filter(c => !c.suspended);
  if (activeCards.length === 0) {
    return {
      overallMasteryPct: 0,
      activeCount: 0,
      stableCount: 0,
      topics: [],
    };
  }

  let totalScore = 0;
  let stableCount = 0;
  const topicMap = new Map<
    string,
    { scoreSum: number; count: number; stableCount: number; dueCount: number }
  >();

  for (const card of activeCards) {
    const score = computeCardMasteryScore(card, settings, referenceDate);
    const stable = isCardStable(card, settings, referenceDate);
    const due = isCardLearned(card) && isCardDueToday(card, referenceDate, settings);
    totalScore += score;
    if (stable) stableCount += 1;

    const categoryLabel = (card.category || '').trim() || 'Uncategorized';
    const existing = topicMap.get(categoryLabel) || {
      scoreSum: 0,
      count: 0,
      stableCount: 0,
      dueCount: 0,
    };
    existing.scoreSum += score;
    existing.count += 1;
    if (stable) existing.stableCount += 1;
    if (due) existing.dueCount += 1;
    topicMap.set(categoryLabel, existing);
  }

  const overallMasteryPct = Math.round((totalScore / activeCards.length) * 100);
  const topics: TopicMasteryItem[] = Array.from(topicMap.entries())
    .map(([category, data]) => ({
      category,
      masteryPct: Math.round((data.scoreSum / data.count) * 100),
      cardCount: data.count,
      stableCount: data.stableCount,
      dueCount: data.dueCount,
    }))
    .sort((a, b) => {
      if (a.masteryPct !== b.masteryPct) return a.masteryPct - b.masteryPct;
      if (b.dueCount !== a.dueCount) return b.dueCount - a.dueCount;
      return a.category.localeCompare(b.category);
    });

  return {
    overallMasteryPct,
    activeCount: activeCards.length,
    stableCount,
    topics,
  };
};

/**
 * Formats a human-readable repeat schedule label for a card (e.g., "Repeat after 3d", "Due today", "Due tomorrow").
 */
export const formatRepeatScheduleLabel = (card: Flashcard): string => {
  if (card.suspended) {
    return 'Suspended';
  }
  const todayKey = getLocalDateKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = getLocalDateKey(tomorrow);
  const cardKey = getLocalDateKey(card.dueDate);

  if (card.intervalDays > 0) {
    const intervalStr = formatIntervalReadable(card.intervalDays);
    if (cardKey <= todayKey) {
      return card.shiftedFromDate && card.shiftedFromDate < todayKey
        ? `Overdue from ${card.shiftedFromDate} · ${intervalStr}`
        : `Due today · Interval ${intervalStr}`;
    }
    if (cardKey === tomorrowKey) {
      return `Due tomorrow · Repeat ${intervalStr}`;
    }
    return `Repeat after ${intervalStr}`;
  }

  if (card.firstTimeReviewedAt) {
    return cardKey === tomorrowKey ? 'First-time reviewed · Due tomorrow' : 'First-time reviewed';
  }

  return 'New · Unseen';
};

/**
 * Calculates updated spaced repetition parameters with:
 * - Bounded intervals via maxIntervalDays (default 4) & exam-date cap (min(setting, daysLeft - 1))
 * - Lapse rule on mature/review cards: newInterval = max(1, round(old * 0.3)), lapses + 1, ease - 0.2
 * - Easy = small bump: round(goodInterval * 1.3), never above the cap
 * - Stable tracking via 3 consecutive Goods at >= cap
 */
export const calculateNextReview = (
  card: Flashcard,
  rating: SrsRating,
  options?: SrsCalculationOptions
): SrsCalculationResult => {
  const now = options?.now || new Date();
  const cap = getEffectiveMaxIntervalDays(options, now);

  let intervalDays = card.intervalDays || 0;
  let easeFactor = card.easeFactor || 2.5;
  let repetitionCount = card.repetitionCount || 0;
  let state: Flashcard['state'] =
    card.state === 'new' || card.state === 'learning' || card.state === 'review'
      ? card.state
      : 'review';
  let lapses = card.lapses || 0;
  let consecutiveGoods = card.consecutiveGoods || 0;

  if (rating === 'first-time') {
    const dayOffset = Math.max(1, Math.floor(options?.spreadDayOffset ?? 1));
    intervalDays = Math.min(cap, dayOffset);
    easeFactor = card.easeFactor || 2.5;
    repetitionCount = 0;
    state = 'learning';

    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + dayOffset);
    targetDate.setHours(9, 0, 0, 0);

    return {
      nextIntervalDays: intervalDays,
      nextEaseFactor: Number(easeFactor.toFixed(2)),
      nextRepetitionCount: repetitionCount,
      nextDueDate: targetDate.toISOString(),
      nextState: state,
      nextLapses: lapses,
      nextConsecutiveGoods: consecutiveGoods,
      isLeech: lapses >= LEECH_LAPSE_THRESHOLD,
      isStable: false,
      readableNextInterval: formatIntervalReadable(dayOffset),
    };
  }

  const isMatureOrReview =
    state === 'review' && repetitionCount > 0 && intervalDays >= 1;

  if (!isMatureOrReview) {
    // New or short-step learning card
    const rawGood = 1;
    const goodCapped = Math.min(cap, rawGood);

    switch (rating) {
      case 'again':
        intervalDays = 1 / (24 * 60); // 1 minute
        easeFactor = Math.max(1.3, easeFactor - 0.2);
        repetitionCount = 0;
        consecutiveGoods = 0;
        state = 'learning';
        break;
      case 'hard':
        intervalDays = 10 / (24 * 60); // 10 minutes
        easeFactor = Math.max(1.3, easeFactor - 0.15);
        repetitionCount = 0;
        consecutiveGoods = 0;
        state = 'learning';
        break;
      case 'good':
        intervalDays = goodCapped;
        repetitionCount = 1;
        consecutiveGoods += 1;
        state = 'review';
        break;
      case 'easy':
        // Standard Anki graduation on Easy: 4 days (bounded by effective maxIntervalDays cap)
        intervalDays = Math.min(cap, 4);
        easeFactor = Math.min(3.0, easeFactor + 0.15);
        repetitionCount = 1;
        consecutiveGoods += 1;
        state = 'review';
        break;
    }
  } else {
    // Review / mature card
    const unboundedGood = Math.max(2, Math.round(intervalDays * easeFactor));
    const goodInterval = Math.min(cap, unboundedGood);

    switch (rating) {
      case 'again':
        // Lapse rule: new interval = max(1, round(old * 0.3)), increment lapses, keep ease penalty
        intervalDays = Math.min(cap, Math.max(1, Math.round(intervalDays * 0.3)));
        easeFactor = Math.max(1.3, easeFactor - 0.2);
        lapses += 1;
        consecutiveGoods = 0;
        state = 'review';
        break;
      case 'hard':
        intervalDays = Math.min(cap, Math.max(1, Math.round(intervalDays * 1.2)));
        easeFactor = Math.max(1.3, easeFactor - 0.15);
        repetitionCount += 1;
        consecutiveGoods = 0;
        state = 'review';
        break;
      case 'good':
        intervalDays = goodInterval;
        repetitionCount += 1;
        consecutiveGoods += 1;
        state = 'review';
        break;
      case 'easy':
        // Easy is a bump over Good (x1.3, at least +1 day), never above the cap
        intervalDays = Math.min(cap, Math.max(goodInterval + 1, Math.round(goodInterval * 1.3)));
        easeFactor = Math.min(3.0, easeFactor + 0.15);
        repetitionCount += 1;
        consecutiveGoods += 1;
        state = 'review';
        break;
    }
  }

  const nextDueDate = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString();
  const isStable = consecutiveGoods >= 3 && intervalDays >= cap;

  return {
    nextIntervalDays: intervalDays,
    nextEaseFactor: Number(easeFactor.toFixed(2)),
    nextRepetitionCount: repetitionCount,
    nextDueDate,
    nextState: state,
    nextLapses: lapses,
    nextConsecutiveGoods: consecutiveGoods,
    isLeech: lapses >= LEECH_LAPSE_THRESHOLD,
    isStable,
    readableNextInterval: formatIntervalReadable(intervalDays),
  };
};

export const previewRatingIntervals = (
  card: Flashcard,
  options?: SrsCalculationOptions
): Record<SrsRating, string> => {
  return {
    'first-time': calculateNextReview(card, 'first-time', options).readableNextInterval,
    again: calculateNextReview(card, 'again', options).readableNextInterval,
    hard: calculateNextReview(card, 'hard', options).readableNextInterval,
    good: calculateNextReview(card, 'good', options).readableNextInterval,
    easy: calculateNextReview(card, 'easy', options).readableNextInterval,
  };
};

export const formatIntervalReadable = (days: number): string => {
  if (days < 1 / 24) {
    const minutes = Math.max(1, Math.round(days * 24 * 60));
    return `${minutes}m`;
  }
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${hours}h`;
  }
  const roundDays = Math.round(days);
  if (roundDays === 1) return '1d';
  if (roundDays < 30) return `${roundDays}d`;
  const months = Math.round(roundDays / 30);
  return `${months}mo`;
};

export interface ClozeItem {
  maskedFormula: string;
  hiddenTerm: string;
  options: string[];
}

function extractMathTokensFromPeers(
  peerCards: Flashcard[],
  currentFormula: string,
  currentCategory?: string
): { exponents: string[]; denominators: string[]; rhsTerms: string[] } {
  const sortedPeers = [...peerCards]
    .filter(c => c.formula && c.formula !== currentFormula)
    .sort((a, b) => {
      const aCatMatch = currentCategory && a.category === currentCategory ? 0 : 1;
      const bCatMatch = currentCategory && b.category === currentCategory ? 0 : 1;
      return aCatMatch - bCatMatch;
    });

  const exponents: string[] = [];
  const denominators: string[] = [];
  const rhsTerms: string[] = [];

  for (const peer of sortedPeers) {
    const f = peer.formula;
    const expMatch = f.match(/\^\{?([0-9a-zA-Z\+\-\/]+)\}?/);
    if (expMatch?.[1]) exponents.push(expMatch[1]);

    const fracMatch = f.match(/\\frac\{([^}]+)\}\{([^}]+)\}/);
    if (fracMatch?.[2]) denominators.push(fracMatch[2]);

    const parts = f.split(/(=|\+|-|\times|\\times)/);
    if (parts.length >= 3) {
      const last = parts[parts.length - 1].trim();
      if (last) rhsTerms.push(last);
    } else if (f.includes('=')) {
      const rhs = f.split('=')[1]?.trim();
      if (rhs) rhsTerms.push(rhs);
    }
  }

  return { exponents, denominators, rhsTerms };
}

/**
 * Deconstructs mathematical formulas to generate clean cloze deletion targets.
 * Builds distractors from other formulas in the same deck/category (same variables, nearby exponents)
 * before falling back to algebraically related variants.
 */
export const generateFormulaCloze = (
  formula: string,
  peerCards: Flashcard[] = [],
  currentCategory?: string
): ClozeItem => {
  if (!formula || formula.length < 3) {
    return {
      maskedFormula: '?',
      hiddenTerm: formula,
      options: [formula, 'x^2', '0', '1'],
    };
  }

  const peerTokens = extractMathTokensFromPeers(peerCards, formula, currentCategory);

  // 1. Exponents like ^2, ^{2}, ^3, ^4
  const exponentMatch = formula.match(/\^\{?([0-9a-zA-Z\+\-]+)\}?/);
  if (exponentMatch && exponentMatch[1]) {
    const fullMatch = exponentMatch[0];
    const power = exponentMatch[1];
    const numPower = Number(power);
    const nearbyExponents: string[] = [];
    if (!Number.isNaN(numPower)) {
      nearbyExponents.push(
        String(numPower + 1),
        String(numPower === 1 ? 2 : numPower - 1),
        String(-numPower),
        `\\frac{1}{${Math.max(2, Math.abs(numPower))}}`
      );
    }
    const candidates = pickDistractors(
      power,
      [...peerTokens.exponents, ...nearbyExponents, '2', '3', '-1', '\\frac{1}{2}'],
      3
    );
    return {
      maskedFormula: formula.replace(fullMatch, '^?'),
      hiddenTerm: power,
      options: shuffle([power, ...candidates]),
    };
  }

  // 2. Denominators in \frac{numerator}{denominator}
  const fracMatch = formula.match(/\\frac\{([^}]+)\}\{([^}]+)\}/);
  if (fracMatch && fracMatch[2]) {
    const numer = fracMatch[1];
    const denom = fracMatch[2];
    // Mutate variables from current formula for realistic distractors
    const syntheticDenoms = [
      denom.includes('^2') ? denom.replace('^2', '') : `${denom}^2`,
      `2${denom}`,
      numer,
    ];
    const candidates = pickDistractors(
      denom,
      [...peerTokens.denominators, ...syntheticDenoms, 'r^2', '2m', '\\Delta t'],
      3
    );
    return {
      maskedFormula: formula.replace(`{${denom}}`, '{?}'),
      hiddenTerm: denom,
      options: shuffle([denom, ...candidates]),
    };
  }

  // 3. Multiplication/addition terms: split by operators
  const parts = formula.split(/(=|\+|-|\times|\\times)/);
  if (parts.length >= 3) {
    const targetIdx = parts.length - 1;
    const token = parts[targetIdx].trim();
    if (token) {
      const masked = parts
        .map((p, i) => (i === targetIdx ? ' ? ' : p))
        .join('');
      const syntheticVariants = [
        token.includes('^2') ? token.replace('^2', '') : `${token}^2`,
        `\\frac{1}{2} ${token}`,
        `-${token}`,
      ];
      const candidates = pickDistractors(
        token,
        [...peerTokens.rhsTerms, ...syntheticVariants],
        3
      );
      return {
        maskedFormula: masked,
        hiddenTerm: token,
        options: shuffle([token, ...candidates]),
      };
    }
  }

  // Fallback: mask right side with ?
  const half = Math.floor(formula.length / 2);
  const left = formula.slice(0, half);
  const right = formula.slice(half);
  const candidates = pickDistractors(right, [...peerTokens.rhsTerms, `${right}^2`, `-${right}`, '0'], 3);
  return {
    maskedFormula: `${left} ?`,
    hiddenTerm: right,
    options: shuffle([right, ...candidates]),
  };
};

/**
 * Generates candidate formulas from the same deck/category for Interleaved Mode's
 * "Which formula applies?" prompt.
 */
export const generateInterleavedFormulaOptions = (
  targetCard: Flashcard,
  candidatePool: Flashcard[],
  count = 4
): string[] => {
  const sameDeckOrCat = candidatePool
    .filter(c => c.id !== targetCard.id && c.formula && c.formula !== targetCard.formula)
    .sort((a, b) => {
      const aScore =
        (a.deckId === targetCard.deckId ? 2 : 0) +
        (targetCard.category && a.category === targetCard.category ? 1 : 0);
      const bScore =
        (b.deckId === targetCard.deckId ? 2 : 0) +
        (targetCard.category && b.category === targetCard.category ? 1 : 0);
      return bScore - aScore;
    })
    .map(c => c.formula);

  const syntheticFallbacks = [
    targetCard.formula.includes('^2')
      ? targetCard.formula.replace('^2', '^3')
      : `${targetCard.formula}^2`,
    targetCard.formula.includes('+')
      ? targetCard.formula.replace('+', '-')
      : targetCard.formula.replace('=', '= -'),
    `\\frac{1}{2} (${targetCard.formula.split('=').pop()?.trim() || 'x'})`,
  ];

  const distractors = pickDistractors(
    targetCard.formula,
    [...sameDeckOrCat, ...syntheticFallbacks],
    count - 1
  );
  return shuffle([targetCard.formula, ...distractors]);
};

function pickDistractors(correct: string, pool: string[], maxCount: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>([correct.trim()]);
  for (const item of pool) {
    const cleaned = (item || '').trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
    if (result.length >= maxCount) break;
  }
  return result;
}

function shuffle(arr: string[]): string[] {
  const unique = Array.from(new Set(arr));
  return unique.sort(() => Math.random() - 0.5);
}
