/**
 * Local preview only:  node misc/trip-wizard-mock/serve.mjs
 *
 * Serves the built page with the UTF-8 charset the Artifact wrapper sets for
 * itself, so what you see here matches what gets published. (Python's
 * http.server sends no charset and turns every m² into mojibake.)
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const file = new URL('./trip-wizard-mock.html', import.meta.url);

createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(file));
}).listen(8778, () => console.log('http://localhost:8778'));
