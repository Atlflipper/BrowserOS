/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * BOS-2: the side panel mic sends speech to Amara's own dictation
 * (POST /dictation/transcribe), so the owner's saved word list applies.
 *
 * The panel signs in to Amara like the Amara web app does (Supabase email +
 * password), keeps only that ordinary sign-in on this Mac, and refreshes it
 * when it runs out. No server key is ever held here; the dictation route
 * itself still requires the owner's sign-in.
 */

import { storage } from '@wxt-dev/storage'

export const AMARA_API_URL = 'https://api.amaraai.net'
export const AMARA_SUPABASE_URL = 'https://kouuwwculqcpbukvtspu.supabase.co'

/**
 * Supabase's public (anon) key: the same one the Amara web app ships to every
 * browser, safe by design (row security). Set at build time; a pasted one in
 * Settings wins.
 */
export function defaultAnonKey(): string {
  return (
    (import.meta.env.VITE_AMARA_SUPABASE_ANON_KEY as string | undefined) ?? ''
  )
}

export interface AmaraDictationState {
  /** Supabase's public (anon) key, pasted once in Settings. Public by design. */
  anonKey: string
  email: string
  accessToken: string
  refreshToken: string
  /** Epoch seconds. */
  expiresAt: number
}

const EMPTY: AmaraDictationState = {
  anonKey: '',
  email: '',
  accessToken: '',
  refreshToken: '',
  expiresAt: 0,
}

interface DictationStore {
  getValue(): Promise<AmaraDictationState>
  setValue(value: AmaraDictationState): Promise<void>
  watch(listener: (value: AmaraDictationState) => void): () => void
}

let store: DictationStore | null = null

/** Created on first use, so loading this file never touches extension storage. */
function current(): DictationStore {
  store ??= storage.defineItem<AmaraDictationState>('local:amaraDictation', {
    fallback: EMPTY,
  })
  return store
}

/** Where the sign-in is kept: extension storage, or a test's own store. */
export const amaraDictationStorage: DictationStore = {
  getValue: () => current().getValue(),
  setValue: (value) => current().setValue(value),
  watch: (listener) => current().watch(listener),
}

/** Tests only: keep the sign-in somewhere other than extension storage. */
export function setDictationStoreForTests(next: DictationStore): void {
  store = next
}

export class AmaraDictationError extends Error {
  constructor(
    message: string,
    readonly needsSignIn = false,
  ) {
    super(message)
  }
}

type Fetch = typeof fetch

interface TokenReply {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  expires_at?: number
  error_description?: string
  msg?: string
}

function fromReply(
  reply: TokenReply,
  state: Pick<AmaraDictationState, 'anonKey' | 'email'>,
  now: number,
): AmaraDictationState {
  if (!reply.access_token || !reply.refresh_token) {
    throw new AmaraDictationError(
      reply.error_description ??
        reply.msg ??
        'Amara did not accept that sign-in.',
      true,
    )
  }
  return {
    ...state,
    accessToken: reply.access_token,
    refreshToken: reply.refresh_token,
    expiresAt:
      reply.expires_at ?? Math.floor(now / 1000) + (reply.expires_in ?? 3600),
  }
}

async function tokenCall(
  grant: 'password' | 'refresh_token',
  body: Record<string, string>,
  anonKey: string,
  fetchImpl: Fetch,
): Promise<TokenReply> {
  const response = await fetchImpl(
    `${AMARA_SUPABASE_URL}/auth/v1/token?grant_type=${grant}`,
    {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  return (await response.json().catch(() => ({}))) as TokenReply
}

/** Signs in to Amara with the owner's email and password, and keeps the sign-in. */
export async function signInToAmara(
  input: { anonKey: string; email: string; password: string },
  fetchImpl: Fetch = fetch,
  now = Date.now(),
): Promise<AmaraDictationState> {
  const anonKey = input.anonKey.trim() || defaultAnonKey()
  const email = input.email.trim()
  if (!anonKey) {
    throw new AmaraDictationError('Paste Amara’s public key first.', true)
  }
  const reply = await tokenCall(
    'password',
    { email, password: input.password },
    anonKey,
    fetchImpl,
  )
  const state = fromReply(reply, { anonKey, email }, now)
  await amaraDictationStorage.setValue(state)
  return state
}

export async function signOutOfAmara(): Promise<void> {
  const state = await amaraDictationStorage.getValue()
  await amaraDictationStorage.setValue({ ...EMPTY, anonKey: state.anonKey })
}

/** A current Amara sign-in token, refreshed when it is within a minute of running out. */
export async function amaraAccessToken(
  fetchImpl: Fetch = fetch,
  now = Date.now(),
): Promise<string> {
  const state = await amaraDictationStorage.getValue()
  if (!state.refreshToken) {
    throw new AmaraDictationError(
      'Sign in to Amara once in Settings → Voice to use the mic.',
      true,
    )
  }
  if (state.accessToken && state.expiresAt - 60 > now / 1000) {
    return state.accessToken
  }
  const reply = await tokenCall(
    'refresh_token',
    { refresh_token: state.refreshToken },
    state.anonKey,
    fetchImpl,
  )
  try {
    const next = fromReply(reply, state, now)
    await amaraDictationStorage.setValue(next)
    return next.accessToken
  } catch {
    await amaraDictationStorage.setValue({ ...EMPTY, anonKey: state.anonKey })
    throw new AmaraDictationError(
      'Your Amara sign-in ran out. Sign in again in Settings → Voice.',
      true,
    )
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return btoa(binary)
}

/** Speech in, the owner's cleaned-up words out. */
export async function transcribeWithAmara(
  clip: { audio: Blob; mime: string; seconds: number },
  fetchImpl: Fetch = fetch,
): Promise<string> {
  const token = await amaraAccessToken(fetchImpl)
  const response = await fetchImpl(`${AMARA_API_URL}/dictation/transcribe`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio: await blobToBase64(clip.audio),
      mime: clip.mime,
      seconds: Math.max(1, Math.round(clip.seconds)),
    }),
  })
  const body = (await response.json().catch(() => ({}))) as {
    text?: unknown
    error?: unknown
  }
  if (response.status === 401 || response.status === 403) {
    throw new AmaraDictationError(
      'Amara turned the mic away. Sign in again in Settings → Voice.',
      true,
    )
  }
  if (!response.ok) {
    throw new AmaraDictationError(
      typeof body.error === 'string'
        ? body.error
        : 'Amara’s dictation didn’t answer just now. Nothing was typed — try again.',
    )
  }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    throw new AmaraDictationError(
      'Amara couldn’t make out any words. Try again a little closer to the mic.',
    )
  }
  return text
}
