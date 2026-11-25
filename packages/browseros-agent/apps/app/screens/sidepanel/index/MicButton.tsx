/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Loader2, Mic, Square } from 'lucide-react'
import { type FC, useCallback, useEffect, useRef, useState } from 'react'
import { AmaraDictationError, transcribeWithAmara } from '@/lib/amara-dictation'

/** Five minutes, the most Amara's dictation takes in one go. */
const MAX_SECONDS = 300

type Phase = 'idle' | 'recording' | 'working'

function pickMime(): string {
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported(mime)
    ) {
      return mime
    }
  }
  return ''
}

function openVoiceSettings(): void {
  void chrome.tabs.create({
    url: chrome.runtime.getURL('/app.html#/settings/voice'),
  })
}

/**
 * BOS-2: tap to talk, tap again to stop. The words land in the chat box for
 * the owner to check before sending; nothing is sent on its own.
 */
export const MicButton: FC<{
  onText: (text: string) => void
  onError: (message: string | null) => void
  disabled?: boolean
}> = ({ onText, onError, disabled }) => {
  const [phase, setPhase] = useState<Phase>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const startedRef = useRef(0)
  const limitRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (limitRef.current) clearTimeout(limitRef.current)
    limitRef.current = null
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  useEffect(() => stop, [stop])

  const start = async () => {
    onError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onError(
        'The browser has not been allowed to use your mic yet. Opening Settings → Voice to allow it.',
      )
      openVoiceSettings()
      return
    }
    const mime = pickMime()
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {})
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = async () => {
      for (const track of stream.getTracks()) track.stop()
      recorderRef.current = null
      const seconds = (Date.now() - startedRef.current) / 1000
      const type = recorder.mimeType || mime || 'audio/webm'
      setPhase('working')
      try {
        const text = await transcribeWithAmara({
          audio: new Blob(chunks, { type }),
          mime: type.split(';')[0] ?? type,
          seconds,
        })
        onText(text)
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Amara’s dictation didn’t answer just now.'
        onError(message)
        if (err instanceof AmaraDictationError && err.needsSignIn) {
          openVoiceSettings()
        }
      } finally {
        setPhase('idle')
      }
    }
    recorderRef.current = recorder
    startedRef.current = Date.now()
    recorder.start()
    setPhase('recording')
    limitRef.current = setTimeout(stop, MAX_SECONDS * 1000)
  }

  const label =
    phase === 'recording'
      ? 'Stop and type what I said'
      : phase === 'working'
        ? 'Turning your words into text'
        : 'Talk instead of typing'

  return (
    <button
      type="button"
      title={label}
      disabled={disabled || phase === 'working'}
      onClick={() => (phase === 'recording' ? stop() : void start())}
      className={`cursor-pointer rounded-full p-2 transition-colors disabled:cursor-wait disabled:opacity-50 ${
        phase === 'recording'
          ? 'animate-pulse bg-red-600 text-white hover:bg-red-700'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {phase === 'working' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : phase === 'recording' ? (
        <Square className="h-3.5 w-3.5" />
      ) : (
        <Mic className="h-3.5 w-3.5" />
      )}
      <span className="sr-only">{label}</span>
    </button>
  )
}
