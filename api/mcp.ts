import type { IncomingMessage, ServerResponse } from 'http';

const ALLOWED_CORS_ORIGIN = 'https://synapse-formula.vercel.app';
const MAX_FORMULAS_PER_DECK = 200;
const MAX_BODY_BYTES = 512 * 1024; // 512 KB request body limit

interface SanitizedFormulaItem {
  statement: string;
  formula: string;
  variables?: Array<{ symbol: string; meaning: string; unit?: string }>;
  conditions?: string;
  derivation?: string;
  explanation?: string;
  category?: string;
}

interface GeneratedDeckPayload {
  id: string;
  deckName: string;
  description: string;
  formulas: SanitizedFormulaItem[];
  createdAt: string;
  source: 'external-mcp';
}

const TOOL_SCHEMA = {
  name: 'create_formula_deck',
  description:
    'Creates a complete scientific, mathematical, or engineering formula flashcard deck in SynapseFormula (https://synapse-formula.vercel.app) with LaTeX expressions, variable definitions, validity conditions, and derivations.',
  inputSchema: {
    type: 'object',
    properties: {
      deckName: {
        type: 'string',
        description: 'Title for the formula deck (max 200 chars, e.g., "Classical Electrodynamics").',
      },
      description: {
        type: 'string',
        description: 'One-sentence summary of the equations and concepts covered in this deck.',
      },
      formulas: {
        type: 'array',
        description: 'List of formula flashcards in this deck (max 200 formulas).',
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
            conditions: {
              type: 'string',
              description: 'Optional validity conditions (e.g., "constant acceleration only").',
            },
            derivation: {
              type: 'string',
              description: 'Optional concise derivation steps shown after reveal.',
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

function boundString(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val.trim() : String(val ?? fallback).trim();
  return s.slice(0, maxLen);
}

async function readParsedBody(req: IncomingMessage & { body?: any }): Promise<any> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      if (req.body.length > MAX_BODY_BYTES) {
        throw new Error('Payload too large');
      }
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    if (Buffer.isBuffer(req.body)) {
      if (req.body.byteLength > MAX_BODY_BYTES) {
        throw new Error('Payload too large');
      }
      try {
        return JSON.parse(req.body.toString('utf8'));
      } catch {
        return {};
      }
    }
    return req.body;
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', chunk => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(buf);
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

function handleSingleRpcMessage(msg: any): any | null {
  const { jsonrpc, id, method, params } = msg || {};

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
          version: '1.1.0',
        },
        instructions:
          'Use create_formula_deck to build scientific, math, or physics formula flashcard decks in SynapseFormula with LaTeX expressions and variable meanings. Share the returned importUrl with the user so they can confirm and import the deck.',
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
      const rawFormulas = Array.isArray(args.formulas) ? args.formulas : [];
      if (rawFormulas.length === 0) {
        return {
          jsonrpc: jsonrpc || '2.0',
          id,
          error: {
            code: -32602,
            message: 'formulas array must contain at least 1 formula.',
          },
        };
      }
      if (rawFormulas.length > MAX_FORMULAS_PER_DECK) {
        return {
          jsonrpc: jsonrpc || '2.0',
          id,
          error: {
            code: -32602,
            message: `Deck exceeds maximum limit of ${MAX_FORMULAS_PER_DECK} formulas.`,
          },
        };
      }

      const sanitizedFormulas: SanitizedFormulaItem[] = rawFormulas
        .filter((f: any) => f && f.statement && f.formula)
        .slice(0, MAX_FORMULAS_PER_DECK)
        .map((f: any) => ({
          statement: boundString(f.statement, 1000, 'Formula'),
          formula: boundString(f.formula, 1000, 'x'),
          variables: Array.isArray(f.variables)
            ? f.variables
                .filter((v: any) => v && v.symbol && v.meaning)
                .slice(0, 20)
                .map((v: any) => ({
                  symbol: boundString(v.symbol, 120),
                  meaning: boundString(v.meaning, 300),
                  unit: v.unit ? boundString(v.unit, 80) : undefined,
                }))
            : undefined,
          conditions: f.conditions ? boundString(f.conditions, 500) : undefined,
          derivation: f.derivation ? boundString(f.derivation, 1000) : undefined,
          explanation: f.explanation ? boundString(f.explanation, 1000) : undefined,
          category: f.category ? boundString(f.category, 120) : undefined,
        }));

      const deckPayload: GeneratedDeckPayload = {
        id: `mcp_deck_${Date.now()}`,
        deckName: boundString(args.deckName, 200, 'MCP Generated Deck'),
        description: boundString(args.description, 600, 'Created via External MCP'),
        formulas: sanitizedFormulas,
        createdAt: new Date().toISOString(),
        source: 'external-mcp',
      };

      const encoded = Buffer.from(JSON.stringify(deckPayload)).toString('base64url');
      const directUrl = `${ALLOWED_CORS_ORIGIN}/?mcp_deck=${encoded}`;

      return {
        jsonrpc: jsonrpc || '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Created formula deck "${deckPayload.deckName}" (${deckPayload.formulas.length} formulas).\n\nImport Link: ${directUrl}`,
            },
          ],
          isError: false,
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
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
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

  if (req.method === 'GET') {
    const urlObj = new URL(req.url || '/api/mcp', ALLOWED_CORS_ORIGIN);
    if (urlObj.searchParams.get('action') === 'manifest') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(
        JSON.stringify({
          protocolVersion: '2025-03-26',
          endpoint: `${ALLOWED_CORS_ORIGIN}/api/mcp`,
          tools: [TOOL_SCHEMA],
        })
      );
    }

    res.statusCode = 405;
    res.setHeader('Allow', 'POST, OPTIONS, DELETE');
    return res.end();
  }

  if (req.method === 'POST') {
    let body: any;
    try {
      body = await readParsedBody(req);
    } catch {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32600, message: 'Payload exceeds maximum size limit.' },
        })
      );
    }

    const sessionId =
      (req.headers['mcp-session-id'] as string) || 'synapseformula-mcp-session-v1';
    res.setHeader('Mcp-Session-Id', sessionId);

    const isBatch = Array.isArray(body);
    const messages: any[] = isBatch ? body : [body];
    const responses = messages.map((msg: any) => handleSingleRpcMessage(msg)).filter(Boolean);

    if (responses.length === 0) {
      res.statusCode = 202;
      return res.end();
    }

    const responsePayload = isBatch ? responses : responses[0];
    const acceptHeader = String(req.headers.accept || '');

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
