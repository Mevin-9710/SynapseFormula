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
import { Deck, Flashcard, StudyStreakState, VariableDefinition } from '../types';

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

function serializeDeckForFirestore(deck: Deck, uid: string, existingCreatedAt?: any) {
  const record: Record<string, any> = {
    ownerId: uid,
    name: truncateStr(deck.name, 200, 'Untitled Deck'),
    description: truncateStr(deck.description, 1000, ''),
    cardsCount: Math.max(0, Math.min(10000, Math.floor(deck.cardsCount || 0))),
    syncIntervalHours: Math.max(1, Math.min(720, Math.floor(deck.syncIntervalHours || 24))),
    lastSyncedAt: truncateStr(deck.lastSyncedAt || new Date().toISOString(), 64),
    createdAt: existingCreatedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

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

function serializeCardForFirestore(card: Flashcard, uid: string, existingCreatedAt?: any) {
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
    state: ['new', 'learning', 'review', 'mastered'].includes(card.state) ? card.state : 'new',
    createdAt: existingCreatedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (card.explanation !== undefined) {
    record.explanation = truncateStr(card.explanation, 2000);
  }
  if (card.category !== undefined) {
    record.category = truncateStr(card.category, 200);
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

  if (Array.isArray(card.variables) && card.variables.length > 0) {
    const bounded = card.variables.slice(0, 20);
    record.variableSymbols = bounded.map(v => truncateStr(v.symbol, 200, '?'));
    record.variableMeanings = bounded.map(v => truncateStr(v.meaning, 500, 'Variable'));
    record.variableUnits = bounded.map(v => truncateStr(v.unit || '', 100, ''));
  }

  return record;
}

function deserializeCardFromFirestore(id: string, data: Record<string, any>): Flashcard {
  const symbols: string[] = Array.isArray(data.variableSymbols) ? data.variableSymbols : [];
  const meanings: string[] = Array.isArray(data.variableMeanings) ? data.variableMeanings : [];
  const units: string[] = Array.isArray(data.variableUnits) ? data.variableUnits : [];

  const variables: VariableDefinition[] = symbols.map((sym, idx) => ({
    symbol: sym,
    meaning: meanings[idx] || '',
    unit: units[idx] || undefined,
  }));

  return {
    id,
    deckId: data.deckId,
    statement: data.statement,
    formula: data.formula,
    variables: variables.length > 0 ? variables : undefined,
    explanation: data.explanation,
    category: data.category,
    repetitionStage: data.repetitionStage || 'statement',
    intervalDays: Number(data.intervalDays) || 0,
    easeFactor: Number(data.easeFactor) || 2.5,
    repetitionCount: Number(data.repetitionCount) || 0,
    dueDate: data.dueDate || new Date().toISOString(),
    lastReviewedAt: data.lastReviewedAt,
    firstTimeReviewedAt: data.firstTimeReviewedAt,
    shiftedFromDate: data.shiftedFromDate,
    rolloverCount: data.rolloverCount,
    state: data.state || 'new',
  };
}

function deserializeDeckFromFirestore(id: string, data: Record<string, any>): Deck {
  return {
    id,
    name: data.name,
    description: data.description,
    googleDriveFileId: data.googleDriveFileId,
    googleDriveFileName: data.googleDriveFileName,
    googleDriveMimeType: data.googleDriveMimeType,
    googleDriveModifiedTime: data.googleDriveModifiedTime,
    lastSyncedAt: data.lastSyncedAt || new Date().toISOString(),
    syncIntervalHours: Number(data.syncIntervalHours) || 24,
    columnMapping: {
      statementCol: 'Statement',
      formulaCol: 'Formula',
      variablesCol: 'Variables',
      explanationCol: 'Explanation',
      categoryCol: 'Category',
    },
    cardsCount: Number(data.cardsCount) || 0,
  };
}

export async function syncDeckAndCardsToFirestore(
  deck: Deck,
  deckCards: Flashcard[]
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const deckDocId = sanitizeId(deck.id);
  const deckRef = doc(db, 'decks', deckDocId);

  try {
    const existingSnap = await getDoc(deckRef);
    const existingCreatedAt = existingSnap.exists() ? existingSnap.data()?.createdAt : undefined;

    const batch = writeBatch(db);
    batch.set(deckRef, serializeDeckForFirestore(deck, user.uid, existingCreatedAt));

    for (const card of deckCards) {
      const cardDocId = sanitizeId(card.id);
      const cardRef = doc(db, 'cards', cardDocId);
      const cardSnap = await getDoc(cardRef);
      const cardCreatedAt = cardSnap.exists() ? cardSnap.data()?.createdAt : undefined;
      batch.set(
        cardRef,
        serializeCardForFirestore({ ...card, deckId: deckDocId }, user.uid, cardCreatedAt)
      );
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `decks/${deckDocId}`);
  }
}

export async function syncSingleCardToFirestore(card: Flashcard): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const cardDocId = sanitizeId(card.id);
  const cardRef = doc(db, 'cards', cardDocId);

  try {
    const existingSnap = await getDoc(cardRef);
    const existingCreatedAt = existingSnap.exists() ? existingSnap.data()?.createdAt : undefined;
    await setDoc(cardRef, serializeCardForFirestore(card, user.uid, existingCreatedAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `cards/${cardDocId}`);
  }
}

export async function syncStreakToFirestore(streak: StudyStreakState): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const streakRef = doc(db, 'user_streaks', user.uid);
  try {
    const existingSnap = await getDoc(streakRef);
    const existingCreatedAt = existingSnap.exists() ? existingSnap.data()?.createdAt : undefined;

    const payload: Record<string, any> = {
      ownerId: user.uid,
      currentStreak: Math.max(0, Math.min(36500, Math.floor(streak.currentStreak || 0))),
      bestStreak: Math.max(0, Math.min(36500, Math.floor(streak.bestStreak || 0))),
      completedDates: (streak.completedDates || []).slice(0, 1000).map(d => truncateStr(d, 32)),
      createdAt: existingCreatedAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (streak.lastStudiedDate) {
      payload.lastStudiedDate = truncateStr(streak.lastStudiedDate, 32);
    }

    await setDoc(streakRef, payload);
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
    const batch = writeBatch(db);
    for (const cId of cardIds) {
      batch.delete(doc(db, 'cards', sanitizeId(cId)));
    }
    batch.delete(doc(db, 'decks', deckDocId));
    await batch.commit();
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

  // If the user has no cloud decks yet, bootstrap their local decks & cards to Firestore
  if (cloudDecks.length === 0 && localDecks.length > 0) {
    for (const d of localDecks) {
      const dCards = localCards.filter(c => c.deckId === d.id);
      await syncDeckAndCardsToFirestore(d, dCards);
    }
    await syncStreakToFirestore(localStreak);
    return { decks: localDecks, cards: localCards, streak: localStreak };
  }

  // Merge any local-only decks (such as newly imported MCP decks) into Firestore
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
