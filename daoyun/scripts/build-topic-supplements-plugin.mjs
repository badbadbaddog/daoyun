import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const plugin = resolve(root, "plugins/official-topic-supplements")
const result = spawnSync("cargo", ["build", "--manifest-path", resolve(plugin, "Cargo.toml"), "--target", "wasm32-wasip2", "--release"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
const output = resolve(root, "public/plugins/official-topic-supplements")
mkdirSync(output, { recursive: true })
copyFileSync(resolve(plugin, "target/wasm32-wasip2/release/daoyun_official_topic_supplements.wasm"), resolve(output, "plugin.wasm"))
copyFileSync(resolve(plugin, "plugin.json"), resolve(output, "plugin.json"))
console.log(`Plugin package ready: ${output}`)
