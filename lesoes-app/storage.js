// Armazenamento das fotos: Vercel Blob (privado) quando há BLOB_READ_WRITE_TOKEN, senão disco local.
import fs from 'node:fs';
import path from 'node:path';

export async function openStorage(dir) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put, get, del } = await import('@vercel/blob');
    return {
      kind: 'blob',
      put: async (name, buf, type) => (await put(`fotos/${name}`, buf, { access: 'private', contentType: type, addRandomSuffix: true })).pathname,
      get: async (key) => {
        const r = await get(key, { access: 'private' });
        if (!r || r.statusCode !== 200) throw new Error('Foto não encontrada no armazenamento');
        return Buffer.from(await new Response(r.stream).arrayBuffer());
      },
      del: async (key) => { await del(key).catch(() => {}); },
    };
  }
  fs.mkdirSync(dir, { recursive: true });
  return {
    kind: 'disk',
    put: async (name, buf) => { fs.writeFileSync(path.join(dir, name), buf); return name; },
    get: async (key) => fs.readFileSync(path.join(dir, key)),
    del: async (key) => { fs.rmSync(path.join(dir, key), { force: true }); },
  };
}
