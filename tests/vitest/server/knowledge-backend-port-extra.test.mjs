import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
  createKnowledgeBackendPort,
  isKnowledgeBackendEvidenceId,
  knowledgeBackendConfigPath,
} from "../../../server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function withTempPort(testCase) {
  const userDataPath = await tempDir("pact-knowledge-backend-port-");
  const port = createKnowledgeBackendPort({ userDataPath });
  try {
    return await testCase({ port, userDataPath });
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("knowledge-backend port extra coverage", () => {
  it("bootstraps default providers, config, ledger, and helper exports", async () => {
    await withTempPort(async ({ port, userDataPath }) => {
      expect(port.protocolVersion).toBe(KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION);
      expect(port.configPath).toBe(knowledgeBackendConfigPath(userDataPath));
      expect(port.ledgerPath).toBe(path.join(userDataPath, "knowledge", "knowledge-backend-ledger.json"));
      expect(isKnowledgeBackendEvidenceId("knowledge_backend_evidence::abc123")).toBe(true);
      expect(isKnowledgeBackendEvidenceId("evidence::abc123")).toBe(false);

      const manifest = await port.manifest();
      expect(manifest).toMatchObject({
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        configPath: knowledgeBackendConfigPath(userDataPath),
        providerCount: 2,
        enabledProviderCount: 2,
        secretPolicy: "secretRefOnly",
        contractMode: true,
      });
      expect(manifest.providers.dify).toMatchObject({
        provider: "dify",
        enabled: true,
        mode: "contract",
        authType: "apiKey",
        secretRef: "secret://pact/knowledge/dify-api-key",
        endpointRef: "config://pact/knowledge/dify-endpoint",
        retrievalModes: [{ value: "backendContract", label: "Backend Contract" }],
        contractVerified: true,
      });
      expect(manifest.providers.ragflow).toMatchObject({
        provider: "ragflow",
        enabled: true,
        mode: "contract",
        secretRef: "secret://pact/knowledge/ragflow-api-key",
        contractVerified: true,
      });

      await expect(fs.stat(port.configPath)).resolves.toBeTruthy();

      const permission = await port.requestPermission({
        provider: "dify",
        requestedAccessMode: "copyToContext",
        requestedEgress: "evidenceRead",
      }, {
        subject: {
          subjectId: "bootstrapper",
        },
        workspaceId: "default",
      });

      expect(permission).toMatchObject({
        ok: true,
        provider: "dify",
        status: "pending",
      });
      await expect(fs.stat(port.ledgerPath)).resolves.toBeTruthy();

      const config = await readJson(port.configPath);
      expect(config.protocolVersion).toBe(KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION);
      expect(config.providers.dify.provider).toBe("dify");
      expect(config.providers.ragflow.provider).toBe("ragflow");

      const ledger = await readJson(port.ledgerPath);
      expect(ledger.protocolVersion).toBe(KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION);
      expect(ledger.evidence).toEqual({});
      expect(Object.keys(ledger.permissionRequests)).toEqual([permission.permissionRequestId]);
      expect(ledger.exportRequests).toEqual({});
      expect(ledger.events).toHaveLength(1);
      expect(ledger.events[0].type).toBe("knowledge.permission.request");
    });
  });

  it("merges missing providers and filters unsupported provider views", async () => {
    await withTempPort(async ({ port, userDataPath }) => {
      await writeJson(port.configPath, {
        schemaVersion: 1,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        updatedAt: "2026-06-04T00:00:00.000Z",
        providers: {
          dify: {
            provider: "dify",
            enabled: false,
            mode: "live",
            authType: "apiKey",
            secretRef: "secret://pact/knowledge/custom-dify",
            endpointRef: "https://dify.example",
            datasetPort: false,
            retrievalPort: true,
            evidencePort: false,
            exportPort: false,
            capabilities: ["search", "search", "backend.connect"],
            searchModes: [
              { value: "hybrid_search", label: "Hybrid Search" },
              { value: "hybrid_search", label: "Duplicate Hybrid Search" },
              { id: "semantic_search", title: "Semantic Search" },
            ],
            contractSpaces: [
              {
                spaceRef: "dify-custom-space",
                label: "Dify Custom Space",
                description: "Custom fixture",
                dataClass: "internal",
                sensitivity: "normal",
              },
            ],
          },
          box: {
            provider: "box",
            enabled: true,
            mode: "contract",
          },
        },
      });

      const manifest = await port.manifest();
      expect(manifest.providerCount).toBe(2);
      expect(manifest.enabledProviderCount).toBe(1);
      expect(manifest.providers).not.toHaveProperty("box");
      expect(manifest.providers.dify.retrievalModes).toEqual([
        { value: "hybrid_search", label: "Hybrid Search" },
        { value: "semantic_search", label: "Semantic Search" },
      ]);
      expect(manifest.providers.ragflow.retrievalModes).toEqual([
        { value: "backendContract", label: "Backend Contract" },
      ]);
      expect(manifest.contractMode).toBe(true);

      const boxedSpaces = await port.listSpaces({ provider: "box" });
      expect(boxedSpaces).toMatchObject({
        ok: true,
        count: 0,
        spaces: [],
        metadataPolicy: "safeMetadataOnly",
      });

      const ragflowSpaces = await port.listSpaces({ provider: "rag-flow" });
      expect(ragflowSpaces.count).toBe(1);
      expect(ragflowSpaces.spaces[0]).toMatchObject({
        provider: "ragflow",
        metadataOnly: true,
        contractVerified: true,
      });

      const config = await readJson(port.configPath);
      expect(config.providers.dify.enabled).toBe(false);
      expect(config.providers.ragflow.provider).toBe("ragflow");
      expect(config.providers.box.provider).toBe("box");
      expect(config.updatedAt).not.toBe("2026-06-04T00:00:00.000Z");
    });
  });

  it("rejects inline secrets and unsupported providers, then records live connections and permissions", async () => {
    await withTempPort(async ({ port }) => {
      await writeJson(port.configPath, {
        schemaVersion: 1,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        updatedAt: "2026-06-04T00:00:00.000Z",
        providers: {
          dify: {
            provider: "dify",
            enabled: true,
            mode: "contract",
            authType: "apiKey",
            secretRef: "",
            endpointRef: "config://pact/knowledge/dify-endpoint",
            datasetPort: true,
            retrievalPort: true,
            evidencePort: true,
            exportPort: true,
            capabilities: ["search"],
            contractSpaces: [
              {
                spaceRef: "dify-contract-handbook",
                label: "Dify Contract Handbook",
              },
            ],
          },
        },
      });

      await expect(port.connect({
        provider: "dify",
        apiKey: "inline-secret-value",
      })).rejects.toMatchObject({
        code: "INLINE_SECRET_VALUE",
      });

      await expect(port.connect({
        provider: "box",
        secretRef: "secret://pact/knowledge/box",
      })).rejects.toMatchObject({
        code: "UNSUPPORTED_PROVIDER",
      });

      await expect(port.connect({
        provider: "dify",
      })).rejects.toMatchObject({
        code: "SECRET_REF_REQUIRED",
      });

      const connected = await port.connect({
        provider: "dify",
        secretRef: "secret://pact/knowledge/dify-live",
        endpointRef: "https://dify.live.example",
        mode: "live",
      });

      expect(connected.provider).toMatchObject({
        provider: "dify",
        enabled: true,
        mode: "live",
        secretRef: "secret://pact/knowledge/dify-live",
        endpointRef: "https://dify.live.example",
      });
      expect(connected.contractVerified).toBe(false);
      expect(connected.secretPolicy).toBe("secretRefOnly");
      expect(JSON.stringify(connected)).not.toContain("inline-secret-value");

      const permission = await port.requestPermission({
        provider: "dify",
        requestedAccessMode: "copyToContext",
        requestedEgress: "evidenceRead",
        reason: "Need broader access",
      });

      expect(permission).toMatchObject({
        ok: true,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        provider: "dify",
        requestedAccessMode: "copyToContext",
        requestedEgress: "evidenceRead",
        status: "pending",
        contractVerified: false,
      });
      expect(permission.permissionRequestId).toMatch(/^knowledge_permission_request::/u);

      const ledger = await readJson(port.ledgerPath);
      expect(ledger.events.map((event) => event.type)).toEqual([
        "knowledge.backend.connect",
        "knowledge.permission.request",
      ]);
      expect(ledger.permissionRequests[permission.permissionRequestId]).toMatchObject({
        provider: "dify",
        status: "pending",
        requestedEgress: "evidenceRead",
      });
    });
  });

  it("searches and resolves evidence with allow and deny branches", async () => {
    await withTempPort(async ({ port }) => {
      const subject = {
        subjectId: "agent-123",
        username: "agent-123",
      };

      const limitedSearch = await port.search({
        query: "alpha",
        limit: 0,
      }, {
        subject,
        workspaceId: "default",
      });

      expect(limitedSearch).toMatchObject({
        ok: true,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        query: "alpha",
        backendPort: "KnowledgeBasePort",
        metadataPolicy: "safeMetadataOnly",
        externalKnowledgeBase: {
          used: true,
          mode: "contract",
          contractVerified: true,
        },
      });
      expect(limitedSearch.providers).toEqual(["dify", "ragflow"]);
      expect(limitedSearch.count).toBe(1);
      expect(limitedSearch.items).toHaveLength(1);
      expect(limitedSearch.accessDecisions[0]).toMatchObject({
        allowed: true,
        accessMode: "metadataOnly",
      });
      expect(limitedSearch.items[0]).toMatchObject({
        provider: "dify",
        metadataOnly: true,
        contractVerified: true,
        source: {
          kind: "externalKnowledgeBackend",
        },
      });

      const expandedSearch = await port.search({
        query: "alpha",
        limit: 99,
      }, {
        subject,
        workspaceId: "default",
      });
      expect(expandedSearch.count).toBe(2);
      expect(expandedSearch.items).toHaveLength(2);
      expect(expandedSearch.items[0].score).toBeGreaterThan(expandedSearch.items[1].score);

      const evidence = await port.getEvidence({
        evidenceId: limitedSearch.items[0].evidenceId,
      }, {
        subject,
        workspaceId: "default",
      });

      expect(evidence).toMatchObject({
        ok: true,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        provider: "dify",
        contentType: "text/markdown; charset=utf-8",
      });
      expect(evidence.markdown).toContain("Contract evidence from DIFY");
      expect(evidence.knowledgeAccessReceipt).toBeTruthy();
      expect(evidence.loanRecord).toBeTruthy();
      expect(evidence.loanRecord.requestedEgress).toBe("evidenceRead");

      const denied = await port.getEvidence({
        evidenceId: limitedSearch.items[0].evidenceId,
      }, {
        subject: {
          subjectId: "intruder",
        },
        workspaceId: "default",
      });

      expect(denied).toMatchObject({
        ok: false,
        httpStatus: 403,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        evidenceId: limitedSearch.items[0].evidenceId,
        upstreamAccessDenied: true,
      });
      expect(denied.filteredReason).toContain("subject_not_allowed");
    });
  });

  it("handles export authorization branches for contract-mode providers", async () => {
    await withTempPort(async ({ port }) => {
      const subject = {
        subjectId: "exporter-7",
        username: "exporter-7",
      };

      const denied = await port.requestExport({
        provider: "dify",
        format: "jsonl",
      }, {
        subject,
        workspaceId: "default",
      });

      expect(denied).toMatchObject({
        ok: false,
        httpStatus: 403,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        provider: "dify",
        explicitAuthorization: false,
        backendExportInvoked: false,
      });
      expect(denied.filteredReason).toContain("authorization_overlay_no_allow");

      const granted = await port.requestExport({
        provider: "ragflow",
        format: "jsonl",
        confirm: true,
      }, {
        subject,
        workspaceId: "default",
      });

      expect(granted).toMatchObject({
        ok: true,
        protocolVersion: KNOWLEDGE_BACKEND_PORT_PROTOCOL_VERSION,
        provider: "ragflow",
        requestedFormat: "jsonl",
        status: "contractVerified",
        contractVerified: true,
        backendExportInvoked: false,
      });
      expect(granted.accessDecision.allowed).toBe(true);
      expect(granted.knowledgeAccessReceipt).toBeTruthy();
      expect(granted.loanRecord).toBeTruthy();

      const ledger = await readJson(port.ledgerPath);
      expect(Object.keys(ledger.exportRequests)).toContain(granted.exportRequestId);
      expect(ledger.events.map((event) => event.type)).toEqual([
        "knowledge.export.request.denied",
        "knowledge.export.request.allowed",
      ]);
    });
  });
});
