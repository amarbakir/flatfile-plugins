import { describe, expect, it } from 'bun:test'
import { records } from './fake.data'
import { keepLast } from './keep.last.logic'

describe('keepLast()', () => {
  it('keeps the last record', () => {
    let uniques = new Set()
    const removeThese = keepLast(records, 'email', uniques)
    expect(removeThese).toEqual(['recordId:1'])
  })
})
