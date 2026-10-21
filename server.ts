import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { FunctionDeclaration, GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getGenAIClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface GeneratedFormulaItem {
  statement: string;
  formula: string;
  variables?: Array<{
    symbol: string;
    meaning: string;
    unit?: string;
  }>;
  explanation?: string;
  category?: string;
}

export interface GeneratedDeckPayload {
  id: string;
  deckName: string;
  description: string;
  formulas: GeneratedFormulaItem[];
  createdAt: string;
  source: 'gemini-mcp' | 'external-mcp';
}

// Queue for decks pushed by external MCP clients via POST /api/mcp
const pendingMcpDecks: GeneratedDeckPayload[] = [];

const createFormulaDeckToolDeclaration: FunctionDeclaration = {
  name: 'create_formula_deck',
  description:
    'Creates a complete scientific, mathematical, or engineering formula flashcard deck in SynapseFormula with LaTeX expressions and variable definitions.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      deckName: {
        type: Type.STRING,
        description: 'Concise, clear title for the formula deck (e.g., "Classical Electrodynamics").',
      },
      description: {
        type: Type.STRING,
        description: 'One-sentence summary of the equations and concepts covered in this deck.',
      },
      formulas: {
        type: Type.ARRAY,
        description: 'List of formula flashcards in this deck.',
        items: {
          type: Type.OBJECT,
          properties: {
            statement: {
              type: Type.STRING,
              description:
                'Concept statement or physical law name. Wrap key terms in *asterisks* for italic emphasis.',
            },
            formula: {
              type: Type.STRING,
              description:
                'Pure LaTeX math expression without surrounding $ delimiters (e.g., "\\\\vec{F} = q(\\\\vec{E} + \\\\vec{v} \\\\times \\\\vec{B})").',
            },
            variables: {
              type: Type.ARRAY,
              description: 'Definitions for every symbol/variable appearing in the formula.',
              items: {
                type: Type.OBJECT,
                properties: {
                  symbol: {
                    type: Type.STRING,
                    description: 'LaTeX symbol of the variable (e.g., "\\\\vec{E}" or "m_1").',
                  },
                  meaning: {
                    type: Type.STRING,
                    description: 'Clear physical or mathematical meaning of this variable.',
                  },
                  unit: {
                    type: Type.STRING,
                    description: 'SI unit or dimension (e.g., "N", "J/K", "m/s", "dimensionless").',
                  },
                },
                required: ['symbol', 'meaning'],
              },
            },
            explanation: {
              type: Type.STRING,
              description: 'Brief intuition, boundary condition, or physical significance.',
            },
            category: {
              type: Type.STRING,
              description: 'Subtopic tag (e.g., "Kinematics", "Thermodynamics", "Linear Algebra").',
            },
          },
          required: ['statement', 'formula', 'variables'],
        },
      },
    },
    required: ['deckName', 'description', 'formulas'],
  },
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // 1. MCP Server Discovery & Tool Manifest
  app.get('/api/mcp/manifest', (_req, res) => {
    res.json({
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'synapseformula-mcp-server',
        version: '1.0.0',
        description: 'Model Context Protocol (MCP) server for creating formula decks in SynapseFormula.',
      },
      tools: [
        {
          name: createFormulaDeckToolDeclaration.name,
          description: createFormulaDeckToolDeclaration.description,
          inputSchema: createFormulaDeckToolDeclaration.parameters,
        },
      ],
      pendingDecksCount: pendingMcpDecks.length,
    });
  });

  // 2. JSON-RPC 2.0 MCP Endpoint for external AI clients (Claude Desktop, Cursor, Gemini CLI, etc.)
  app.post('/api/mcp', (req, res) => {
    const { jsonrpc, id, method, params } = req.body || {};

    if (method === 'initialize') {
      return res.json({
        jsonrpc: jsonrpc || '2.0',
        id: id ?? 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'synapseformula-mcp-server',
            version: '1.0.0',
          },
        },
      });
    }

    if (method === 'tools/list') {
      return res.json({
        jsonrpc: jsonrpc || '2.0',
        id: id ?? 1,
        result: {
          tools: [
            {
              name: createFormulaDeckToolDeclaration.name,
              description: createFormulaDeckToolDeclaration.description,
              inputSchema: createFormulaDeckToolDeclaration.parameters,
            },
          ],
        },
      });
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};

      if (toolName === 'create_formula_deck') {
        const deckPayload: GeneratedDeckPayload = {
          id: `mcp_deck_${Date.now()}`,
          deckName: String(args.deckName || 'MCP Generated Deck'),
          description: String(args.description || 'Created via MCP tool call'),
          formulas: Array.isArray(args.formulas) ? args.formulas : [],
          createdAt: new Date().toISOString(),
          source: 'external-mcp',
        };
        pendingMcpDecks.push(deckPayload);

        return res.json({
          jsonrpc: jsonrpc || '2.0',
          id: id ?? 1,
          result: {
            content: [
              {
                type: 'text',
                text: `Successfully queued deck "${deckPayload.deckName}" with ${deckPayload.formulas.length} formulas in SynapseFormula.`,
              },
            ],
            deck: deckPayload,
          },
        });
      }

      return res.status(400).json({
        jsonrpc: jsonrpc || '2.0',
        id: id ?? 1,
        error: { code: -32601, message: `Unknown MCP tool: ${toolName}` },
      });
    }

    return res.status(400).json({
      jsonrpc: jsonrpc || '2.0',
      id: id ?? null,
      error: { code: -32600, message: 'Unsupported MCP JSON-RPC method. Use initialize, tools/list, or tools/call.' },
    });
  });

  // 3. Pull any decks pushed by external MCP clients
  app.get('/api/mcp/pending-decks', (_req, res) => {
    const decks = [...pendingMcpDecks];
    pendingMcpDecks.length = 0;
    res.json({ decks });
  });

  // 4. Direct Gemini AI + MCP Tool Invocation to generate a deck from natural language prompt
  app.post('/api/mcp/gemini-deck', async (req, res) => {
    try {
      const { prompt, cardCount = 8 } = req.body || {};
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'Please provide a topic or prompt for the formula deck.' });
      }

      const clampedCount = Math.min(20, Math.max(3, Number(cardCount) || 8));
      const ai = getGenAIClient();

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Create a high-yield formula flashcard deck of ${clampedCount} formulas for the following topic or request: "${prompt.trim()}".
Call the MCP tool "create_formula_deck" with accurate LaTeX formulas (without surrounding $ signs), clear physical/mathematical statements with key terms wrapped in *asterisks*, complete variable definitions (symbol, meaning, SI unit) for every variable in each formula, and a concise explanation.`,
        config: {
          tools: [{ functionDeclarations: [createFormulaDeckToolDeclaration] }],
        },
      });

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const call = functionCalls.find(fc => fc.name === 'create_formula_deck') || functionCalls[0];
        const args = (call.args || {}) as Record<string, any>;

        const deckPayload: GeneratedDeckPayload = {
          id: `mcp_gemini_${Date.now()}`,
          deckName: String(args.deckName || prompt.trim().slice(0, 48)),
          description: String(
            args.description || `Generated by Gemini via MCP (${clampedCount} formulas)`
          ),
          formulas: Array.isArray(args.formulas) ? args.formulas : [],
          createdAt: new Date().toISOString(),
          source: 'gemini-mcp',
        };

        if (deckPayload.formulas.length > 0) {
          return res.json({
            toolCall: 'create_formula_deck',
            deck: deckPayload,
          });
        }
      }

      // Fallback structured JSON generation if model responded with text instead of functionCall
      const structuredResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Generate a formula flashcard deck with ${clampedCount} formulas for: "${prompt.trim()}". Include accurate LaTeX formulas (no $ signs) and variable definitions (symbol, meaning, unit) for every variable.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: createFormulaDeckToolDeclaration.parameters,
        },
      });

      const parsed = JSON.parse((structuredResponse.text || '{}').trim());
      const fallbackDeck: GeneratedDeckPayload = {
        id: `mcp_gemini_${Date.now()}`,
        deckName: String(parsed.deckName || prompt.trim().slice(0, 48)),
        description: String(parsed.description || 'Generated by Gemini via MCP'),
        formulas: Array.isArray(parsed.formulas) ? parsed.formulas : [],
        createdAt: new Date().toISOString(),
        source: 'gemini-mcp',
      };

      return res.json({
        toolCall: 'create_formula_deck',
        deck: fallbackDeck,
      });
    } catch (err: any) {
      console.error('Gemini MCP deck generation error:', err);
      return res.status(500).json({
        error: err?.message || 'Failed to generate deck via Gemini MCP.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SynapseFormula server & MCP endpoint running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
