import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  where,
  writeBatch,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from './auth';
import { Deck, Flashcard, StudyStreakState, VariableDefinition, ColumnMapping } from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map(provider => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot per skill guidelines
export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testFirestoreConnection();

const BATCH_CHUNK_SIZE = 450;

const sanitizeId = (rawId: string): string => {
  const cleaned = String(rawId || 'id')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  return cleaned || 'id_default';
};

const truncateStr = (val: string | undefined, maxLen: number, fallback = ''): string => {
  const str = String(val ?? fallback);
  return str.slice(0, maxLen);
};

export function serializeDeckForFirestore(deck: Deck, uid: string) {
  const mapping = deck.columnMapping || {
    statementCol: 'Statement',
    formulaCol: 'Formula',
  };

  const record: Record<string, any> = {
    ownerId: uid,
    name: truncateStr(deck.name, 200, 'Untitled Deck'),
    description: truncateStr(deck.description, 1000, ''),
    cardsCount: Math.max(0, Math.min(10000, Math.floor(deck.cardsCount || 0))),
    syncIntervalHours: Math.max(1, Math.min(720, Math.floor(deck.syncIntervalHours || 24))),
    lastSyncedAt: truncateStr(deck.lastSyncedAt || new Date().toISOString(), 64),
    statementCol: truncateStr(mapping.statementCol, 120, 'Statement'),
    formulaCol: truncateStr(mapping.formulaCol, 120, 'Formula'),
    createdAt: truncateStr(deck.createdAt || deck.lastSyncedAt || new Date().toISOString(), 64),
    updatedAt: serverTimestamp(),
  };

  if (deck.sheetName) {
    record.sheetName = truncateStr(deck.sheetName, 120);
  }
  if (typeof deck.newCardsPerDayOverride === 'number') {
    record.newCardsPerDayOverride = Math.max(0, Math.min(1000, Math.floor(deck.newCardsPerDayOverride)));
  }
  if (mapping.variablesCol) {
    record.variablesCol = truncateStr(mapping.variablesCol, 120);
  }
  if (mapping.explanationCol) {
    record.explanationCol = truncateStr(mapping.explanationCol, 120);
  }
  if (mapping.categoryCol) {
    record.categoryCol = truncateStr(mapping.categoryCol, 120);
  }
  if (mapping.conditionsCol) {
    record.conditionsCol = truncateStr(mapping.conditionsCol, 120);
  }
  if (mapping.derivationCol) {
    record.derivationCol = truncateStr(mapping.derivationCol, 120);
  }

  if (deck.googleDriveFileId) {
    record.googleDriveFileId = truncateStr(deck.googleDriveFileId, 256);
  }
  if (deck.googleDriveFileName) {
    record.googleDriveFileName = truncateStr(deck.googleDriveFileName, 256);
  }
  if (deck.googleDriveMimeType) {
    record.googleDriveMimeType = truncateStr(deck.googleDriveMimeType, 128);
  }
  if (deck.googleDriveModifiedTime) {
    record.googleDriveModifiedTime = truncateStr(deck.googleDriveModifiedTime, 64);
  }

  return record;
}

export function serializeCardForFirestore(card: Flashcard, uid: string) {
  const normalizedState =
    card.state === 'new' || card.state === 'learning' || card.state === 'review'
      ? card.state
      : 'review';

  const record: Record<string, any> = {
    ownerId: uid,
    deckId: sanitizeId(card.deckId),
    statement: truncateStr(card.statement, 2000, 'Formula'),
    formula: truncateStr(card.formula, 2000, 'x'),
    repetitionStage: ['statement', 'cloze', 'variables'].includes(card.repetitionStage)
      ? card.repetitionStage
      : 'statement',
    intervalDays: Math.max(0, Math.min(36500, Number(card.intervalDays) || 0)),
    easeFactor: Math.max(1.0, Math.min(10.0, Number(card.easeFactor) || 2.5)),
    repetitionCount: Math.max(0, Math.min(100000, Math.floor(card.repetitionCount || 0))),
    dueDate: truncateStr(card.dueDate || new Date().toISOString(), 64),
    state: normalizedState,
    createdAt: truncateStr(card.createdAt || card.dueDate || new Date().toISOString(), 64),
    updatedAt: serverTimestamp(),
  };

  if (card.explanation !== undefined) {
    record.explanation = truncateStr(card.explanation, 2000);
  }
  if (card.category !== undefined) {
    record.category = truncateStr(card.category, 200);
  }
  if (card.conditions !== undefined) {
    record.conditions = truncateStr(card.conditions, 1000);
  }
  const deriv = card.derivation ?? card.derivationSummary;
  if (deriv !== undefined) {
    record.derivation = truncateStr(deriv, 2000);
  }
  if (card.lastReviewedAt) {
    record.lastReviewedAt = truncateStr(card.lastReviewedAt, 64);
  }
  if (card.firstTimeReviewedAt) {
    record.firstTimeReviewedAt = truncateStr(card.firstTimeReviewedAt, 64);
  }
  if (card.shiftedFromDate) {
    record.shiftedFromDate = truncateStr(card.shiftedFromDate, 32);
  }
  if (typeof card.rolloverCount === 'number') {
    record.rolloverCount = Math.max(0, Math.min(10000, Math.floor(card.rolloverCount)));
  }
  if (typeof card.lapses === 'number') {
    record.lapses = Math.max(0, Math.min(10000, Math.floor(card.lapses)));
  }
  if (typeof card.consecutiveGoods === 'number') {
    record.consecutiveGoods = Math.max(0, Math.min(10000, Math.floor(card.consecutiveGoods)));
  }
  if (typeof card.suspended === 'boolean') {
    record.suspended = card.suspended;
  }

  if (Array.isArray(card.variables) && card.variables.length > 0) {
    const bounded = card.variables.slice(0, 20);
    record.variableSymbols = bounded.map(v => truncateStr(v.symbol, 200, '?'));
    record.variableMeanings = bounded.map(v => truncateStr(v.meaning, 500, 'Variable'));
    record.variableUnits = bounded.map(v => truncateStr(v.unit || '', 100, ''));
  }

  return record;
}

export function deserializeCardFromFirestore(id: string, data: Record<string, any>): Flashcard {
  const symbols: string[] = Array.isArray(data.variableSymbols) ? data.variableSymbols : [];
  const meanings: string[] = Array.isArray(data.variableMeanings) ? data.variableMeanings : [];
  const units: string[] = Array.isArray(data.variableUnits) ? data.variableUnits : [];

  const variables: VariableDefinition[] = symbols.map((sym, idx) => ({
    symbol: sym,
    meaning: meanings[idx] || '',
    unit: units[idx] || undefined,
  }));

  const rawState = data.state;
  const normalizedState: Flashcard['state'] =
    rawState === 'new' || rawState === 'learning' || rawState === 'review'
      ? rawState
      : 'review';

  return {
    id,
    deckId: data.deckId,
    statement: data.statement,
    formula: data.formula,
    variables: variables.length > 0 ? variables : undefined,
    explanation: data.explanation,
    category: data.category,
    conditions: data.conditions,
    derivation: data.derivation,
    derivationSummary: data.derivation,
    repetitionStage: data.repetitionStage || 'statement',
    intervalDays: Number(data.intervalDays) || 0,
    easeFactor: Number(data.easeFactor) || 2.5,
    repetitionCount: Number(data.repetitionCount) || 0,
    dueDate: data.dueDate || new Date().toISOString(),
    lastReviewedAt: data.lastReviewedAt,
    firstTimeReviewedAt: data.firstTimeReviewedAt,
    shiftedFromDate: data.shiftedFromDate,
    rolloverCount: data.rolloverCount,
    lapses: typeof data.lapses === 'number' ? data.lapses : 0,
    consecutiveGoods: typeof data.consecutiveGoods === 'number' ? data.consecutiveGoods : 0,
    suspended: Boolean(data.suspended),
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
    state: normalizedState,
  };
}

export function deserializeDeckFromFirestore(id: string, data: Record<string, any>): Deck {
  const columnMapping: ColumnMapping = {
    statementCol: data.statementCol || 'Statement',
    formulaCol: data.formulaCol || 'Formula',
    variablesCol: data.variablesCol || undefined,
    explanationCol: data.explanationCol || undefined,
    categoryCol: data.categoryCol || undefined,
    conditionsCol: data.conditionsCol || undefined,
    derivationCol: data.derivationCol || undefined,
  };

  return {
    id,
    name: data.name,
    description: data.description,
    sheetName: data.sheetName || undefined,
    googleDriveFileId: data.googleDriveFileId,
    googleDriveFileName: data.googleDriveFileName,
    googleDriveMimeType: data.googleDriveMimeType,
    googleDriveModifiedTime: data.googleDriveModifiedTime,
    lastSyncedAt: data.lastSyncedAt || new Date().toISOString(),
    syncIntervalHours: Number(data.syncIntervalHours) || 24,
    columnMapping,
    cardsCount: Number(data.cardsCount) || 0,
    newCardsPerDayOverride:
      typeof data.newCardsPerDayOverride === 'number' ? data.newCardsPerDayOverride : undefined,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : undefined,
  };
}

/**
 * Syncs a deck and its cards in chunks of <= 450 operations with zero sequential getDoc reads.
 */
export async function syncDeckAndCardsToFirestore(
  deck: Deck,
  deckCards: Flashcard[]
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const deckDocId = sanitizeId(deck.id);
  const deckRef = doc(db, 'decks', deckDocId);

  try {
    const operations: Array<{ ref: ReturnType<typeof doc>; payload: Record<string, any> }> = [
      {
        ref: deckRef,
        payload: serializeDeckForFirestore(deck, user.uid),
      },
      ...deckCards.map(card => ({
        ref: doc(db, 'cards', sanitizeId(card.id)),
        payload: serializeCardForFirestore({ ...card, deckId: deckDocId }, user.uid),
      })),
    ];

    for (let i = 0; i < operations.length; i += BATCH_CHUNK_SIZE) {
      const chunk = operations.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const op of chunk) {
        batch.set(op.ref, op.payload, { merge: true });
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `decks/${deckDocId}`);
  }
}

/**
 * Writes a single card update to Firestore using merge write without a pre-read getDoc.
 */
export async function syncSingleCardToFirestore(card: Flashcard): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const cardDocId = sanitizeId(card.id);
  const cardRef = doc(db, 'cards', cardDocId);

  try {
    await setDoc(cardRef, serializeCardForFirestore(card, user.uid), { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `cards/${cardDocId}`);
  }
}

/**
 * Writes the study streak once per session end using a single merge write.
 */
export async function syncStreakToFirestore(streak: StudyStreakState): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const streakRef = doc(db, 'user_streaks', user.uid);
  try {
    const payload: Record<string, any> = {
      ownerId: user.uid,
      currentStreak: Math.max(0, Math.min(36500, Math.floor(streak.currentStreak || 0))),
      bestStreak: Math.max(0, Math.min(36500, Math.floor(streak.bestStreak || 0))),
      completedDates: (streak.completedDates || []).slice(0, 1000).map(d => truncateStr(d, 32)),
      createdAt: truncateStr(streak.lastStudiedDate || new Date().toISOString(), 64),
      updatedAt: serverTimestamp(),
    };

    if (streak.lastStudiedDate) {
      payload.lastStudiedDate = truncateStr(streak.lastStudiedDate, 32);
    }

    await setDoc(streakRef, payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `user_streaks/${user.uid}`);
  }
}

