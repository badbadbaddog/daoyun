import { afterEach, describe, expect, it, vi } from "vitest"

import {
  changePassword,
  bindOidcClaim,
  createOidcClaimAccount,
  createRecentAuthentication,
  getOidcClaim,
  getCurrentSession,
  listDeviceSessions,
  listExternalIdentities,
  listOidcProviders,
  listPasskeys,
  login,
  logout,
  register,
  revokeDeviceSession,
  startPasskeyAssertion,
  startPasskeyRegistration,
  deletePasskey,
  verifyPasskeyAssertion,
  verifyPasskeyRegistration,
  startOidcIdentityBinding,
  startOidcIdentityReplacement,
  unlinkExternalIdentity,
} from "./auth"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("auth API client", () => {
  it("maps the authenticated session envelope and sends credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        user: {
          id: "019fc700-0000-7000-8000-000000000004",
          username: "member",
          email: "member@example.com",
          display_name: "社区成员",
        },
        csrf_token: "a".repeat(64),
      },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(getCurrentSession()).resolves.toEqual({
      user: {
        id: "019fc700-0000-7000-8000-000000000004",
        username: "member",
        email: "member@example.com",
        displayName: "社区成员",
      },
      csrfToken: "a".repeat(64),
    })
    expect(fetch).toHaveBeenCalledWith("/api/v1/auth/session", expect.objectContaining({
      credentials: "include",
    }))
  })

  it("treats a 401 session response as signed out", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "auth.unauthenticated",
        message: "当前请求未通过身份认证",
      },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 401, headers: { "Content-Type": "application/json" } }))

    await expect(getCurrentSession()).resolves.toBeNull()
  })

  it("posts registration fields in the server contract and returns auth data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        user: {
          id: "019fc700-0000-7000-8000-000000000004",
          username: "member",
          email: "member@example.com",
          display_name: "社区成员",
        },
        csrf_token: "b".repeat(64),
      },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }))

    await expect(register({
      username: "member",
      email: "member@example.com",
      displayName: "社区成员",
      password: "correct horse battery staple",
    })).resolves.toMatchObject({ csrfToken: "b".repeat(64) })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/register", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        username: "member",
        email: "member@example.com",
        display_name: "社区成员",
        password: "correct horse battery staple",
      }),
    }))
  })

  it("maps server field errors without accepting malformed envelopes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "request.validation_failed",
        message: "请求参数校验失败",
        fields: { password: ["密码长度不正确"] },
      },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 422, headers: { "Content-Type": "application/json" } }))

    await expect(login({ identifier: "member", password: "short" })).rejects.toEqual(
      expect.objectContaining({
        status: 422,
        code: "request.validation_failed",
        fields: { password: ["密码长度不正确"] },
      }),
    )
  })

  it("sends the CSRF header when logging out", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: { logged_out: true },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(logout("c".repeat(64))).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/logout", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "c".repeat(64) }),
    }))
  })

  it("creates recent authentication for the fixed security operation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        authenticated: true,
        expires_at: "2026-08-08T12:10:00Z",
      },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(createRecentAuthentication(
      "correct horse battery staple",
      "e".repeat(64),
    )).resolves.toEqual({
      authenticated: true,
      expiresAt: "2026-08-08T12:10:00Z",
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/recent-auth", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "e".repeat(64) }),
      body: JSON.stringify({
        operation: "security.settings",
        password: "correct horse battery staple",
      }),
    }))
  })

  it("changes the password and returns the rotated CSRF token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: { csrf_token: "f".repeat(64) },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(changePassword(
      "new secure password",
      "e".repeat(64),
    )).resolves.toBe("f".repeat(64))
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/password", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "e".repeat(64) }),
      body: JSON.stringify({ new_password: "new secure password" }),
    }))
  })

  it("maps passkey options and protects registration with CSRF", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        challenge_id: "019fc700-0000-7000-8000-000000000009",
        options: {
          challenge: "challenge",
          rp: { id: "127.0.0.1", name: "DaoYun" },
          user: { id: "user", name: "member", displayName: "社区成员" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          excludeCredentials: [],
          timeout: 60000,
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "preferred",
            userVerification: "required",
          },
          attestation: "none",
        },
      },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(startPasskeyRegistration("j".repeat(64))).resolves.toMatchObject({
      challengeId: "019fc700-0000-7000-8000-000000000009",
      options: { user: { displayName: "社区成员" } },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/passkeys/registration/options",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "x-csrf-token": "j".repeat(64) }),
      }),
    )
  })

  it("lists and deletes passkeys with the server summary contract", async () => {
    const passkeyId = "019fc700-0000-7000-8000-000000000010"
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: passkeyId,
          created_at: "2026-08-08T10:00:00Z",
          last_used_at: null,
        }],
        meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { deleted: true, csrf_token: "b".repeat(64) },
        meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(listPasskeys()).resolves.toEqual([{
      id: passkeyId,
      createdAt: "2026-08-08T10:00:00Z",
      lastUsedAt: null,
    }])
    await expect(deletePasskey(passkeyId, "e".repeat(64))).resolves.toBe("b".repeat(64))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/v1/auth/passkeys/${passkeyId}`, expect.objectContaining({
      method: "DELETE",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "e".repeat(64) }),
    }))
  })

  it("encodes browser attestation buffers as base64url for registration verification", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        credential: {
          id: "019fc700-0000-7000-8000-000000000011",
          created_at: "2026-08-08T10:00:00Z",
          last_used_at: null,
        },
        csrf_token: "c".repeat(64),
      },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 201, headers: { "Content-Type": "application/json" } }))

    const credential = {
      id: "credential-id",
      response: {
        attestationObject: new Uint8Array([251, 239, 190]).buffer,
        clientDataJSON: new Uint8Array([123, 125]).buffer,
        getTransports: () => ["internal"],
      },
    } as unknown as PublicKeyCredential
    await expect(verifyPasskeyRegistration(
      "019fc700-0000-7000-8000-000000000009",
      credential,
      "f".repeat(64),
    )).resolves.toMatchObject({ csrfToken: "c".repeat(64) })
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      attestationObject: "----",
      clientDataJSON: "e30",
      transports: ["internal"],
    })
  })

  it("encodes browser assertion buffers without sending a CSRF header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: {
        user: {
          id: "019fc700-0000-7000-8000-000000000004",
          username: "member",
          email: "member@example.com",
          display_name: "社区成员",
        },
        csrf_token: "d".repeat(64),
      },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    const credential = {
      id: "credential-id",
      response: {
        authenticatorData: new Uint8Array([0, 1, 2]).buffer,
        signature: new Uint8Array([251, 239, 190]).buffer,
        clientDataJSON: new Uint8Array([123, 125]).buffer,
        userHandle: null,
      },
    } as unknown as PublicKeyCredential
    await expect(verifyPasskeyAssertion(
      "019fc700-0000-7000-8000-000000000009",
      credential,
    )).resolves.toMatchObject({ csrfToken: "d".repeat(64) })
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(request.headers).toEqual(expect.objectContaining({
      Accept: "application/json",
      "Content-Type": "application/json",
    }))
    expect(request.headers).not.toHaveProperty("x-csrf-token")
    expect(JSON.parse(String(request.body))).toMatchObject({
      authenticatorData: "AAEC",
      signature: "----",
      clientDataJSON: "e30",
      userHandle: null,
    })
  })

  it("maps device sessions and revokes another session with CSRF protection", async () => {
    const sessionId = "019fc700-0000-7000-8000-000000000006"
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: sessionId,
          device_label: "Windows 设备",
          created_at: "2026-08-07T10:00:00Z",
          last_seen_at: "2026-08-07T10:30:00Z",
          is_current: false,
        }],
        meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { revoked: true },
        meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(listDeviceSessions()).resolves.toEqual([{
      id: sessionId,
      deviceLabel: "Windows 设备",
      createdAt: "2026-08-07T10:00:00Z",
      lastSeenAt: "2026-08-07T10:30:00Z",
      isCurrent: false,
    }])
    await expect(revokeDeviceSession(sessionId, "d".repeat(64))).resolves.toBe(true)
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/auth/sessions", expect.objectContaining({
      credentials: "include",
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/v1/auth/sessions/${sessionId}`, expect.objectContaining({
      method: "DELETE",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "d".repeat(64) }),
    }))
  })

  it("unlinks an external identity with CSRF protection and returns the rotated token", async () => {
    const identityId = "019fc700-0000-7000-8000-000000000007"
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: { unlinked: true, csrf_token: "a".repeat(64) },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(unlinkExternalIdentity(identityId, "h".repeat(64))).resolves.toBe("a".repeat(64))
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/auth/identities/${identityId}/unlink`, expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "h".repeat(64) }),
    }))
  })

  it("maps external identities and starts protected OIDC binding or replacement authorization", async () => {
    const identityId = "019fc700-0000-7000-8000-000000000008"
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: identityId,
          provider_key: "google",
          created_at: "2026-08-08T10:00:00Z",
          last_authenticated_at: "2026-08-08T10:05:00Z",
        }],
        meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { authorization_url: "https://accounts.example.com/oauth2/authorize?state=state" },
        meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { authorization_url: "https://accounts.example.com/oauth2/authorize?state=replacement" },
        meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(listExternalIdentities()).resolves.toEqual([{
      id: identityId,
      providerKey: "google",
      createdAt: "2026-08-08T10:00:00Z",
      lastAuthenticatedAt: "2026-08-08T10:05:00Z",
    }])
    await expect(startOidcIdentityBinding("google", "a".repeat(64))).resolves.toBe(
      "https://accounts.example.com/oauth2/authorize?state=state",
    )
    await expect(startOidcIdentityReplacement(
      "google",
      identityId,
      "a".repeat(64),
    )).resolves.toBe("https://accounts.example.com/oauth2/authorize?state=replacement")

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/auth/identities", expect.objectContaining({
      credentials: "include",
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/auth/oidc/google/bindings", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "a".repeat(64) }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/v1/auth/oidc/google/bindings/${identityId}/replacement`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "x-csrf-token": "a".repeat(64) }),
      }),
    )
  })

  it("maps only public OIDC provider metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [
        { provider_key: "google", display_name: "Google" },
        { provider_key: "github", display_name: "GitHub" },
      ],
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    await expect(listOidcProviders()).resolves.toEqual([
      { providerKey: "google", displayName: "Google" },
      { providerKey: "github", displayName: "GitHub" },
    ])
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/providers", expect.objectContaining({
      credentials: "include",
    }))
  })

  it("keeps the verified OIDC claim cookie-only while creating or binding an account", async () => {
    const sessionPayload = {
      data: {
        user: {
          id: "019fc700-0000-7000-8000-000000000004",
          username: "member",
          email: "member@example.com",
          display_name: "社区成员",
        },
        csrf_token: "a".repeat(64),
      },
      meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
    }
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          provider_key: "google",
          provider_display_name: "Google",
          profile_name: "社区成员",
          preferred_username: "member",
          email_hint: "m***@example.com",
        },
        meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(sessionPayload), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { bound: true, csrf_token: "b".repeat(64) },
        meta: { request_id: "019fc700-0000-7000-8000-000000000005" },
      }), { status: 200 }))

    await expect(getOidcClaim()).resolves.toEqual({
      providerKey: "google",
      providerDisplayName: "Google",
      profileName: "社区成员",
      preferredUsername: "member",
      emailHint: "m***@example.com",
    })
    await expect(createOidcClaimAccount({
      username: "member",
      email: "member@example.com",
      displayName: "社区成员",
      password: "correct horse battery staple",
    })).resolves.toMatchObject({ csrfToken: "a".repeat(64) })
    await expect(bindOidcClaim("a".repeat(64))).resolves.toEqual({ csrfToken: "b".repeat(64) })
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/auth/oidc/claim", expect.objectContaining({
      credentials: "include",
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/auth/oidc/claim/account", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        username: "member",
        email: "member@example.com",
        display_name: "社区成员",
        password: "correct horse battery staple",
      }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/auth/oidc/claim/bind", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({ "x-csrf-token": "a".repeat(64) }),
    }))
  })
})
