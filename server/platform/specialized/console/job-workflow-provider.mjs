export const JOB_WORKFLOW_PROVIDER_PROTOCOL_VERSION = "v0.0.1:workflow:job-workflow-1";

function requireJobManager(jobManager = null) {
  const required = [
    "createJob",
    "getJob",
    "getJobByCheckpointId",
    "getJobResult",
    "listJobs",
    "reparseJob"
  ];
  const missing = required.filter((name) => typeof jobManager?.[name] !== "function");
  if (missing.length > 0) {
    throw new Error(`job workflow provider is not connected to jobManager: ${missing.join(", ")}`);
  }
  return jobManager;
}

export function createJobWorkflowProvider({ jobManager } = {}) {
  const manager = requireJobManager(jobManager);
  return Object.freeze({
    protocolVersion: JOB_WORKFLOW_PROVIDER_PROTOCOL_VERSION,
    describe() {
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: JOB_WORKFLOW_PROVIDER_PROTOCOL_VERSION,
        capabilities: [
          "jobs.create",
          "jobs.list",
          "jobs.get",
          "jobs.result",
          "jobs.reparse",
          "jobs.checkpoint.lookup",
          "jobs.workflow.get",
          "jobs.workflow.list",
          "workflow.durable_execution"
        ]
      };
    },
    createJob(input = {}) {
      return manager.createJob(input);
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
    reparseJob(jobId = "", input = {}) {
      return manager.reparseJob(jobId, input);
    }
  });
}
