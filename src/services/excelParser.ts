import * as XLSX from 'xlsx';
import { ColumnMapping, Flashcard, VariableDefinition } from '../types';

export interface ParsedWorkbookSummary {
  sheetNames: string[];
  activeSheet: string;
  headers: string[];
  detectedMapping: ColumnMapping;
  sampleRows: Record<string, any>[];
  totalRows: number;
}

export const parseWorkbookSummary = (buffer: ArrayBuffer, chosenSheet?: string): ParsedWorkbookSummary => {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error('The Excel workbook contains no readable sheets.');
  }

  const activeSheet = chosenSheet && sheetNames.includes(chosenSheet) ? chosenSheet : sheetNames[0];
  const worksheet = workbook.Sheets[activeSheet];
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  if (rawRows.length === 0) {
    throw new Error(`The sheet "${activeSheet}" is empty or has no data rows.`);
  }

  const headers = Object.keys(rawRows[0] || {});
  const detectedMapping = autoDetectColumns(headers);

  return {
    sheetNames,
    activeSheet,
    headers,
    detectedMapping,
    sampleRows: rawRows.slice(0, 5),
    totalRows: rawRows.length,
  };
};

export const autoDetectColumns = (headers: string[]): ColumnMapping => {
  const findMatch = (candidates: string[]): string => {
    for (const cand of candidates) {
      const match = headers.find(h => {
        const clean = h.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
        return clean.includes(cand) || cand.includes(clean);
      });
      if (match) return match;
    }
    return '';
  };

  const statementCol = findMatch([
    'statement', 'concept', 'question', 'law', 'principle', 'theorem', 
    'topic', 'name', 'title', 'condition', 'prompt', 'front'
  ]) || (headers[0] || '');

  const formulaCol = findMatch([
    'formula', 'equation', 'math', 'latex', 'expression', 'back', 'relation'
  ]) || (headers[1] || headers[0] || '');

  const variablesCol = findMatch([
    'variables', 'variable', 'symbols', 'parameters', 'legend', 'notation', 'terms'
  ]);

  const explanationCol = findMatch([
    'explanation', 'derivation', 'notes', 'note', 'details', 'description', 'meaning'
  ]);

  const categoryCol = findMatch([
    'category', 'branch', 'subfield', 'unit', 'chapter', 'field', 'topic'
  ]);

  return {
    statementCol,
    formulaCol,
    variablesCol,
    explanationCol,
    categoryCol,
  };
};

export const parseVariablesString = (raw: string | undefined): VariableDefinition[] => {
  if (!raw || typeof raw !== 'string') return [];
  const entries = raw.split(/[\n;•|]+/).map(s => s.trim()).filter(Boolean);
  
  const definitions: VariableDefinition[] = [];
  for (const entry of entries) {
    // Matches "Symbol : Meaning [Unit]" or "Symbol = Meaning (Unit)"
    // Supports LaTeX symbols like "\Delta x", "\vec{F}", "m_1, m_2", "\hbar", etc.
    const match = entry.match(/^([^:=–—\n]+?)\s*(?:=|:|–|—)\s*(.*?)(?:\[(.*?)\]|\((.*?)\)|$)/);
    if (match) {
      const symbol = match[1].trim();
      const meaning = match[2].trim();
      const unit = (match[3] || match[4] || '').trim();
      definitions.push({ symbol, meaning, unit: unit || undefined });
    } else {
      // Fallback: simple colon/dash/equals split
      const parts = entry.split(/[:=–—]/);
      if (parts.length >= 2) {
        definitions.push({
          symbol: parts[0].trim(),
          meaning: parts.slice(1).join(' ').trim(),
        });
      } else {
        definitions.push({
          symbol: '—',
          meaning: entry,
        });
      }
    }
  }

  return definitions;
};

