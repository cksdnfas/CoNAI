import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { collectWildcardTreeIds, sortWildcardNodesByHierarchy, useWildcardTree } from '@/hooks/use-wildcard-tree'

type TestNode = {
  id: number
  name: string
  children?: TestNode[]
}

const treeData: TestNode[] = [
  {
    id: 1,
    name: 'root-folder',
    children: [{ id: 2, name: 'child-item' }],
  },
  {
    id: 3,
    name: 'standalone-item',
  },
]

function WildcardTreeHarness() {
  const {
    selectedNode,
    expandedIds,
    totalCount,
    handleSelect,
    handleToggle,
    handleExpandAll,
    handleCollapseAll,
    selectFirstNode,
    clearSelection,
  } = useWildcardTree(treeData)

  const expanded = Array.from(expandedIds).sort((a, b) => a - b).join(',')

  return (
    <div>
      <div data-testid="selected">{selectedNode ? selectedNode.id : 'none'}</div>
      <div data-testid="expanded">{expanded}</div>
      <div data-testid="total">{totalCount}</div>

      <button type="button" onClick={() => handleSelect(treeData[0])}>select-root</button>
      <button type="button" onClick={() => handleToggle(1)}>toggle-1</button>
      <button type="button" onClick={handleExpandAll}>expand-all</button>
      <button type="button" onClick={handleCollapseAll}>collapse-all</button>
      <button type="button" onClick={selectFirstNode}>select-first</button>
      <button type="button" onClick={clearSelection}>clear-selection</button>
    </div>
  )
}

describe('useWildcardTree', () => {
  it('applies deterministic state transitions on happy path', () => {
    render(<WildcardTreeHarness />)

    expect(screen.getByTestId('selected')).toHaveTextContent('none')
    expect(screen.getByTestId('expanded')).toBeEmptyDOMElement()
    expect(screen.getByTestId('total')).toHaveTextContent('3')

    fireEvent.click(screen.getByRole('button', { name: 'select-first' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'toggle-1' }))
    expect(screen.getByTestId('expanded')).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: 'toggle-1' }))
    expect(screen.getByTestId('expanded')).toBeEmptyDOMElement()

    fireEvent.click(screen.getByRole('button', { name: 'expand-all' }))
    expect(screen.getByTestId('expanded')).toHaveTextContent('1,2,3')

    fireEvent.click(screen.getByRole('button', { name: 'collapse-all' }))
    expect(screen.getByTestId('expanded')).toBeEmptyDOMElement()

    fireEvent.click(screen.getByRole('button', { name: 'clear-selection' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('none')
  })

  it('handles malformed input paths with safe fallback', () => {
    const malformed = [
      null,
      {
        id: 9,
        name: 'valid-parent',
        children: [{ id: 'bad-id' }, { id: 10, children: 'not-array' }],
      },
      {
        id: Number.NaN,
        name: 'invalid-number',
      },
      'bad-node',
    ]

    expect(() => collectWildcardTreeIds(malformed)).not.toThrow()
    expect(collectWildcardTreeIds(malformed)).toEqual([9, 10])

    const folderNode = { id: 1, name: 'folder', children: [{ id: 2, name: 'x' }] }
    const fileNode = { id: 3, name: 'file' }
    const alphaNode = { id: 4, name: 'alpha' }
    const betaNode = { id: 5, name: 'beta' }

    expect(sortWildcardNodesByHierarchy(folderNode, fileNode)).toBeLessThan(0)
    expect(sortWildcardNodesByHierarchy(alphaNode, betaNode)).toBeLessThan(0)
  })
})
