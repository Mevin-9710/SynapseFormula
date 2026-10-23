import 'dotenv/config';
import express from 'express';
import fs from 'fs';
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
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'custom',
    });

    // Provide a lightweight @vite/client that injects styles without opening WebSockets
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript');
      res.send(
        '// HMR disabled in sandboxed Cloud Run environment - CSS injector enabled\n' +
        'const sheetsMap = new Map();\n' +
        'export function updateStyle(id, content) {\n' +
        '  let style = sheetsMap.get(id);\n' +
        '  if (!style) {\n' +
        '    style = document.createElement("style");\n' +
        '    style.setAttribute("type", "text/css");\n' +
        '    style.setAttribute("data-vite-dev-id", id);\n' +
        '    document.head.appendChild(style);\n' +
        '    sheetsMap.set(id, style);\n' +
        '  }\n' +
        '  style.textContent = content;\n' +
        '}\n' +
        'export function removeStyle(id) {\n' +
        '  const style = sheetsMap.get(id);\n' +
        '  if (style) {\n' +
        '    document.head.removeChild(style);\n' +
        '    sheetsMap.delete(id);\n' +
        '  }\n' +
        '}\n' +
        'export function createHotContext() {\n' +
        '  return { accept() {}, dispose() {}, prune() {}, data: {}, on() {}, off() {}, send() {} };\n' +
        '}\n' +
        'export const injectQuery = (url) => url;\n'
      );
    });

    // Serve transformed index.html with our WebSocket-free @vite/client
    app.use(async (req, res, next) => {
      const url = req.originalUrl || req.url;
      const isHtmlReq =
        req.method === 'GET' &&
        !url.startsWith('/api') &&
        !url.startsWith('/@') &&
        !url.startsWith('/src') &&
        !url.startsWith('/node_modules') &&
        (req.headers.accept?.includes('text/html') || url === '/' || url.endsWith('.html') || !path.extname(url));

      if (!isHtmlReq) {
        return next();
      }

      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        let html = fs.readFileSync(indexPath, 'utf-8');
        html = await vite.transformIndexHtml(url, html);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
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
