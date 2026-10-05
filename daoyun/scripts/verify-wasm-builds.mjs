import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// Source: https://doc.rust-lang.org/cargo/reference/features.html#inspecting-resolved-features
const cwd = fileURLToPath(new URL("..", import.meta.url))
for (const [name, flags, supported] of [
  ["default", [], false],
  ["base", ["--no-default-features"], false],
  ["wasm", ["--no-default-features", "--features", "wasm-plugins"], true],
]) {
  const result = spawnSync(process.env.CARGO ?? "cargo", [
    "tree", "-p", "daoyun-api", "--locked", "-e", "features", ...flags,
  ], { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  for (const dependency of ["plugin-host", "wasmtime", "wasmtime-wasi"]) {
    assert.equal(result.stdout.includes(dependency + " v"), supported,
      name + " has an unexpected dependency closure: " + dependency)
  }
  console.log(name + ": dependency closure verified")
}
