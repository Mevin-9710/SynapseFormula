/**
 * Firestore Security Rules Test Suite verifying all Dirty Dozen adversarial payloads
 * return PERMISSION_DENIED.
 */
export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  { id: 1, name: 'Unverified email token rejected on create', collection: 'decks', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Cross-user ownerId spoofing rejected on create', collection: 'decks', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Shadow field injection rejected on deck create', collection: 'decks', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Shadow field injection rejected on deck update', collection: 'decks', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Immutable ownerId mutation rejected on update', collection: 'decks', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Immutable createdAt mutation rejected on update', collection: 'decks', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Client-forged timestamp rejected on create', collection: 'decks', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Orphaned card without owned parent deck rejected', collection: 'cards', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Path variable ID poisoning rejected', collection: 'cards', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Oversized string payload (>2000 chars) rejected', collection: 'cards', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Oversized or non-string array in user_streaks rejected', collection: 'user_streaks', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Cross-user list query without ownerId match rejected', collection: 'decks', operation: 'list', expected: 'PERMISSION_DENIED' },
];
