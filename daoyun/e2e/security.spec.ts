import { expect, test } from "@playwright/test"

test("API responses keep the baseline security headers", async ({ request }) => {
  const apiURL = process.env.DAOYUN_API_URL ?? "http://127.0.0.1:3000"
  let response
  try {
    response = await request.get(`${apiURL}/api/v1/health/live`)
  } catch {
    test.skip(true, "set DAOYUN_API_URL to run the live API security regression")
    return
  }

  expect(response.status()).toBe(200)
  const headers = response.headers()
  expect(headers["x-content-type-options"]).toBe("nosniff")
  expect(headers["x-frame-options"]).toBe("DENY")
  expect(headers["referrer-policy"]).toBe("no-referrer")
  expect(headers["content-security-policy"]).toContain("default-src 'none'")
  expect(headers["permissions-policy"]).toContain("camera=()")
})
