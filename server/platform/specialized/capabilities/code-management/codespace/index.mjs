import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../../../../common/config/ServerConfig.mjs";
import { executeRepoOperation as defaultExecuteRepoOperation } from "../../code-repository/repo-operations/index.mjs";

export const CODESPACE_PROTOCOL_VERSION = "v0.0.1:platform:codespace-1";

const REGISTRY_FILE = path.join("code-management", "codespace-registry.json");
const PROVIDER_CONFIG_FILE = path.join("code-management", "codespace-providers.json");
const CODE_PAYLOAD_KINDS = new Set(["sourceCode", "patch", "gitDiff", "repositoryChange", "codeChange"]);
const REVIEW_STATUS = new Set(["draft", "open", "reviewed", "submitted", "merged", "abandoned", "conflict", "failed"]);
const SUBMIT_STATUS = new Set(["notSubmitted", "submitted", "merged", "failed"]);
const GITHUB_PROVIDER_NAMES = new Set(["github", "gh", "github-pr"]);
const GERRIT_PROVIDER_NAMES = new Set(["gerrit", "gerrit-change"]);

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function uniqueStrings(value = []) {
  return [...new Set(asArray(value).map(text).filter(Boolean))];
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function digest(value, length = 20) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function stableId(prefix, value) {
  return `${prefix}_${digest(stableJson(value), 24)}`;
}

function registryPath(userDataPath = "") {
  return path.join(userDataPath || ServerConfig.getDataDir(), REGISTRY_FILE);
}

function providerConfigPath(userDataPath = "") {
  return path.join(userDataPath || ServerConfig.getDataDir(), PROVIDER_CONFIG_FILE);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function emptyRegistry() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: CODESPACE_PROTOCOL_VERSION,
    updatedAt: nowIso(),
    targets: {},
    changes: {},
    events: []
  };
}

function defaultProviderConfig() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: CODESPACE_PROTOCOL_VERSION,
    updatedAt: nowIso(),
    providers: {
      github: {
        provider: "github",
        enabled: true,
        mode: "contract",
        authType: "githubApp",
        secretRef: "secret://pact/codespace/github-app",
        repositoryPort: true,
        reviewPort: true,
        capabilities: [
          "repository.status",
          "tree.list",
          "file.read",
          "diff.read",
          "change.prepare",
          "change.upload",
          "review.comment",
          "review.requestChanges",
          "review.approve",
          "review.status.sync"
        ]
      },
      gerrit: {
        provider: "gerrit",
        enabled: true,
        mode: "contract",
        authType: "serviceAccount",
        secretRef: "secret://pact/codespace/gerrit-service-account",
        repositoryPort: true,
        reviewPort: true,
        capabilities: [
          "repository.status",
          "tree.list",
          "file.read",
          "diff.read",
          "change.prepare",
          "change.upload",
          "review.comment",
          "review.requestChanges",
          "review.approve",
          "review.status.sync"
        ]
      }
    }
  };
}