export const convertRowsToFlashcards = (
  buffer: ArrayBuffer,
  sheetName: string,
  mapping: ColumnMapping,
  deckId: string
): Flashcard[] => {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const targetSheet = sheetName && workbook.Sheets[sheetName] ? sheetName : workbook.SheetNames[0];
  const worksheet = workbook.Sheets[targetSheet];
  if (!worksheet) {
    throw new Error('Could not find any readable sheet in this file.');
  }
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  const nowIso = new Date().toISOString();

  return rawRows
    .filter(row => {
      const statement = String(row[mapping.statementCol] || '').trim();
      const formula = String(row[mapping.formulaCol] || '').trim();
      return statement || formula;
    })
    .map((row, index) => {
      const statement = String(row[mapping.statementCol] || `Formula #${index + 1}`).trim();
      const formula = String(row[mapping.formulaCol] || '').trim();
      const rawVars = mapping.variablesCol ? String(row[mapping.variablesCol] || '') : '';
      const explanation = mapping.explanationCol ? String(row[mapping.explanationCol] || '') : '';
      const category = mapping.categoryCol ? String(row[mapping.categoryCol] || 'Physics') : 'Physics';

      // Hash-based or row-based ID
      const cardId = `card_${deckId}_${index + 1}_${Math.abs(hashString(statement + formula))}`;

      return {
        id: cardId,
        deckId,
        statement,
        formula,
        variables: parseVariablesString(rawVars),
        explanation: explanation || undefined,
        category: category || undefined,
        repetitionStage: 'statement',
        intervalDays: 0,
        easeFactor: 2.5,
        repetitionCount: 0,
        dueDate: nowIso,
        state: 'new',
      };
    });
};

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

const SAMPLE_FORMULA_ROWS = [
  {
    Statement: "Newton's Second Law of Motion",
    Formula: "\\vec{F} = m \\vec{a}",
    Variables: "F : Net force [N]; m : Mass [kg]; a : Acceleration [m/s^2]",
    Explanation: "Fundamental relation between net external force and linear acceleration.",
    Category: "Mechanics"
  },
  {
    Statement: "Total Lorentz Force on a charged particle",
    Formula: "\\vec{F} = q(\\vec{E} + \\vec{v} \\times \\vec{B})",
    Variables: "\\vec{F} : Total Lorentz force [N]; q : Electric charge [C]; \\vec{E} : Electric field [V/m]; \\vec{v} : Velocity [m/s]; \\vec{B} : Magnetic field [T]",
    Explanation: "Combines electrostatic and magnetic components. Magnetic force is perpendicular to velocity and does zero work.",
    Category: "Electromagnetism"
  },
  {
    Statement: "Newton's Universal Law of Gravitation",
    Formula: "F_g = G \\frac{m_1 m_2}{r^2}",
    Variables: "F_g : Attractive gravitational force [N]; G : Gravitational constant [N*m^2/kg^2]; m_1, m_2 : Point masses [kg]; r : Distance [m]",
    Explanation: "Inverse-square attractive force between any two point masses.",
    Category: "Gravitation"
  },
  {
    Statement: "Kinetic Energy in terms of linear momentum",
    Formula: "E_k = \\frac{p^2}{2m}",
    Variables: "E_k : Kinetic energy [J]; p : Linear momentum [kg*m/s]; m : Mass [kg]",
    Explanation: "Direct relation between mechanical energy and linear momentum.",
    Category: "Mechanics"
  },
  {
    Statement: "Heisenberg Uncertainty Principle",
    Formula: "\\Delta x \\cdot \\Delta p \\ge \\frac{\\hbar}{2}",
    Variables: "\\Delta x : Position uncertainty [m]; \\Delta p : Momentum uncertainty [kg*m/s]; \\hbar : Reduced Planck constant [J*s]",
    Explanation: "Quantum mechanical limit arising from non-commuting operators.",
    Category: "Quantum Physics"
  },
  {
    Statement: "Ideal Gas Law (Plain text formula example)",
    Formula: "P * V = n * R * T",
    Variables: "P : Absolute pressure [Pa]; V : Volume [m^3]; n : Amount of substance [mol]; R : Universal gas constant [J/(mol*K)]; T : Temperature [K]",
    Explanation: "Equation of state of a hypothetical ideal gas. Works with plain-text operators without LaTeX too!",
    Category: "Thermodynamics"
  }
];

export const downloadSampleExcelTemplate = () => {
  const ws = XLSX.utils.json_to_sheet(SAMPLE_FORMULA_ROWS);
  ws['!cols'] = [
    { wch: 38 },
    { wch: 32 },
    { wch: 55 },
    { wch: 45 },
    { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "PhysicsFormulas");
  XLSX.writeFile(wb, "Physics_Formula_Template.xlsx");
};

export const downloadSampleCsvTemplate = () => {
  const ws = XLSX.utils.json_to_sheet(SAMPLE_FORMULA_ROWS);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Physics_Formula_Template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
