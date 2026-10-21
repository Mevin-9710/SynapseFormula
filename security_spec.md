# Security Specification — SynapseFormula Firestore

## 1. Data Invariants
1. **Authentication & Verification Invariant**: Every read and write operation requires an authenticated user (`request.auth != null`) with a verified email (`request.auth.token.email_verified == true`).
2. **Ownership Invariant**: Every `DeckRecord` (`/decks/{deckId}`), `CardRecord` (`/cards/{cardId}`), and `StreakRecord` (`/user_streaks/{userId}`) must have `ownerId == request.auth.uid`, and for `/user_streaks/{userId}`, the path variable `userId` must equal `request.auth.uid`.
3. **Relational Integrity Invariant**: A `CardRecord` at `/cards/{cardId}` can only be created or updated if its parent `DeckRecord` at `/decks/$(incoming().deckId)` exists (`exists(...)` or `existsAfter(...)`) and belongs to `request.auth.uid`.
4. **Immutability Invariant**: `ownerId`, `deckId` (on cards), and `createdAt` cannot be modified after creation.
5. **Temporal Integrity Invariant**: On `create`, `createdAt == request.time && updatedAt == request.time`. On `update`, `updatedAt == request.time && createdAt == resource.data.createdAt`.
6. **Strict Schema & Volumetric Bounds**: All strings and arrays have explicit `.size()` limits and `.keys().hasAll(...)` / `.keys().hasOnly(...)` guards.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unverified Email Spoof**: `{ ownerId: "uid1", ... }` sent with `request.auth.token.email_verified == false` -> `PERMISSION_DENIED`.
2. **Cross-User Ownership Spoof on Create**: Creating `/decks/deck_1` with `ownerId: "victim_uid"` while signed in as `"attacker_uid"` -> `PERMISSION_DENIED`.
3. **Shadow Field Injection on Deck Create**: Creating `/decks/deck_1` with an undeclared field `isAdmin: true` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection on Deck Update**: Updating `/decks/deck_1` with `extraField: "hack"` -> `PERMISSION_DENIED`.
5. **Immutable `ownerId` Mutation on Update**: Updating `/decks/deck_1` to change `ownerId` -> `PERMISSION_DENIED`.
6. **Immutable `createdAt` Mutation on Update**: Updating `/decks/deck_1` to alter `createdAt` -> `PERMISSION_DENIED`.
7. **Forged Client Timestamp on Create**: Creating `/decks/deck_1` with `createdAt` not matching `request.time` -> `PERMISSION_DENIED`.
8. **Orphaned Card Creation**: Creating `/cards/card_1` pointing to a non-existent `deckId` or a `deckId` owned by another user -> `PERMISSION_DENIED`.
9. **ID Poisoning Attack**: Creating a document with a 500-character ID or invalid characters (`../`) -> `PERMISSION_DENIED`.
10. **Denial-of-Wallet String Overflow**: Creating `/cards/card_1` with a 50,000-character `statement` (exceeding `maxLength: 2000`) -> `PERMISSION_DENIED`.
11. **Unbounded Array Poisoning**: Updating `/user_streaks/uid1` with `completedDates` exceeding 1000 items or non-string first item -> `PERMISSION_DENIED`.
12. **Unauthorized Cross-User List Scraping**: Executing a `list` query on `/decks` or `/cards` without filtering `ownerId == request.auth.uid` -> `PERMISSION_DENIED`.
