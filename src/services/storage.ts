import {
  Deck,
  Flashcard,
  DeckSessionState,
  StudySessionMode,
  StudyStreakState,
  UserSettings,
  ReviewLogEntry,
} from '../types';
import {
  DEFAULT_USER_SETTINGS,
  getLocalDateKey,
  isCardDueToday,
  sortDueCardsMostOverdueFirst,
} from './srsEngine';
import {
  syncSingleCardToFirestore,
  syncStreakToFirestore,
  syncDeckAndCardsToFirestore,
} from './firestoreSync';
import {
  getReviewLogsSync,
  initReviewLogStore,
  mergeImportedReviewLogs,
} from './reviewLog';

const DECKS_KEY = 'synapse_formula_decks_v1';
const CARDS_KEY = 'synapse_formula_cards_v1';
const DUE_SESSION_KEY = 'synapse_formula_due_session_v1';
const STREAK_KEY = 'synapse_formula_streak_v1';
const SETTINGS_KEY = 'synapse_formula_settings_v1';
const LAST_CLOUD_SYNC_KEY = 'synapse_last_cloud_sync_ts_v1';
const OFFLINE_DIRTY_CARDS_KEY = 'synapse_offline_dirty_cards_v1';
const COMPLETED_FIRST_SESSION_KEY = 'synapse_completed_first_session_v1';

const hasDomStorage = (): boolean => typeof localStorage !== 'undefined';

export const getUserSettings = (): UserSettings => {
  if (!hasDomStorage()) return { ...DEFAULT_USER_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_USER_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      maxIntervalDays: Math.max(1, Math.min(365, Number(parsed.maxIntervalDays) || DEFAULT_USER_SETTINGS.maxIntervalDays)),
      newCardsPerDay: Math.max(1, Math.min(500, Number(parsed.newCardsPerDay) || DEFAULT_USER_SETTINGS.newCardsPerDay)),
      dailyReviewCap: Math.max(10, Math.min(2000, Number(parsed.dailyReviewCap) || DEFAULT_USER_SETTINGS.dailyReviewCap)),
      examDate: typeof parsed.examDate === 'string' && parsed.examDate ? parsed.examDate : undefined,
      reminderTime: typeof parsed.reminderTime === 'string' && parsed.reminderTime ? parsed.reminderTime : undefined,
      remindersEnabled: Boolean(parsed.remindersEnabled),
      swipeGesturesEnabled: Boolean(parsed.swipeGesturesEnabled),
      hapticsEnabled: parsed.hapticsEnabled !== undefined ? Boolean(parsed.hapticsEnabled) : true,
      reduceEffects: Boolean(parsed.reduceEffects),
      themeMode:
        parsed.themeMode === 'dark' || parsed.themeMode === 'system' || parsed.themeMode === 'light'
          ? parsed.themeMode
          : 'light',
    };
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
};

export const saveUserSettings = (settings: UserSettings): void => {
  if (!hasDomStorage()) return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Error saving user settings:', err);
  }
};

export const recordCloudSyncTimestamp = (ts = Date.now()): void => {
  if (!hasDomStorage()) return;
  try {
    localStorage.setItem(LAST_CLOUD_SYNC_KEY, String(ts));
  } catch {
    // ignore
  }
};

export const getLastCloudSyncTimestamp = (): number | null => {
  if (!hasDomStorage()) return null;
  try {
    const raw = localStorage.getItem(LAST_CLOUD_SYNC_KEY);
    if (!raw) return null;
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : null;
  } catch {
    return null;
  }
};

export const markFirstSessionCompleted = (): void => {
  if (!hasDomStorage()) return;
  try {
    localStorage.setItem(COMPLETED_FIRST_SESSION_KEY, 'true');
  } catch {
    // ignore
  }
};

