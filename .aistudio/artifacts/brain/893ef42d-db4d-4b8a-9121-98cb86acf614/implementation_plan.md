# SynapseFormula: Monochrome Liquid-Glass Formula Flashcard System

SynapseFormula is a cognitive-science grounded flashcard platform designed to accelerate physics and mathematical formula mastery through automated multi-stage retrieval practice, directly synced with Excel workbooks in Google Drive. Built with an Apple liquid-glass monochromatic visual design, JetBrains Mono technical typography, and session resumption across every deck.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following requirements have been incorporated directly from your design and functional feedback:

- **Confirmed Decision 1: Universal "Resume Where I Left Off" Option**: Every deck continuously auto-saves the active card, stage, study queue index, and timestamp so you can instantly resume any interrupted study session with one click.
- **Confirmed Decision 2: Monochromatic Black & White Classic Palette**: Zero rainbow colors. Clean, high-contrast, pure black (`#000000`), white (`#FFFFFF`), and refined grayscale tones (`#F8F9FA`, `#E9ECEF`, `#6C757D`), with light theme as the pristine default.
- **Confirmed Decision 3: Apple Liquid Glass Aesthetic**: Translucent frosted glass containers (`backdrop-blur-2xl bg-white/70 border border-white/60 shadow-[0_8px_32px_0_rgba(0,0,0,0.06)]`), polished specular rim highlights, and smooth tactile glass button surfaces.
- **Confirmed Decision 4: Typography with JetBrains Mono Flashpoints**:
  - Formulas, flashpoint symbols, LaTeX equations, variables, and tabular figures rendered strictly in **JetBrains Mono**.
  - Conceptual statements, titles, and explanations styled in premium editorial typography (`Plus Jakarta Sans` / classic editorial serif accents) with elegant *italics* for conceptual emphasis.
- **Confirmed Decision 5: Accelerated Spaced Repetition Engine**: Adaptive SM-2 / FSRS hybrid intervals (1m, 10m, 1d, 3d, 7d) optimized for rapid physics formula retention.
- **Confirmed Decision 6: 24-Hour Google Drive Excel Sync & Flexible Column Mapper**: Automated daily sync verification with Drive file metadata, manual "Refresh Now", and automatic column detection for any Excel layout.

---

### 1. Overview & Core Concept

- **What It Does**: SynapseFormula enables users to connect Excel workbooks stored on Google Drive as dynamic formula study decks. It automatically reads equations, statements, variables, and derivations, renders them with JetBrains Mono math notation, and guides users through evidence-based active recall drills with automated 24-hour cloud syncing.
- **Target Audience**: Students, researchers, and engineers learning physics and mathematical formulas under tight timelines who demand a distraction-free, ultra-refined study interface.
- **Key Value**: Combines cognitive science (the testing effect, cloze deletion, distributed practice) with a distraction-free Apple liquid-glass environment and seamless Google Drive continuity.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Deck Library & Session Resumption**:
   - Each deck card displays a prominent **"Resume (Card #X)"** action alongside a "Start Fresh" option.
   - Shows deck stats (Total Formulas, Due for Spaced Review, Mastered Count, Last Synced timestamp).
   - "Connect Excel from Google Drive" opens the authenticated Drive file browser to select workbooks.
2. **Multi-Stage Formula Retrieval Drill**:
   - **Stage 1 (Statement & Formula Generation)**: Displays the physical condition or theorem with *italicized highlights*. The user visualizes or writes on the integrated liquid-glass scratchpad, then reveals the formula rendered in crisp **JetBrains Mono**.
   - **Stage 2 (Cloze Deletion Drill)**: Masks critical exponents, denominators, or physical constants with interactive click-to-reveal blanks to test active generation.
   - **Stage 3 (Variable & Dimension Matrix)**: Displays a clean tabular breakdown of all physical quantities, symbols, and SI dimensions.
   - **Assessment**: Minimal monochrome rating buttons (**Again [1m]**, **Hard [10m]**, **Good [1d]**, **Easy [3d]**).
3. **Google Drive Sync & 24-Hour Schedule**:
   - Automatically checks Google Drive file timestamps every 24 hours.
   - Displays a quiet glass sync indicator with an instant "Refresh Now" trigger that re-parses rows without losing your memory scores.

#### Visual Identity & Theme (Apple Liquid Glass Monochrome)
- **Palette**:
  - Background Canvas: Crisp, serene light-mode glass field (`#F8F9FA` to `#EDF2F7` subtle luminance gradient).
  - Glass Surfaces: High-translucency milk glass (`rgba(255, 255, 255, 0.75)` with `backdrop-filter: blur(24px)`).
  - Glass Borders: Specular white rim edges (`rgba(255, 255, 255, 0.85)` top-left highlight with `rgba(0, 0, 0, 0.08)` hairline shadow).
  - Text & Accents: Pitch Black (`#000000`), Charcoal (`#212529`), and Muted Pewter (`#6C757D`). Zero saturated hues.
