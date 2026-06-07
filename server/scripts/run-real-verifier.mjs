import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMachineDefinition } from '../platform/common/state-machine/state-machine-verifier.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const dir = path.join(repoRoot, 'server/platform/common/state-machine/definitions');

if (!fs.existsSync(dir)) {
  console.error(`Definitions directory not found: ${dir}`);
  process.exit(1);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
if (files.length === 0) {
  console.warn(`No JSON definition files found in ${dir}`);
}

let anyFailed = false;
for (const f of files) {
  console.log("Checking", f);
  try {
    const def = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    const res = verifyMachineDefinition(def, { throwOnError: false, relativePath: f });
    console.log("  OK:", res.ok);
    if (!res.ok) {
      anyFailed = true;
      res.checks.filter(c => c.status === 'failed').forEach(c => console.log("  FAIL:", c.id, c.error));
    }
  } catch (e) {
    anyFailed = true;
    console.log("  CRASH:", e.message);
  }
}
if (anyFailed) process.exitCode = 1;