export const hasCompletedFirstSession = (): boolean => {
  if (!hasDomStorage()) return false;
  try {
    return localStorage.getItem(COMPLETED_FIRST_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
};

export const queueCardForOfflineSync = (cardId: string): void => {
  if (!hasDomStorage()) return;
  try {
    const raw = localStorage.getItem(OFFLINE_DIRTY_CARDS_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(cardId)) {
      ids.push(cardId);
      localStorage.setItem(OFFLINE_DIRTY_CARDS_KEY, JSON.stringify(ids));
    }
  } catch {
    // ignore
  }
};

export const getOfflinePendingSyncCount = (): number => {
  if (!hasDomStorage()) return 0;
  try {
    const raw = localStorage.getItem(OFFLINE_DIRTY_CARDS_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    return ids.length;
  } catch {
    return 0;
  }
};

export const flushOfflineSyncQueue = async (): Promise<number> => {
  if (!hasDomStorage()) return 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  try {
    const raw = localStorage.getItem(OFFLINE_DIRTY_CARDS_KEY);
    if (!raw) return 0;
    const ids: string[] = JSON.parse(raw);
    if (ids.length === 0) return 0;

    const allCards = getStoredCards();
    let syncedCount = 0;
    for (const id of ids) {
      const card = allCards.find(c => c.id === id);
      if (card) {
        await syncSingleCardToFirestore(card);
        syncedCount++;
      }
    }
    localStorage.removeItem(OFFLINE_DIRTY_CARDS_KEY);
    recordCloudSyncTimestamp();
    return syncedCount;
  } catch {
    return 0;
  }
};

export const checkLocalStorageQuotaWarning = (): {
  usedBytes: number;
  pctUsed: number;
  isNearQuota: boolean;
} => {
  if (!hasDomStorage()) return { usedBytes: 0, pctUsed: 0, isNearQuota: false };
  try {
    let totalChars = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) {
        const v = localStorage.getItem(k) || '';
        totalChars += k.length + v.length;
      }
    }
    const usedBytes = totalChars * 2;
    const quotaBytes = 5 * 1024 * 1024; // ~5 MB standard browser localStorage limit
    const pctUsed = Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
    return {
      usedBytes,
      pctUsed,
      isNearQuota: pctUsed >= 80,
    };
  } catch {
    return { usedBytes: 0, pctUsed: 0, isNearQuota: false };
  }
};

/**
 * Computes how many new cards can still be introduced today for a given deck,
 * taking into account the global newCardsPerDay setting and optional per-deck override.
 */
export const getNewCardQuotaForDeck = (
  deck: Deck,
  deckCards: Flashcard[],
  allCards: Flashcard[],
  settings: UserSettings = getUserSettings(),
  now: Date = new Date()
): {
  availableToday: number;
  unseenLeftInDeck: number;
  dailyLimitForDeck: number;
  introducedTodayInDeck: number;
  introducedTodayGlobal: number;
} => {
  const todayKey = getLocalDateKey(now);
  const unseenLeftInDeck = deckCards.filter(
    c => !c.suspended && !c.firstTimeReviewedAt && c.repetitionCount === 0
  ).length;

  const introducedTodayInDeck = deckCards.filter(
    c =>
      (c.firstTimeReviewedAt && getLocalDateKey(c.firstTimeReviewedAt) === todayKey) ||
      (c.lastReviewedAt && c.repetitionCount === 1 && getLocalDateKey(c.lastReviewedAt) === todayKey)
  ).length;

  const introducedTodayGlobal = allCards.filter(
    c =>
      (c.firstTimeReviewedAt && getLocalDateKey(c.firstTimeReviewedAt) === todayKey) ||
      (c.lastReviewedAt && c.repetitionCount === 1 && getLocalDateKey(c.lastReviewedAt) === todayKey)
  ).length;

  const hasOverride =
    typeof deck.newCardsPerDayOverride === 'number' && deck.newCardsPerDayOverride > 0;
  const dailyLimitForDeck = hasOverride
    ? deck.newCardsPerDayOverride!
    : settings.newCardsPerDay;

  const remainingDeckQuota = Math.max(0, dailyLimitForDeck - introducedTodayInDeck);
  const remainingGlobalQuota = hasOverride
    ? remainingDeckQuota
    : Math.max(0, settings.newCardsPerDay - introducedTodayGlobal);

  const availableToday = Math.min(
    unseenLeftInDeck,
    remainingDeckQuota,
    remainingGlobalQuota
  );

  return {
    availableToday,
    unseenLeftInDeck,
    dailyLimitForDeck,
    introducedTodayInDeck,
    introducedTodayGlobal,
  };
};

export const calculateConsecutiveStreak = (completedDates: string[]): number => {
  const dateSet = new Set(completedDates);
  const now = new Date();
  const todayKey = getLocalDateKey(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = getLocalDateKey(yesterday);

  let cursor: Date;
  if (dateSet.has(todayKey)) {
    cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (dateSet.has(yesterdayKey)) {
    cursor = yesterday;
  } else {
    return 0;
  }

  let streak = 0;
  while (dateSet.has(getLocalDateKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  return streak;
};

export const getStudyStreakState = (): StudyStreakState => {
  if (!hasDomStorage()) {
    return {
      currentStreak: 0,
      bestStreak: 0,
      completedDates: [],
    };
  }
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) {
      return {
        currentStreak: 0,
        bestStreak: 0,
        completedDates: [],
      };
    }
    const parsed: StudyStreakState = JSON.parse(raw);
    const completedDates = Array.from(new Set(parsed.completedDates || [])).sort();
    const currentStreak = calculateConsecutiveStreak(completedDates);
    const bestStreak = Math.max(parsed.bestStreak || 0, currentStreak);
    return {
      currentStreak,
      bestStreak,
      completedDates,
      lastStudiedDate: parsed.lastStudiedDate,
    };
  } catch {
    return {
      currentStreak: 0,
      bestStreak: 0,
      completedDates: [],
    };
  }
};

export const saveStudyStreakState = (state: StudyStreakState): void => {
  if (!hasDomStorage()) return;
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Error saving study streak state:', err);
  }
};

export const evaluateAndRecordDailyStreak = (allCards: Flashcard[]): StudyStreakState => {
  const streakState = getStudyStreakState();
  const todayKey = getLocalDateKey(new Date());

  const reviewedToday = allCards.some(
    c => c.lastReviewedAt && getLocalDateKey(c.lastReviewedAt) === todayKey
  );
  const remainingDueToday = allCards.filter(c => isCardDueToday(c)).length;

  const completedSet = new Set(streakState.completedDates);
  if (allCards.length > 0 && remainingDueToday === 0 && reviewedToday) {
    completedSet.add(todayKey);
  }

  const completedDates = Array.from(completedSet).sort();
  const currentStreak = calculateConsecutiveStreak(completedDates);
  const bestStreak = Math.max(streakState.bestStreak || 0, currentStreak);

  const nextState: StudyStreakState = {
    currentStreak,
    bestStreak,
    completedDates,
    lastStudiedDate: reviewedToday ? todayKey : streakState.lastStudiedDate,
  };

  saveStudyStreakState(nextState);
  return nextState;
};

/**
 * Evaluates and writes the streak to Firestore once per session end (not on every card rating).
 */
export const syncSessionEndStreakToFirestore = (allCards: Flashcard[]): StudyStreakState => {
  const nextStreak = evaluateAndRecordDailyStreak(allCards);
  syncStreakToFirestore(nextStreak)
    .then(() => recordCloudSyncTimestamp())
    .catch(err => console.error('Session-end streak Firestore sync failed:', err));
  return nextStreak;
};

export const getStoredDecks = (): Deck[] => {
  if (!hasDomStorage()) return [];
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    if (!raw) {
      const initial = getInitialDemoDecks();
      saveStoredDecks(initial.decks);
      saveStoredCards(initial.cards);
      return initial.decks;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error loading decks from storage:', err);
    return [];
  }
};

export const saveStoredDecks = (decks: Deck[]): void => {
  if (!hasDomStorage()) return;
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
  } catch (err) {
    console.error('Error saving decks to storage:', err);
  }
};

export const getStoredCards = (): Flashcard[] => {
  if (!hasDomStorage()) return [];
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    if (!raw) return [];
    const parsed: Flashcard[] = JSON.parse(raw);
    return parsed.map(c => ({
      ...c,
      state:
        c.state === 'new' || c.state === 'learning' || c.state === 'review'
          ? c.state
          : 'review',
    }));
  } catch (err) {
    console.error('Error loading cards from storage:', err);
    return [];
  }
};

