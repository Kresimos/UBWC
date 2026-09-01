/**
 * Local preview only:  node misc/pack-playground/serve.mjs
 *
 * Serves the built page with the UTF-8 charset the Artifact wrapper sets for
 * itself, so what you see here matches what gets published. Python's
 * http.server sends no charset and renders every m² as mojibake.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(new URL('./index.html', import.meta.url)));
}).listen(8777, () => console.log('http://localhost:8777'));
