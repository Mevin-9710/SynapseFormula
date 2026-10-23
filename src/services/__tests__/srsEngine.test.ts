import { describe, it, expect } from 'vitest';
import {
  calculateNextReview,
  getLocalDateKey,
  getDaysLeftBeforeExam,
  getEffectiveMaxIntervalDays,
  isCardDueToday,
  isCardStable,
  isCardLeech,
  sortDueCardsMostOverdueFirst,
  generateFormulaCloze,
  generateInterleavedFormulaOptions,
  formatIntervalReadable,
  isCardLearned,
  calculateRatingScoreDelta,
  computeRoundProgress,
  buildUnifiedReviewQueue,
  computeCardMasteryScore,
  computePoolAndTopicMastery,
} from '../srsEngine';
import {
  getNewCardQuotaForDeck,
  rolloverOverdueCardsFromPastDays,
  applyCatchUpPostponement,
  getRemainingTimeAttackSeconds,
  recordCompletedGameSession,
  getGameAnalyticsState,
  saveGameAnalyticsState,
} from '../storage';
import { computeHistoricalMasterySeries } from '../reviewLog';
import { parseAndValidateMcpParam } from '../mcpService';
import { deserializeDeckFromFirestore } from '../firestoreSync';
import { Deck, Flashcard, ReviewLogEntry } from '../../types';

function makeCard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'test-card-1',
    deckId: 'deck-1',
    statement: 'Newton Second Law',
    formula: 'F = ma',
    repetitionStage: 'statement',
    intervalDays: 0,
    easeFactor: 2.5,
    repetitionCount: 0,
    dueDate: new Date().toISOString(),
    state: 'new',
    ...overrides,
  };
}

