#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

async function run() {
  const readmeEnPath = path.join(repoRoot, "README.md");
  const readmeZhPath = path.join(repoRoot, "README.zh-CN.md");
  const composePath = path.join(repoRoot, "docker-compose.yml");
  const dockerfilePath = path.join(repoRoot, "Dockerfile");
  const packagePath = path.join(repoRoot, "package.json");
  const serverDocPath = path.join(repoRoot, "docs", "SERVER.md");

  const readmeEn = await fs.readFile(readmeEnPath, "utf8");
  const readmeZh = await fs.readFile(readmeZhPath, "utf8");
  const compose = await fs.readFile(composePath, "utf8");
  const dockerfile = await fs.readFile(dockerfilePath, "utf8");
  const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"));
  const serverDoc = await fs.readFile(serverDocPath, "utf8");

  // 1. 验证 docker-compose.yml 端口
  assert.match(compose, /"7228:7228"/, "docker-compose.yml must map port 7228:7228");
  assert.match(compose, /PACT_SERVER_PORT:\s*7228/, "docker-compose.yml must set PACT_SERVER_PORT: 7228");
  assert.match(compose, /http:\/\/127\.0\.0\.1:7228/, "docker-compose.yml URLs must point to port 7228");

  // 2. 验证 Dockerfile 端口
  assert.match(dockerfile, /PACT_SERVER_PORT=7228/, "Dockerfile must set default PACT_SERVER_PORT=7228");
  assert.match(dockerfile, /EXPOSE\s+7228/, "Dockerfile must EXPOSE port 7228");
  assert.match(dockerfile, /"--port",\s*"7228"/, "Dockerfile CMD must point to port 7228");

  // 3. 验证 package.json engines
  assert.ok(pkg.engines?.node, "package.json must contain engines.node");
  assert.match(pkg.engines.node, /22/, "engines.node must support Node 22");
  assert.match(pkg.engines.node, /24/, "engines.node must support Node 24");

  // 4. 读取其他校验文件
  const usageDocPath = path.join(repoRoot, "docs", "USAGE.md");
  const usageDoc = await fs.readFile(usageDocPath, "utf8");
  const viteConfigPath = path.join(repoRoot, "vite.config.ts");
  const viteConfig = await fs.readFile(viteConfigPath, "utf8");
  const capabilityGapPath = path.join(repoRoot, "docs", "PRODUCTION-CAPABILITY-GAP.md");
  const capabilityGap = await fs.readFile(capabilityGapPath, "utf8");

  // 5. 验证 README.md & README.zh-CN.md 端口及安全警告
  assert.match(readmeEn, /127\.0\.0\.1:7228/, "README.md must point to port 7228");
  assert.match(readmeZh, /127\.0\.0\.1:7228/, "README.zh-CN.md must point to port 7228");
  
  // 检查生产可用性免责声明 (Disclaimer assertions)
  assert.match(readmeEn, /Before the production gates are closed, it is not recommended to claim production readiness/i, "README.md must contain English production readiness disclaimer");
  assert.match(readmeZh, /生产门禁未关闭前不建议对外宣称生产可用/, "README.zh-CN.md must contain Chinese production readiness disclaimer");
  assert.match(serverDoc, /生产门禁未关闭前不建议对外宣称生产可用/, "docs/SERVER.md must contain Chinese production readiness disclaimer");
  assert.match(usageDoc, /生产门禁未关闭前不建议对外宣称生产可用/, "docs/USAGE.md must contain Chinese production readiness disclaimer");
  assert.match(compose, /生产门禁未关闭前不建议对外宣称生产可用/, "docker-compose.yml must contain Chinese production readiness disclaimer");
  assert.match(dockerfile, /生产门禁未关闭前不建议对外宣称生产可用/, "Dockerfile must contain Chinese production readiness disclaimer");
  assert.match(viteConfig, /生产门禁未关闭前不建议对外宣称生产可用/, "vite.config.ts must contain Chinese production readiness disclaimer");
  assert.match(capabilityGap, /生产门禁未关闭前不建议对外宣称生产可用/, "docs/PRODUCTION-CAPABILITY-GAP.md must contain Chinese production readiness disclaimer");

  // 检查五大安全加固要求
  const enHardening = [/HTTPS/i, /reverse proxy/i, /controlled network/i, /secret/i, /audit/i, /backup/i];
  for (const regex of enHardening) {
    assert.match(readmeEn, regex, `README.md is missing safety hardening requirement: ${regex}`);
  }

  const zhHardening = [/HTTPS/, /反向代理/, /受控网段|隔离/, /密钥|凭证/, /审计|Operation Ledger/, /备份/];
  for (const regex of zhHardening) {
    assert.match(readmeZh, regex, `README.zh-CN.md is missing safety hardening requirement: ${regex}`);
    assert.match(serverDoc, regex, `docs/SERVER.md is missing safety hardening requirement: ${regex}`);
    assert.match(usageDoc, regex, `docs/USAGE.md is missing safety hardening requirement: ${regex}`);
    assert.match(compose, regex, `docker-compose.yml is missing safety hardening requirement: ${regex}`);
  }

  // 6. 验证 docs/SERVER.md 的启动命令与 package.json scripts 的存在性
  const npmRunRegex = /npm run ([a-zA-Z0-9:-]+)/g;
  let match;
  const foundScripts = new Set();
  while ((match = npmRunRegex.exec(serverDoc)) !== null) {
    foundScripts.add(match[1]);
  }
  
  for (const script of foundScripts) {
    // 排除 external-kd 或第三方脚本，如果是本项目中调用的 script 则进行检验
    if (script.startsWith("server:") || script === "start:all" || script === "build:renderer" || script.startsWith("composition:") || script.startsWith("client:") || script.startsWith("mcp:")) {
      assert.ok(pkg.scripts[script], `docs/SERVER.md references script '${script}' which is missing in package.json`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    defaultPort: 7228,
    nodeMinimum: "22",
    dockerNodeMajor: "24"
  }));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
