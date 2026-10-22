import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

interface AssistantChatPayload {
  deckTitle?: string;
  cardStatement?: string;
  cardFormula?: string;
  cardConditions?: string;
  cardDerivation?: string;
  cardExplanation?: string;
  cardVariables?: Array<{ symbol: string; meaning: string; unit?: string }>;
  deckFormulasSummary?: string[];
  circledTarget?: string;
  question?: string;
  chatHistory?: Array<{ role: 'user' | 'model'; text: string }>;
}

let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

/**
 * Intelligent local physics/math fallback when offline or no API key is set.
 * Uses exact deck variables, formula, conditions, and derivation.
 */
function generateLocalExplanation(payload: AssistantChatPayload): string {
  const {
    deckTitle = 'Physics / Math Deck',
    cardStatement = 'Formula Card',
    cardFormula = '',
    cardConditions = '',
    cardDerivation = '',
    cardExplanation = '',
    cardVariables = [],
    circledTarget = '',
    question = '',
  } = payload;

  const target = (circledTarget || '').trim();
  const q = (question || '').toLowerCase().trim();

  // 1. Look for matching variable in cardVariables
  const matchedVar = cardVariables.find(v => {
    if (!target) return false;
    const cleanSym = v.symbol.replace(/[{}\\]/g, '').toLowerCase();
    const cleanTgt = target.replace(/[{}\\]/g, '').toLowerCase();
    return cleanSym === cleanTgt || cleanTgt.includes(cleanSym) || cleanSym.includes(cleanTgt);
  });

  const parts: string[] = [];

  if (target) {
    parts.push(`### Analysis for circled part: \`${target}\`\n`);
    if (matchedVar) {
      parts.push(`- **Physical Meaning**: ${matchedVar.meaning}`);
      if (matchedVar.unit) parts.push(`- **Standard Units**: \`${matchedVar.unit}\``);
    }
  } else {
    parts.push(`### Assistance for: ${cardStatement}\n`);
  }

  if (cardFormula) {
    parts.push(`\n**Governing Formula**: $${cardFormula}$`);
  }

  if (q.includes('derive') || q.includes('how') || q.includes('where') || q.includes('origin')) {
    if (cardDerivation) {
      parts.push(`\n**Derivation / Origin**:\n${cardDerivation}`);
    } else {
      parts.push(`\n**Origin**: Derived from foundational conservation laws and geometric boundary conditions in ${deckTitle}.`);
    }
  } else if (q.includes('condition') || q.includes('when') || q.includes('valid') || q.includes('regime')) {
    if (cardConditions) {
      parts.push(`\n**Validity Conditions / Regime**:\n${cardConditions}`);
    } else {
      parts.push('\n**Validity**: Holds in standard classical/idealized inertial reference frames unless extreme relativistic or quantum regimes apply.');
    }
  } else {
    if (cardExplanation) {
      parts.push(`\n**Physical Intuition**:\n${cardExplanation}`);
    }
    if (cardConditions && !parts.some(p => p.includes('Validity Conditions'))) {
      parts.push(`\n**Conditions to remember**: ${cardConditions}`);
    }
    if (cardVariables.length > 0 && !matchedVar) {
      parts.push('\n**Constituent Variables**:');
      for (const v of cardVariables) {
        parts.push(`- $${v.symbol}$: ${v.meaning}${v.unit ? ` [${v.unit}]` : ''}`);
      }
    }
  }

  parts.push('\n*Tip: You can circle another term or ask specific questions like "Why is this squared?" or "What are the units?"*');
  return parts.join('\n');
}

export async function handleAssistantChat(req: Request, res: Response): Promise<void> {
  const payload = req.body as AssistantChatPayload;
  const {
    deckTitle = 'Formula Deck',
    cardStatement = '',
    cardFormula = '',
    cardConditions = '',
    cardDerivation = '',
    cardExplanation = '',
    cardVariables = [],
    deckFormulasSummary = [],
    circledTarget = '',
    question = 'Please explain this part of the formula.',
    chatHistory = [],
  } = payload;

  const ai = getAiClient();

  if (!ai) {
    // If Gemini API key is not present or user requested no paid tools, use local deck knowledge engine
    const answer = generateLocalExplanation(payload);
    res.json({ answer, source: 'deck-context-engine' });
    return;
  }

  const variablesText = (cardVariables || [])
    .map(v => `- ${v.symbol}: ${v.meaning} (units: ${v.unit || 'dimensionless'})`)
    .join('\n');

  const otherDeckFormulas = (deckFormulasSummary || [])
    .slice(0, 10)
    .map(f => `- ${f}`)
    .join('\n');

  const systemInstruction = `You are a world-class STEM and Physics tutor built into the SynapseFormula flashcard study app.
You are helping a student who has a doubt while reviewing a formula card.

CURRENT DECK CONTEXT:
Deck: "${deckTitle}"

CURRENT FORMULA CARD DETAILS:
- Statement: ${cardStatement}
- Formula (LaTeX): $${cardFormula}$
- Validity Conditions / Regime: ${cardConditions || 'None specified'}
- Physical Derivation: ${cardDerivation || 'Standard textbook derivation'}
- Conceptual Explanation: ${cardExplanation || 'None specified'}
- Variable Definitions:
${variablesText || 'None specified'}

OTHER FORMULAS IN THIS DECK (for curricular context):
${otherDeckFormulas || 'None specified'}

TUTOR INSTRUCTIONS:
1. If the student circled a specific symbol or term (indicated in CIRCLED TARGET), focus specifically on that part of the formula (what it represents, why it appears with that power/sign, physical significance, and units).
2. Format mathematical symbols using KaTeX inline math ($...$) or block math ($$...$$).
3. Keep your explanation crystal-clear, pedagogically sound, encouraging, and concise (under 250 words unless derivation steps are explicitly asked).
4. Do not talk about API keys or backend details. Directly teach and clarify the student's doubt.`;

  const userPrompt = `CIRCLED TARGET BY STUDENT: "${circledTarget || 'Whole formula'}"
STUDENT QUESTION: "${question}"

Please explain and answer my doubt based on this formula and deck.`;

  try {
    // Construct multi-turn contents if chat history exists
    const contents: any[] = [];
    if (chatHistory && chatHistory.length > 0) {
      for (const msg of chatHistory.slice(-6)) {
        contents.push({
          role: msg.role === 'model' ? 'model' : 'user',
          parts: [{ text: msg.text }],
        });
      }
    }
    contents.push({
      role: 'user',
      parts: [{ text: userPrompt }],
    });

    // gemini-3.8-flash: Standard free model
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction,
      },
    });

    const answer = response.text || generateLocalExplanation(payload);
    res.json({ answer, source: 'gemini-3.8-flash' });
  } catch (err: any) {
    console.error('Gemini assistant error, falling back to deck context engine:', err?.message);
    const answer = generateLocalExplanation(payload);
    res.json({ answer, source: 'deck-context-engine' });
  }
}
export default handleAssistantChat;
