import {
  createQueueDefinitionRegistry,
  createQueueFallbackCoordinator,
  createQueuePushDispatcher,
  createQueueWorkerRuntime,
  createQueuePeerRegistry,
  createSqliteWorkQueueStore,
  createPostgresWorkQueueStore,
  normalizeQueueDedupeKey,
  resolveQueueMaxAckPending
} from "../../common/resource-management/work-queue/index.mjs";

export const QUEUED_JOB_WORKFLOW_PROVIDER_PROTOCOL_VERSION = "v0.0.1:workflow:job-workflow-work-queue-1";
export const JOB_WORK_QUEUE_LABEL = "pact.jobs.import-parse";

function toText(value) {
  return String(value ?? "").trim();
}

function asInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function enabledByDefault(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "off", "disabled", "no"].includes(String(value).toLowerCase());
}

function defaultQueueScope() {
  return {
    tenantId: "platform",
    workspaceId: "default"
  };
}

function summarizeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    code: error?.code || ""
  };
}

async function createDefaultStore({ userDataPath, store = null } = {}) {
  if (store) return store;
  const storeKind = toText(process.env.PACT_WORK_QUEUE_STORE || "sqlite").toLowerCase();
  if (storeKind === "postgres" || storeKind === "postgresql") {
    return createPostgresWorkQueueStore({
      connectionString: process.env.PACT_WORK_QUEUE_POSTGRES_URL || process.env.DATABASE_URL || "",
      poolOptions: {
        max: Number(process.env.PACT_WORK_QUEUE_POSTGRES_POOL_MAX || 10)
      }
    });
  }
  return createSqliteWorkQueueStore({ userDataPath });
}

function requireManager(manager = null) {
  const required = [
    "createJob",
    "dispatchQueuedJob",
    "getJob",
    "getJobByCheckpointId",
    "getJobResult",
    "listJobs",
    "reparseJob"
  ];
  const missing = required.filter((name) => typeof manager?.[name] !== "function");
  if (missing.length > 0) {
    throw new Error(`queued job workflow provider is not connected to jobManager: ${missing.join(", ")}`);
  }
  return manager;
}

function jobDedupeKey(job = {}) {
  return normalizeQueueDedupeKey({
    jobId: job.id || "",
    checkpointId: job.checkpointId || "",
    versionGroupId: job.versionGroupId || "",
    versionNumber: job.versionNumber || 1
  });
}

