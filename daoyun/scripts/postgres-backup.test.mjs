import {mkdtemp,writeFile,rm,mkdir,copyFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join,resolve} from "node:path"
import {spawnSync} from "node:child_process"
import {test} from "vitest"
import assert from "node:assert/strict"

// Controlled tools prove failed backups/restores never echo database credentials.
for (const operation of ["backup", "restore"]) for (const discovery of ["PATH", "installation"]) test.skipIf(process.platform !== "win32")(operation + " hides PostgreSQL diagnostics via " + discovery, async () => {
 const fixture=await mkdtemp(join(tmpdir(),"daoyun-pg-redaction-"))
 try {
  const tool=operation === "backup" ? "pg_dump" : "pg_restore"
  if (discovery === "installation") {
   const bin=join(fixture,"PostgreSQL","16","bin")
   await mkdir(bin,{recursive:true})
   await copyFile(process.execPath,join(bin,tool+".exe"))
  }
  if (discovery === "PATH") await writeFile(join(fixture,tool+".cmd"),"@echo off\r\necho private-credential-fixture 1>&2\r\nexit /b 1\r\n","utf8")
  const backup=join(fixture,"fixture.dump")
  await writeFile(backup,"fixture","utf8")
  const args=["-NoProfile","-NonInteractive","-File",resolve("scripts/"+operation+"-postgres.ps1"), ...(operation === "backup" ? ["-OutputDirectory",join(fixture,"backups")] : ["-BackupFile",backup,"-AllowDataLoss"])]
  const env={...process.env,DATABASE_URL:"postgres://fixture:private-credential-fixture@127.0.0.1:1/isolated"}
  const path=process.env.Path ?? process.env.PATH ?? ""
  for(const key of Object.keys(env)) if(key.toLowerCase() === "path") delete env[key]
  env.Path=discovery === "PATH" ? fixture+";"+path : fixture
  env.PATHEXT=".COM;.EXE;.BAT;.CMD"
  if (discovery === "installation") {
   for (const key of Object.keys(env)) if (key.toLowerCase().startsWith("programfiles")) delete env[key]
   env.ProgramFiles=fixture
  }
  const result=spawnSync("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",args,{encoding:"utf8",windowsHide:true,env})
  assert.notEqual(result.status,0)
  assert.doesNotMatch(result.stdout+result.stderr,/private-credential-fixture/)
  assert.match(result.stdout+result.stderr,/failed/)
 } finally {assert.ok(fixture.startsWith(join(tmpdir(),"daoyun-pg-redaction-"))); await rm(fixture,{recursive:true,force:true})}
})
