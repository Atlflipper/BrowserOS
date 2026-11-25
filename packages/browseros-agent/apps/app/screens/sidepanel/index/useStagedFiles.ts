/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FileUIPart } from 'ai'
import { useCallback, useState } from 'react'
import { type StagedAttachment, stageAttachments } from '@/lib/attachments'
import { toFilePart } from '@/modules/chat/pending-home-message'

/** BOS-3: the files waiting in the side panel's chat box until the next send. */
export interface StagedFiles {
  attachments: StagedAttachment[]
  error: string | null
  busy: boolean
  /** Only agents (Claude Code, Codex) read attachments today. */
  enabled: boolean
  add: (files: File[]) => Promise<void>
  remove: (id: string) => void
  clear: () => void
  toFileParts: () => FileUIPart[]
}

export function useStagedFiles(enabled: boolean): StagedFiles {
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const add = useCallback(
    async (files: File[]) => {
      if (!enabled || files.length === 0) return
      setBusy(true)
      try {
        const { staged, errors } = await stageAttachments(
          files,
          attachments.length,
        )
        setAttachments((previous) => [...previous, ...staged])
        setError(errors[0]?.message ?? null)
      } finally {
        setBusy(false)
      }
    },
    [enabled, attachments.length],
  )

  const remove = useCallback((id: string) => {
    setAttachments((previous) => previous.filter((item) => item.id !== id))
    setError(null)
  }, [])

  const clear = useCallback(() => {
    setAttachments([])
    setError(null)
  }, [])

  const toFileParts = useCallback(
    () => attachments.map(toFilePart),
    [attachments],
  )

  return {
    attachments: enabled ? attachments : [],
    error,
    busy,
    enabled,
    add,
    remove,
    clear,
    toFileParts: enabled ? toFileParts : () => [],
  }
}
