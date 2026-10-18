import type { Backend, Entry, Meta, WebRecipe } from './store'

// Lagring i IndexedDB: en databas per app (den riktiga appen och varje förhandsvisning har sin egen).

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error)
  })

export function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1)
    r.onupgradeneeded = () => {
      const db = r.result
      db.createObjectStore('entries', { keyPath: 'key' })
      db.createObjectStore('recipes', { keyPath: 'id' })
      db.createObjectStore('meta')
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export async function readAll(db: IDBDatabase) {
  const tx = db.transaction(['entries', 'recipes', 'meta'], 'readonly')
  const [entries, recipes, meta] = await Promise.all([
    req(tx.objectStore('entries').getAll() as IDBRequest<Entry[]>),
    req(tx.objectStore('recipes').getAll() as IDBRequest<WebRecipe[]>),
    req(tx.objectStore('meta').get('meta') as IDBRequest<Meta | undefined>),
  ])
  return { entries, recipes, meta }
}

export function idbBackend(db: IDBDatabase): Backend {
  return {
    load: () => readAll(db),
    async save(entries, recipes, meta) {
      const tx = db.transaction(['entries', 'recipes', 'meta'], 'readwrite')
      for (const e of entries) tx.objectStore('entries').put(e)
      for (const r of recipes) tx.objectStore('recipes').put(r)
      tx.objectStore('meta').put(meta, 'meta')
      await done(tx)
    },
    async clear() {
      const tx = db.transaction(['entries', 'recipes', 'meta'], 'readwrite')
      for (const s of ['entries', 'recipes', 'meta']) tx.objectStore(s).clear()
      await done(tx)
    },
  }
}