describe('srsEngine - ratings, caps, lapses, exam mode, and rollover', () => {
  it('handles every rating from new state', () => {
    const card = makeCard({ state: 'new', intervalDays: 0, repetitionCount: 0, easeFactor: 2.5 });

    const firstTime = calculateNextReview(card, 'first-time');
    expect(firstTime.nextIntervalDays).toBe(1);
    expect(firstTime.nextState).toBe('learning');
    expect(firstTime.nextEaseFactor).toBe(2.5);

    const again = calculateNextReview(card, 'again');
    expect(again.nextIntervalDays).toBeCloseTo(1 / (24 * 60), 6);
    expect(again.nextState).toBe('learning');
    expect(again.nextRepetitionCount).toBe(0);
    expect(again.nextEaseFactor).toBe(2.3);

    const hard = calculateNextReview(card, 'hard');
    expect(hard.nextIntervalDays).toBeCloseTo(10 / (24 * 60), 6);
    expect(hard.nextState).toBe('learning');
    expect(hard.nextEaseFactor).toBe(2.35);

    const good = calculateNextReview(card, 'good');
    expect(good.nextIntervalDays).toBe(1);
    expect(good.nextState).toBe('review');
    expect(good.nextRepetitionCount).toBe(1);
    expect(good.nextConsecutiveGoods).toBe(1);

    const easy = calculateNextReview(card, 'easy');
    expect(easy.nextIntervalDays).toBe(4);
    expect(easy.readableNextInterval).toBe('4d');
    expect(easy.nextState).toBe('review');
    expect(easy.nextRepetitionCount).toBe(1);
  });

  it('caps Good and Easy intervals at maxIntervalDays (default 4) and never enters mastered state', () => {
    const card = makeCard({
      state: 'review',
      intervalDays: 3,
      repetitionCount: 4,
      easeFactor: 2.5,
      consecutiveGoods: 2,
    });

    const good = calculateNextReview(card, 'good', { maxIntervalDays: 4 });
    expect(good.nextIntervalDays).toBe(4);
    expect(good.nextState).toBe('review');
    expect(good.nextConsecutiveGoods).toBe(3);
    expect(good.isStable).toBe(true);

    const easy = calculateNextReview(card, 'easy', { maxIntervalDays: 4 });
    expect(easy.nextIntervalDays).toBe(4);
    expect(easy.nextState).toBe('review');

    const easyUncapped = calculateNextReview(card, 'easy', { maxIntervalDays: 12 });
    const goodUncapped = calculateNextReview(card, 'good', { maxIntervalDays: 12 });
    expect(goodUncapped.nextIntervalDays).toBe(8);
    expect(easyUncapped.nextIntervalDays).toBe(Math.round(8 * 1.3));
  });

  it('caps intervals when examDate is set to min(setting, daysLeft - 1) and activates final-week mode', () => {
    const now = new Date('2026-05-01T10:00:00');
    const examDate = '2026-05-04'; // 3 days left -> cap = min(10, 3 - 1) = 2
    expect(getDaysLeftBeforeExam(examDate, now)).toBe(3);
    expect(getEffectiveMaxIntervalDays({ maxIntervalDays: 10, examDate }, now)).toBe(2);

    const card = makeCard({ state: 'review', intervalDays: 3, repetitionCount: 2, easeFactor: 2.5 });
    const res = calculateNextReview(card, 'good', { maxIntervalDays: 10, examDate, now });
    expect(res.nextIntervalDays).toBe(2);

    // Final-week mode surfaces seen cards in the last 3 days before exam
    const futureDueCard = makeCard({
      state: 'review',
      intervalDays: 4,
      repetitionCount: 2,
      dueDate: '2026-05-08T09:00:00.000Z',
      lastReviewedAt: '2026-04-28T09:00:00.000Z',
    });
    expect(isCardDueToday(futureDueCard, now, { examDate })).toBe(true);
  });

  it('applies lapse rule on Again for mature/review cards instead of resetting to 1 minute', () => {
    const matureCard = makeCard({
      state: 'review',
      intervalDays: 10,
      repetitionCount: 4,
      easeFactor: 2.5,
      lapses: 4,
      consecutiveGoods: 3,
    });

    const lapsed = calculateNextReview(matureCard, 'again', { maxIntervalDays: 10 });
    expect(lapsed.nextIntervalDays).toBe(3); // round(10 * 0.3) = 3
    expect(lapsed.nextLapses).toBe(5);
    expect(lapsed.isLeech).toBe(true);
    expect(lapsed.nextEaseFactor).toBe(2.3);
    expect(lapsed.nextConsecutiveGoods).toBe(0);
    expect(lapsed.nextState).toBe('review');
  });

  it('detects stable and leech cards and excludes suspended cards from due queue', () => {
    const stableCard = makeCard({
      state: 'review',
      intervalDays: 4,
      repetitionCount: 3,
      consecutiveGoods: 3,
      lapses: 5,
    });
    expect(isCardStable(stableCard, { maxIntervalDays: 4 })).toBe(true);
    expect(isCardLeech(stableCard)).toBe(true);

    const suspendedCard = makeCard({
      dueDate: new Date('2020-01-01').toISOString(),
      suspended: true,
    });
    expect(isCardDueToday(suspendedCard)).toBe(false);
  });

  it('preserves overdue order during rollover and catch-up mode spreads excess across 3 days', () => {
    const c1 = makeCard({ id: 'c1', dueDate: '2026-05-08T09:00:00.000Z' });
    const c2 = makeCard({ id: 'c2', dueDate: '2026-05-05T09:00:00.000Z' });
    const c3 = makeCard({ id: 'c3', dueDate: '2026-05-09T09:00:00.000Z' });

    const { updatedCards } = rolloverOverdueCardsFromPastDays([c1, c3, c2]);
    const sorted = sortDueCardsMostOverdueFirst(updatedCards);
    expect(sorted.map(c => c.id)).toEqual(['c2', 'c1', 'c3']);

    // Catch-up mode with cap = 1 postpones 2 cards
    const now = new Date('2026-05-10T10:00:00');
    const catchUp = applyCatchUpPostponement(updatedCards, 1, now);
    expect(catchUp.postponedCount).toBe(2);
    const stillDueToday = catchUp.updatedCards.filter(c => isCardDueToday(c, now));
    expect(stillDueToday.map(c => c.id)).toEqual(['c2']);
  });

  it('limits a fresh user with 20 imported decks (~700 cards) to at most the daily new-card quota', () => {
    const now = new Date('2026-05-10T10:00:00');
    const decks: Deck[] = [];
    const allCards: Flashcard[] = [];

    for (let d = 1; d <= 20; d++) {
      const deckId = `deck_${d}`;
      decks.push({
        id: deckId,
        name: `Physics Deck ${d}`,
        lastSyncedAt: now.toISOString(),
        syncIntervalHours: 24,
        columnMapping: { statementCol: 'Statement', formulaCol: 'Formula' },
        cardsCount: 35,
      });
      for (let c = 1; c <= 35; c++) {
        allCards.push(
          makeCard({
            id: `card_${d}_${c}`,
            deckId,
            dueDate: now.toISOString(),
            state: 'new',
          })
        );
      }
    }

    const deck1Cards = allCards.filter(c => c.deckId === 'deck_1');
    const quota = getNewCardQuotaForDeck(
      decks[0],
      deck1Cards,
      allCards,
      { maxIntervalDays: 4, newCardsPerDay: 25, dailyReviewCap: 150 },
      now
    );
    expect(quota.availableToday).toBe(25);
    expect(quota.unseenLeftInDeck).toBe(35);
  });

  it('persists columnMapping and sheetName in Firestore deck deserialization and validates MCP payloads', () => {
    const deck = deserializeDeckFromFirestore('deck_123', {
      name: 'Thermodynamics',
      description: 'Heat & Entropy',
      sheetName: 'Chapter2_Entropy',
      statementCol: 'LawName',
      formulaCol: 'LaTeX',
      conditionsCol: 'Regime',
      derivationCol: 'Proof',
      cardsCount: 30,
      syncIntervalHours: 24,
      lastSyncedAt: '2026-05-10T00:00:00.000Z',
    });

    expect(deck.sheetName).toBe('Chapter2_Entropy');
    expect(deck.columnMapping.statementCol).toBe('LawName');
    expect(deck.columnMapping.formulaCol).toBe('LaTeX');
    expect(deck.columnMapping.conditionsCol).toBe('Regime');
    expect(deck.columnMapping.derivationCol).toBe('Proof');

    const validMcp = Buffer.from(
      JSON.stringify({
        deckName: 'Optics',
        formulas: [{ statement: 'Snell Law', formula: 'n_1 \\sin\\theta_1 = n_2 \\sin\\theta_2' }],
      })
    ).toString('base64url');
    const parsed = parseAndValidateMcpParam(validMcp);
    expect(parsed.deckName).toBe('Optics');
    expect(parsed.formulas.length).toBe(1);
  });

  it('builds cloze and interleaved distractors from peer formulas in the same deck/category', () => {
    const peer1 = makeCard({ id: 'p1', formula: 'E_k = \\frac{p^2}{2m}', category: 'Mechanics' });
    const peer2 = makeCard({ id: 'p2', formula: 'U_g = -\\frac{GMm}{r}', category: 'Mechanics' });
    const target = makeCard({ id: 't1', formula: 'F_g = \\frac{Gm_1m_2}{r^2}', category: 'Mechanics' });

    const cloze = generateFormulaCloze(target.formula, [peer1, peer2], 'Mechanics');
    expect(cloze.options).toContain('2');
    expect(cloze.options.length).toBeGreaterThanOrEqual(4);

    const interleaved = generateInterleavedFormulaOptions(target, [target, peer1, peer2], 4);
    expect(interleaved).toContain(target.formula);
    expect(interleaved).toContain(peer1.formula);
    expect(getLocalDateKey('2026-05-10')).toBe('2026-05-10');
    expect(formatIntervalReadable(1)).toBe('1d');
  });

  it('awards +3 for Good/Easy and -1 for Again ONLY on already-learned cards, and 0 for new cards', () => {
    const unseenCard = makeCard({ state: 'new', repetitionCount: 0, lastReviewedAt: undefined });
    expect(isCardLearned(unseenCard)).toBe(false);
    expect(calculateRatingScoreDelta(unseenCard, 'first-time').pointsDelta).toBe(0);
    expect(calculateRatingScoreDelta(unseenCard, 'good').pointsDelta).toBe(0);
    expect(calculateRatingScoreDelta(unseenCard, 'easy').pointsDelta).toBe(0);
    expect(calculateRatingScoreDelta(unseenCard, 'again').pointsDelta).toBe(0);

    const learnedCard = makeCard({
      state: 'review',
      repetitionCount: 2,
      lastReviewedAt: '2026-05-01T10:00:00.000Z',
    });
    expect(isCardLearned(learnedCard)).toBe(true);
    expect(calculateRatingScoreDelta(learnedCard, 'good').pointsDelta).toBe(3);
    expect(calculateRatingScoreDelta(learnedCard, 'easy').pointsDelta).toBe(3);
    expect(calculateRatingScoreDelta(learnedCard, 'again').pointsDelta).toBe(-1);

    // Score can go below zero and Undo reverses the exact delta
    let score = 0;
    const d1 = calculateRatingScoreDelta(learnedCard, 'again').pointsDelta;
    score += d1;
    expect(score).toBe(-1);
    // Undo
    score -= d1;
    expect(score).toBe(0);
  });

  it('computes 5-card rounds accurately for 50-card, 63-card, and short sessions', () => {
    // 50-card session: 10 rounds of 5
    const r0 = computeRoundProgress(0, 50);
    expect(r0.totalRounds).toBe(10);
    expect(r0.currentRound).toBe(1);
    expect(r0.cardInRound).toBe(1);
    expect(r0.cardsInCurrentRound).toBe(5);
    expect(r0.roundSize).toBe(5);
    expect(r0.justCompletedRound).toBeNull();

    const r5 = computeRoundProgress(5, 50);
    expect(r5.currentRound).toBe(2);
    expect(r5.cardInRound).toBe(1);
    expect(r5.cardsInCurrentRound).toBe(5);
    expect(r5.justCompletedRound).toBe(1);

    // 63-card session: 12 rounds of 5 + 1 final round of 3
    const r60 = computeRoundProgress(60, 63);
    expect(r60.totalRounds).toBe(13);
    expect(r60.currentRound).toBe(13);
    expect(r60.cardsInCurrentRound).toBe(3);
    expect(r60.cardInRound).toBe(1);
    expect(r60.justCompletedRound).toBe(12);

    const r62 = computeRoundProgress(62, 63);
    expect(r62.currentRound).toBe(13);
    expect(r62.cardsInCurrentRound).toBe(3);
    expect(r62.cardInRound).toBe(3);

    const r63 = computeRoundProgress(63, 63);
    expect(r63.overallPercent).toBe(100);
    expect(r63.roundPercent).toBe(100);
    expect(r63.justCompletedRound).toBeNull();
  });

  it('builds a unified priority-shuffled queue with overdue first, due today second, interleaved new cards, and excludes non-due cards', () => {
    const now = new Date('2026-05-10T10:00:00');
    const overdueCard = makeCard({
      id: 'overdue-1',
      deckId: 'deck-a',
      state: 'review',
      repetitionCount: 3,
      lastReviewedAt: '2026-05-01T10:00:00.000Z',
      dueDate: '2026-05-05T10:00:00.000Z',
    });
    const dueTodayCard1 = makeCard({
      id: 'due-today-1',
      deckId: 'deck-a',
      state: 'review',
      repetitionCount: 2,
      lastReviewedAt: '2026-05-08T10:00:00.000Z',
      dueDate: '2026-05-10T08:00:00.000Z',
    });
    const dueTodayCard2 = makeCard({
      id: 'due-today-2',
      deckId: 'deck-b',
      state: 'review',
      repetitionCount: 2,
      lastReviewedAt: '2026-05-08T10:00:00.000Z',
      dueDate: '2026-05-10T09:00:00.000Z',
    });
    const futureCard = makeCard({
      id: 'future-1',
      deckId: 'deck-a',
      state: 'review',
      repetitionCount: 4,
      lastReviewedAt: '2026-05-09T10:00:00.000Z',
      dueDate: '2026-05-14T10:00:00.000Z',
    });
    const suspendedCard = makeCard({
      id: 'suspended-1',
      deckId: 'deck-a',
      state: 'review',
      repetitionCount: 2,
      lastReviewedAt: '2026-05-01T10:00:00.000Z',
      dueDate: '2026-05-04T10:00:00.000Z',
      suspended: true,
    });
    const newCard1 = makeCard({
      id: 'new-1',
      deckId: 'deck-b',
      state: 'new',
      repetitionCount: 0,
      dueDate: '2026-05-10T09:00:00.000Z',
    });

    const queue = buildUnifiedReviewQueue(
      [overdueCard, dueTodayCard1, dueTodayCard2, futureCard, suspendedCard, newCard1],
      [],
      { maxIntervalDays: 4, newCardsPerDay: 10, dailyReviewCap: 50 },
      now
    );

    const ids = queue.map(c => c.id);
    expect(ids).toContain('overdue-1');
    expect(ids).toContain('due-today-1');
    expect(ids).toContain('due-today-2');
    expect(ids).toContain('new-1');
    expect(ids).not.toContain('future-1');
    expect(ids).not.toContain('suspended-1');
    // Overdue card should appear before due-today cards
    expect(ids[0]).toBe('overdue-1');
    // No duplicates
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('computes wall-clock Time Attack countdown and records completed sessions idempotently', () => {
    const endsAt = 1_700_000_300_000;
    expect(getRemainingTimeAttackSeconds(endsAt, 1_700_000_000_000)).toBe(300);
    expect(getRemainingTimeAttackSeconds(endsAt, 1_700_000_299_200)).toBe(1);
    expect(getRemainingTimeAttackSeconds(endsAt, 1_700_000_305_000)).toBe(0);

    saveGameAnalyticsState({ timeAttackBests: {}, recentSessions: [] });

    const sessionRecord = {
      id: 'session-unique-1',
      mode: 'time-attack' as const,
      durationSeconds: 300 as const,
      score: 21,
      cardsCompleted: 8,
      correctCount: 7,
      incorrectCount: 1,
      roundsCompleted: 1,
      completedAt: '2026-05-10T10:05:00.000Z',
    };

    const firstSave = recordCompletedGameSession(sessionRecord);
    expect(firstSave.isNewPersonalBest).toBe(true);
    expect(firstSave.state.recentSessions.length).toBe(1);
    expect(firstSave.state.timeAttackBests[300]?.bestScore).toBe(21);

    // Calling recordCompletedGameSession a second time with the same session ID must not duplicate
    const secondSave = recordCompletedGameSession(sessionRecord);
    expect(secondSave.isNewPersonalBest).toBe(false);
    expect(secondSave.wasDuplicate).toBe(true);
    expect(secondSave.state.recentSessions.length).toBe(1);
    expect(getGameAnalyticsState().recentSessions.length).toBe(1);
  });

  it('saves high score even when exiting mid-round', () => {
    saveGameAnalyticsState({ timeAttackBests: {}, recentSessions: [] });

    // Mid-round classic mode exit after 2 cards with +6 score
    const midClassic = {
      id: 'session-mid-classic',
      mode: 'classic' as const,
      score: 6,
      cardsCompleted: 2,
      correctCount: 2,
      incorrectCount: 0,
      roundsCompleted: 0, // mid-round (less than 5 cards)
      completedAt: '2026-05-10T11:00:00.000Z',
    };

    const classicSave = recordCompletedGameSession(midClassic, { forceHighScore: true });
    expect(classicSave.isNewPersonalBest).toBe(true);
    expect(classicSave.state.classicBest?.bestScore).toBe(6);
    expect(classicSave.state.classicBest?.mostCardsCompleted).toBe(2);
    expect(getGameAnalyticsState().classicBest?.bestScore).toBe(6);

    // Mid-round Time Attack exit after 1 card with +3 score
    const midTimeAttack = {
      id: 'session-mid-ta',
      mode: 'time-attack' as const,
      durationSeconds: 300 as const,
      score: 3,
      cardsCompleted: 1,
      correctCount: 1,
      incorrectCount: 0,
      roundsCompleted: 0,
      completedAt: '2026-05-10T11:05:00.000Z',
    };

    const taSave = recordCompletedGameSession(midTimeAttack, { forceHighScore: true });
    expect(taSave.isNewPersonalBest).toBe(true);
    expect(taSave.state.timeAttackBests[300]?.bestScore).toBe(3);
    expect(taSave.state.timeAttackBests[300]?.mostCardsCompleted).toBe(1);
    expect(getGameAnalyticsState().timeAttackBests[300]?.bestScore).toBe(3);
  });

  it('computes graduated card mastery, topic mastery, and historical mastery series from review logs', () => {
    const newCard = makeCard({ id: 'm-new', state: 'new', category: 'Mechanics' });
    const learningCard = makeCard({
      id: 'm-learn',
      state: 'learning',
      repetitionCount: 1,
      lastReviewedAt: '2026-05-09T10:00:00.000Z',
      category: 'Mechanics',
    });
    const stableCard = makeCard({
      id: 'm-stable',
      state: 'review',
      intervalDays: 4,
      repetitionCount: 4,
      consecutiveGoods: 3,
      lastReviewedAt: '2026-05-09T10:00:00.000Z',
      category: 'Optics',
    });

    expect(computeCardMasteryScore(newCard, { maxIntervalDays: 4 })).toBe(0);
    expect(computeCardMasteryScore(learningCard, { maxIntervalDays: 4 })).toBe(0.25);
    expect(computeCardMasteryScore(stableCard, { maxIntervalDays: 4 })).toBe(1);

    const mastery = computePoolAndTopicMastery(
      [newCard, learningCard, stableCard],
      { maxIntervalDays: 4 }
    );
    expect(mastery.activeCount).toBe(3);
    expect(mastery.overallMasteryPct).toBe(Math.round(((0 + 0.25 + 1) / 3) * 100));
    expect(mastery.topics.length).toBe(2);
    // Weakest topic first (Mechanics: 13% before Optics: 100%)
    expect(mastery.topics[0].category).toBe('Mechanics');
    expect(mastery.topics[1].category).toBe('Optics');

    // Historical mastery from chronological review logs
    const day1Ts = new Date('2026-05-08T10:00:00.000Z').getTime();
    const day2Ts = new Date('2026-05-09T10:00:00.000Z').getTime();
    const logs: ReviewLogEntry[] = [
      {
        id: 'log-1',
        cardId: 'm-learn',
        deckId: 'deck-1',
        rating: 'first-time',
        ts: day1Ts,
        ms: 4000,
        prevInterval: 0,
        newInterval: 1,
      },
      {
        id: 'log-2',
        cardId: 'm-stable',
        deckId: 'deck-1',
        rating: 'easy',
        ts: day2Ts,
        ms: 3500,
        prevInterval: 3,
        newInterval: 4,
      },
    ];

    const series = computeHistoricalMasterySeries(
      [newCard, learningCard, stableCard],
      logs,
      { maxIntervalDays: 4 },
      14,
      new Date('2026-05-09T18:00:00.000Z')
    );
    expect(series.length).toBe(2);
    expect(series[1].masteryPct).toBeGreaterThan(series[0].masteryPct);
  });
});

