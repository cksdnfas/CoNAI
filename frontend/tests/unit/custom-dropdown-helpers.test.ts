import { describe, expect, it } from 'vitest'
import {
  normalizeCustomDropdownItems,
  normalizeCustomDropdownPayload,
  parseCustomDropdownItemsText,
} from '@/features/image-generation/utils/custom-dropdown-helpers'

describe('custom-dropdown-helpers', () => {
  it('normalizes items deterministically on happy path', () => {
    expect(parseCustomDropdownItemsText(' alpha\n beta\nalpha\n\n gamma ')).toEqual(['alpha', 'beta', 'gamma'])

    expect(normalizeCustomDropdownPayload({
      name: '  Model List  ',
      description: '  curated  ',
      itemsText: 'foo\nbar\nfoo\n',
    })).toEqual({
      name: 'Model List',
      description: 'curated',
      items: ['foo', 'bar'],
    })
  })

  it('returns safe fallback for malformed input without throwing', () => {
    expect(() => normalizeCustomDropdownItems(Symbol('bad'))).not.toThrow()
    expect(() => normalizeCustomDropdownPayload(null)).not.toThrow()

    expect(normalizeCustomDropdownItems([null, ' item ', '', 42, false, 'item'])).toEqual(['item', '42', 'false'])
    expect(normalizeCustomDropdownItems({ items: { bad: true } })).toEqual([])
    expect(normalizeCustomDropdownPayload({ name: 123, description: '   ', items: { bad: true } })).toEqual({
      name: '',
      items: [],
    })
  })
})
