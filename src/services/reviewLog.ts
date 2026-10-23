import { Flashcard, ReviewLogEntry, UserSettings } from '../types';
import {
  computeCardMasteryScore,
  computePoolAndTopicMastery,
  getLocalDateKey,
} from './srsEngine';

const DB_NAME = 'synapse_formula_idb_v1';
const DB_VERSION = 1;
const STORE_NAME = 'review_logs';
const FALLBACK_KEY = 'synapse_formula_review_logs_fallback_v1';

// In-memory cache kept in sync with IndexedDB for fast synchronous reads in UI and tests
let memoryLogCache: ReviewLogEntry[] = [];
let initialized = false;

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openReviewDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('ts', 'ts', { unique: false });
        store.createIndex('cardId', 'cardId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function initReviewLogStore(): Promise<ReviewLogEntry[]> {
  if (initialized && memoryLogCache.length > 0) {
    return memoryLogCache;
  }
  try {
    if (hasIndexedDB()) {
      const db = await openReviewDb();
      const entries = await new Promise<ReviewLogEntry[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      db.close();
      memoryLogCache = entries.sort((a, b) => a.ts - b.ts);
      initialized = true;
      return memoryLogCache;
    }
  } catch {
    // Fallback to localStorage if IndexedDB is unavailable in test/restricted context
  }

  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    memoryLogCache = raw ? JSON.parse(raw) : [];
  } catch {
    memoryLogCache = [];
  }
  initialized = true;
  return memoryLogCache;
}

export function getReviewLogsSync(): ReviewLogEntry[] {
  if (!initialized && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(FALLBACK_KEY);
      if (raw) {
        memoryLogCache = JSON.parse(raw);
      }
    } catch {
      // ignore
    }
  }
  return memoryLogCache;
}

export async function appendReviewLog(entry: ReviewLogEntry): Promise<ReviewLogEntry> {
  const withId: ReviewLogEntry = {
    ...entry,
    id: entry.id || `rlog_${entry.ts}_${entry.cardId}_${Math.random().toString(36).slice(2, 7)}`,
  };

  memoryLogCache = [...memoryLogCache, withId];

  try {
    if (typeof localStorage !== 'undefined') {
      // Keep last 2000 in fallback mirror for instant sync startup
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(memoryLogCache.slice(-2000)));
    }
  } catch {
    // Quota exceeded on localStorage is fine because IndexedDB is primary
  }

  try {
    if (hasIndexedDB()) {
      const db = await openReviewDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(withId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }
  } catch (err) {
    console.warn('IndexedDB review log write fallback:', err);
  }

  return withId;
}

export async function removeReviewLogById(logId: string): Promise<void> {
  memoryLogCache = memoryLogCache.filter(item => item.id !== logId);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(memoryLogCache.slice(-2000)));
    }
  } catch {
    // ignore
  }

  try {
    if (hasIndexedDB()) {
      const db = await openReviewDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(logId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }
  } catch {
    // ignore
  }
}

export async function mergeImportedReviewLogs(entries: ReviewLogEntry[]): Promise<number> {
  await initReviewLogStore();
  const existingIds = new Set(
    memoryLogCache.map(e => e.id || `${e.cardId}_${e.ts}`)
  );
  const toInsert: ReviewLogEntry[] = [];

  for (const raw of entries) {
    if (!raw || !raw.cardId || typeof raw.ts !== 'number') continue;
    const key = raw.id || `${raw.cardId}_${raw.ts}`;
    if (!existingIds.has(key)) {
      const normalized: ReviewLogEntry = {
        id: raw.id || `rlog_${raw.ts}_${raw.cardId}`,
        cardId: String(raw.cardId),
        deckId: raw.deckId ? String(raw.deckId) : undefined,
        ts: Number(raw.ts),
        rating: raw.rating,
        prevInterval: Number(raw.prevInterval) || 0,
        newInterval: Number(raw.newInterval) || 0,
        ms: Math.max(0, Number(raw.ms) || 0),
      };
      existingIds.add(key);
      toInsert.push(normalized);
    }
  }

  if (toInsert.length === 0) return 0;

  memoryLogCache = [...memoryLogCache, ...toInsert].sort((a, b) => a.ts - b.ts);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(memoryLogCache.slice(-2000)));
    }
  } catch {
    // ignore
  }

  try {
    if (hasIndexedDB()) {
      const db = await openReviewDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const item of toInsert) {
          store.put(item);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }
  } catch {
    // ignore
  }

  return toInsert.length;
}