export async function createQueuedJobWorkflowProvider({
  userDataPath,
  jobManager,
  strategyManagementProvider = null,
  store = null,
  logger = null,
  autoStart = true,
  dispatchIntervalMs = Number(process.env.PACT_WORK_QUEUE_DISPATCH_INTERVAL_MS || 500),
  dispatchBatchSize = Number(process.env.PACT_WORK_QUEUE_DISPATCH_BATCH_SIZE || 8),
  maxInFlight = process.env.PACT_WORK_QUEUE_MAX_ACK_PENDING || 64
} = {}) {
  const manager = requireManager(jobManager);
  const maxAckPendingLimit = resolveQueueMaxAckPending(maxInFlight, { fallback: 64 });
  const effectiveMaxInFlight = maxAckPendingLimit.limit;
  if (maxAckPendingLimit.clamped) {
    logger?.warn?.("work_queue.jobs.max_ack_pending.clamped", {
      requested: maxAckPendingLimit.normalizedRequested,
      effective: effectiveMaxInFlight,
      hardLimit: maxAckPendingLimit.hardLimit
    });
  }
  const registry = createQueueDefinitionRegistry();
  const queueDefinition = registry.registerQueueDefinition({
    label: JOB_WORK_QUEUE_LABEL,
    ownerCapability: "platform.job-workflow",
    metadata: {
      businessStateOwner: "jobManager",
      schedulerStateOwner: "workQueue"
    },
    policy: {
      policyVersion: "v0.0.1:workflow:job-work-queue-policy-1",
      maxAckPending: effectiveMaxInFlight,
      hardMaxAckPending: maxAckPendingLimit.hardLimit
    }
  });
  const queueStore = await createDefaultStore({ userDataPath, store });
  if (typeof queueStore.registerQueueDefinition === "function") {
    await queueStore.registerQueueDefinition(queueDefinition);
  }

  function evaluateQueuePolicy(input = {}) {
    if (typeof strategyManagementProvider?.evaluateQueuePolicy !== "function") {
      return {
        effect: "allow",
        allowed: true,
        reasonCode: "queue_policy_default_allow",
        policyVersion: "v0.0.1:workflow:queue-policy-default-1"
      };
    }
    return strategyManagementProvider.evaluateQueuePolicy({
      queueDefinition,
      queueDefinitionId: queueDefinition.queueDefinitionId,
      queueLabel: queueDefinition.label,
      ...input
    });
  }

  async function enqueueJob(job, payload = {}, input = {}) {
    if (!job?.id) {
      return { enqueued: false, reason: "missing_job_id" };
    }
    const decision = evaluateQueuePolicy({
      operationId: input.operationId || "jobs.enqueue",
      job,
      payloadKind: "import_parse_job",
      ownerRef: {
        capability: "platform.job-workflow",
        jobId: job.id
      }
    });
    if (decision.effect === "deny" || decision.allowed === false) {
      throw new Error(`Queue policy denied job enqueue: ${decision.reasonCode || "denied"}`);
    }
    const resolved = registry.resolveQueueDefinitionForEnqueue({
      queueDefinitionId: queueDefinition.queueDefinitionId,
      scope: input.scope || defaultQueueScope(),
      dedupeKey: jobDedupeKey(job)
    });
    const result = await queueStore.enqueue({
      ...resolved,
      payloadRef: {
        kind: "import_parse_job",
        jobId: job.id,
        checkpointId: job.checkpointId || "",
        archiveBatchId: job.archiveBatchId || "",
        versionGroupId: job.versionGroupId || "",
        versionNumber: job.versionNumber || 1
      },
      ownerRef: {
        capability: "platform.job-workflow",
        jobId: job.id
      },
      payloadKind: "import_parse_job",
      priority: asInt(input.priority ?? decision.priority, 0),
      maxAttempts: asInt(input.maxAttempts ?? decision.maxAttempts, 3),
      policyVersion: decision.policyVersion || decision.decisionId || "v0.0.1:workflow:queue-policy-default-1",
      routeVersion: decision.routeVersion || "",
      actor: input.actor || { system: "job-workflow-provider" },
      reason: input.reason || "job_workflow_enqueue"
    });
    return {
      enqueued: result.accepted !== false,
      deduped: result.deduped === true,
      workItem: result.workItem,
      policyDecision: decision
    };
  }

  async function bootstrapQueuedJobs() {
    const listed = await manager.listJobs({ limit: Number(process.env.PACT_WORK_QUEUE_BOOTSTRAP_JOB_LIMIT || 200) });
    const jobs = Array.isArray(listed?.items) ? listed.items : [];
    let enqueued = 0;
    let deduped = 0;
    for (const job of jobs) {
      if (job.status !== "queued") continue;
      try {
        const result = await enqueueJob(job, {}, {
          operationId: "jobs.bootstrap",
          reason: "job_workflow_bootstrap"
        });
        if (result.enqueued) enqueued += 1;
        if (result.deduped) deduped += 1;
      } catch (error) {
        logger?.error?.("work_queue.jobs.bootstrap.failed", {
          jobId: job.id || "",
          error: summarizeError(error)
        });
      }
    }
    return { scanned: jobs.length, enqueued, deduped };
  }

  const fallbackCoordinator = createQueueFallbackCoordinator({
    store: queueStore,
    logger
  });
  const peerRegistry = createQueuePeerRegistry();
  const workerRuntime = createQueueWorkerRuntime({
    store: queueStore,
    workerId: "platform-job-workflow-worker",
    fallbackCoordinator,
    handlers: {
      [queueDefinition.queueDefinitionId]: async ({ workItem }) => {
        const jobId = toText(workItem.payloadRef?.jobId);
        if (!jobId) {
          return {
            action: "dead_letter",
            reason: "job_payload_missing_job_id"
          };
        }
        const result = await manager.dispatchQueuedJob(jobId, {
          workItemId: workItem.workItemId
        });
        return {
          action: "ack",
          reason: result.completed ? "business_job_completed" : "business_job_dispatched",
          result
        };
      }
    },
    logger
  });
  const dispatcher = createQueuePushDispatcher({
    store: queueStore,
    workerRuntime,
    queueDefinitionId: queueDefinition.queueDefinitionId,
    scope: defaultQueueScope(),
    workerId: "platform-job-workflow-dispatcher",
    maxInFlight: effectiveMaxInFlight,
    peerSelector: () => peerRegistry.selectPeer(),
    logger
  });

  let timer = null;
  let dispatching = false;
  let stopped = false;

  async function dispatchTick() {
    if (stopped || dispatching) return null;
    dispatching = true;
    try {
      return await dispatcher.dispatchOnce({
        batchSize: Math.max(1, asInt(dispatchBatchSize, 8))
      });
    } catch (error) {
      logger?.error?.("work_queue.jobs.dispatch.failed", {
        error: summarizeError(error)
      });
      return { dispatched: 0, error: summarizeError(error) };
    } finally {
      dispatching = false;
    }
  }

  function start() {
    if (timer || stopped) return { started: false, reason: stopped ? "stopped" : "already_started" };
    timer = setInterval(() => {
      void dispatchTick();
    }, Math.max(50, asInt(dispatchIntervalMs, 500)));
    timer.unref?.();
    void bootstrapQueuedJobs().then(() => dispatchTick());
    return { started: true };
  }

  async function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    await dispatcher.drain({ timeoutMs: 30_000 }).catch(() => null);
  }

  const provider = Object.freeze({
    protocolVersion: QUEUED_JOB_WORKFLOW_PROVIDER_PROTOCOL_VERSION,
    queueDefinition,
    queueStore,
    registry,
    dispatcher,
    workerRuntime,
    describe() {
      const base = typeof manager.describe === "function" ? manager.describe() : {};
      return {
        ...base,
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: QUEUED_JOB_WORKFLOW_PROVIDER_PROTOCOL_VERSION,
        delegatedProtocolVersion: base.protocolVersion || "v0.0.1:workflow:job-workflow-1",
        queue: {
          queueDefinitionId: queueDefinition.queueDefinitionId,
          label: queueDefinition.label,
          storeKind: queueStore.kind || "sqlite",
          configuredMaxAckPending: maxAckPendingLimit.normalizedRequested,
          effectiveMaxAckPending: effectiveMaxInFlight,
          hardMaxAckPending: maxAckPendingLimit.hardLimit,
          maxAckPendingClamped: maxAckPendingLimit.clamped,
          dispatcher: dispatcher.status(),
          peers: peerRegistry.listPeers()
        },
        capabilities: [
          ...(base.capabilities || []),
          "jobs.work-queue.enqueue",
          "jobs.work-queue.dispatch",
          "jobs.work-queue.inspect",
          "jobs.work-queue.pause",
          "jobs.work-queue.resume",
          "jobs.work-queue.drain"
        ]
      };
    },
    async createJob(input = {}) {
      const decision = evaluateQueuePolicy({
        operationId: "jobs.create",
        payloadKind: "import_parse_job",
        payload: input
      });
      if (decision.effect === "deny" || decision.allowed === false) {
        throw new Error(`Queue policy denied job create: ${decision.reasonCode || "denied"}`);
      }
      const job = await manager.createJob(input);
      await enqueueJob(job, input, {
        operationId: "jobs.create.enqueue",
        priority: decision.priority,
        maxAttempts: decision.maxAttempts,
        reason: "job_created"
      });
      void dispatchTick();
      return job;
    },
    async reparseJob(jobId = "", input = {}) {
      const job = await manager.reparseJob(jobId, input);
      await enqueueJob(job, input, {
        operationId: "jobs.reparse.enqueue",
        reason: "job_reparse_created"
      });
      void dispatchTick();
      return job;
    },
    getJob(jobId = "") {
      return manager.getJob(jobId);
    },
    getJobWorkflow(jobId = "") {
      return typeof manager.getJobWorkflow === "function" ? manager.getJobWorkflow(jobId) : null;
    },
    listJobWorkflows(input = {}) {
      return typeof manager.listJobWorkflows === "function" ? manager.listJobWorkflows(input) : [];
    },
    getJobByCheckpointId(checkpointId = "") {
      return manager.getJobByCheckpointId(checkpointId);
    },
    getJobResult(jobId = "") {
      return manager.getJobResult(jobId);
    },
    listJobs(input = {}) {
      return manager.listJobs(input);
    },
    inspectWorkQueue(input = {}) {
      return queueStore.inspect({
        queueDefinitionId: queueDefinition.queueDefinitionId,
        scope: defaultQueueScope(),
        ...input
      });
    },
    pauseWorkQueue(input = {}) {
      return queueStore.pause({
        queueDefinitionId: queueDefinition.queueDefinitionId,
        scope: defaultQueueScope(),
        ...input
      });
    },
    resumeWorkQueue(input = {}) {
      return queueStore.resume({
        queueDefinitionId: queueDefinition.queueDefinitionId,
        scope: defaultQueueScope(),
        ...input
      });
    },
    drainWorkQueue(input = {}) {
      return queueStore.drain({
        queueDefinitionId: queueDefinition.queueDefinitionId,
        scope: defaultQueueScope(),
        ...input
      });
    },
    dispatchWorkQueue: dispatchTick,
    bootstrapWorkQueue: bootstrapQueuedJobs,
    start,
    stop,
    async close() {
      await stop();
      await queueStore.close?.();
    }
  });

  if (autoStart && enabledByDefault(process.env.PACT_PLATFORM_WORK_QUEUE_AUTOSTART, true)) {
    provider.start();
  }
  return provider;
}
