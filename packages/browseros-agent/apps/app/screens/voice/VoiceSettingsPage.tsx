/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { CheckCircle2, Mic } from 'lucide-react'
import { type FC, type FormEvent, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type AmaraDictationState,
  amaraDictationStorage,
  defaultAnonKey,
  signInToAmara,
  signOutOfAmara,
} from '@/lib/amara-dictation'

type MicAccess = 'unknown' | 'granted' | 'denied'

/**
 * BOS-2: where the owner lets the mic in and signs in to Amara's dictation once.
 * The side panel cannot ask for the mic itself, so the ask happens on this page.
 */
export const VoiceSettingsPage: FC = () => {
  const [state, setState] = useState<AmaraDictationState | null>(null)
  const [mic, setMic] = useState<MicAccess>('unknown')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [anonKey, setAnonKey] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const needsKey = !defaultAnonKey()

  useEffect(() => {
    amaraDictationStorage.getValue().then((value) => {
      setState(value)
      setEmail(value.email)
      setAnonKey(value.anonKey)
    })
    const unwatch = amaraDictationStorage.watch((value) => setState(value))
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((status) => {
        setMic(status.state === 'granted' ? 'granted' : 'unknown')
        status.onchange = () =>
          setMic(status.state === 'granted' ? 'granted' : 'unknown')
      })
      .catch(() => {})
    return () => unwatch()
  }, [])

  const allowMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const track of stream.getTracks()) track.stop()
      setMic('granted')
    } catch {
      setMic('denied')
    }
  }

  const signIn = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await signInToAmara({ anonKey, email, password })
      setPassword('')
      setMessage('Signed in. The mic in the side panel now uses Amara.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  const signedIn = Boolean(state?.refreshToken)

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-orange)]/10">
            <Mic className="h-6 w-6 text-[var(--accent-orange)]" />
          </div>
          <div className="flex-1">
            <h2 className="mb-1 font-semibold text-xl">Voice</h2>
            <p className="text-muted-foreground text-sm">
              Talk instead of typing in the side panel. Your words go through
              Amara’s dictation, so your saved word list applies. Audio is never
              stored.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h3 className="font-semibold">1. Let the browser use your mic</h3>
        {mic === 'granted' ? (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-600" /> Mic allowed.
          </p>
        ) : (
          <>
            <Button type="button" onClick={allowMic}>
              Allow microphone
            </Button>
            {mic === 'denied' && (
              <p className="text-destructive text-sm">
                The mic was blocked. Click the icon at the left of the address
                bar, set Microphone to Allow, then try again.
              </p>
            )}
          </>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h3 className="font-semibold">2. Sign in to Amara</h3>
        {signedIn ? (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Signed in as{' '}
              {state?.email}.
            </p>
            <Button type="button" variant="outline" onClick={signOutOfAmara}>
              Sign out
            </Button>
          </div>
        ) : (
          <form onSubmit={signIn} className="max-w-sm space-y-3">
            {needsKey && (
              <div className="space-y-1">
                <Label htmlFor="amara-anon">Amara public key</Label>
                <Input
                  id="amara-anon"
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  placeholder="eyJ…"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="amara-email">Email</Label>
              <Input
                id="amara-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="amara-password">Amara password</Label>
              <Input
                id="amara-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy || !email || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}
        {message && <p className="text-sm">{message}</p>}
      </div>
    </div>
  )
}