export interface DailyReviewMetric {
  dateKey: string;
  label: string;
  cardsCount: number;
  totalMinutes: number;
  retentionPct: number;
}

export function computeReviewAnalytics(
  logs: ReviewLogEntry[],
  days = 14,
  now: Date = new Date()
): {
  overallRetentionPct: number;
  totalReviews: number;
  avgSecondsPerCard: number;
  dailyMetrics: DailyReviewMetric[];
  newIntroducedToday: number;
  newIntroducedTodayByDeck: Record<string, number>;
  reviewsDoneToday: number;
} {
  const todayKey = getLocalDateKey(now);
  const recallLogs = logs.filter(l => l.rating !== 'first-time');
  const passedRecall = recallLogs.filter(
    l => l.rating === 'good' || l.rating === 'easy' || l.rating === 'hard'
  );
  const overallRetentionPct =
    recallLogs.length > 0 ? Math.round((passedRecall.length / recallLogs.length) * 100) : 100;

  const totalMs = logs.reduce((acc, l) => acc + Math.min(120000, Math.max(0, l.ms || 0)), 0);
  const avgSecondsPerCard = logs.length > 0 ? Math.round(totalMs / logs.length / 1000) : 0;

  let newIntroducedToday = 0;
  const newIntroducedTodayByDeck: Record<string, number> = {};
  let reviewsDoneToday = 0;

  const byDate: Record<string, ReviewLogEntry[]> = {};
  for (const log of logs) {
    const key = getLocalDateKey(log.ts);
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(log);

    if (key === todayKey) {
      if (log.rating === 'first-time' || log.prevInterval === 0) {
        newIntroducedToday += 1;
        if (log.deckId) {
          newIntroducedTodayByDeck[log.deckId] = (newIntroducedTodayByDeck[log.deckId] || 0) + 1;
        }
      } else {
        reviewsDoneToday += 1;
      }
    }
  }

  const dailyMetrics: DailyReviewMetric[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = getLocalDateKey(d);
    const dayLogs = byDate[key] || [];
    const dayRecall = dayLogs.filter(l => l.rating !== 'first-time');
    const dayPassed = dayRecall.filter(l => l.rating !== 'again');
    const dayMs = dayLogs.reduce((acc, l) => acc + Math.min(120000, Math.max(0, l.ms || 0)), 0);

    dailyMetrics.push({
      dateKey: key,
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      cardsCount: dayLogs.length,
      totalMinutes: Number((dayMs / 60000).toFixed(1)),
      retentionPct:
        dayRecall.length > 0 ? Math.round((dayPassed.length / dayRecall.length) * 100) : 100,
    });
  }

  return {
    overallRetentionPct,
    totalReviews: logs.length,
    avgSecondsPerCard,
    dailyMetrics,
    newIntroducedToday,
    newIntroducedTodayByDeck,
    reviewsDoneToday,
  };
}

export interface HistoricalMasteryPoint {
  dateKey: string;
  label: string;
  masteryPct: number;
  cumulativeReviews: number;
}

/**
 * Reconstructs daily mastery percentage trajectory from chronological ReviewLogEntry events.
 * Because ReviewLogEntry records { cardId, ts, rating, prevInterval, newInterval } rather than full
 * daily database snapshots, this replays each card's review transitions up to each day's cutoff
 * and aligns today's final point with the live pool mastery.
 * Returns an empty array when no review logs exist (never fabricates historical data).
 */
