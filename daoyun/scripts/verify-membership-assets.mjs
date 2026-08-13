import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export function validateManifest(manifest, levelFiles, medalFiles) {
  if (manifest?.version !== 1) throw new Error("会员资源清单版本不受支持")
  validateEntries(manifest.levels, levelFiles, /^20080719_[A-Za-z0-9]+\.gif$/, "lv_", 20)
  validateEntries(manifest.medals, medalFiles, /^medal(?:[1-9]|1[0-7])\.gif$/, "medal_", 17)
  if (manifest.member_group?.key !== "member" || manifest.member_group?.asset_level_key !== "lv_1") {
    throw new Error("会员用户组清单不正确")
  }
  return true
}

export async function verifyMembershipAssets(root = projectRoot) {
  const base = join(root, "public", "assets", "membership")
  const manifest = JSON.parse(await readFile(join(base, "manifest.json"), "utf8"))
  const levelFiles = await readdir(join(base, "levels"), { withFileTypes: true })
  const medalFiles = await readdir(join(base, "medals"), { withFileTypes: true })
  validateManifest(
    manifest,
    levelFiles.filter((entry) => entry.isFile()).map((entry) => entry.name),
    medalFiles.filter((entry) => entry.isFile()).map((entry) => entry.name),
  )
  await verifyHashes(manifest.levels, join(base, "levels"))
  await verifyHashes(manifest.medals, join(base, "medals"))
  return { levels: manifest.levels.length, medals: manifest.medals.length }
}

function validateEntries(entries, files, filePattern, keyPrefix, expectedCount) {
  if (!Array.isArray(entries) || entries.length !== expectedCount) {
    throw new Error(`${keyPrefix}资源数量必须为 ${expectedCount}`)
  }
  const expectedKeys = Array.from({ length: expectedCount }, (_, index) =>
    keyPrefix === "lv_" ? `lv_${index + 1}` : `medal_${String(index + 1).padStart(2, "0")}`,
  )
  const keys = entries.map((entry) => entry?.key)
  if (new Set(keys).size !== keys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`${keyPrefix}资源键必须连续且不可重复`)
  }
  const manifestFiles = entries.map((entry) => entry?.file)
  if (new Set(manifestFiles).size !== manifestFiles.length || manifestFiles.some((file) => !filePattern.test(file))) {
    throw new Error(`${keyPrefix}资源文件名不合法或重复`)
  }
  const actualFiles = [...files].sort()
  const listedFiles = [...manifestFiles].sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(listedFiles)) {
    throw new Error(`${keyPrefix}资源文件与清单不一致`)
  }
  if (entries.some((entry) => !/^[a-f0-9]{64}$/.test(entry?.sha256 ?? ""))) {
    throw new Error(`${keyPrefix}资源 SHA-256 清单不合法`)
  }
}

async function verifyHashes(entries, directory) {
  for (const entry of entries) {
    const bytes = await readFile(join(directory, entry.file))
    validateGifBytes(bytes, entry.file)
    const actual = createHash("sha256").update(bytes).digest("hex")
    if (actual !== entry.sha256) throw new Error(`资源 SHA-256 不匹配: ${entry.file}`)
  }
}

export function validateGifBytes(bytes, file) {
  const isGif = bytes.length >= 6
    && bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39)
    && bytes[5] === 0x61
  if (!isGif) throw new Error(`资源文件不是 GIF: ${file}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = await verifyMembershipAssets()
    process.stdout.write(`会员资源校验通过：等级 ${result.levels}，勋章 ${result.medals}\n`)
  } catch (error) {
    process.stderr.write(`会员资源校验失败：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
