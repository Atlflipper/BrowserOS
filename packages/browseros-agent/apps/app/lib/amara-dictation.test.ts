import { beforeAll, describe, expect, it } from 'bun:test'
import {
  AMARA_API_URL,
  amaraAccessToken,
  setDictationStoreForTests,
  signInToAmara,
  transcribeWithAmara,
} from './amara-dictation'

let stored: unknown

beforeAll(() => {
  setDictationStoreForTests({
    getValue: async () => stored as never,
    setValue: async (value) => {
      stored = value
    },
    watch: () => () => {},
  })
})

type Call = { url: string; init: RequestInit }

function fakeFetch(replies: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const reply = replies.shift() ?? { status: 500, body: {} }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
    })
  }) as unknown as typeof fetch
  return { calls, impl }
}

const NOW = 1_800_000_000_000

describe('Amara dictation from the side panel (BOS-2)', () => {
  it('signs in with email and password and keeps only the sign-in', async () => {
    const { calls, impl } = fakeFetch([
      { body: { access_token: 'a1', refresh_token: 'r1', expires_in: 3600 } },
    ])
    const state = await signInToAmara(
      { anonKey: 'anon', email: ' me@example.com ', password: 'pw' },
      impl,
      NOW,
    )
    expect(calls[0]?.url).toContain('/auth/v1/token?grant_type=password')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      email: 'me@example.com',
      password: 'pw',
    })
    expect(state).toEqual({
      anonKey: 'anon',
      email: 'me@example.com',
      accessToken: 'a1',
      refreshToken: 'r1',
      expiresAt: NOW / 1000 + 3600,
    })
    expect(JSON.stringify(stored)).not.toContain('pw')
  })

  it('refreshes a sign-in that is about to run out', async () => {
    stored = {
      anonKey: 'anon',
      email: 'me@example.com',
      accessToken: 'old',
      refreshToken: 'r1',
      expiresAt: NOW / 1000 + 30,
    }
    const { calls, impl } = fakeFetch([
      { body: { access_token: 'a2', refresh_token: 'r2', expires_in: 3600 } },
    ])
    expect(await amaraAccessToken(impl, NOW)).toBe('a2')
    expect(calls[0]?.url).toContain('grant_type=refresh_token')
  })

  it('asks to sign in again when the refresh is refused', async () => {
    stored = {
      anonKey: 'anon',
      email: 'me@example.com',
      accessToken: '',
      refreshToken: 'dead',
      expiresAt: 0,
    }
    const { impl } = fakeFetch([
      { status: 400, body: { error_description: 'Invalid Refresh Token' } },
    ])
    await expect(amaraAccessToken(impl, NOW)).rejects.toMatchObject({
      needsSignIn: true,
    })
    expect((stored as { refreshToken: string }).refreshToken).toBe('')
  })

  it('sends the clip to /dictation/transcribe with the sign-in and returns the words', async () => {
    stored = {
      anonKey: 'anon',
      email: 'me@example.com',
      accessToken: 'live',
      refreshToken: 'r',
      expiresAt: Date.now() / 1000 + 3600,
    }
    const { calls, impl } = fakeFetch([
      { body: { text: ' Book Keith Ave #5 ' } },
    ])
    const text = await transcribeWithAmara(
      {
        audio: new Blob([new Uint8Array([1, 2, 3])]),
        mime: 'audio/webm',
        seconds: 2.4,
      },
      impl,
    )
    expect(text).toBe('Book Keith Ave #5')
    expect(calls[0]?.url).toBe(`${AMARA_API_URL}/dictation/transcribe`)
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe('Bearer live')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      audio: 'AQID',
      mime: 'audio/webm',
      seconds: 2,
    })
  })

  it('says plainly when Amara turns the mic away', async () => {
    const { impl } = fakeFetch([{ status: 401, body: {} }])
    await expect(
      transcribeWithAmara(
        { audio: new Blob([]), mime: 'audio/webm', seconds: 1 },
        impl,
      ),
    ).rejects.toMatchObject({ needsSignIn: true })
  })
})