export async function deleteDeckAndCardsFromFirestore(
  deckId: string,
  cardIds: string[]
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const deckDocId = sanitizeId(deckId);
  try {
    const refs = [
      ...cardIds.map(cId => doc(db, 'cards', sanitizeId(cId))),
      doc(db, 'decks', deckDocId),
    ];

    for (let i = 0; i < refs.length; i += BATCH_CHUNK_SIZE) {
      const chunk = refs.slice(i, i + BATCH_CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const r of chunk) {
        batch.delete(r);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `decks/${deckDocId}`);
  }
}

export async function deleteSingleCardFromFirestore(cardId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const cardDocId = sanitizeId(cardId);
  try {
    await deleteDoc(doc(db, 'cards', cardDocId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `cards/${cardDocId}`);
  }
}

export async function loadOrBootstrapUserFirestoreState(
  localDecks: Deck[],
  localCards: Flashcard[],
  localStreak: StudyStreakState
): Promise<{
  decks: Deck[];
  cards: Flashcard[];
  streak: StudyStreakState;
}> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    return { decks: localDecks, cards: localCards, streak: localStreak };
  }

  let cloudDecks: Deck[] = [];
  let cloudCards: Flashcard[] = [];
  let cloudStreak: StudyStreakState | null = null;

  try {
    const decksSnap = await getDocs(
      query(collection(db, 'decks'), where('ownerId', '==', user.uid))
    );
    cloudDecks = decksSnap.docs.map(d => deserializeDeckFromFirestore(d.id, d.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'decks');
  }

  try {
    const cardsSnap = await getDocs(
      query(collection(db, 'cards'), where('ownerId', '==', user.uid))
    );
    cloudCards = cardsSnap.docs.map(c => deserializeCardFromFirestore(c.id, c.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'cards');
  }

  try {
    const streakSnap = await getDoc(doc(db, 'user_streaks', user.uid));
    if (streakSnap.exists()) {
      const sData = streakSnap.data();
      cloudStreak = {
        currentStreak: Number(sData.currentStreak) || 0,
        bestStreak: Number(sData.bestStreak) || 0,
        completedDates: Array.isArray(sData.completedDates) ? sData.completedDates : [],
        lastStudiedDate: sData.lastStudiedDate,
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `user_streaks/${user.uid}`);
  }

  if (cloudDecks.length === 0 && localDecks.length > 0) {
    for (const d of localDecks) {
      const dCards = localCards.filter(c => c.deckId === d.id);
      await syncDeckAndCardsToFirestore(d, dCards);
    }
    await syncStreakToFirestore(localStreak);
    return { decks: localDecks, cards: localCards, streak: localStreak };
  }

  const cloudDeckIds = new Set(cloudDecks.map(d => d.id));
  const mergedDecks = [...cloudDecks];
  const mergedCards = [...cloudCards];

  for (const localDeck of localDecks) {
    if (!cloudDeckIds.has(localDeck.id)) {
      const dCards = localCards.filter(c => c.deckId === localDeck.id);
      await syncDeckAndCardsToFirestore(localDeck, dCards);
      mergedDecks.unshift(localDeck);
      mergedCards.push(...dCards);
    }
  }

  const mergedCompletedDates = Array.from(
    new Set([...(localStreak.completedDates || []), ...(cloudStreak?.completedDates || [])])
  ).sort();

  const finalStreak: StudyStreakState = {
    currentStreak: Math.max(localStreak.currentStreak, cloudStreak?.currentStreak || 0),
    bestStreak: Math.max(localStreak.bestStreak, cloudStreak?.bestStreak || 0),
    completedDates: mergedCompletedDates,
    lastStudiedDate: localStreak.lastStudiedDate || cloudStreak?.lastStudiedDate,
  };

  await syncStreakToFirestore(finalStreak);

  return {
    decks: mergedDecks,
    cards: mergedCards,
    streak: finalStreak,
  };
}
