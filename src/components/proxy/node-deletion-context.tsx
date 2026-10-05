import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded'
import { Alert, Box, Button, Typography } from '@mui/material'
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import { useProfiles } from '@/hooks/use-profiles'
import { useAppRefreshers, useProxiesData } from '@/providers/app-data-context'
import { changeDeletedNodes } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

import { isDeletableNode, selectNodeNames } from './node-selection-model'
import {
  NodeDeletionContext,
  type NodeDeletionState,
} from './use-node-deletion'

export function NodeDeletionProvider({
  children,
  enabled,
}: {
  children: ReactNode
  enabled: boolean
}) {
  const { t } = useTranslation()
  const { profiles, current, mutateProfiles } = useProfiles()
  const { proxyView } = useProxiesData()
  const { refreshProxy } = useAppRefreshers()
  const [active, setActive] = useState(false)
  const [groupName, setGroupName] = useState<string>()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [confirmAll, setConfirmAll] = useState<string[] | null>(null)
  const [error, setError] = useState<string>()
  const ordersRef = useRef(new Map<string, string[]>())
  const anchorRef = useRef<{ name: string; group: string } | undefined>(
    undefined,
  )
  const busyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const candidates = useMemo(() => {
    if (!proxyView) return []
    const group =
      proxyView.global?.name === groupName
        ? proxyView.global
        : proxyView.groups.find((item) => item.name === groupName)
    const nodes = groupName
      ? (group?.members ?? []).flatMap((member) =>
          member.kind === 'node' && proxyView.records[member.recordId]
            ? [proxyView.records[member.recordId]]
            : [],
        )
      : Object.values(proxyView.records)
    return Array.from(
      new Set(nodes.filter(isDeletableNode).map((node) => node.name)),
    )
  }, [proxyView, groupName])
  const eligible = useMemo(() => new Set(candidates), [candidates])
  const selectedNames = useMemo(
    () => Array.from(selected).filter((name) => eligible.has(name)),
    [selected, eligible],
  )
  const deletedNames = current?.option?.deleted_nodes ?? []

  const registerOrder = useCallback((next: Map<string, string[]>) => {
    ordersRef.current = next
  }, [])
  const start = useCallback(
    (group?: string) => {
      if (!enabled || busyRef.current) return
      setGroupName(group)
      setSelected(new Set())
      setActive(true)
      anchorRef.current = undefined
      rootRef.current?.focus()
    },
    [enabled],
  )
  const select = useCallback(
    (name: string, group: string, event: MouseEvent, checkbox = false) => {
      if (busyRef.current) return
      const order = ordersRef.current.get(group) ?? []
      const sameGroup = anchorRef.current?.group === group
      setSelected((previous) =>
        selectNodeNames(
          previous,
          name,
          order,
          sameGroup ? anchorRef.current?.name : undefined,
          checkbox || event.ctrlKey || event.metaKey,
          !checkbox && event.shiftKey,
        ),
      )
      if (!event.shiftKey || !sameGroup) anchorRef.current = { name, group }
    },
    [],
  )

  const stop = () => {
    if (busyRef.current) return
    setActive(false)
    setSelected(new Set())
    anchorRef.current = undefined
  }
  const apply = async (names: string[], restore = false) => {
    if (busyRef.current || !profiles?.current || names.length === 0) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      const outcome = await changeDeletedNodes(profiles.current, names, restore)
      if (outcome.status !== 'valid') {
        setError(t('proxies.page.nodeDeletion.failed'))
        return
      }
      setSelected(new Set())
      setConfirmAll(null)
      await Promise.all([mutateProfiles(), refreshProxy()])
      showNotice.success(
        t(
          restore
            ? 'proxies.page.nodeDeletion.restored'
            : 'proxies.page.nodeDeletion.deleted',
          { count: names.length },
        ),
      )
    } catch (cause) {
      setError(String(cause))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const value = useMemo<NodeDeletionState>(
    () => ({
      active: active && enabled,
      busy,
      groupName,
      selected,
      start,
      registerOrder,
      select,
    }),
    [active, enabled, busy, groupName, selected, start, registerOrder, select],
  )

  return (
    <NodeDeletionContext value={enabled ? value : null}>
      <Box
        ref={rootRef}
        tabIndex={-1}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
        onKeyDown={(event) => {
          if (!active || busyRef.current || confirmAll) return
          if (
            event.target instanceof Element &&
            event.target.closest(
              'input:not([type="checkbox"]), textarea, [contenteditable="true"]',
            )
          )
            return
          if (event.key === 'Delete') {
            event.preventDefault()
            void apply(selectedNames)
          } else if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'a'
          ) {
            event.preventDefault()
            setSelected(new Set(candidates))
          } else if (event.key === 'Escape') {
            event.preventDefault()
            stop()
          }
        }}
      >
        {enabled && (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 1,
            }}
          >
            {active ? (
              <>
                <Typography variant="body2" sx={{ mr: 'auto' }}>
                  {t('proxies.page.nodeDeletion.selected', {
                    count: selectedNames.length,
                  })}
                  {groupName && ` · ${groupName}`}
                </Typography>
                <Button
                  size="small"
                  disabled={busy || candidates.length === 0}
                  onClick={() => setSelected(new Set(candidates))}
                >
                  {t('proxies.page.nodeDeletion.selectAll')}
                </Button>
                <Button
                  size="small"
                  disabled={busy || selectedNames.length === 0}
                  onClick={() => setSelected(new Set())}
                >
                  {t('proxies.page.nodeDeletion.clear')}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="error"
                  startIcon={<DeleteOutlineRounded />}
                  disabled={busy || selectedNames.length === 0}
                  loading={busy}
                  onClick={() => void apply(selectedNames)}
                >
                  {t('proxies.page.nodeDeletion.deleteSelected')}
                </Button>
                <Button
                  size="small"
                  color="error"
                  disabled={busy || candidates.length === 0}
                  onClick={() => setConfirmAll(candidates)}
                >
                  {t(
                    groupName
                      ? 'proxies.page.nodeDeletion.deleteGroup'
                      : 'proxies.page.nodeDeletion.deleteAll',
                  )}
                </Button>
                <Button size="small" disabled={busy} onClick={stop}>
                  {t('proxies.page.nodeDeletion.done')}
                </Button>
              </>
            ) : (
              <Button
                size="small"
                variant="outlined"
                startIcon={<DeleteOutlineRounded />}
                disabled={!profiles?.current || candidates.length === 0}
                onClick={() => start()}
              >
                {t('proxies.page.nodeDeletion.start')}
              </Button>
            )}
            {deletedNames.length > 0 && (
              <Button
                size="small"
                disabled={busy}
                onClick={() => void apply(deletedNames, true)}
              >
                {t('proxies.page.nodeDeletion.restore', {
                  count: deletedNames.length,
                })}
              </Button>
            )}
          </Box>
        )}
        {active && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ px: 1.5, pb: 1 }}
          >
            {t('proxies.page.nodeDeletion.hint')}
          </Typography>
        )}
        {error && (
          <Alert severity="error" onClose={() => setError(undefined)}>
            {error}
          </Alert>
        )}
        <Box sx={{ flex: 1, minHeight: 0 }}>{children}</Box>
      </Box>
      <BaseDialog
        open={confirmAll !== null}
        title={t('proxies.page.nodeDeletion.deleteAll')}
        okBtn={t('proxies.page.nodeDeletion.deleteSelected')}
        cancelBtn={t('shared.actions.cancel')}
        loading={busy}
        disableCancel={busy}
        onOk={() => void apply(confirmAll ?? [])}
        onCancel={() => setConfirmAll(null)}
        onClose={() => {
          if (!busyRef.current) setConfirmAll(null)
        }}
      >
        {t('proxies.page.nodeDeletion.confirmAll', {
          count: confirmAll?.length ?? 0,
        })}
      </BaseDialog>
    </NodeDeletionContext>
  )
}
