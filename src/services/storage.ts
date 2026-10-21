import { Deck, Flashcard, DeckSessionState, StudySessionMode, StudyStreakState } from '../types';
import { getLocalDateKey, isCardDueToday } from './srsEngine';
import { syncSingleCardToFirestore, syncStreakToFirestore } from './firestoreSync';

const DECKS_KEY = 'synapse_formula_decks_v1';
const CARDS_KEY = 'synapse_formula_cards_v1';
const DUE_SESSION_KEY = 'synapse_formula_due_session_v1';
const STREAK_KEY = 'synapse_formula_streak_v1';

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

export const getStoredDecks = (): Deck[] => {
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
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
  } catch (err) {
    console.error('Error saving decks to storage:', err);
  }
};

export const getStoredCards = (): Flashcard[] => {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error loading cards from storage:', err);
    return [];
  }
};

export const saveStoredCards = (cards: Flashcard[]): void => {
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
  } catch (err) {
    console.error('Error saving cards to storage:', err);
  }
};

export const getCardsForDeck = (deckId: string): Flashcard[] => {
  return getStoredCards().filter(c => c.deckId === deckId);
};

export const updateCardInStorage = (updatedCard: Flashcard): void => {
  const cards = getStoredCards();
  const idx = cards.findIndex(c => c.id === updatedCard.id);
  if (idx >= 0) {
    cards[idx] = updatedCard;
  } else {
    cards.push(updatedCard);
  }
  saveStoredCards(cards);
  const nextStreak = evaluateAndRecordDailyStreak(cards);
  syncSingleCardToFirestore(updatedCard).catch(err =>
    console.error('Background card Firestore sync failed:', err)
  );
  syncStreakToFirestore(nextStreak).catch(err =>
    console.error('Background streak Firestore sync failed:', err)
  );
};

/**
 * Universally updates session resumption state for a specific deck or global due session.
 * Supports separate persistence for 'first-time' review vs 'recall' study.
 */
export const saveDeckSessionState = (
  deckId: string,
  sessionState: DeckSessionState | undefined,
  mode: StudySessionMode = 'recall'
): void => {
  if (deckId === '__due_today__' || mode === 'due-continuous') {
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
 * Automatically rolls over any incomplete due cards from past calendar days
 * to today's schedule so no unfinished cards from yesterday or earlier are stranded.
 */
export const rolloverOverdueCardsFromPastDays = (
  currentCards: Flashcard[]
): { updatedCards: Flashcard[]; shiftedCount: number; shiftedByDeck: Record<string, number> } => {
  const now = new Date();
  const todayKey = getLocalDateKey(now);
  const todayMorning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0).toISOString();

  let shiftedCount = 0;
  const shiftedByDeck: Record<string, number> = {};

  const updatedCards = currentCards.map(card => {
    const cardDateKey = getLocalDateKey(card.dueDate);
    if (cardDateKey < todayKey) {
      shiftedCount += 1;
      shiftedByDeck[card.deckId] = (shiftedByDeck[card.deckId] || 0) + 1;
      return {
        ...card,
        shiftedFromDate: cardDateKey,
        rolloverCount: (card.rolloverCount || 0) + 1,
        dueDate: todayMorning,
      };
    }
    return card;
  });

  if (shiftedCount > 0) {
    saveStoredCards(updatedCards);
  }

  return { updatedCards, shiftedCount, shiftedByDeck };
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
        shiftedFromDate: todayKey,
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
    lastSyncedAt: now,
    syncIntervalHours: 24,
    columnMapping: {
      statementCol: 'Statement',
      formulaCol: 'Formula',
      variablesCol: 'Variables',
      explanationCol: 'Explanation',
      categoryCol: 'Category',
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
    lastSyncedAt: now,
    syncIntervalHours: 24,
    columnMapping: {
      statementCol: 'Statement',
      formulaCol: 'Formula',
      variablesCol: 'Variables',
      explanationCol: 'Explanation',
      categoryCol: 'Category',
    },
    cardsCount: 4,
  };

  const deck3: Deck = {
    id: deck3Id,
    name: 'Quantum Physics & Thermodynamics',
    description: 'Wave-particle duality, uncertainty principles, entropy, and statistical thermodynamics.',
    lastSyncedAt: now,
    syncIntervalHours: 24,
    columnMapping: {
      statementCol: 'Statement',
      formulaCol: 'Formula',
      variablesCol: 'Variables',
      explanationCol: 'Explanation',
      categoryCol: 'Category',
    },
    cardsCount: 4,
  };

  const cards: Flashcard[] = [
    // Classical Mechanics
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
      explanation: 'The magnetic component of the force is strictly perpendicular to both particle velocity and magnetic field, doing zero work on the charge.',
      category: 'Electrodynamics',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
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
      explanation: 'Follows an inverse-square relationship. Halving the separation quadruples the gravitational pull.',
      category: 'Gravitation',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      state: 'new',
    },
    {
      id: 'card_cm_3',
      deckId: deck1Id,
      statement: '*Kinetic Energy* in terms of relativistic or classical linear momentum:',
      formula: 'E_k = \\frac{p^2}{2m}',
      variables: [
        { symbol: 'E_k', meaning: 'Translational kinetic energy', unit: 'J' },
        { symbol: 'p', meaning: 'Linear momentum (p = mv)', unit: 'kg\\cdot m/s' },
        { symbol: 'm', meaning: 'Inertial mass of the body', unit: 'kg' },
      ],
      explanation: 'Directly relates mechanical kinetic energy to momentum. Crucial for quantum de Broglie substitution.',
      category: 'Mechanics',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
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
      explanation: 'Independent of initial displacement amplitude in the small-strain Hookean limit.',
      category: 'Oscillations',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
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
      explanation: 'Applies whether forces are conservative or non-conservative.',
      category: 'Energy',
      repetitionStage: 'statement',
      intervalDays: 0,
      easeFactor: 2.5,
      repetitionCount: 0,
      dueDate: now,
      state: 'new',
    },

    // Electromagnetism
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
      state: 'new',
    },

    // Quantum & Thermo
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
      state: 'new',
    },
  ];

  return {
    decks: [deck1, deck2, deck3],
    cards,
  };
}