export const saveStoredCards = (cards: Flashcard[]): void => {
  if (!hasDomStorage()) return;
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
  } catch (err) {
    console.error('Error saving cards to storage:', err);
  }
};

export const getCardsForDeck = (deckId: string): Flashcard[] => {
  return getStoredCards().filter(c => c.deckId === deckId);
};

/**
 * Updates a single card in local storage and writes only the card to Firestore (1 write, 0 reads).
 * When offline, queues the card ID in localStorage for automatic sync when back online.
 */
export const updateCardInStorage = (updatedCard: Flashcard): void => {
  const cards = getStoredCards();
  const idx = cards.findIndex(c => c.id === updatedCard.id);
  if (idx >= 0) {
    cards[idx] = updatedCard;
  } else {
    cards.push(updatedCard);
  }
  saveStoredCards(cards);
  evaluateAndRecordDailyStreak(cards);

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    queueCardForOfflineSync(updatedCard.id);
    return;
  }

  syncSingleCardToFirestore(updatedCard)
    .then(() => recordCloudSyncTimestamp())
    .catch(() => {
      queueCardForOfflineSync(updatedCard.id);
    });
};

/**
 * Splits a leech/complex card into two focused cards in the same deck.
 */
export const splitCardInStorage = (
  originalCard: Flashcard,
  partA: { statement: string; formula: string; conditions?: string },
  partB: { statement: string; formula: string; conditions?: string }
): { updatedCards: Flashcard[]; updatedDecks: Deck[]; cardA: Flashcard; cardB: Flashcard } => {
  const now = new Date().toISOString();
  const cardA: Flashcard = {
    ...originalCard,
    statement: partA.statement.trim(),
    formula: partA.formula.trim(),
    conditions: partA.conditions?.trim() || originalCard.conditions,
    intervalDays: 0,
    repetitionCount: 0,
    lapses: 0,
    consecutiveGoods: 0,
    state: 'new',
    dueDate: now,
  };
  const cardB: Flashcard = {
    ...originalCard,
    id: `${originalCard.id}_split_${Date.now().toString(36)}`,
    statement: partB.statement.trim(),
    formula: partB.formula.trim(),
    conditions: partB.conditions?.trim() || originalCard.conditions,
    intervalDays: 0,
    repetitionCount: 0,
    lapses: 0,
    consecutiveGoods: 0,
    state: 'new',
    dueDate: now,
    createdAt: now,
  };

  const cards = getStoredCards();
  const idx = cards.findIndex(c => c.id === originalCard.id);
  if (idx >= 0) {
    cards.splice(idx, 1, cardA, cardB);
  } else {
    cards.push(cardA, cardB);
  }
  saveStoredCards(cards);

  const decks = getStoredDecks().map(d =>
    d.id === originalCard.deckId ? { ...d, cardsCount: d.cardsCount + 1 } : d
  );
  saveStoredDecks(decks);

  syncSingleCardToFirestore(cardA).catch(() => {});
  syncSingleCardToFirestore(cardB).catch(() => {});

  return { updatedCards: cards, updatedDecks: decks, cardA, cardB };
};

