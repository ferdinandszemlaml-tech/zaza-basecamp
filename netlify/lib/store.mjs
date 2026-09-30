// Vrstva pro ukládání dat. Jediné místo, které ví o Netlify Blobs –
// při přechodu na vlastní server se vymění jen tento soubor.
import { getStore } from '@netlify/blobs';

const useMemory = () => process.env.BASECAMP_MEMORY_STORE === '1'; // jen pro lokální testy
const mem = { data: new Map(), files: new Map() };

const dataStore = () => getStore({ name: 'basecamp-data', consistency: 'strong' });
const fileStore = () => getStore({ name: 'basecamp-files', consistency: 'strong' });

export async function getJSON(key, fallback) {
  if (useMemory()) return mem.data.has(key) ? structuredClone(mem.data.get(key)) : fallback;
  const value = await dataStore().get(key, { type: 'json' });
  return value ?? fallback;
}

export async function setJSON(key, value) {
  if (useMemory()) { mem.data.set(key, structuredClone(value)); return; }
  await dataStore().setJSON(key, value);
}

export async function deleteJSON(key) {
  if (useMemory()) { mem.data.delete(key); return; }
  await dataStore().delete(key);
}

export async function getFile(key) {
  if (useMemory()) return mem.files.get(key) ?? null;
  const res = await fileStore().getWithMetadata(key, { type: 'arrayBuffer' });
  return res ? { data: res.data, metadata: res.metadata } : null;
}

export async function setFile(key, data, metadata) {
  if (useMemory()) { mem.files.set(key, { data, metadata }); return; }
  await fileStore().set(key, data, { metadata });
}

export async function deleteFile(key) {
  if (useMemory()) { mem.files.delete(key); return; }
  await fileStore().delete(key);
}
