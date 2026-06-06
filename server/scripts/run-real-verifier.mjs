import fs from 'node:fs';
import path from 'node:path';
import { verifyMachineDefinition } from './server/platform/common/state-machine/state-machine-verifier.mjs';

const dir = './server/platform/common/state-machine/definitions';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
for (const f of files) {
  console.log("Checking", f);
  const def = JSON.parse(fs.readFileSync(path.join(dir, f)));
  try {
    const res = verifyMachineDefinition(def, { throwOnError: false, relativePath: f });
    console.log("  OK:", res.ok);
    if (!res.ok) {
        res.checks.filter(c => c.status === 'failed').forEach(c => console.log("  FAIL:", c.id, c.error));
    }
  } catch (e) {
    console.log("  CRASH:", e.message);
  }
}
