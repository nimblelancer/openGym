import { describe, test, expect } from 'vitest'
import { idbBackend } from './media-store-idb.js'
import { createMediaStore } from './media-store.js'

/* Just enough IndexedDB for the backend: one database, one object store keyed by `hash`, requests
   that answer on the next tick and transactions that complete after their last request. Values
   are kept as they are put, so a test can plant a record in the old `blob` shape. */
function fakeIdb() {
  const rows = new Map()
  const later = fn => setTimeout(fn, 0)
  const request = run => {
    const r = { onsuccess: null, onerror: null, result: undefined }
    later(() => { r.result = run(); r.onsuccess?.() })
    return r
  }
  const db = {
    objectStoreNames: { contains: () => true },
    onversionchange: null,
    close() {},
    transaction() {
      const t = { oncomplete: null, onerror: null, onabort: null, pending: 0 }
      const settle = () => { if (--t.pending === 0) later(() => t.oncomplete?.()) }
      const track = run => { t.pending++; return request(() => { const v = run(); later(settle); return v }) }
      t.objectStore = () => ({
        put: v => track(() => { rows.set(v.hash, v) }),
        get: k => track(() => rows.get(k)),
        delete: k => track(() => { rows.delete(k) }),
        openCursor: () => {
          const list = [...rows.values()]
          const r = { onsuccess: null, onerror: null, result: null }
          let i = 0
          const step = () => later(() => {
            r.result = i < list.length ? { value: list[i], continue: () => { i++; step() } } : null
            r.onsuccess?.()
          })
          step()
          return r
        }
      })
      return t
    }
  }
  return {
    rows,
    open() {
      const r = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: db }
      later(() => r.onsuccess?.())
      return r
    }
  }
}

const bytesOf = async blob => Array.from(new Uint8Array(await blob.arrayBuffer()))

describe('the IndexedDB media backend', () => {
  test('keeps the bytes as an ArrayBuffer, never the Blob, and hands back a readable Blob', async () => {
    const idb = fakeIdb()
    const be = idbBackend({ idb })
    expect(await be.open()).toBe(true)
    await be.put({ hash: 'h1', mime: 'video/quicktime', size: 3 }, new Blob([new Uint8Array([1, 2, 3])]))
    const row = idb.rows.get('h1')
    expect(row.blob).toBeUndefined()
    expect(row.data).toBeInstanceOf(ArrayBuffer)
    const back = await be.getBlob('h1')
    expect(back.type).toBe('video/quicktime')
    expect(await bytesOf(back)).toEqual([1, 2, 3])
    expect(await be.all()).toEqual([{ hash: 'h1', mime: 'video/quicktime', size: 3 }])
  })

  test('an old record whose Blob WebKit can no longer read counts as missing', async () => {
    const idb = fakeIdb()
    const be = idbBackend({ idb })
    await be.open()
    const dead = { size: 37535282, type: 'video/quicktime', arrayBuffer: () => Promise.reject(new Error('WebKitBlobResource error 1')) }
    idb.rows.set('h2', { hash: 'h2', mime: 'video/quicktime', size: 37535282, blob: dead })
    expect(await be.getBlob('h2')).toBeNull()
  })

  test('an old record that reads short counts as missing', async () => {
    const idb = fakeIdb()
    const be = idbBackend({ idb })
    await be.open()
    idb.rows.set('h3', { hash: 'h3', mime: 'image/webp', size: 10, blob: new Blob([new Uint8Array([9])]) })
    expect(await be.getBlob('h3')).toBeNull()
  })

  test('an old readable record is read once and rewritten as data', async () => {
    const idb = fakeIdb()
    const be = idbBackend({ idb })
    await be.open()
    idb.rows.set('h4', { hash: 'h4', mime: 'image/webp', size: 2, blob: new Blob([new Uint8Array([7, 8])]) })
    expect(await bytesOf(await be.getBlob('h4'))).toEqual([7, 8])
    const row = idb.rows.get('h4')
    expect(row.blob).toBeUndefined()
    expect(row.data).toBeInstanceOf(ArrayBuffer)
    expect(await bytesOf(await be.getBlob('h4'))).toEqual([7, 8])
  })
})

test('Phase 7: two stores sharing IDB cannot evict a record newly marked owed by the other', async () => {
  const idb = fakeIdb(), a = createMediaStore(idbBackend({ idb })), b = createMediaStore(idbBackend({ idb }))
  const h = 'a'.repeat(64)
  await a.put(h, new Blob(['original']), { mime: 'image/webp', pending: false })
  expect((await b.list())[0].pending).toBe(false)
  await a.markOwed(h)
  expect(await b.removeIf(h, rec => !rec.pending && !rec.rejected)).toBeNull()
  expect(idb.rows.get(h).pending).toBe(true)
  expect(await (await a.get(h)).blob.text()).toBe('original')
})

test('Phase 7: legacy Blob read cannot overwrite newer owed metadata', async () => {
  const idb = fakeIdb(), be = idbBackend({ idb })
  await be.open()
  const blob = new Blob(['old'])
  idb.rows.set('h5', { hash: 'h5', mime: 'image/webp', size: 3, pending: false, blob: {
    arrayBuffer: async () => { await be.patch('h5', { pending: true }); return blob.arrayBuffer() }
  } })
  expect(await (await be.getBlob('h5')).text()).toBe('old')
  expect(idb.rows.get('h5').pending).toBe(true)
  expect(idb.rows.get('h5').data).toBeInstanceOf(ArrayBuffer)
})

test('Phase 7: legacy Blob read never resurrects a removed record', async () => {
  const idb = fakeIdb(), be = idbBackend({ idb })
  await be.open()
  const blob = new Blob(['old'])
  idb.rows.set('h6', { hash: 'h6', mime: 'image/webp', size: 3, blob: {
    arrayBuffer: async () => { await be.remove('h6'); return blob.arrayBuffer() }
  } })
  expect(await (await be.getBlob('h6')).text()).toBe('old')
  expect(idb.rows.has('h6')).toBe(false)
})
