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

async function readParsedBody(req: IncomingMessage & { body?: any }): Promise<any> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    if (Buffer.isBuffer(req.body)) {
      try {
        return JSON.parse(req.body.toString('utf8'));
      } catch {
        return {};
      }
    }
    return req.body;
  }

  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function handleSingleRpcMessage(msg: any, pendingQueue: GeneratedDeckPayload[]): any | null {
  const { jsonrpc, id, method, params } = msg || {};

  // Notifications (such as notifications/initialized or notifications/cancelled) have no id
  if (
    id === undefined ||
    method === 'notifications/initialized' ||
    method === 'initialized' ||
    (typeof method === 'string' && method.startsWith('notifications/'))
  ) {
    return null;
  }

  if (method === 'initialize') {
    const requestedVersion =
      typeof params?.protocolVersion === 'string' && params.protocolVersion.trim()
        ? params.protocolVersion.trim()
        : '2025-03-26';

    return {
      jsonrpc: jsonrpc || '2.0',
      id,
      result: {
        protocolVersion: requestedVersion,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'synapseformula-mcp-server',
          version: '1.0.0',
        },
        instructions:
          'Use create_formula_deck to build scientific, math, or physics formula flashcard decks in SynapseFormula with LaTeX expressions and variable meanings. Always share the returned importUrl with the user so they can open or sync the deck.',
      },
    };
  }

  if (method === 'ping') {
    return {
      jsonrpc: jsonrpc || '2.0',
      id,
      result: {},
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: jsonrpc || '2.0',
      id,
      result: {
        tools: [TOOL_SCHEMA],
      },
    };
  }

  if (method === 'prompts/list') {
    return {
      jsonrpc: jsonrpc || '2.0',
      id,
      result: {
        prompts: [],
      },
    };
  }

  if (method === 'resources/list') {
    return {
      jsonrpc: jsonrpc || '2.0',
      id,
      result: {
        resources: [],
      },
    };
  }

  if (method === 'resources/templates/list') {
    return {
      jsonrpc: jsonrpc || '2.0',
      id,
      result: {
        resourceTemplates: [],
      },
    };
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

      return {
        jsonrpc: jsonrpc || '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Created formula deck "${deckPayload.deckName}" (${deckPayload.formulas.length} formulas).\n\n1-Click Import Link: ${directUrl}\n(Or click "Pull MCP Queue" inside https://synapse-formula.vercel.app)`,
            },
          ],
          isError: false,
          deck: deckPayload,
          importUrl: directUrl,
        },
      };
    }

    return {
      jsonrpc: jsonrpc || '2.0',
      id,
      error: { code: -32601, message: `Unknown MCP tool: ${toolName}` },
    };
  }

  return {
    jsonrpc: jsonrpc || '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}

export default async function handler(
  req: IncomingMessage & { body?: any; query?: any },
  res: ServerResponse
) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, PUT, DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Accept, Content-Type, Content-Length, Accept-Encoding, Authorization, User-Agent, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Accept, Content-Type, Content-Length, Accept-Encoding, MCP-Protocol-Version, Mcp-Session-Id'
  );
  res.setHeader('Cache-Control', 'no-cache, no-transform');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'DELETE') {
    res.statusCode = 200;
    return res.end();
  }

  const pendingQueue = globalStore.__synapsePendingMcpDecks!;

  if (req.method === 'GET') {
    const urlObj = new URL(req.url || '/api/mcp', 'https://synapse-formula.vercel.app');
    if (urlObj.searchParams.get('action') === 'pending') {
      const decks = [...pendingQueue];
      pendingQueue.length = 0;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ decks }));
    }

    if (urlObj.searchParams.get('action') === 'manifest') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(
        JSON.stringify({
          protocolVersion: '2025-03-26',
          endpoint: 'https://synapse-formula.vercel.app/api/mcp',
          tools: [TOOL_SCHEMA],
          pendingDecksCount: pendingQueue.length,
        })
      );
    }

    // Per MCP Streamable HTTP specification (2025-03-26 / 2025-06-18):
    // When a client probes GET for a standalone SSE stream and the server uses stateless HTTP POST,
    // the server MUST return 405 Method Not Allowed.
    res.statusCode = 405;
    res.setHeader('Allow', 'POST, OPTIONS, DELETE');
    return res.end();
  }

  if (req.method === 'POST') {
    const body = await readParsedBody(req);
    const sessionId =
      (req.headers['mcp-session-id'] as string) || 'synapseformula-mcp-session-v1';
    res.setHeader('Mcp-Session-Id', sessionId);

    // Handle batch or single JSON-RPC payload
    const isBatch = Array.isArray(body);
    const messages = isBatch ? body : [body];
    const responses = messages
      .map(msg => handleSingleRpcMessage(msg, pendingQueue))
      .filter(Boolean);

    // If all messages were notifications (e.g. notifications/initialized), return 202 Accepted with empty body
    if (responses.length === 0) {
      res.statusCode = 202;
      return res.end();
    }

    const responsePayload = isBatch ? responses : responses[0];
    const acceptHeader = String(req.headers.accept || '');

    // If client explicitly requests SSE stream format without application/json, or prefers event-stream
    if (
      acceptHeader.includes('text/event-stream') &&
      !acceptHeader.includes('application/json')
    ) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      return res.end(`event: message\ndata: ${JSON.stringify(responsePayload)}\n\n`);
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify(responsePayload));
  }

  res.statusCode = 405;
  return res.end();
}
