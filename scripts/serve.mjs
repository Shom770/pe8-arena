// Tiny static server for trying the app locally: http://localhost:5173
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const pub = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.cmi': 'application/octet-stream', '.cma': 'application/octet-stream', '.txt': 'text/plain' };
const port = Number(process.env.PORT) || 5173;

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(pub, path.normalize(p));
  if (!file.startsWith(pub)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) throw new Error('dir');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`OCaml Arena on http://localhost:${port}  (add ?local to test with tabs in one browser)`));
