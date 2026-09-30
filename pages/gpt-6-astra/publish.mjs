import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Only production assets inside this project's dist/ are ever uploaded.
const project = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(project, 'dist');
const metadataPath = path.join(project, 'artifacts', 'deployment-private.json');
const apiKey = process.env.DATAECHO_API_KEY;
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
async function collect(directory, prefix = '') {
  const results = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in production output.');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) results.push(...await collect(path.join(directory, entry.name), `${relative}/`));
    else if (entry.isFile()) {
      const body = await fs.readFile(path.join(directory, entry.name));
      results.push({ path: relative, size: body.length, contentType: mimeTypes[path.extname(entry.name)] || 'application/octet-stream', hash: crypto.createHash('sha256').update(body).digest('hex') });
    }
  }
  return results;
}
async function jsonRequest(url, method, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(url, { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Deploy request failed: ${response.status} ${await response.text()}`);
  return response.json();
}
const files = await collect(root);
if (!files.some((file) => file.path === 'index.html')) throw new Error('Build the site first.');
console.log(`Publishing ${files.length} production files (${files.reduce((n, file) => n + file.size, 0)} bytes).`);
let previous;
try { previous = JSON.parse(await fs.readFile(metadataPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const body = { files, viewer: { title: 'Pelican Post · 骑进海风里', description: 'A little island. A very big beak. Absolutely nowhere to be.' } };
if (previous && !apiKey) throw new Error('This site is already published. To update the same URL, claim it using the saved claimUrl, then set DATAECHO_API_KEY to an API key for the owning account. No new site has been created.');
const result = await jsonRequest(previous ? `https://dataecho.ai/api/v1/publish/${previous.slug}` : 'https://dataecho.ai/api/v1/publish', previous ? 'PUT' : 'POST', body);
const metadata = { ...previous, ...result };
await fs.mkdir(path.dirname(metadataPath), { recursive: true });
await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
const upload = result.upload;
if (!upload || !upload.finalizeUrl || !Array.isArray(upload.uploads)) throw new Error('Unexpected upload response. Metadata saved for recovery.');
for (const item of upload.uploads) {
  if (!files.some((file) => file.path === item.path)) throw new Error('Upload response requested an unknown file.');
  const response = await fetch(item.url, { method: item.method || 'PUT', headers: item.headers || { 'Content-Type': files.find((file) => file.path === item.path).contentType }, body: await fs.readFile(path.join(root, item.path)), signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Upload failed for ${item.path}: ${response.status}`);
  console.log(`Uploaded ${item.path}`);
}
const finalized = await jsonRequest(new URL(upload.finalizeUrl, 'https://dataecho.ai').href, 'POST', { versionId: upload.versionId });
metadata.finalized = finalized;
await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ siteUrl: metadata.siteUrl, claimUrl: metadata.claimUrl, expiresAt: metadata.expiresAt, slug: metadata.slug, finalized }, null, 2));