export function computeHistoricalMasterySeries(
  cards: Flashcard[],
  logs: ReviewLogEntry[],
  settings?: Partial<UserSettings>,
  maxDays = 14,
  now: Date = new Date()
): HistoricalMasteryPoint[] {
  const activeCards = cards.filter(c => !c.suspended);
  if (activeCards.length === 0 || logs.length === 0) {
    return [];
  }

  const sortedLogs = [...logs].sort((a, b) => a.ts - b.ts);
  const firstLogDate = new Date(sortedLogs[0].ts);
  const firstMidnight = new Date(
    firstLogDate.getFullYear(),
    firstLogDate.getMonth(),
    firstLogDate.getDate()
  );
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const spanDays = Math.max(
    1,
    Math.min(
      maxDays,
      Math.round((todayMidnight.getTime() - firstMidnight.getTime()) / (24 * 60 * 60 * 1000)) + 1
    )
  );

  // Build baseline simulated card map starting unseen before logs are replayed
  const simMap = new Map<string, Flashcard>();
  for (const c of activeCards) {
    simMap.set(c.id, {
      ...c,
      state: 'new',
      intervalDays: 0,
      repetitionCount: 0,
      consecutiveGoods: 0,
      firstTimeReviewedAt: undefined,
      lastReviewedAt: undefined,
    });
  }

  const points: HistoricalMasteryPoint[] = [];
  let logCursor = 0;

  for (let i = spanDays - 1; i >= 0; i--) {
    const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dayEndMs = new Date(
      dayDate.getFullYear(),
      dayDate.getMonth(),
      dayDate.getDate(),
      23,
      59,
      59,
      999
    ).getTime();
    const dateKey = getLocalDateKey(dayDate);

    while (logCursor < sortedLogs.length && sortedLogs[logCursor].ts <= dayEndMs) {
      const entry = sortedLogs[logCursor++];
      const simCard = simMap.get(entry.cardId);
      if (simCard) {
        const iso = new Date(entry.ts).toISOString();
        if (entry.rating === 'first-time') {
          simCard.state = 'learning';
          simCard.intervalDays = entry.newInterval;
          simCard.firstTimeReviewedAt = simCard.firstTimeReviewedAt || iso;
        } else if (entry.rating === 'again') {
          simCard.state = simCard.repetitionCount > 0 ? 'review' : 'learning';
          simCard.intervalDays = entry.newInterval;
          simCard.consecutiveGoods = 0;
          simCard.firstTimeReviewedAt = simCard.firstTimeReviewedAt || iso;
          simCard.lastReviewedAt = iso;
        } else if (entry.rating === 'hard') {
          simCard.state = simCard.repetitionCount > 0 ? 'review' : 'learning';
          simCard.intervalDays = entry.newInterval;
          simCard.consecutiveGoods = 0;
          if (simCard.repetitionCount > 0) simCard.repetitionCount += 1;
          simCard.firstTimeReviewedAt = simCard.firstTimeReviewedAt || iso;
          simCard.lastReviewedAt = iso;
        } else {
          // 'good' | 'easy'
          simCard.state = 'review';
          simCard.intervalDays = entry.newInterval;
          simCard.repetitionCount = (simCard.repetitionCount || 0) + 1;
          simCard.consecutiveGoods = (simCard.consecutiveGoods || 0) + 1;
          simCard.firstTimeReviewedAt = simCard.firstTimeReviewedAt || iso;
          simCard.lastReviewedAt = iso;
        }
      }
    }

    if (i === 0) {
      const liveMastery = computePoolAndTopicMastery(activeCards, settings, now).overallMasteryPct;
      points.push({
        dateKey,
        label: dayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        masteryPct: liveMastery,
        cumulativeReviews: logCursor,
      });
    } else {
      let sum = 0;
      for (const simCard of simMap.values()) {
        sum += computeCardMasteryScore(simCard, settings, dayDate);
      }
      const pct = Math.round((sum / activeCards.length) * 100);
      points.push({
        dateKey,
        label: dayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        masteryPct: pct,
        cumulativeReviews: logCursor,
      });
    }
  }

  return points;
}