function publicProviderConfig(config = {}, filePath = "") {
  const providers = {};
  for (const [providerId, provider] of Object.entries(asObject(config.providers))) {
    providers[providerId] = {
      provider: text(provider.provider || providerId),
      enabled: provider.enabled !== false,
      mode: text(provider.mode || "contract"),
      authType: text(provider.authType || ""),
      secretRef: text(provider.secretRef || ""),
      repositoryPort: provider.repositoryPort !== false,
      reviewPort: provider.reviewPort !== false,
      capabilities: uniqueStrings(provider.capabilities)
    };
  }
  return {
    schemaVersion: String(config.schemaVersion || "v0.0.1:schema:definition-1"),
    protocolVersion: CODESPACE_PROTOCOL_VERSION,
    configPath: filePath,
    providers,
    providerCount: Object.keys(providers).length,
    enabledProviderCount: Object.values(providers).filter((provider) => provider.enabled).length,
    secretPolicy: "secretRefOnly",
    contractMode: Object.values(providers).some((provider) => provider.mode === "contract"),
    updatedAt: text(config.updatedAt || "")
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function workspaceIdFrom(input = {}) {
  return text(input.workspaceId || input.workspace || "default") || "default";
}

function repositoryRefFrom(input = {}) {
  return text(input.repositoryRef || input.repositoryId || input.repositoryHint || input.project || input.remoteUrl || "");
}

function branchFrom(input = {}) {
  return text(input.branch || input.branchHint || "main") || "main";
}

function targetProviderFor(input = {}, routeDecision = "") {
  return text(input.targetProvider || input.provider || (routeDecision === "gerritChange" ? "gerrit" : "workspace"));
}

function providerKeyFor(input = {}, fallback = "gerrit") {
  const provider = text(input.targetProvider || input.provider || fallback).toLowerCase();
  if (GITHUB_PROVIDER_NAMES.has(provider)) return "github";
  if (GERRIT_PROVIDER_NAMES.has(provider)) return "gerrit";
  return provider || fallback;
}

function localRepoInput(input = {}) {
  const repoId = text(input.repoId || input.worktreePath || input.localPath || "");
  return repoId ? { ...input, repoId } : null;
}

function contractVerifiedReceipt({ operationId, provider = {}, input = {}, reason = "" } = {}) {
  return {
    contractVerified: true,
    provider: provider.provider || providerKeyFor(input),
    providerMode: provider.mode || "contract",
    uploadState: "contract",
    secretRef: provider.secretRef || "",
    operationId,
    repositoryRef: repositoryRefFrom(input),
    branch: branchFrom(input),
    reason: reason || "External provider credentials are represented by secretRef and this verification ran in contract mode."
  };
}

function firstText(...values) {
  return values.map(text).find(Boolean) || "";
}

function githubPullRequestNumberFromUrl(value = "") {
  const match = String(value || "").match(/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/i);
  return match?.[1] || "";
}

function firstGithubUrl(...values) {
  for (const value of values.map(text).filter(Boolean)) {
    const match = value.match(/https?:\/\/github\.com\/[^\s"'<>]+\/pull\/\d+/i);
    if (match) {
      return match[0];
    }
    if (/^https?:\/\/github\.com\/[^\s"'<>]+\/pull\/\d+$/i.test(value)) {
      return value;
    }
  }
  return "";
}

function normalizeGithubProposalReceipt({ repoOperation = {}, provider = {}, input = {} } = {}) {
  const receipt = asObject(repoOperation.data || repoOperation);
  const dryRun = input.dryRun !== false || receipt.dryRun === true;
  const providerMode = firstText(receipt.providerMode, provider.mode, receipt.contractVerified === true ? "contract" : "live");
  const contractVerified = dryRun || providerMode === "contract" || receipt.contractVerified === true;
  const uploadState = dryRun ? "dry-run" : (contractVerified ? "contract" : "remote-live");
  const reviewUrl = firstText(
    input.reviewUrl,
    receipt.reviewUrl,
    receipt.htmlUrl,
    receipt.url,
    firstGithubUrl(receipt.stdout, receipt.stderr)
  );
  const pullRequestNumber = firstText(
    input.pullRequestNumber,
    input.prNumber,
    input.number,
    receipt.pullRequestNumber,
    receipt.prNumber,
    receipt.number,
    githubPullRequestNumberFromUrl(reviewUrl)
  );
  if (uploadState === "remote-live" && !reviewUrl) {
    return {
      ok: false,
      status: 502,
      error: "GitHub live PR creation did not return a review URL; refusing to record it as a remote-live upload.",
      receipt,
      providerMode,
      uploadState
    };
  }
  return {
    ok: true,
    contractVerified,
    providerMode,
    uploadState,
    reviewUrl,
    pullRequestNumber,
    receipt: {
      ...receipt,
      contractVerified,
      providerMode,
      uploadState,
      reviewUrl,
      pullRequestNumber
    }
  };
}

function routeDecisionFor(input = {}) {
  const explicit = text(input.routeDecision || input.route || "");
  if (explicit) return explicit;
  if (input.forceFallback === true || text(input.requestedAction) === "draft" || text(input.policyDecision) === "needsApproval") {
    return "proposalFallback";
  }
  const payloadKind = text(input.payloadKind || "");
  if (CODE_PAYLOAD_KINDS.has(payloadKind)) return "gerritChange";
  if (input.requestedAction === "review" && repositoryRefFrom(input)) return "gerritChange";
  return "workspaceContribution";
}

function normalizeReviewStatus(value, fallback = "draft") {
  const raw = text(value || fallback);
  const mapped = {
    NEW: "open",
    MERGED: "merged",
    ABANDONED: "abandoned",
    SUBMITTED: "submitted",
    DRAFT: "draft"
  }[raw.toUpperCase?.()] || raw;
  return REVIEW_STATUS.has(mapped) ? mapped : fallback;
}

function normalizeSubmitStatus(value, reviewStatus = "") {
  const raw = text(value || "");
  if (SUBMIT_STATUS.has(raw)) return raw;
  if (reviewStatus === "merged") return "merged";
  if (reviewStatus === "submitted") return "submitted";
  if (reviewStatus === "failed") return "failed";
  return "notSubmitted";
}

function appendEvent(registry, type, payload = {}) {
  const event = {
    eventId: stableId("code_event", { type, payload, nonce: randomUUID() }),
    protocolVersion: CODESPACE_PROTOCOL_VERSION,
    type,
    workspaceId: workspaceIdFrom(payload),
    codeChangeId: text(payload.codeChangeId || ""),
    targetId: text(payload.targetId || ""),
    payload: clone(asObject(payload)),
    createdAt: nowIso()
  };
  registry.events.push(event);
  return event;
}

function targetIdFor(input = {}) {
  return text(input.targetId || "") || stableId("code_target", {
    workspaceId: workspaceIdFrom(input),
    taskId: input.taskId || "",
    payloadKind: input.payloadKind || "",
    repositoryRef: repositoryRefFrom(input),
    branch: branchFrom(input),
    requestedAction: input.requestedAction || "",
    idempotencyKey: input.idempotencyKey || ""
  });
}

function normalizeTarget(input = {}) {
  const routeDecision = routeDecisionFor(input);
  const targetProvider = targetProviderFor(input, routeDecision);
  const repositoryRef = repositoryRefFrom(input);
  const branch = branchFrom(input);
  const policyDecision = text(input.policyDecision || (routeDecision === "reject" ? "deny" : "allow"));
  const accepted = routeDecision !== "reject" && policyDecision !== "deny";
  return {
    protocolVersion: CODESPACE_PROTOCOL_VERSION,
    targetId: targetIdFor(input),
    workspaceId: workspaceIdFrom(input),
    subject: text(input.subject || input.subjectId || ""),
    operatorId: text(input.operatorId || input.actorId || input.createdBy || ""),
    taskId: text(input.taskId || input.runId || ""),
    payloadKind: text(input.payloadKind || ""),
    payloadRefs: uniqueStrings(input.payloadRefs || input.payloadRef),
    requestedAction: text(input.requestedAction || "review"),
    routeDecision,
    accepted,
    policyDecision,
    fallbackReason: text(input.fallbackReason || ""),
    targetKind: routeDecision === "gerritChange"
      ? "gerritChange"
      : routeDecision === "proposalFallback"
        ? "workspaceProposal"
        : "workspaceContribution",
    targetProvider,
    repositoryId: text(input.repositoryId || input.repositoryHint || input.project || ""),
    repositoryRef,
    branch,
    reviewUrl: text(input.reviewUrl || input.gerritChangeUrl || ""),
    changeRef: text(input.changeRef || input.changeId || input.changeNumber || ""),
    status: "evaluated",
    metadata: asObject(input.metadata),
    createdAt: text(input.createdAt || nowIso()),
    updatedAt: nowIso()
  };
}

function compatibleTarget(target) {
  return {
    targetId: target.targetId,
    targetKind: target.targetKind,
    targetProvider: target.targetProvider,
    repositoryId: target.repositoryId,
    repositoryRef: target.repositoryRef,
    branch: target.branch,
    changeRef: target.changeRef,
    reviewUrl: target.reviewUrl,
    reason: target.routeDecision === "gerritChange"
      ? "source code changes require review"
      : target.routeDecision === "proposalFallback"
        ? "code route requires a workspace proposal fallback"
        : "payload can remain a workspace contribution"
  };
}

function codeChangeIdFor(input = {}) {
  return text(input.codeChangeId || input.changeSetId || "") || stableId("code_change", {
    workspaceId: workspaceIdFrom(input),
    targetId: input.targetId || "",
    repositoryRef: repositoryRefFrom(input),
    branch: branchFrom(input),
    diff: input.diff || input.patch || "",
    idempotencyKey: input.idempotencyKey || ""
  });
}

function normalizeChangeSet(input = {}) {
  const files = asArray(input.files || input.fileChanges).map((item) => asObject(item)).filter((item) => Object.keys(item).length);
  const diff = text(input.diff || input.patch || "");
  const commitPlan = asArray(input.commitPlan).map((item) => asObject(item, { message: text(item) }));
  const payload = {
    payloadKind: text(input.payloadKind || "repositoryChange"),
    payloadRefs: uniqueStrings(input.payloadRefs || input.payloadRef),
    dataClass: text(input.dataClass || input.payloadKind || "codeChange"),
    diff,
    files,
    commitPlan,
    policy: asObject(input.policy, {
      decision: text(input.policyDecision || "allow"),
      dataClass: text(input.dataClass || input.payloadKind || "codeChange")
    }),
    checkpoint: asObject(input.checkpoint, {
      checkpointNodeId: text(input.checkpointNodeId || ""),
      checkpointId: text(input.checkpointId || "")
    })
  };
  return {
    changeSetId: text(input.changeSetId || "") || stableId("change_set", payload),
    ...payload,
    diffSha256: diff ? digest(diff, 64) : "",
    fileCount: files.length
  };
}

function publicCodeChange(change = {}) {
  return {
    protocolVersion: CODESPACE_PROTOCOL_VERSION,
    codeChangeId: change.codeChangeId,
    workspaceId: change.workspaceId,
    targetId: change.targetId,
    repositoryId: change.repositoryId,
    repositoryRef: change.repositoryRef,
    branch: change.branch,
    changeId: change.changeId,
    changeNumber: change.changeNumber,
    changeRef: change.changeRef,
    gerritChangeUrl: change.gerritChangeUrl,
    reviewUrl: change.reviewUrl,
    patchSetRefs: change.patchSetRefs || [],
    reviewStatus: change.reviewStatus,
    submitStatus: change.submitStatus,
    operationId: change.operationId,
    checkpointNodeId: change.checkpointNodeId,
    auditId: change.auditId,
    changeSet: clone(change.changeSet || {}),
    target: clone(change.target || {}),
    completion: clone(change.completion || {}),
    statusHistory: clone(change.statusHistory || []),
    createdAt: change.createdAt,
    updatedAt: change.updatedAt
  };
}

function findChange(registry, input = {}) {
  const codeChangeId = text(input.codeChangeId || "");
  if (codeChangeId && registry.changes[codeChangeId]) return registry.changes[codeChangeId];
  const changeId = text(input.changeId || input.changeRef || "");
  if (changeId) {
    return Object.values(registry.changes).find((item) =>
      item.changeId === changeId || item.changeRef === changeId || String(item.changeNumber || "") === changeId
    ) || null;
  }
  return null;
}

function statusFromGerritChange(change = {}) {
  const reviewStatus = normalizeReviewStatus(change.status || change.reviewStatus || "open", "open");
  return {
    reviewStatus,
    submitStatus: normalizeSubmitStatus(change.submitStatus, reviewStatus),
    changeId: text(change.change_id || change.changeId || ""),
    changeNumber: text(change._number || change.changeNumber || ""),
    currentRevision: text(change.current_revision || change.currentRevision || "")
  };
}

export function createCodespaceRegistry({
  userDataPath,
  executeGerritCommonOperation,
  uploadGerritGitChange,
  executeRepoOperation = defaultExecuteRepoOperation
} = {}) {
  const filePath = registryPath(userDataPath);
  const providersPath = providerConfigPath(userDataPath);

  async function loadRegistry() {
    const registry = await readJson(filePath, emptyRegistry());
    return {
      ...emptyRegistry(),
      ...registry,
      targets: asObject(registry.targets),
      changes: asObject(registry.changes),
      events: asArray(registry.events)
    };
  }

  async function saveRegistry(registry) {
    registry.updatedAt = nowIso();
    await writeJson(filePath, registry);
    return registry;
  }

  async function loadProviderConfig() {
    const existing = await readJson(providersPath, null);
    if (existing) {
      return {
        ...defaultProviderConfig(),
        ...existing,
        providers: {
          ...defaultProviderConfig().providers,
          ...asObject(existing.providers)
        }
      };
    }
    const defaults = defaultProviderConfig();
    await writeJson(providersPath, defaults);
    return defaults;
  }

  async function providerManifest() {
    const config = await loadProviderConfig();
    return {
      ok: true,
      ...publicProviderConfig(config, providersPath)
    };
  }

  async function resolveProvider(input = {}, fallback = "gerrit") {
    const config = await loadProviderConfig();
    const providerId = providerKeyFor(input, fallback);
    const provider = asObject(config.providers?.[providerId], {
      provider: providerId,
      enabled: false,
      mode: "contract"
    });
    return {
      providerId,
      provider: {
        ...provider,
        provider: text(provider.provider || providerId),
        enabled: provider.enabled !== false,
        mode: text(provider.mode || "contract"),
        secretRef: text(provider.secretRef || "")
      },
      config: publicProviderConfig(config, providersPath)
    };
  }

  async function mutate(mutator) {
    const registry = await loadRegistry();
    const output = await mutator(registry);
    await saveRegistry(registry);
    return output;
  }

  async function runRepoPort(operationId, input = {}, context = {}) {
    const { providerId, provider, config } = await resolveProvider(input, providerKeyFor(input, "gerrit"));
    if (!provider.enabled) {
      return {
        ok: false,
        status: 409,
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        provider: providerId,
        error: `Codespace provider is disabled: ${providerId}`,
        providerConfig: config
      };
    }
    const localInput = localRepoInput(input);
    if (!localInput) {
      return {
        ok: true,
        status: 200,
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        operationId,
        provider: provider.provider,
        adapter: "RepositoryPort",
        repositoryRef: repositoryRefFrom(input),
        branch: branchFrom(input),
        data: {},
        receipt: contractVerifiedReceipt({ operationId, provider, input, reason: "No local repoId/worktreePath was supplied for provider-backed repository read." }),
        providerConfig: config
      };
    }
    const mapped = {
      "codespace.repository.status": "repo.status",
      "codespace.tree.list": "repo.tree.list",
      "codespace.file.read": "repo.file.read",
      "codespace.diff.read": "repo.diff.read"
    }[operationId];
    const repoResult = await executeRepoOperation({
      operationId: mapped,
      input: localInput,
      authSession: context.authSession
    });
    return {
      ok: repoResult.ok === true,
      status: repoResult.status || (repoResult.ok ? 200 : 400),
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      operationId,
      provider: provider.provider,
      adapter: "RepositoryPort",
      repositoryRef: repositoryRefFrom(input) || repoResult.repo?.repoId || localInput.repoId || "",
      branch: branchFrom(input) || repoResult.repo?.branch || "",
      repo: repoResult.repo || {},
      data: repoResult.data || {},
      error: repoResult.error,
      receipt: {
        contractVerified: provider.mode === "contract",
        provider: provider.provider,
        secretRef: provider.secretRef,
        operationId,
        repoOperationId: mapped
      },
      providerConfig: config
    };
  }

  async function evaluateTarget(input = {}) {
    return mutate(async (registry) => {
      const target = normalizeTarget(input);
      const existing = registry.targets[target.targetId];
      registry.targets[target.targetId] = {
        ...existing,
        ...target,
        createdAt: existing?.createdAt || target.createdAt,
        updatedAt: nowIso()
      };
      const audit = appendEvent(registry, "code.route.evaluated", {
        workspaceId: target.workspaceId,
        targetId: target.targetId,
        routeDecision: target.routeDecision,
        policyDecision: target.policyDecision
      });
      let fallback = null;
      if (target.routeDecision === "proposalFallback") {
        const fallbackAudit = appendEvent(registry, "code.change.fallback.created", {
          workspaceId: target.workspaceId,
          targetId: target.targetId,
          reason: target.fallbackReason || "proposal fallback requested"
        });
        fallback = {
          targetKind: "workspaceProposal",
          operationId: "workspace.proposal.create",
          reason: target.fallbackReason || "code route requires proposal fallback",
          auditId: fallbackAudit.eventId
        };
      }
      return {
        ok: true,
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        accepted: target.accepted,
        routeDecision: target.routeDecision,
        compatibleTargets: [compatibleTarget(target)],
        policyDecision: target.policyDecision,
        fallbackReason: target.fallbackReason,
        fallback,
        auditId: audit.eventId,
        target: clone(registry.targets[target.targetId])
      };
    });
  }

  async function prepareChange(input = {}) {
    return mutate(async (registry) => {
      const targetId = text(input.targetId || "");
      const target = targetId && registry.targets[targetId]
        ? registry.targets[targetId]
        : normalizeTarget(input);
      registry.targets[target.targetId] = {
        ...registry.targets[target.targetId],
        ...target,
        updatedAt: nowIso()
      };
      const changeSet = normalizeChangeSet(input);
      const codeChangeId = codeChangeIdFor({
        ...input,
        targetId: target.targetId,
        changeSetId: changeSet.changeSetId
      });
      const timestamp = nowIso();
      const previous = registry.changes[codeChangeId];
      const audit = appendEvent(registry, "code.change.prepared", {
        workspaceId: target.workspaceId,
        targetId: target.targetId,
        codeChangeId,
        changeSetId: changeSet.changeSetId
      });
      const change = {
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        ...(previous || {}),
        codeChangeId,
        workspaceId: target.workspaceId,
        targetId: target.targetId,
        repositoryId: text(input.repositoryId || target.repositoryId),
        repositoryRef: text(input.repositoryRef || target.repositoryRef || target.repositoryId),
        branch: branchFrom({ ...target, ...input }),
        changeId: text(input.changeId || previous?.changeId || ""),
        changeNumber: text(input.changeNumber || previous?.changeNumber || ""),
        changeRef: text(input.changeRef || previous?.changeRef || ""),
        gerritChangeUrl: text(input.gerritChangeUrl || input.reviewUrl || previous?.gerritChangeUrl || ""),
        reviewUrl: text(input.reviewUrl || input.gerritChangeUrl || previous?.reviewUrl || ""),
        patchSetRefs: uniqueStrings(input.patchSetRefs || previous?.patchSetRefs),
        reviewStatus: normalizeReviewStatus(input.reviewStatus || previous?.reviewStatus || "draft"),
        submitStatus: normalizeSubmitStatus(input.submitStatus || previous?.submitStatus || "notSubmitted"),
        operationId: "workspace.code.change.prepare",
        checkpointNodeId: text(input.checkpointNodeId || previous?.checkpointNodeId || ""),
        auditId: audit.eventId,
        changeSet,
        target: compatibleTarget(target),
        completion: asObject(previous?.completion),
        statusHistory: [
          ...(previous?.statusHistory || []),
          { status: "prepared", at: timestamp, auditId: audit.eventId }
        ],
        createdAt: previous?.createdAt || timestamp,
        updatedAt: timestamp
      };
      registry.changes[codeChangeId] = change;
      return {
        ok: true,
        ...publicCodeChange(change),
        prepared: true
      };
    });
  }

  async function linkChange(input = {}) {
    return mutate(async (registry) => {
      const timestamp = nowIso();
      const existing = findChange(registry, input);
      const targetId = text(input.targetId || existing?.targetId || "");
      const target = targetId && registry.targets[targetId]
        ? registry.targets[targetId]
        : normalizeTarget({
            ...input,
            payloadKind: input.payloadKind || "repositoryChange",
            routeDecision: input.routeDecision || "gerritChange"
          });
      registry.targets[target.targetId] = {
        ...registry.targets[target.targetId],
        ...target,
        changeRef: text(input.changeRef || input.changeId || input.changeNumber || target.changeRef),
        reviewUrl: text(input.reviewUrl || input.gerritChangeUrl || target.reviewUrl),
        updatedAt: timestamp
      };
      const codeChangeId = existing?.codeChangeId || codeChangeIdFor({ ...input, targetId: target.targetId });
      const audit = appendEvent(registry, "code.change.linked", {
        workspaceId: target.workspaceId,
        targetId: target.targetId,
        codeChangeId,
        changeId: input.changeId || ""
      });
      const reviewStatus = normalizeReviewStatus(
        input.reviewStatus || (existing?.reviewStatus && existing.reviewStatus !== "draft" ? existing.reviewStatus : "open"),
        "open"
      );
      const change = {
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        ...(existing || {}),
        codeChangeId,
        workspaceId: target.workspaceId,
        targetId: target.targetId,
        repositoryId: text(input.repositoryId || existing?.repositoryId || target.repositoryId),
        repositoryRef: text(input.repositoryRef || existing?.repositoryRef || target.repositoryRef),
        branch: branchFrom({ ...target, ...existing, ...input }),
        changeId: text(input.changeId || existing?.changeId || ""),
        changeNumber: text(input.changeNumber || existing?.changeNumber || ""),
        changeRef: text(input.changeRef || input.changeId || input.changeNumber || existing?.changeRef || ""),
        gerritChangeUrl: text(input.gerritChangeUrl || input.reviewUrl || existing?.gerritChangeUrl || ""),
        reviewUrl: text(input.reviewUrl || input.gerritChangeUrl || existing?.reviewUrl || ""),
        patchSetRefs: uniqueStrings(input.patchSetRefs || existing?.patchSetRefs),
        reviewStatus,
        submitStatus: normalizeSubmitStatus(input.submitStatus || existing?.submitStatus, reviewStatus),
        operationId: "workspace.code.change.link",
        checkpointNodeId: text(input.checkpointNodeId || existing?.checkpointNodeId || ""),
        auditId: audit.eventId,
        changeSet: asObject(existing?.changeSet),
        target: compatibleTarget(registry.targets[target.targetId]),
        completion: asObject(existing?.completion),
        statusHistory: [
          ...(existing?.statusHistory || []),
          { status: "linked", at: timestamp, auditId: audit.eventId }
        ],
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      };
      registry.changes[codeChangeId] = change;
      return {
        ok: true,
        ...publicCodeChange(change),
        linked: true
      };
    });
  }

  async function syncStatus(input = {}) {
    return mutate(async (registry) => {
      let existing = findChange(registry, input);
      if (!existing) {
        const target = normalizeTarget({
          ...input,
          payloadKind: input.payloadKind || "repositoryChange",
          routeDecision: input.routeDecision || "gerritChange"
        });
        registry.targets[target.targetId] = {
          ...registry.targets[target.targetId],
          ...target,
          updatedAt: nowIso()
        };
        const codeChangeId = codeChangeIdFor({ ...input, targetId: target.targetId });
        existing = {
          protocolVersion: CODESPACE_PROTOCOL_VERSION,
          codeChangeId,
          workspaceId: target.workspaceId,
          targetId: target.targetId,
          repositoryId: text(input.repositoryId || target.repositoryId),
          repositoryRef: text(input.repositoryRef || target.repositoryRef),
          branch: branchFrom({ ...target, ...input }),
          changeId: text(input.changeId || ""),
          changeNumber: text(input.changeNumber || ""),
          changeRef: text(input.changeRef || input.changeId || input.changeNumber || ""),
          gerritChangeUrl: text(input.gerritChangeUrl || input.reviewUrl || ""),
          reviewUrl: text(input.reviewUrl || input.gerritChangeUrl || ""),
          patchSetRefs: [],
          reviewStatus: "open",
          submitStatus: "notSubmitted",
          operationId: "workspace.code.change.link",
          checkpointNodeId: text(input.checkpointNodeId || ""),
          auditId: "",
          changeSet: {},
          target: compatibleTarget(target),
          completion: {},
          statusHistory: [],
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        registry.changes[codeChangeId] = existing;
      }
      let providerReceipt = asObject(input.providerReceipt || input.gerritResult);
      if (
        executeGerritCommonOperation &&
        input.fetchFromGerrit === true &&
        text(input.changeId || existing.changeId || existing.changeRef)
      ) {
        const gerrit = await executeGerritCommonOperation({
          mode: "read",
          input: {
            ...input,
            action: input.action || "changes.detail",
            changeId: input.changeId || existing.changeId || existing.changeRef
          }
        });
        providerReceipt = {
          ok: gerrit.ok,
          action: gerrit.action,
          mode: gerrit.mode,
          gerrit: gerrit.gerrit,
          result: gerrit.result,
          error: gerrit.error || ""
        };
      }
      const statusSource = asObject(providerReceipt.result || providerReceipt.change || providerReceipt, {});
      const mapped = statusFromGerritChange({
        ...statusSource,
        reviewStatus: input.reviewStatus || statusSource.reviewStatus,
        submitStatus: input.submitStatus || statusSource.submitStatus
      });
      const timestamp = nowIso();
      const audit = appendEvent(registry, "code.change.status.synced", {
        workspaceId: existing.workspaceId,
        targetId: existing.targetId,
        codeChangeId: existing.codeChangeId,
        reviewStatus: mapped.reviewStatus,
        submitStatus: mapped.submitStatus
      });
      const change = {
        ...existing,
        changeId: text(input.changeId || existing.changeId || mapped.changeId),
        changeNumber: text(input.changeNumber || existing.changeNumber || mapped.changeNumber),
        changeRef: text(input.changeRef || existing.changeRef || input.changeId || mapped.changeId || mapped.changeNumber),
        reviewStatus: mapped.reviewStatus,
        submitStatus: mapped.submitStatus,
        operationId: "workspace.code.change.status.sync",
        auditId: audit.eventId,
        completion: {
          ...asObject(existing.completion),
          providerReceipt
        },
        statusHistory: [
          ...(existing.statusHistory || []),
          { status: "status_synced", at: timestamp, auditId: audit.eventId, reviewStatus: mapped.reviewStatus, submitStatus: mapped.submitStatus }
        ],
        updatedAt: timestamp
      };
      registry.changes[change.codeChangeId] = change;
      return {
        ok: true,
        ...publicCodeChange(change),
        synced: true,
        providerReceipt
      };
    });
  }

  async function uploadChange(input = {}) {
    if (typeof uploadGerritGitChange !== "function") {
      return {
        ok: false,
        status: 503,
        error: "Gerrit upload provider is not registered."
      };
    }
    const upload = await uploadGerritGitChange(input);
    const target = {
      targetKind: "codespace",
      targetProvider: upload.targetProvider || "gerrit",
      repositoryRef: upload.repositoryRef || input.repositoryRef || input.repositoryId || input.project || "",
      branch: upload.branch || branchFrom(input),
      changeRef: upload.changeRef || upload.changeId || upload.changeNumber || "",
      reviewUrl: upload.reviewUrl || ""
    };
    return mutate(async (registry) => {
      const timestamp = nowIso();
      const existing = findChange(registry, input);
      const targetRecord = normalizeTarget({
        ...input,
        routeDecision: "gerritChange",
        targetProvider: target.targetProvider,
        repositoryRef: target.repositoryRef,
        branch: target.branch,
        changeRef: target.changeRef,
        reviewUrl: target.reviewUrl
      });
      registry.targets[targetRecord.targetId] = {
        ...registry.targets[targetRecord.targetId],
        ...targetRecord,
        targetKind: "gerritChange",
        status: upload.ok ? "uploaded" : "upload_failed",
        updatedAt: timestamp
      };
      const codeChangeId = existing?.codeChangeId || codeChangeIdFor({ ...input, targetId: targetRecord.targetId });
      const eventType = upload.ok ? "code.change.uploaded" : "code.change.upload.failed";
      const audit = appendEvent(registry, eventType, {
        workspaceId: workspaceIdFrom(input),
        targetId: targetRecord.targetId,
        codeChangeId,
        uploadId: upload.uploadId || "",
        dryRun: upload.dryRun === true
      });
      const reviewStatus = upload.ok && upload.dryRun !== true
        ? "open"
        : upload.ok
          ? "draft"
          : "failed";
      const submitStatus = upload.ok ? "notSubmitted" : "failed";
      const change = {
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        ...(existing || {}),
        codeChangeId,
        workspaceId: workspaceIdFrom(input),
        targetId: targetRecord.targetId,
        repositoryId: text(input.repositoryId || target.repositoryRef),
        repositoryRef: target.repositoryRef,
        branch: target.branch,
        changeId: text(upload.changeId || existing?.changeId || ""),
        changeNumber: text(upload.changeNumber || existing?.changeNumber || ""),
        changeRef: text(target.changeRef || existing?.changeRef || ""),
        gerritChangeUrl: text(upload.reviewUrl || existing?.gerritChangeUrl || ""),
        reviewUrl: text(upload.reviewUrl || existing?.reviewUrl || ""),
        patchSetRefs: uniqueStrings(existing?.patchSetRefs),
        reviewStatus,
        submitStatus,
        operationId: "workspace.code.change.upload",
        checkpointNodeId: text(input.checkpointNodeId || existing?.checkpointNodeId || ""),
        auditId: audit.eventId,
        changeSet: asObject(existing?.changeSet),
        target,
        completion: {
          confirmed: upload.completion?.confirmed === true,
          dryRun: upload.dryRun === true,
          uploadId: upload.uploadId || "",
          provider: upload.provider || "gerrit",
          receipt: clone(upload.completion || {}),
          error: upload.error || ""
        },
        statusHistory: [
          ...(existing?.statusHistory || []),
          { status: upload.ok ? "uploaded" : "upload_failed", at: timestamp, auditId: audit.eventId }
        ],
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      };
      registry.changes[codeChangeId] = change;
      return {
        ok: upload.ok,
        status: upload.status || (upload.ok ? 200 : 400),
        schemaVersion: "v0.0.1:schema:definition-1",
        operationId: "workspace.code.change.upload",
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        ...upload,
        codeChange: publicCodeChange(change),
        codeChangeId,
        target,
        auditId: audit.eventId
      };
    });
  }

  async function uploadGithubChange(input = {}, context = {}) {
    const { provider, config } = await resolveProvider(input, "github");
    if (!provider.enabled) {
      return {
        ok: false,
        status: 409,
        error: "Codespace GitHub provider is disabled."
      };
    }
    const repoOperation = localRepoInput(input)
      ? await executeRepoOperation({
          operationId: "repo.proposal.create",
          input: {
            ...input,
            provider: "github",
            sourceRef: text(input.sourceRef || input.headRef || input.branch || "HEAD"),
            targetRef: text(input.targetRef || input.baseRef || input.branch || "main"),
            title: text(input.title || input.subject || "Pact Codespace change"),
            dryRun: input.dryRun !== false
          },
          authSession: context.authSession
        })
      : {
          ok: true,
          status: 200,
          data: contractVerifiedReceipt({
            operationId: "codespace.change.upload",
            provider,
            input,
            reason: "No local repoId/worktreePath was supplied for GitHub PR creation."
          })
        };
    if (repoOperation.ok !== true) {
      return {
        ok: false,
        status: repoOperation.status || 400,
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        operationId: "codespace.change.upload",
        error: repoOperation.error || "GitHub upload preparation failed.",
        providerConfig: config
      };
    }
    const githubReceipt = normalizeGithubProposalReceipt({ repoOperation, provider, input });
    if (githubReceipt.ok !== true) {
      return {
        ok: false,
        status: githubReceipt.status || 502,
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        operationId: "codespace.change.upload",
        error: githubReceipt.error || "GitHub upload receipt could not be normalized.",
        provider: "github",
        providerMode: githubReceipt.providerMode,
        uploadState: githubReceipt.uploadState,
        receipt: githubReceipt.receipt,
        providerConfig: config
      };
    }
    return mutate(async (registry) => {
      const timestamp = nowIso();
      const existing = findChange(registry, input);
      const targetRecord = normalizeTarget({
        ...input,
        routeDecision: "githubPullRequest",
        targetProvider: "github",
        repositoryRef: repositoryRefFrom(input) || input.repoId || input.worktreePath || "",
        branch: branchFrom(input),
        reviewUrl: text(input.reviewUrl || "")
      });
      targetRecord.targetKind = "githubPullRequest";
      targetRecord.status = githubReceipt.uploadState === "remote-live" ? "uploaded" : "contractVerified";
      registry.targets[targetRecord.targetId] = {
        ...registry.targets[targetRecord.targetId],
        ...targetRecord,
        updatedAt: timestamp
      };
      const codeChangeId = existing?.codeChangeId || codeChangeIdFor({ ...input, targetId: targetRecord.targetId });
      const audit = appendEvent(registry, "code.change.uploaded", {
        workspaceId: workspaceIdFrom(input),
        targetId: targetRecord.targetId,
        codeChangeId,
        provider: "github",
        contractVerified: githubReceipt.contractVerified,
        providerMode: githubReceipt.providerMode,
        uploadState: githubReceipt.uploadState
      });
      const reviewId = githubReceipt.pullRequestNumber
        ? `github_pr_${githubReceipt.pullRequestNumber}`
        : text(input.reviewId || "") || stableId("github_pr", { codeChangeId, repositoryRef: repositoryRefFrom(input), branch: branchFrom(input) });
      const reviewUrl = githubReceipt.reviewUrl || `https://github.example.invalid/${repositoryRefFrom(input) || "owner/repo"}/pull/${reviewId.replace(/^github_pr_/, "")}`;
      const change = {
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        ...(existing || {}),
        codeChangeId,
        workspaceId: workspaceIdFrom(input),
        targetId: targetRecord.targetId,
        repositoryId: text(input.repositoryId || input.repoId || ""),
        repositoryRef: text(input.repositoryRef || input.repoId || input.worktreePath || ""),
        branch: branchFrom(input),
        changeId: reviewId,
        changeNumber: githubReceipt.pullRequestNumber || reviewId,
        changeRef: reviewId,
        gerritChangeUrl: "",
        reviewUrl,
        patchSetRefs: uniqueStrings(existing?.patchSetRefs),
        reviewStatus: input.dryRun === false ? "open" : "draft",
        submitStatus: "notSubmitted",
        operationId: "codespace.change.upload",
        checkpointNodeId: text(input.checkpointNodeId || existing?.checkpointNodeId || ""),
        auditId: audit.eventId,
        changeSet: asObject(existing?.changeSet),
        target: {
          targetKind: "codespace",
          targetProvider: "github",
          repositoryRef: repositoryRefFrom(input) || input.repoId || input.worktreePath || "",
          branch: branchFrom(input),
          changeRef: reviewId,
          reviewUrl
        },
        completion: {
          confirmed: githubReceipt.uploadState === "remote-live",
          dryRun: input.dryRun !== false,
          contractVerified: githubReceipt.contractVerified,
          providerMode: githubReceipt.providerMode,
          uploadState: githubReceipt.uploadState,
          provider: "github",
          receipt: githubReceipt.receipt,
          secretRef: provider.secretRef
        },
        statusHistory: [
          ...(existing?.statusHistory || []),
          { status: githubReceipt.uploadState === "remote-live" ? "uploaded" : "contract_verified", at: timestamp, auditId: audit.eventId }
        ],
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      };
      registry.changes[codeChangeId] = change;
      return {
        ok: true,
        status: 200,
        schemaVersion: "v0.0.1:schema:definition-1",
        operationId: "codespace.change.upload",
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        provider: "github",
        contractVerified: githubReceipt.contractVerified,
        providerMode: githubReceipt.providerMode,
        uploadState: githubReceipt.uploadState,
        dryRun: input.dryRun !== false,
        codeChange: publicCodeChange(change),
        codeChangeId,
        target: change.target,
        completion: change.completion,
        auditId: audit.eventId,
        providerConfig: config
      };
    });
  }

  async function uploadCodespaceChange(input = {}, context = {}) {
    const providerId = providerKeyFor(input, "gerrit");
    if (providerId === "github") {
      return uploadGithubChange(input, context);
    }
    const upload = await uploadChange(input);
    if (upload?.operationId === "workspace.code.change.upload") {
      return {
        ...upload,
        operationId: "codespace.change.upload"
      };
    }
    return upload;
  }

  async function reviewAction(kind, input = {}, context = {}) {
    const providerId = providerKeyFor(input, "gerrit");
    const { provider, config } = await resolveProvider(input, providerId);
    if (!provider.enabled) {
      return {
        ok: false,
        status: 409,
        error: `Codespace provider is disabled: ${providerId}`
      };
    }
    const operationIdByKind = {
      comment: "repo.review.comment",
      requestChanges: "repo.review.requestChanges",
      approve: "repo.review.approve"
    };
    const operationId = operationIdByKind[kind] || "repo.review.comment";
    const localInput = localRepoInput(input);
    const reviewTarget = text(input.reviewTarget || input.changeRef || input.changeId || input.codeChangeId || "");
    const providerReceipt = localInput && reviewTarget
      ? await executeRepoOperation({
          operationId,
          input: {
            ...input,
            ...localInput,
            provider: providerId,
            reviewTarget,
            dryRun: input.dryRun !== false
          },
          authSession: context.authSession
        })
      : {
          ok: true,
          status: 200,
          data: contractVerifiedReceipt({
            operationId: `codespace.review.${kind}`,
            provider,
            input,
            reason: "Review operation ran without a local repoId/reviewTarget and produced a contract receipt."
          })
        };
    if (providerReceipt.ok !== true) {
      return {
        ok: false,
        status: providerReceipt.status || 400,
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        operationId: `codespace.review.${kind}`,
        error: providerReceipt.error || "Codespace review operation failed.",
        providerConfig: config
      };
    }
    return mutate(async (registry) => {
      const timestamp = nowIso();
      const existing = findChange(registry, input);
      const target = existing?.targetId && registry.targets[existing.targetId]
        ? registry.targets[existing.targetId]
        : normalizeTarget({
            ...input,
            payloadKind: input.payloadKind || "repositoryChange",
            routeDecision: providerId === "github" ? "githubPullRequest" : "gerritChange",
            targetProvider: providerId
          });
      target.targetKind = providerId === "github" ? "githubPullRequest" : "gerritChange";
      registry.targets[target.targetId] = {
        ...registry.targets[target.targetId],
        ...target,
        updatedAt: timestamp
      };
      const codeChangeId = existing?.codeChangeId || codeChangeIdFor({ ...input, targetId: target.targetId });
      const eventType = kind === "approve"
        ? "code.review.approved"
        : kind === "requestChanges"
          ? "code.review.changes_requested"
          : "code.review.commented";
      const audit = appendEvent(registry, eventType, {
        workspaceId: workspaceIdFrom(input),
        targetId: target.targetId,
        codeChangeId,
        provider: providerId
      });
      const reviewStatus = kind === "approve" ? "reviewed" : normalizeReviewStatus(existing?.reviewStatus || "open", "open");
      const change = {
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        ...(existing || {}),
        codeChangeId,
        workspaceId: workspaceIdFrom(input),
        targetId: target.targetId,
        repositoryId: text(input.repositoryId || existing?.repositoryId || target.repositoryId),
        repositoryRef: text(input.repositoryRef || existing?.repositoryRef || target.repositoryRef),
        branch: branchFrom({ ...target, ...existing, ...input }),
        changeId: text(input.changeId || existing?.changeId || reviewTarget),
        changeNumber: text(input.changeNumber || existing?.changeNumber || ""),
        changeRef: text(input.changeRef || existing?.changeRef || reviewTarget),
        gerritChangeUrl: text(input.gerritChangeUrl || existing?.gerritChangeUrl || ""),
        reviewUrl: text(input.reviewUrl || input.gerritChangeUrl || existing?.reviewUrl || ""),
        patchSetRefs: uniqueStrings(input.patchSetRefs || existing?.patchSetRefs),
        reviewStatus,
        submitStatus: normalizeSubmitStatus(input.submitStatus || existing?.submitStatus, reviewStatus),
        operationId: `codespace.review.${kind}`,
        checkpointNodeId: text(input.checkpointNodeId || existing?.checkpointNodeId || ""),
        auditId: audit.eventId,
        changeSet: asObject(existing?.changeSet),
        target: compatibleTarget(registry.targets[target.targetId]),
        completion: {
          ...asObject(existing?.completion),
          lastReviewReceipt: providerReceipt.data || providerReceipt,
          contractVerified: provider.mode === "contract",
          secretRef: provider.secretRef
        },
        statusHistory: [
          ...(existing?.statusHistory || []),
          { status: eventType, at: timestamp, auditId: audit.eventId }
        ],
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp
      };
      registry.changes[codeChangeId] = change;
      return {
        ok: true,
        status: 200,
        protocolVersion: CODESPACE_PROTOCOL_VERSION,
        operationId: `codespace.review.${kind}`,
        provider: providerId,
        reviewAction: kind,
        contractVerified: provider.mode === "contract",
        providerReceipt: providerReceipt.data || providerReceipt,
        codeChange: publicCodeChange(change),
        auditId: audit.eventId,
        providerConfig: config
      };
    });
  }

  async function getChange(input = {}) {
    const registry = await loadRegistry();
    const change = findChange(registry, input);
    return change
      ? { ok: true, ...publicCodeChange(change) }
      : { ok: false, status: 404, error: "Code change not found." };
  }

  async function listChanges(input = {}) {
    const registry = await loadRegistry();
    const workspaceId = text(input.workspaceId || "");
    const items = Object.values(registry.changes)
      .filter((item) => !workspaceId || item.workspaceId === workspaceId)
      .map(publicCodeChange)
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
    return {
      ok: true,
      protocolVersion: CODESPACE_PROTOCOL_VERSION,
      count: items.length,
      items
    };
  }

  return {
    protocolVersion: CODESPACE_PROTOCOL_VERSION,
    providerManifest,
    repositoryStatus: (input, context) => runRepoPort("codespace.repository.status", input, context),
    listTree: (input, context) => runRepoPort("codespace.tree.list", input, context),
    readFile: (input, context) => runRepoPort("codespace.file.read", input, context),
    readDiff: (input, context) => runRepoPort("codespace.diff.read", input, context),
    evaluateTarget,
    prepareChange,
    uploadChange,
    uploadCodespaceChange,
    linkChange,
    syncStatus,
    reviewComment: (input, context) => reviewAction("comment", input, context),
    reviewRequestChanges: (input, context) => reviewAction("requestChanges", input, context),
    reviewApprove: (input, context) => reviewAction("approve", input, context),
    getChange,
    listChanges
  };
}
