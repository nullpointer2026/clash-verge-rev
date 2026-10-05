import { expect, test } from 'vitest'

import { isDeletableNode, selectNodeNames } from './node-selection-model'

test('Explorer selection replaces, toggles, and spans the displayed sorted order', () => {
  const order = ['C', 'A', 'B', 'D']
  const single = selectNodeNames(
    new Set(['D']),
    'C',
    order,
    undefined,
    false,
    false,
  )
  expect([...single]).toEqual(['C'])
  const multiple = selectNodeNames(single, 'D', order, 'C', true, false)
  expect([...multiple]).toEqual(['C', 'D'])
  expect([...selectNodeNames(multiple, 'C', order, 'D', true, false)]).toEqual([
    'D',
  ])
  expect([...selectNodeNames(multiple, 'B', order, 'C', false, true)]).toEqual([
    'C',
    'A',
    'B',
  ])
  expect([
    ...selectNodeNames(new Set(['D']), 'B', order, 'C', true, true),
  ]).toEqual(['D', 'C', 'A', 'B'])
  expect([...multiple]).toEqual(['C', 'D'])
})

test('a stale range anchor becomes a single selection and built-in policies cannot be deleted', () => {
  expect([
    ...selectNodeNames(new Set(['D']), 'B', ['A', 'B'], 'C', false, true),
  ]).toEqual(['B'])
  expect(isDeletableNode({ name: 'DIRECT', type: 'Direct' })).toBe(false)
  expect(isDeletableNode({ name: 'reject policy', type: 'Reject' })).toBe(false)
  expect(isDeletableNode({ name: 'Tokyo [1]', type: 'Vless' })).toBe(true)
})
