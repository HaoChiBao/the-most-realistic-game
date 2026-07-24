/**
 * Run every scripts/test-*.ts file.
 * Used by `npm test` and CI. Invoke from repo root.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const scriptsDir = path.resolve("scripts");

const files = readdirSync(scriptsDir)
  .filter((f) => f.startsWith("test-") && f.endsWith(".ts"))
  .sort();

if (files.length === 0) {
  console.error("No test-*.ts files found in scripts/");
  process.exit(1);
}

console.log(`Running ${files.length} test files...\n`);

let failed = 0;
for (const file of files) {
  const full = path.join(scriptsDir, file);
  process.stdout.write(`• ${file} ... `);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", full],
    {
      encoding: "utf8",
      env: process.env,
      cwd: path.resolve("."),
    }
  );

  if (result.status === 0) {
    const line = (result.stdout || "").trim().split(/\r?\n/).pop() || "ok";
    console.log(line);
  } else {
    failed++;
    console.log("FAIL");
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(result.error);
  }
}

console.log("");
if (failed > 0) {
  console.error(`${failed}/${files.length} test file(s) failed`);
  process.exit(1);
}
console.log(`All ${files.length} test files passed`);
