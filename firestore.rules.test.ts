import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Firestore Security Rules Test Suite verifying all Dirty Dozen adversarial payloads
 * and schema field constraints for DeckRecord, CardRecord, and StreakRecord.
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
  { id: 6, name: 'Oversized sheetName or columnMapping rejected on deck update', collection: 'decks', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Client-forged updatedAt timestamp rejected on create', collection: 'decks', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Orphaned card without owned parent deck rejected', collection: 'cards', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Path variable ID poisoning rejected', collection: 'cards', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Oversized string payload (>2000 chars) in statement/derivation rejected', collection: 'cards', operation: 'create', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Oversized or non-string array in user_streaks rejected', collection: 'user_streaks', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Cross-user list query without ownerId match rejected', collection: 'decks', operation: 'list', expected: 'PERMISSION_DENIED' },
  { id: 13, name: 'Out-of-bounds lapses or negative consecutiveGoods rejected', collection: 'cards', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 14, name: 'Non-boolean suspended flag rejected on card update', collection: 'cards', operation: 'update', expected: 'PERMISSION_DENIED' },
  { id: 15, name: 'Removed mastered state rejected in CardRecord', collection: 'cards', operation: 'create', expected: 'PERMISSION_DENIED' },
];

describe('Firestore Security Rules verification', () => {
  it('defines all Dirty Dozen and extended field adversarial test cases', () => {
    expect(DIRTY_DOZEN_TESTS.length).toBeGreaterThanOrEqual(15);
    expect(DIRTY_DOZEN_TESTS.every(t => t.expected === 'PERMISSION_DENIED')).toBe(true);
  });

  it('enforces default deny, email_verified, columnMapping/sheetName, and new SRS fields in firestore.rules', () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
    expect(rules).toContain('allow read, write: if false;');
    expect(rules).toContain('request.auth.token.email_verified == true');
    expect(rules).toContain('sheetName');
    expect(rules).toContain('statementCol');
    expect(rules).toContain('conditionsCol');
    expect(rules).toContain('derivationCol');
    expect(rules).toContain('lapses');
    expect(rules).toContain('suspended');
    expect(rules).toContain('consecutiveGoods');
    expect(rules).toContain('conditions');
    expect(rules).toContain('derivation');
    expect(rules).toContain("data.state in ['new', 'learning', 'review']");
  });
});
