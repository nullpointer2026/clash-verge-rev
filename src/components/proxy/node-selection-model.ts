import type { ProxyNodeView } from '@/types/proxy-view'

const builtinNames = new Set([
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'PASS-RULE',
  'COMPATIBLE',
])
const builtinTypes = new Set([
  'Direct',
  'Reject',
  'RejectDrop',
  'Compatible',
  'Pass',
  'PassRule',
  'Dns',
])

export const isDeletableNode = (node: Pick<ProxyNodeView, 'name' | 'type'>) =>
  !builtinNames.has(node.name) && !builtinTypes.has(node.type)

export function selectNodeNames(
  selected: ReadonlySet<string>,
  name: string,
  order: readonly string[],
  anchor: string | undefined,
  toggle: boolean,
  range: boolean,
): Set<string> {
  const start = anchor === undefined ? -1 : order.indexOf(anchor)
  const end = order.indexOf(name)
  if (range && start >= 0 && end >= 0) {
    return new Set([
      ...(toggle ? selected : []),
      ...order.slice(Math.min(start, end), Math.max(start, end) + 1),
    ])
  }
  if (!toggle) return new Set([name])
  const next = new Set(selected)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return next
}
