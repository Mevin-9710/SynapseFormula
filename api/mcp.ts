import type { IncomingMessage, ServerResponse } from 'http';

interface GeneratedDeckPayload {
  id: string;
  deckName: string;
  description: string;
  formulas: Array<{
    statement: string;
    formula: string;
    variables?: Array<{ symbol: string; meaning: string; unit?: string }>;
    explanation?: string;
    category?: string;
  }>;
  createdAt: string;
  source: 'external-mcp';
}

// Global queue across warm serverless invocations on Vercel
const globalStore = globalThis as unknown as {
  __synapsePendingMcpDecks?: GeneratedDeckPayload[];
};
if (!globalStore.__synapsePendingMcpDecks) {
  globalStore.__synapsePendingMcpDecks = [];
}

const TOOL_SCHEMA = {
  name: 'create_formula_deck',
  description:
    'Creates a complete scientific, mathematical, or engineering formula flashcard deck in SynapseFormula (https://synapse-formula.vercel.app) with LaTeX expressions and variable definitions.',
  inputSchema: {
    type: 'object',
    properties: {
      deckName: {
        type: 'string',
        description: 'Title for the formula deck (e.g., "Classical Electrodynamics").',
      },
      description: {
        type: 'string',
        description: 'One-sentence summary of the equations and concepts covered in this deck.',
      },
      formulas: {
        type: 'array',
        description: 'List of formula flashcards in this deck.',
        items: {
          type: 'object',
          properties: {
            statement: {
              type: 'string',
              description:
                'Concept statement or physical law name. Wrap key terms in *asterisks* for italic emphasis.',
            },
            formula: {
              type: 'string',
              description:
                'Pure LaTeX math expression without surrounding $ delimiters (e.g., "\\\\vec{F} = q(\\\\vec{E} + \\\\vec{v} \\\\times \\\\vec{B})").',
            },
            variables: {
              type: 'array',
              description: 'Definitions for every symbol/variable appearing in the formula.',
              items: {
                type: 'object',
                properties: {
                  symbol: {
                    type: 'string',
                    description: 'LaTeX symbol of the variable (e.g., "\\\\vec{E}" or "m_1").',
                  },
                  meaning: {
                    type: 'string',
                    description: 'Clear physical or mathematical meaning of this variable.',
                  },
                  unit: {
                    type: 'string',
                    description: 'SI unit or dimension (e.g., "N", "J/K", "m/s").',
                  },
                },
                required: ['symbol', 'meaning'],
              },
            },
            explanation: {
              type: 'string',
              description: 'Brief intuition, boundary condition, or physical significance.',
            },
            category: {
              type: 'string',
              description: 'Subtopic tag (e.g., "Kinematics", "Thermodynamics").',
            },
          },
          required: ['statement', 'formula', 'variables'],
        },
      },
    },
    required: ['deckName', 'description', 'formulas'],
  },
};

export default async function handler(req: IncomingMessage & { body?: any; query?: any }, res: ServerResponse & { status?: (code: number) => any; json?: (data: any) => any }) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  const sendJson = (statusCode: number, data: any) => {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const pendingQueue = globalStore.__synapsePendingMcpDecks!;

  if (req.method === 'GET') {
    const urlObj = new URL(req.url || '/api/mcp', 'https://synapse-formula.vercel.app');
    if (urlObj.searchParams.get('action') === 'pending') {
      const decks = [...pendingQueue];
      pendingQueue.length = 0;
      return sendJson(200, { decks });
    }

    return sendJson(200, {
      protocolVersion: '2024-11-05',
      endpoint: 'https://synapse-formula.vercel.app/api/mcp',
      serverInfo: {
        name: 'synapseformula-mcp-server',
        version: '1.0.0',
        homepage: 'https://synapse-formula.vercel.app',
      },
      tools: [TOOL_SCHEMA],
      pendingDecksCount: pendingQueue.length,
    });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { jsonrpc, id, method, params } = body;

    if (method === 'initialize') {
      return sendJson(200, {
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
      return sendJson(200, {
        jsonrpc: jsonrpc || '2.0',
        id: id ?? 1,
        result: {
          tools: [TOOL_SCHEMA],
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
          description: String(args.description || 'Created via External MCP'),
          formulas: Array.isArray(args.formulas) ? args.formulas : [],
          createdAt: new Date().toISOString(),
          source: 'external-mcp',
        };
        pendingQueue.push(deckPayload);

        const encoded = Buffer.from(JSON.stringify(deckPayload)).toString('base64url');
        const directUrl = `https://synapse-formula.vercel.app/?mcp_deck=${encoded}`;

        return sendJson(200, {
          jsonrpc: jsonrpc || '2.0',
          id: id ?? 1,
          result: {
            content: [
              {
                type: 'text',
                text: `Queued deck "${deckPayload.deckName}" (${deckPayload.formulas.length} formulas) on https://synapse-formula.vercel.app. Click "Pull MCP Queue" in the app or open: ${directUrl}`,
              },
            ],
            deck: deckPayload,
            importUrl: directUrl,
          },
        });
      }

      return sendJson(400, {
        jsonrpc: jsonrpc || '2.0',
        id: id ?? 1,
        error: { code: -32601, message: `Unknown MCP tool: ${toolName}` },
      });
    }

    return sendJson(400, {
      jsonrpc: jsonrpc || '2.0',
      id: id ?? null,
      error: {
        code: -32600,
        message: 'Unsupported MCP JSON-RPC method. Use initialize, tools/list, or tools/call.',
      },
    });
  }

  return sendJson(405, { error: 'Method not allowed' });
}
