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
} from '../srsEngine';
import {
  getNewCardQuotaForDeck,
  rolloverOverdueCardsFromPastDays,
  applyCatchUpPostponement,
} from '../storage';
import { parseAndValidateMcpParam } from '../mcpService';
import { deserializeDeckFromFirestore } from '../firestoreSync';
import { Deck, Flashcard } from '../../types';

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
});
