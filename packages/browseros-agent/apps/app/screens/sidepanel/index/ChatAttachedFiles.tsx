/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { FileText, ImageIcon, X } from 'lucide-react'
import type { FC } from 'react'
import type { StagedFiles } from './useStagedFiles'

/** BOS-3: the files that will go with the next message, each removable. */
export const ChatAttachedFiles: FC<{ files?: StagedFiles }> = ({ files }) => {
  if (!files?.enabled) return null
  if (files.attachments.length === 0 && !files.error) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
      {files.attachments.map((item) => (
        <span
          key={item.id}
          className="flex max-w-[220px] items-center gap-1 rounded-full border border-border/50 bg-muted/50 py-0.5 pr-1 pl-2 text-xs"
        >
          {item.kind === 'image' ? (
            <ImageIcon className="size-3 shrink-0" />
          ) : (
            <FileText className="size-3 shrink-0" />
          )}
          <span className="truncate">{item.name}</span>
          <button
            type="button"
            onClick={() => files.remove(item.id)}
            className="cursor-pointer rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3" />
            <span className="sr-only">Remove {item.name}</span>
          </button>
        </span>
      ))}
      {files.error && (
        <span className="text-destructive text-xs">{files.error}</span>
      )}
    </div>
  )
}
