import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  recoverBackgroundSupervisor,
  recoverSystemInspection,
  supervisorLaunchAgentTargets,
  systemInspectionLaunchAgentTargets
} from "../../../server/platform/common/devops/supervisor-recovery/supervisor-recovery.mjs";
import {
  decodeMimeEncodedWords,
  extractEmailHeaderValue,
  extractReadableEmailText,
  stripHtmlToReadableText,
  stripUrlNoise
} from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/mail-readable-text.mjs";
import {
  getExpertVocabularyPath,
  getExpertVocabularySummary,
  listExpertVocabularyVersions,
  loadExpertVocabulary,
  saveExpertVocabulary
} from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/expert-vocabulary.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

async function withTempRoot(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-supervisor-mail-vocabulary-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("supervisor recovery final extra coverage", () => {
  it("normalizes launch agent targets and returns early for running or unsupported services", async () => {
    expect(supervisorLaunchAgentTargets({
      uid: "501",
      homeDir: "/Users/unit",
      serviceLabel: "  unit.supervisor  "
    })).toMatchObject({
      serviceLabel: "unit.supervisor",
      uid: 501,
      launchTarget: "gui/501",
      serviceTarget: "gui/501/unit.supervisor",
      plistPath: "/Users/unit/Library/LaunchAgents/unit.supervisor.plist"
    });
    expect(systemInspectionLaunchAgentTargets({
      uid: "bad",
      homeDir: "/Users/unit",
      serviceLabel: ""
    }).serviceLabel).toBe("dev.pact.system-inspection");

    await expect(recoverBackgroundSupervisor({
      backgroundStatus: { supervisor: { alive: true } },
      platform: "linux"
    })).resolves.toMatchObject({
      ok: true,
      attempted: false,
      reason: "already_running"
    });
    await expect(recoverSystemInspection({
      backgroundStatus: {
        processes: [{ role: "system-inspection", alive: true, status: "running" }]
      },
      platform: "linux"
    })).resolves.toMatchObject({
      ok: true,
      attempted: false,
      reason: "already_running"
    });
    await expect(recoverBackgroundSupervisor({
      backgroundStatus: {},
      platform: "linux"
    })).resolves.toMatchObject({
      ok: false,
      attempted: false,
      reason: "unsupported_platform",
      platform: "linux"
    });
  });

  it("covers missing plist, kickstart success, bootstrap failures, and retry paths", async () => {
    await expect(recoverSystemInspection({
      platform: "darwin",
      processItem: { alive: false },
      fileExists: vi.fn(async () => false),
      uid: 501,
      serviceLabel: "unit.service",
      plistPath: "/tmp/unit.plist"
    })).resolves.toMatchObject({
      ok: false,
      attempted: false,
      reason: "plist_missing",
      plistPath: "/tmp/unit.plist"
    });

    const successRunCommand = vi.fn(async () => ({ code: 0, stdout: "started\n", stderr: "" }));
    await expect(recoverBackgroundSupervisor({
      platform: "darwin",
      fileExists: vi.fn(async () => true),
      runCommand: successRunCommand,
      launchctlPath: "/bin/launchctl-test",
      uid: 501,
      serviceLabel: "unit.service",
      plistPath: "/tmp/unit.plist"
    })).resolves.toMatchObject({
      ok: true,
      attempted: true,
      action: "kickstart",
      commands: [{ args: ["kickstart", "-k", "gui/501/unit.service"], code: 0 }]
    });
    expect(successRunCommand).toHaveBeenCalledWith("/bin/launchctl-test", [
      "kickstart",
      "-k",
      "gui/501/unit.service"
    ]);

    const failedBootstrap = vi
      .fn()
      .mockResolvedValueOnce({ code: 7, stdout: "", stderr: "kickstart failed" })
      .mockResolvedValueOnce({ code: 9, stdout: "", stderr: "bootstrap denied" });
    await expect(recoverBackgroundSupervisor({
      platform: "darwin",
      fileExists: vi.fn(async () => true),
      runCommand: failedBootstrap,
      uid: 501,
      serviceLabel: "unit.service",
      plistPath: "/tmp/unit.plist"
    })).resolves.toMatchObject({
      ok: false,
      attempted: true,
      reason: "bootstrap_failed",
      commands: [
        { args: ["kickstart", "-k", "gui/501/unit.service"], code: 7 },
        { args: ["bootstrap", "gui/501", "/tmp/unit.plist"], code: 9 }
      ]
    });

    const alreadyLoadedThenFailed = vi
      .fn()
      .mockResolvedValueOnce({ code: 7, stdout: "", stderr: "kickstart failed" })
      .mockResolvedValueOnce({ code: 5, stdout: "", stderr: "Bootstrap failed: 5: already loaded" })
      .mockResolvedValueOnce({ code: 8, stdout: "", stderr: "still failed" });
    await expect(recoverBackgroundSupervisor({
      platform: "darwin",
      fileExists: vi.fn(async () => true),
      runCommand: alreadyLoadedThenFailed,
      uid: 501,
      serviceLabel: "unit.service",
      plistPath: "/tmp/unit.plist"
    })).resolves.toMatchObject({
      ok: false,
      attempted: true,
      action: "kickstart_failed",
      reason: "kickstart_failed",
      commands: [
        { args: ["kickstart", "-k", "gui/501/unit.service"], code: 7 },
        { args: ["bootstrap", "gui/501", "/tmp/unit.plist"], code: 5 },
        { args: ["kickstart", "-k", "gui/501/unit.service"], code: 8 }
      ]
    });
  });

  it("uses filesystem detection and the built-in command runner", async () => {
    await withTempRoot(async (root) => {
      const missingPlist = path.join(root, "missing.plist");
      await expect(recoverBackgroundSupervisor({
        platform: "darwin",
        uid: 501,
        serviceLabel: "unit.missing",
        plistPath: missingPlist
      })).resolves.toMatchObject({
        ok: false,
        attempted: false,
        reason: "plist_missing",
        plistPath: missingPlist
      });

      const plistPath = path.join(root, "unit.plist");
      const launchctlStub = path.join(root, "launchctl-stub.sh");
      await fs.writeFile(plistPath, "<plist />", "utf8");
      await fs.writeFile(launchctlStub, [
        "#!/bin/sh",
        "echo launchctl-stdout",
        "echo launchctl-stderr >&2",
        "exit 0"
      ].join("\n"), { mode: 0o755 });

      await expect(recoverBackgroundSupervisor({
        platform: "darwin",
        launchctlPath: launchctlStub,
        uid: 501,
        serviceLabel: "unit.service",
        plistPath
      })).resolves.toMatchObject({
        ok: true,
        attempted: true,
        action: "kickstart",
        commands: [{
          args: ["kickstart", "-k", "gui/501/unit.service"],
          code: 0,
          stdout: "launchctl-stdout",
          stderr: "launchctl-stderr"
        }]
      });
    });
  });
});

describe("mail readable text final extra coverage", () => {
  it("decodes headers, html text, url noise, and nested multipart messages", () => {
    expect(decodeMimeEncodedWords("=?UTF-8?Q?Hello_=E2=9C=93?= =?UTF-8?B?IFdvcmxk?=")).toBe("Hello ✓  World");
    expect(stripHtmlToReadableText("<style>x</style><p>Hello&nbsp;<img alt=\"diagram\">&amp; team</p>")).toBe(
      "Hello diagram & team"
    );
    expect(stripUrlNoise("Read https://example.com?a=1 mailto:test@example.com token=secret keep").replace(/\s+/g, " ").trim()).toBe(
      "Read keep"
    );

    const raw = [
      "Subject: =?UTF-8?B?5rWL6K+V?=",
      "From: Alice <alice@example.com>",
      "To: Bob <bob@example.com>",
      "Content-Type: multipart/mixed; boundary=\"outer\"",
      "",
      "--outer",
      "Content-Type: multipart/alternative; boundary=\"inner\"",
      "",
      "--inner",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Plain=20body=20https://noise.example/path?token=abc",
      "--inner",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>HTML <b>body</b></p>",
      "--inner--",
      "--outer",
      "Content-Type: application/pdf",
      "Content-Disposition: attachment",
      "",
      "ignored attachment",
      "--outer--"
    ].join("\r\n");

    expect(extractEmailHeaderValue(raw, "Subject")).toBe("测试");
    expect(extractReadableEmailText(raw)).toContain("Plain body");
    expect(extractReadableEmailText(raw)).not.toContain("https://noise.example");
    expect(extractReadableEmailText(raw, { includeHeaders: false, removeUrlNoise: false })).toContain(
      "https://noise.example/path?token"
    );
  });

  it("falls back from invalid base64 and depth-limited multipart bodies", () => {
    const raw = [
      "Subject: Broken",
      "Content-Type: multipart/mixed; boundary=\"b0\"",
      "",
      "--b0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      "a",
      "--b0--"
    ].join("\n");
    expect(extractReadableEmailText(raw)).toContain("Broken");
    expect(extractReadableEmailText(raw)).toContain("Content-Type: text/plain");
    expect(extractReadableEmailText("No headers but <p>fallback body</p>", { includeHeaders: false })).toBe("");
  });
});

describe("expert vocabulary final extra coverage", () => {
  it("seeds, normalizes, summarizes, saves, and lists history versions", async () => {
    await withTempRoot(async (root) => {
      expect(getExpertVocabularyPath(root)).toBe(path.join(root, "rules", "expert-vocabulary.json"));

      const seeded = await loadExpertVocabulary(root);
      expect(seeded.schemaVersion).toBe(1);
      expect(seeded.entries.length).toBeGreaterThan(0);

      const saved = await saveExpertVocabulary(root, {
        source: "unit-source",
        entries: [
          {
            path: "Sales / Renewal",
            label: "",
            terms: ["Renewal", "renewal", ""],
            emailDomains: ["@Example.COM/path", "https://Vendor.test/root", ""],
            status: "invalid",
            notes: "  keep note  "
          },
          {
            categoryPath: "  ",
            keywords: ["ignored"]
          }
        ]
      });

      expect(saved).toMatchObject({
        source: "unit-source",
        version: seeded.version + 1,
        entries: [
          {
            pathSegments: ["Sales", "Renewal"],
            label: "Renewal",
            keywords: ["Renewal"],
            domains: ["example.com", "vendor.test"],
            status: "active",
            notes: "keep note"
          }
        ]
      });

      const summary = await getExpertVocabularySummary(root);
      expect(summary).toMatchObject({
        path: getExpertVocabularyPath(root),
        schemaVersion: 1,
        version: saved.version,
        entryCount: 1,
        activeEntryCount: 1,
        checksum: saved.checksum
      });

      const versions = await listExpertVocabularyVersions(root);
      expect(versions.current.version).toBe(saved.version);
      expect(versions.history.length).toBeGreaterThanOrEqual(1);
      expect(versions.history[0]).toMatchObject({
        version: seeded.version,
        path: expect.stringContaining("expert-vocabulary.v")
      });
    });
  });
});