/**
 * Universally updates session resumption state for a specific deck or global due session.
 */
export const saveDeckSessionState = (
  deckId: string,
  sessionState: DeckSessionState | undefined,
  mode: StudySessionMode = 'recall'
): void => {
  if (mode === 'practice') return;
  if (deckId === '__due_today__' || mode === 'due-continuous' || mode === 'interleaved') {
    saveDueTodaySessionState(sessionState);
    return;
  }

  const decks = getStoredDecks();
  const idx = decks.findIndex(d => d.id === deckId);
  if (idx >= 0) {
    if (mode === 'first-time') {
      decks[idx].firstTimeSessionState = sessionState;
    } else {
      decks[idx].sessionState = sessionState;
    }
    saveStoredDecks(decks);
  }
};

export const clearDeckSessionState = (deckId: string, mode: StudySessionMode = 'recall'): void => {
  saveDeckSessionState(deckId, undefined, mode);
};

export const getDueTodaySessionState = (): DeckSessionState | undefined => {
  try {
    const raw = localStorage.getItem(DUE_SESSION_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const saveDueTodaySessionState = (sessionState: DeckSessionState | undefined): void => {
  try {
    if (!sessionState) {
      localStorage.removeItem(DUE_SESSION_KEY);
    } else {
      localStorage.setItem(DUE_SESSION_KEY, JSON.stringify(sessionState));
    }
  } catch (err) {
    console.error('Error saving continuous due session state:', err);
  }
};

/**
 * Marks overdue cards from past calendar days with their original shiftedFromDate
 * while preserving their relative overdue timestamps so the due queue can be sorted
 * most-overdue first without losing overdue order.
 */
export const rolloverOverdueCardsFromPastDays = (
  currentCards: Flashcard[]
): { updatedCards: Flashcard[]; shiftedCount: number; shiftedByDeck: Record<string, number> } => {
  const now = new Date();
  const todayKey = getLocalDateKey(now);

  let shiftedCount = 0;
  const shiftedByDeck: Record<string, number> = {};

  const updatedCards = currentCards.map(card => {
    const normalizedState: Flashcard['state'] =
      card.state === 'new' || card.state === 'learning' || card.state === 'review'
        ? card.state
        : 'review';

    const cardDateKey = getLocalDateKey(card.dueDate);
    if (!card.suspended && cardDateKey < todayKey && !card.shiftedFromDate) {
      shiftedCount += 1;
      shiftedByDeck[card.deckId] = (shiftedByDeck[card.deckId] || 0) + 1;
      return {
        ...card,
        state: normalizedState,
        shiftedFromDate: cardDateKey,
        rolloverCount: (card.rolloverCount || 0) + 1,
      };
    }
    if (card.state !== normalizedState) {
      return { ...card, state: normalizedState };
    }
    return card;
  });

  if (shiftedCount > 0) {
    saveStoredCards(updatedCards);
  }

  return { updatedCards, shiftedCount, shiftedByDeck };
};

/**
 * Catch-up mode (2.2): Keeps the most-overdue `dailyReviewCap` cards due today
 * and softly postpones excess due cards evenly across the next 3 days (+1d, +2d, +3d).
 */
export const applyCatchUpPostponement = (
  currentCards: Flashcard[],
  dailyReviewCap: number = getUserSettings().dailyReviewCap,
  now: Date = new Date()
): { updatedCards: Flashcard[]; postponedCount: number } => {
  const dueCards = sortDueCardsMostOverdueFirst(
    currentCards.filter(c => isCardDueToday(c, now))
  );

  if (dueCards.length <= dailyReviewCap) {
    return { updatedCards: currentCards, postponedCount: 0 };
  }

  const excessCards = dueCards.slice(dailyReviewCap);
  const excessPostponedDayMap = new Map<string, string>();
  const todayKey = getLocalDateKey(now);

  excessCards.forEach((card, idx) => {
    const dayOffset = (idx % 3) + 1; // Spread evenly across next 3 days (+1, +2, +3)
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + dayOffset,
      9,
      0,
      0,
      0
    );
    excessPostponedDayMap.set(card.id, target.toISOString());
  });

  const updatedCards = currentCards.map(card => {
    const nextIso = excessPostponedDayMap.get(card.id);
    if (!nextIso) return card;
    return {
      ...card,
      shiftedFromDate: card.shiftedFromDate || getLocalDateKey(card.dueDate) || todayKey,
      rolloverCount: (card.rolloverCount || 0) + 1,
      dueDate: nextIso,
    };
  });

  saveStoredCards(updatedCards);
  return { updatedCards, postponedCount: excessCards.length };
};

/**
 * Shifts remaining incomplete due cards for today to Tomorrow (segregated by deck or across all decks).
 */
export const shiftRemainingTodayCardsToTomorrow = (
  currentCards: Flashcard[],
  targetDeckId?: string
): { updatedCards: Flashcard[]; shiftedCount: number } => {
  const now = new Date();
  const todayKey = getLocalDateKey(now);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  const tomorrowIso = tomorrow.toISOString();

  let shiftedCount = 0;
  const updatedCards = currentCards.map(card => {
    const matchesDeck = !targetDeckId || card.deckId === targetDeckId;
    if (matchesDeck && isCardDueToday(card, now)) {
      shiftedCount += 1;
      return {
        ...card,
        shiftedFromDate: card.shiftedFromDate || todayKey,
        rolloverCount: (card.rolloverCount || 0) + 1,
        dueDate: tomorrowIso,
      };
    }
    return card;
  });

  if (shiftedCount > 0) {
    saveStoredCards(updatedCards);
    if (!targetDeckId) {
      saveDueTodaySessionState(undefined);
    }
  }

  return { updatedCards, shiftedCount };
};

export interface FullBackupPayload {
  version: number;
  exportedAt: string;
  settings: UserSettings;
  streak: StudyStreakState;
  decks: Deck[];
  cards: Flashcard[];
  reviewLogs: ReviewLogEntry[];
}

export const exportFullBackupJson = async (): Promise<string> => {
  await initReviewLogStore();
  const payload: FullBackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getUserSettings(),
    streak: getStudyStreakState(),
    decks: getStoredDecks(),
    cards: getStoredCards(),
    reviewLogs: getReviewLogsSync(),
  };
  return JSON.stringify(payload, null, 2);
};

export const importFullBackupJson = async (
  rawJson: string
): Promise<{
  decks: Deck[];
  cards: Flashcard[];
  settings: UserSettings;
  streak: StudyStreakState;
  mergedDecksCount: number;
  mergedCardsCount: number;
  mergedLogsCount: number;
}> => {
  const parsed = JSON.parse(rawJson) as Partial<FullBackupPayload>;
  if (!parsed || (!Array.isArray(parsed.decks) && !Array.isArray(parsed.cards))) {
    throw new Error('Invalid SynapseFormula backup JSON file.');
  }

  const currentDecks = getStoredDecks();
  const currentCards = getStoredCards();
  const deckMap = new Map<string, Deck>(currentDecks.map(d => [d.id, d]));
  const cardMap = new Map<string, Flashcard>(currentCards.map(c => [c.id, c]));

  let mergedDecksCount = 0;
  for (const incomingDeck of parsed.decks || []) {
    if (!incomingDeck || !incomingDeck.id || !incomingDeck.name) continue;
    deckMap.set(incomingDeck.id, incomingDeck);
    mergedDecksCount += 1;
  }

  let mergedCardsCount = 0;
  for (const incomingCard of parsed.cards || []) {
    if (!incomingCard || !incomingCard.id || !incomingCard.deckId) continue;
    const normalizedCard: Flashcard = {
      ...incomingCard,
      state:
        incomingCard.state === 'new' ||
        incomingCard.state === 'learning' ||
        incomingCard.state === 'review'
          ? incomingCard.state
          : 'review',
    };
    const existing = cardMap.get(normalizedCard.id);
    if (!existing) {
      cardMap.set(normalizedCard.id, normalizedCard);
      mergedCardsCount += 1;
    } else {
      // Keep the card with more recent review timestamp or higher repetitionCount
      const incomingTime = normalizedCard.lastReviewedAt
        ? new Date(normalizedCard.lastReviewedAt).getTime()
        : 0;
      const existingTime = existing.lastReviewedAt
        ? new Date(existing.lastReviewedAt).getTime()
        : 0;
      if (
        incomingTime >= existingTime ||
        (normalizedCard.repetitionCount || 0) >= (existing.repetitionCount || 0)
      ) {
        cardMap.set(normalizedCard.id, normalizedCard);
        mergedCardsCount += 1;
      }
    }
  }

  const finalDecks = Array.from(deckMap.values());
  const finalCards = Array.from(cardMap.values());
  saveStoredDecks(finalDecks);
  saveStoredCards(finalCards);

  const currentSettings = getUserSettings();
  const finalSettings: UserSettings = parsed.settings
    ? {
        ...currentSettings,
        ...parsed.settings,
      }
    : currentSettings;
  saveUserSettings(finalSettings);

  const currentStreak = getStudyStreakState();
  const mergedCompleted = Array.from(
    new Set([
      ...(currentStreak.completedDates || []),
      ...(parsed.streak?.completedDates || []),
    ])
  ).sort();
  const finalStreak: StudyStreakState = {
    currentStreak: calculateConsecutiveStreak(mergedCompleted),
    bestStreak: Math.max(
      currentStreak.bestStreak || 0,
      parsed.streak?.bestStreak || 0,
      calculateConsecutiveStreak(mergedCompleted)
    ),
    completedDates: mergedCompleted,
    lastStudiedDate: parsed.streak?.lastStudiedDate || currentStreak.lastStudiedDate,
  };
  saveStudyStreakState(finalStreak);

  const mergedLogsCount = Array.isArray(parsed.reviewLogs)
    ? await mergeImportedReviewLogs(parsed.reviewLogs)
    : 0;

  for (const d of finalDecks) {
    const dCards = finalCards.filter(c => c.deckId === d.id);
    syncDeckAndCardsToFirestore(d, dCards).catch(() => {});
  }

  return {
    decks: finalDecks,
    cards: finalCards,
    settings: finalSettings,
    streak: finalStreak,
    mergedDecksCount,
    mergedCardsCount,
    mergedLogsCount,
  };
};

/**
 * Checks whether 24 hours have elapsed since the last cloud sync.
 */
export const isSyncDue = (deck: Deck): boolean => {
  if (!deck.lastSyncedAt) return true;
  const lastSyncTime = new Date(deck.lastSyncedAt).getTime();
  const hoursSinceSync = (Date.now() - lastSyncTime) / (1000 * 60 * 60);
  return hoursSinceSync >= (deck.syncIntervalHours || 24);
};

/**
 * Seeds default high-yield physics decks for out-of-the-box mastery.
 */
function getInitialDemoDecks(): { decks: Deck[]; cards: Flashcard[] } {
  const now = new Date().toISOString();

  const deck1Id = 'deck_classical_mechanics';
  const deck2Id = 'deck_electromagnetism';
  const deck3Id = 'deck_quantum_thermo';

  const deck1: Deck = {
    id: deck1Id,
    name: 'Classical Mechanics & Dynamics',
    description: 'Fundamental equations governing motion, energy conservation, gravitation, and harmonic oscillation.',
    sheetName: 'Sheet1',
    lastSyncedAt: now,
    createdAt: now,
    syncIntervalHours: 24,
    columnMapping: {
      statementCol: 'Statement',
      formulaCol: 'Formula',
      variablesCol: 'Variables',
      explanationCol: 'Explanation',
      categoryCol: 'Category',
      conditionsCol: 'Conditions',
      derivationCol: 'Derivation',
    },
    cardsCount: 5,
    sessionState: {
      lastCardId: 'card_cm_1',
      lastCardIndex: 0,
      stage: 'statement',
      remainingQueueIds: ['card_cm_1', 'card_cm_2', 'card_cm_3', 'card_cm_4', 'card_cm_5'],
      totalInSession: 5,
      completedInSession: 0,
      lastStudiedAt: now,
      mode: 'recall',
    },
  };

  const deck2: Deck = {
    id: deck2Id,
    name: 'Electromagnetism & Fields',
    description: 'Maxwell relations, Lorentz electromagnetic force, and electrostatic potential laws.',
    sheetName: 'Sheet1',
    lastSyncedAt: now,
    createdAt: now,
    syncIntervalHours: 24,
    columnMapping: {
      statementCol: 'Statement',
      formulaCol: 'Formula',
      variablesCol: 'Variables',
      explanationCol: 'Explanation',
      categoryCol: 'Category',
      conditionsCol: 'Conditions',
      derivationCol: 'Derivation',
    },
    cardsCount: 4,
  };

  const deck3: Deck = {
    id: deck3Id,
    name: 'Quantum Physics & Thermodynamics',
    description: 'Wave-particle duality, uncertainty principles, entropy, and statistical thermodynamics.',
    sheetName: 'Sheet1',
    lastSyncedAt: now,
    createdAt: now,
    syncIntervalHours: 24,
    columnMapping: {
      statementCol: 'Statement',
      formulaCol: 'Formula',
      variablesCol: 'Variables',
      explanationCol: 'Explanation',
      categoryCol: 'Category',
      conditionsCol: 'Conditions',
      derivationCol: 'Derivation',
    },
    cardsCount: 4,
  };

  const cards: Flashcard[] = [
    {
      id: 'card_cm_1',
      deckId: deck1Id,
      statement: 'Total *Lorentz Force* acting on a charged particle with velocity in combined electromagnetic fields:',
      formula: '\\vec{F} = q(\\vec{E} + \\vec{v} \\times \\vec{B})',
      variables: [
        { symbol: '\\vec{F}', meaning: 'Total Lorentz force vector', unit: 'N' },
        { symbol: 'q', meaning: 'Electric charge of the particle', unit: 'C' },
        { symbol: '\\vec{E}', meaning: 'Electric field vector', unit: 'V/m' },
        { symbol: '\\vec{v}', meaning: 'Instantaneous velocity vector', unit: 'm/s' },
        { symbol: '\\vec{B}', meaning: 'Magnetic flux density field', unit: 'T' },
      ],
      conditions: 'Point charge q in classical or relativistic frame',
      derivation: 'Combines electrostatic force qE with magnetic cross-product force q(v × B).',
      explanation: 'The magnetic component of the force is strictly perpendicular to both particle velocity and magnetic field, doing zero work on the charge.',
      category: 'Electrodynamics',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_cm_2',
      deckId: deck1Id,
      statement: "Newton's *Universal Law of Gravitation* between two point masses:",
      formula: 'F_g = G \\frac{m_1 m_2}{r^2}',
      variables: [
        { symbol: 'F_g', meaning: 'Attractive gravitational force', unit: 'N' },
        { symbol: 'G', meaning: 'Universal gravitational constant', unit: '6.674 \\times 10^{-11} \\text{ N}\\cdot\\text{m}^2/\\text{kg}^2' },
        { symbol: 'm_1, m_2', meaning: 'Point masses', unit: 'kg' },
        { symbol: 'r', meaning: 'Separation distance between centers', unit: 'm' },
      ],
      conditions: 'Point masses or spherically symmetric bodies (r >= R1 + R2)',
      derivation: 'From Gauss gravitational flux law over a spherical surface of area 4πr².',
      explanation: 'Follows an inverse-square relationship. Halving the separation quadruples the gravitational pull.',
      category: 'Gravitation',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_cm_3',
      deckId: deck1Id,
      statement: '*Kinetic Energy* in terms of classical linear momentum:',
      formula: 'E_k = \\frac{p^2}{2m}',
      variables: [
        { symbol: 'E_k', meaning: 'Translational kinetic energy', unit: 'J' },
        { symbol: 'p', meaning: 'Linear momentum (p = mv)', unit: 'kg\\cdot m/s' },
        { symbol: 'm', meaning: 'Inertial mass of the body', unit: 'kg' },
      ],
      conditions: 'Non-relativistic speeds (v << c)',
      derivation: 'Substitute v = p / m into E_k = (1/2) m v².',
      explanation: 'Directly relates mechanical kinetic energy to momentum. Crucial for quantum de Broglie substitution.',
      category: 'Mechanics',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_cm_4',
      deckId: deck1Id,
      statement: 'Angular frequency of a *Simple Harmonic Oscillator* (mass-spring system):',
      formula: '\\omega = \\sqrt{\\frac{k}{m}}',
      variables: [
        { symbol: '\\omega', meaning: 'Angular oscillation frequency', unit: 'rad/s' },
        { symbol: 'k', meaning: 'Spring stiffness constant', unit: 'N/m' },
        { symbol: 'm', meaning: 'Oscillating mass', unit: 'kg' },
      ],
      conditions: 'Ideal massless Hookean spring without damping',
      derivation: 'From m(d²x/dt²) = -kx => d²x/dt² + (k/m)x = 0.',
      explanation: 'Independent of initial displacement amplitude in the small-strain Hookean limit.',
      category: 'Oscillations',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_cm_5',
      deckId: deck1Id,
      statement: '*Work-Energy Theorem* expressing total work done by net external forces:',
      formula: 'W_{\\text{net}} = \\Delta K = \\frac{1}{2} m v_f^2 - \\frac{1}{2} m v_i^2',
      variables: [
        { symbol: 'W_{\\text{net}}', meaning: 'Net work performed along path', unit: 'J' },
        { symbol: '\\Delta K', meaning: 'Change in kinetic energy', unit: 'J' },
        { symbol: 'v_f, v_i', meaning: 'Final and initial scalar speeds', unit: 'm/s' },
      ],
      conditions: 'Rigid body translational motion, inertial reference frame',
      derivation: 'Integrate F_net dx = m (dv/dt) dx = m v dv from v_i to v_f.',
      explanation: 'Applies whether forces are conservative or non-conservative.',
      category: 'Energy',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_em_1',
      deckId: deck2Id,
      statement: '*Maxwell-Faraday Equation* (differential induction law):',
      formula: '\\nabla \\times \\vec{E} = -\\frac{\\partial \\vec{B}}{\\partial t}',
      variables: [
        { symbol: '\\nabla \\times \\vec{E}', meaning: 'Curl of electric field', unit: 'V/m^2' },
        { symbol: '\\vec{B}', meaning: 'Time-varying magnetic field', unit: 'T' },
        { symbol: 't', meaning: 'Time coordinate', unit: 's' },
      ],
      explanation: 'A time-varying magnetic field induces a spatially circulating non-conservative electric field.',
      category: 'Maxwell Equations',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_em_2',
      deckId: deck2Id,
      statement: '*Gauss’s Law for Electrostatics* in differential formulation:',
      formula: '\\nabla \\cdot \\vec{E} = \\frac{\\rho}{\\varepsilon_0}',
      variables: [
        { symbol: '\\nabla \\cdot \\vec{E}', meaning: 'Divergence of electric field', unit: 'V/m^2' },
        { symbol: '\\rho', meaning: 'Volume charge density', unit: 'C/m^3' },
        { symbol: '\\varepsilon_0', meaning: 'Permittivity of free space', unit: 'F/m' },
      ],
      explanation: 'Electric charges act as sources (positive) or sinks (negative) of electrostatic flux.',
      category: 'Electrostatics',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_em_3',
      deckId: deck2Id,
      statement: '*Poynting Vector* denoting directional electromagnetic energy flux density:',
      formula: '\\vec{S} = \\frac{1}{\\mu_0} (\\vec{E} \\times \\vec{B})',
      variables: [
        { symbol: '\\vec{S}', meaning: 'Poynting power flux density', unit: 'W/m^2' },
        { symbol: '\\mu_0', meaning: 'Permeability of vacuum', unit: 'H/m' },
        { symbol: '\\vec{E}', meaning: 'Electric field vector', unit: 'V/m' },
        { symbol: '\\vec{B}', meaning: 'Magnetic flux density', unit: 'T' },
      ],
      explanation: 'Points in the propagation direction of wave power; time average equals radiation intensity.',
      category: 'Radiation',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_em_4',
      deckId: deck2Id,
      statement: 'Capacitance energy stored in an electrostatic field:',
      formula: 'U_C = \\frac{1}{2} C V^2 = \\frac{Q^2}{2C}',
      variables: [
        { symbol: 'U_C', meaning: 'Stored electric potential energy', unit: 'J' },
        { symbol: 'C', meaning: 'Capacitance', unit: 'F' },
        { symbol: 'V', meaning: 'Potential difference between plates', unit: 'V' },
        { symbol: 'Q', meaning: 'Accumulated surface charge', unit: 'C' },
      ],
      explanation: 'The quadratic dependence on voltage explains the extreme discharge energy of high-voltage capacitors.',
      category: 'Capacitance',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_qt_1',
      deckId: deck3Id,
      statement: 'Heisenberg *Uncertainty Principle* for position and momentum:',
      formula: '\\Delta x \\cdot \\Delta p \\ge \\frac{\\hbar}{2}',
      variables: [
        { symbol: '\\Delta x', meaning: 'Standard deviation in position measurement', unit: 'm' },
        { symbol: '\\Delta p', meaning: 'Standard deviation in momentum measurement', unit: 'kg\\cdot m/s' },
        { symbol: '\\hbar', meaning: 'Reduced Planck constant (h / 2\\pi)', unit: 'J\\cdot s' },
      ],
      explanation: 'A fundamental quantum mechanical limit arising from non-commuting position and momentum operators.',
      category: 'Quantum Mechanics',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_qt_2',
      deckId: deck3Id,
      statement: 'de Broglie *Wavelength* of a matter particle:',
      formula: '\\lambda = \\frac{h}{p} = \\frac{h}{mv}',
      variables: [
        { symbol: '\\lambda', meaning: 'Quantum matter wavelength', unit: 'm' },
        { symbol: 'h', meaning: 'Planck constant', unit: '6.626 \\times 10^{-34} \\text{ J}\\cdot\\text{s}' },
        { symbol: 'p', meaning: 'Particle linear momentum', unit: 'kg\\cdot m/s' },
      ],
      explanation: 'Reveals the fundamental wave-particle duality underpinning electron microscopy and quantum scattering.',
      category: 'Quantum Mechanics',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_qt_3',
      deckId: deck3Id,
      statement: 'Carnot *Maximum Thermodynamic Efficiency* between two thermal reservoirs:',
      formula: '\\eta_{\\text{max}} = 1 - \\frac{T_C}{T_H}',
      variables: [
        { symbol: '\\eta_{\\text{max}}', meaning: 'Theoretical limit efficiency (0 to 1)', unit: 'dimensionless' },
        { symbol: 'T_C', meaning: 'Cold reservoir temperature', unit: 'K' },
        { symbol: 'T_H', meaning: 'Hot reservoir temperature', unit: 'K' },
      ],
      explanation: 'Temperatures must strictly be evaluated in absolute Kelvin. 100% efficiency is unreachable at finite nonzero cold sink.',
      category: 'Thermodynamics',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
    {
      id: 'card_qt_4',
      deckId: deck3Id,
      statement: 'Stefan-Boltzmann *Blackbody Radiant Emittance*:',
      formula: 'j^* = \\sigma T^4',
      variables: [
        { symbol: 'j^*', meaning: 'Total radiant power emitted per unit area', unit: 'W/m^2' },
        { symbol: '\\sigma', meaning: 'Stefan-Boltzmann constant', unit: '5.670 \\times 10^{-8} \\text{ W}/(\\text{m}^2 \\text{K}^4)' },
        { symbol: 'T', meaning: 'Absolute thermodynamic temperature', unit: 'K' },
      ],
      explanation: 'Radiation power scales to the fourth power of temperature, explaining the extreme heat output of stars.',
      category: 'Thermal Radiation',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      createdAt: now,
      state: 'new',
    },
  ];

  return {
    decks: [deck1, deck2, deck3],
    cards,
  };
}
