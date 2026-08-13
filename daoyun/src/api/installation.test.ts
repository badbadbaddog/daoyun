import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getInstallationStatus,
  initializeInstallation,
  InstallationApiError,
} from "./installation"

const fetchMock = vi.fn()
const requestId = "019fc630-0000-7000-8000-000000000002"

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe("getInstallationStatus", () => {
  it("validates and maps the installation status response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { is_initialized: false },
        meta: { request_id: requestId },
      }),
    })

    await expect(getInstallationStatus()).resolves.toEqual({ isInitialized: false })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/installation", {
      headers: { Accept: "application/json" },
      signal: undefined,
    })
  })

  it("rejects a malformed successful response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { is_initialized: "no" }, meta: {} }),
    })

    await expect(getInstallationStatus()).rejects.toThrow("安装状态响应格式无效")
  })
})

describe("initializeInstallation", () => {
  const input = {
    username: "owner",
    email: "owner@example.com",
    displayName: "站点管理员",
    password: "correct horse battery staple",
  }

  it("serializes the request and validates the created administrator", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        data: {
          is_initialized: true,
          administrator: {
            id: "019fc630-0000-7000-8000-000000000001",
            username: "owner",
            email: "owner@example.com",
            display_name: "站点管理员",
          },
        },
        meta: { request_id: requestId },
      }),
    })

    await expect(initializeInstallation(input)).resolves.toEqual({
      isInitialized: true,
      administrator: {
        id: "019fc630-0000-7000-8000-000000000001",
        username: "owner",
        email: "owner@example.com",
        displayName: "站点管理员",
      },
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/installation", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "owner",
        email: "owner@example.com",
        display_name: "站点管理员",
        password: "correct horse battery staple",
      }),
      signal: undefined,
    })
  })

  it("retains structured field errors from a validation response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: "request.validation_failed",
          message: "请求字段校验失败",
          fields: {
            username: ["用户名格式不正确"],
            password: ["密码至少需要 6 个字符"],
          },
        },
        meta: { request_id: requestId },
      }),
    })

    const error = await initializeInstallation(input).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(InstallationApiError)
    expect(error).toMatchObject({
      status: 422,
      code: "request.validation_failed",
      message: "请求字段校验失败",
      fields: {
        username: ["用户名格式不正确"],
        password: ["密码至少需要 6 个字符"],
      },
    })
  })

  it("rejects malformed error and success envelopes", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: { message: "missing code" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ data: { is_initialized: true }, meta: { request_id: requestId } }),
      })

    await expect(initializeInstallation(input)).rejects.toMatchObject({
      status: 503,
      code: "response.invalid",
    })
    await expect(initializeInstallation(input)).rejects.toThrow("安装响应格式无效")
  })

  it("rejects invalid administrator fields in a successful envelope", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        data: {
          is_initialized: true,
          administrator: {
            id: "019fc630-0000-7000-8000-000000000001",
            username: "Owner",
            email: "owner@example.com",
            display_name: "站点管理员",
          },
        },
        meta: { request_id: requestId },
      }),
    })

    await expect(initializeInstallation(input)).rejects.toThrow("安装响应格式无效")
  })

  it("rejects empty field-message arrays in an error envelope", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: "request.validation_failed",
          message: "请求字段校验失败",
          fields: { username: [] },
        },
        meta: { request_id: requestId },
      }),
    })

    await expect(initializeInstallation(input)).rejects.toMatchObject({
      status: 422,
      code: "response.invalid",
    })
  })
})
