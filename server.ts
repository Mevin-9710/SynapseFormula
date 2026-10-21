import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import mcpHandler from './api/mcp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Route MCP endpoints through the unified MCP Streamable HTTP handler
  app.all('/api/mcp', (req, res) => mcpHandler(req, res));
  app.all('/mcp', (req, res) => mcpHandler(req, res));
  app.get('/api/mcp/pending-decks', (req, res) => {
    req.url = '/api/mcp?action=pending';
    return mcpHandler(req, res);
  });
  app.get('/api/mcp/manifest', (req, res) => {
    req.url = '/api/mcp?action=manifest';
    return mcpHandler(req, res);
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
