import { describe, expect, it } from 'vitest'
import { candidates, isNew, pick } from './random'
import { decodeState, emptyState, encodeState, merge } from './storage'
import type { AppState, Filters, Recipe } from './types'

const r = (id: string, category: Recipe['category'] = 'fast'): Recipe => ({ id, name: id, category })
const all = [r('a'), r('b', 'storkok'), r('c', 'finmiddag'), r('d')]
const base: Filters = { categories: [], who: 'both', source: 'all' }

const withState = (f: (s: AppState) => void) => {
  const s = emptyState()
  f(s)
  return s
}

describe('candidates', () => {
  it('filtrerar på kategori', () => {
    expect(candidates(all, emptyState(), { ...base, categories: ['fast'] }).map((x) => x.id)).toEqual(['a', 'd'])
  })

  it('tar bort rätter som någon som äter ogillar', () => {
    const s = withState((s) => (s.ratings.b.a = 'dislike'))
    expect(candidates(all, s, base).map((x) => x.id)).toEqual(['b', 'c', 'd'])
    expect(candidates(all, s, { ...base, who: 'a' }).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('gillade kräver att alla som äter gillar', () => {
    const s = withState((s) => {
      s.ratings.a.a = 'like'
      s.ratings.b.a = 'like'
      s.ratings.a.b = 'like'
    })
    expect(candidates(all, s, { ...base, source: 'liked' }).map((x) => x.id)).toEqual(['a'])
    expect(candidates(all, s, { ...base, source: 'liked', who: 'a' }).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('nya är rätter ingen har testat', () => {
    const s = withState((s) => {
      s.ratings.a.a = 'like'
      s.favorites = ['b']
      s.cooked.c = '2026-01-01'
    })
    expect(candidates(all, s, { ...base, source: 'new' }).map((x) => x.id)).toEqual(['d'])
    expect(isNew(all[3], s)).toBe(true)
  })
})

describe('pick', () => {
  it('undviker förra resultatet', () => {
    for (let i = 0; i < 20; i++) expect(pick(all.slice(0, 2), emptyState(), base, 'a')?.id).toBe('b')
  })

  it('returnerar inget för tom lista', () => {
    expect(pick([], emptyState(), base)).toBeUndefined()
  })

  it('väljer nyligen lagade rätter mer sällan', () => {
    const now = new Date('2026-10-18').getTime()
    const s = withState((s) => (s.cooked.a = '2026-10-17'))
    // a har vikt 0.15 och b vikt 1, så ett slumptal under 0.15/1.15 ger a.
    expect(pick(all.slice(0, 2), s, base, undefined, () => 0.1, now)?.id).toBe('a')
    expect(pick(all.slice(0, 2), s, base, undefined, () => 0.2, now)?.id).toBe('b')
  })
})

describe('storage', () => {
  it('kodar och avkodar tillstånd med åäö', () => {
    const s = withState((s) => {
      s.names.a = 'Åsa'
      s.favorites = ['a']
    })
    expect(decodeState(encodeState(s))).toEqual(s)
  })

  it('slår ihop listor från två enheter', () => {
    const mine = withState((s) => {
      s.names.a = 'Axel'
      s.ratings.a.a = 'like'
      s.favorites = ['a']
      s.cooked.a = '2026-10-10'
    })
    const theirs = withState((s) => {
      s.names.b = 'Kim'
      s.ratings.b.b = 'dislike'
      s.favorites = ['b']
      s.cooked.a = '2026-10-01'
    })
    const out = merge(mine, theirs)
    expect(out.names).toEqual({ a: 'Axel', b: 'Kim' })
    expect(out.ratings).toEqual({ a: { a: 'like' }, b: { b: 'dislike' } })
    expect(out.favorites).toEqual(['a', 'b'])
    expect(out.cooked.a).toBe('2026-10-10')
  })
})
