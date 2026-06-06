import fs from 'node:fs';
import path from 'node:path';
import { verifyMachineDefinition } from '../platform/common/state-machine/state-machine-verifier.mjs';

export function runVerifier(definitionsDir, reportsDir) {
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const report = { ok: true, checkedAt: new Date().toISOString(), machines: [] };
  const files = fs.readdirSync(definitionsDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(definitionsDir, file);
    try {
      const def = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const res = verifyMachineDefinition(def, { throwOnError: false, relativePath: file });
      report.machines.push(res);
      if (!res.ok) report.ok = false;
    } catch (err) {
      report.ok = false;
      report.machines.push({ machineId: file, ok: false, error: err.message, completenessLevel: "FAIL" });
    }
  }
  fs.writeFileSync(path.join(reportsDir, 'latest.json'), JSON.stringify(report, null, 2));

  let mdContent = `# State Machine Verification Report\n\nChecked At: ${report.checkedAt}\nStatus: ${report.ok ? '✅ PASS' : '❌ FAIL'}\n\n## Machines\n\n`;
  for (const machine of report.machines) {
    mdContent += `### ${machine.machineId}\n`;
    mdContent += `- OK: ${machine.ok}\n`;
    mdContent += `- Completeness: ${machine.completenessLevel || "FAIL"}\n`;
    if (!machine.ok) {
      mdContent += `- **Errors**:\n`;
      if (machine.checks) {
        for (const check of machine.checks.filter(c => c.status !== 'passed')) {
          mdContent += `  - [${check.id}] ${check.error}\n`;
        }
      } else {
        mdContent += `  - ${machine.error}\n`;
      }
    }
    mdContent += `\n`;
  }
  fs.writeFileSync(path.join(reportsDir, 'latest.md'), mdContent);
  return report;
}

import { fileURLToPath } from "node:url";
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const defs = path.join(process.cwd(), "server/platform/common/state-machine/definitions");
  const reps = path.join(process.cwd(), "build/reports/state-machines");
  const r = runVerifier(defs, reps);
  if (!r.ok) {
    console.error("Verification FAILED");
    process.exit(1);
  }
  console.log("Verification PASSED");
}
