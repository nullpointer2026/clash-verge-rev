import { Checkbox } from '@mui/material'
import { createContext, use, type MouseEvent } from 'react'

import type { ResolvedProxyMember } from '@/types/proxy-view'

import { isDeletableNode } from './node-selection-model'

export interface NodeDeletionState {
  active: boolean
  busy: boolean
  groupName?: string
  selected: ReadonlySet<string>
  start: (groupName?: string) => void
  registerOrder: (orders: Map<string, string[]>) => void
  select: (
    name: string,
    group: string,
    event: MouseEvent,
    checkbox?: boolean,
  ) => void
}

export const NodeDeletionContext = createContext<NodeDeletionState | null>(null)
export const useNodeDeletion = () => use(NodeDeletionContext)

export function useNodeCardSelection(
  member: ResolvedProxyMember,
  group: string,
) {
  const deletion = useNodeDeletion()
  const selecting = deletion?.active ?? false
  const eligible =
    member.kind === 'node' &&
    isDeletableNode(member.node) &&
    (!deletion?.groupName || deletion.groupName === group)
  const checked = deletion?.selected.has(member.ref.name) ?? false
  const checkbox =
    selecting && eligible ? (
      <Checkbox
        checked={checked}
        disabled={deletion?.busy}
        size="small"
        slotProps={{ input: { 'aria-label': member.ref.name } }}
        onClick={(event) => {
          event.stopPropagation()
          deletion?.select(member.ref.name, group, event, true)
        }}
        sx={{ mr: 0.5, p: 0.5 }}
      />
    ) : null
  return {
    selecting,
    checked,
    disabled: selecting && (!eligible || deletion?.busy),
    checkbox,
    onSelect: (event: MouseEvent) => {
      if (eligible) deletion?.select(member.ref.name, group, event)
    },
  }
}