- **Typography**:
  - Technical / Flashpoints / Equations / Code: **JetBrains Mono** (`tabular-nums font-mono`).
  - Editorial Prose & Statement Headers: **Plus Jakarta Sans** with refined *italics* for highlighted terms.
- **Motion & Polish**:
  - Smooth 3D card flips with inertial easing (`cubic-bezier(0.16, 1, 0.3, 1)`).
  - Tactile liquid-glass button depress states (`active:scale-[0.98]`).

---

### 3. Key Product Decisions & Trade-Offs

- **Decision: Monochromatic Visual Language with Liquid Glass**:
  - *Chosen Approach*: Exclusively pure black, whites, and frosted glass opacities. Feedback states (learning, due, mastered) are communicated through distinct structural styling, typographic weights, and subtle border diffusions rather than colored badges.
  - *Why*: Eliminates cognitive clutter, perfectly aligns with user preference, and evokes a high-end physical lab notebook.
- **Decision: Session Resumption State Engine**:
  - *Chosen Approach*: Maintain a dedicated `sessionState` object per deck in browser storage tracking `currentCardId`, `cardIndex`, `stage`, and `inProgressQueue`.
  - *Why*: Allows users to close the browser mid-session and instantly resume at the exact card and stage they left off.
- **Decision: JetBrains Mono for Mathematical Flashpoints**:
  - *Chosen Approach*: Load JetBrains Mono webfont with complete mathematical operator glyphs and ligature support for crystal-clear formulas and indices.

---

### 4. Technical Architecture & Data Strategy (Technical Reference)

#### Architecture Diagram
```
┌────────────────────────────────────────────────────────────────────────┐
│                        Google Drive API (OAuth)                        │
│          (Fetches user Excel .xlsx/.xls files via Bearer Token)        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 SynapseFormula Client Application                      │
│                                                                        │
│  ┌───────────────────────┐             ┌────────────────────────────┐  │
│  │ Google Auth &         │             │ Excel SheetJS Engine       │  │
│  │ Drive Sync Manager    │────────────▶│ - Auto Column Mapper       │  │
│  │ (24h Check + Cache)   │             │ - Statement/Formula Parser │  │
│  └───────────────────────┘             └─────────────┬──────────────┘  │
│                                                      │                 │
│                                                      ▼                 │
│  ┌───────────────────────┐             ┌────────────────────────────┐  │
│  │ Spaced Repetition Core│◀────────────│ Decks, Flashcards &        │  │
│  │ (Adaptive SM-2/FSRS)  │             │ Session Resumption Store   │  │
│  │ - 1m / 10m / 1d / 3d  │             │ (IndexedDB / LocalStorage) │  │
│  └───────────┬───────────┘             └────────────────────────────┘  │
│              │                                                         │
│              ▼                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │            Liquid Glass Monochrome UI Presentation               │  │
│  │  - Deck Library with "Resume Where Left Off" Controls            │  │
│  │  - Multi-Stage Study View (JetBrains Mono Formulas + Cloze)      │  │
│  │  - Interactive Frosted Glass Scratchpad                          │  │
│  │  - 24-Hour Drive Sync Status & Manual Refresh                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

#### Data Model & Session Resumption
```typescript
interface DeckSessionState {
  lastCardId: string;
  lastCardIndex: number;
  stage: 'statement' | 'cloze' | 'variables';
  queueRemainingIds: string[];
  lastStudiedAt: string; // ISO string
}

interface Deck {
  id: string;
  name: string;
  googleDriveFileId?: string;
  googleDriveModifiedTime?: string;
  lastSyncedAt: string;
  syncIntervalHours: number; // 24
  columnMapping: {
    statementCol: string;
    formulaCol: string;
    variablesCol?: string;
    explanationCol?: string;
  };
  cardsCount: number;
  sessionState?: DeckSessionState; // Auto-resumption
}

interface Flashcard {
  id: string;
  deckId: string;
  statement: string; // Editorial text with *italics*
  formula: string;   // JetBrains Mono math expression
  variables?: { symbol: string; meaning: string; unit?: string }[];
  explanation?: string;
  repetitionStage: 'statement' | 'cloze' | 'variables';
  intervalDays: number;
  easeFactor: number;
  repetitionCount: number;
  dueDate: string;
  lastReviewedAt?: string;
  state: 'new' | 'learning' | 'review' | 'mastered';
}
```

#### Interactive Component & State Mapping
- `LiquidGlassNavbar`: Minimal brand wordmark, quick stats, Google Drive connection button, and monochrome theme toggle.
- `DeckGrid`: Displays all active decks, each featuring a prominent **"Resume"** button with resume progress indicator alongside standard deck management.
- `DriveExcelPickerModal`: Frosted liquid glass modal to search and select `.xlsx` spreadsheets from Google Drive, with a live column detection preview.
- `StudySessionEngine`: Orchestrates the 3-phase formula recall drill, auto-saving progress after every card flip and score rating, with full JetBrains Mono formula formatting and digital scratchpad.
