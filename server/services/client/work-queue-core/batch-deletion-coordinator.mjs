import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithin } from "../../../platform/interactive/product-api.mjs";

function getJobDirectory(userDataPath, jobId) {
  return path.join(userDataPath, "jobs", jobId);
}

function pathWithinRoot(candidatePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realpathOrResolved(candidatePath) {
  try {
    return await fs.realpath(candidatePath);
  } catch {
    return path.resolve(candidatePath);
  }
}

async function assertManagedDeletionPath(targetPath, allowedRoots = []) {
  const selectedPath = path.resolve(String(targetPath || ""));
  const roots = allowedRoots
    .map((root) => String(root || "").trim())
    .filter(Boolean)
    .map((root) => path.resolve(root));
  if (!roots.some((root) => pathWithinRoot(selectedPath, root))) {
    throw new Error("删除路径不在受管数据目录内，已拒绝。");
  }
  const realRoots = await Promise.all(roots.map(realpathOrResolved));
  const realParent = await realpathOrResolved(path.dirname(selectedPath));
  if (!realRoots.some((root) => pathWithinRoot(realParent, root))) {
    throw new Error("删除路径父目录不在受管数据目录内，已拒绝。");
  }
}

async function removePath(targetPath, { allowedRoots = [] } = {}) {
  if (!targetPath) {
    return;
  }

  await assertManagedDeletionPath(targetPath, allowedRoots);
  await fs.rm(targetPath, {
    recursive: true,
    force: true
  });
}

async function removeEmptyParentDirectories(startPath, stopPath) {
  let currentPath = startPath;
  while (currentPath && currentPath !== stopPath && currentPath.startsWith(stopPath)) {
    try {
      const entries = await fs.readdir(currentPath);
      if (entries.length > 0) {
        return;
      }
      await fs.rmdir(currentPath);
    } catch {
      return;
    }
    currentPath = path.dirname(currentPath);
  }
}

async function removeRawObjectFiles({ userDataPath, objectRootPath, rawObjectPaths = [] }) {
  for (const relativePath of rawObjectPaths) {
    if (!relativePath) {
      continue;
    }
    const objectPath = resolveWithin(userDataPath, relativePath);
    await fs.rm(objectPath, { force: true });
    await removeEmptyParentDirectories(path.dirname(objectPath), objectRootPath);
  }
}

export function createBatchDeletionCoordinator({ userDataPath, jobManager, metadataStore, runtime = null }) {
  const jobsRootPath = path.join(userDataPath, "jobs");
  const fallbackObjectRootPath = path.join(userDataPath, "objects");

  async function executeOperation(operation) {
    let current = operation;
    const jobId = current.jobId || current.state?.jobId || current.batchId;
    const artifactPaths = metadataStore.getBatchArtifactPaths(current.batchId);
    const state = {
      jobId,
      jobDirectory: getJobDirectory(userDataPath, jobId),
      objectRootPath: artifactPaths.objectRootPath,
      rawObjectPaths: metadataStore.listRawObjectStoragePathsByBatch(current.batchId),
      ...(current.state || {})
    };

    metadataStore.updateBatchStatus(current.batchId, "deleting", current.error || "");

    if (!state.metadataDeleted) {
      state.rawObjectPaths = metadataStore.listRawObjectStoragePathsByBatch(current.batchId);
    }

    if (!state.runtimeDeleted) {
      const deletedJob = await jobManager.deleteJob(state.jobId || current.batchId);
      state.deletedJob = deletedJob || null;
      state.runtimeDeleted = true;
      current = metadataStore.updateDeletionOperation(current.operationId, {
        status: "metadata_pending",
        state
      });
    }

    if (!state.metadataDeleted) {
      const knowledgeCore = runtime?.mounts?.knowledgeBase;
      if (knowledgeCore && typeof knowledgeCore.deleteBatch === "function") {
        await knowledgeCore.deleteBatch(current.batchId);
      }
      metadataStore.deleteBatchRecords(current.batchId);
      metadataStore.deleteBatchRow(current.batchId);
      state.metadataDeleted = true;
      current = metadataStore.updateDeletionOperation(current.operationId, {
        status: "artifact_cleanup_pending",
        state
      });
    }

    if (!state.artifactsDeleted) {
      await removeRawObjectFiles({
        userDataPath,
        objectRootPath: state.objectRootPath,
        rawObjectPaths: state.rawObjectPaths
      });
      await removePath(state.objectBatchPath, {
        allowedRoots: [state.objectRootPath, fallbackObjectRootPath]
      });
      await removePath(state.jobDirectory, {
        allowedRoots: [jobsRootPath]
      });
      state.artifactsDeleted = true;
      current = metadataStore.updateDeletionOperation(current.operationId, {
        status: "completed",
        state
      });
    }

    metadataStore.deleteDeletionOperation(current.operationId);
    return {
      ok: true,
      deletedJob: state.deletedJob || null,
      batchId: current.batchId
    };
  }

  return {
    async deleteBatch(batchId) {
      const existingJob = await jobManager.getJob(batchId);
      const effectiveBatchId = existingJob?.archiveBatchId || batchId;
      const batchRow = metadataStore.getBatch(effectiveBatchId);
      const effectiveJobId = existingJob?.id || batchRow?.job_id || batchId;
      const hasBatch = Boolean(batchRow) || metadataStore.hasBatch(effectiveBatchId);
      const existing = metadataStore.getDeletionOperationByBatchId(effectiveBatchId);
      if (!existing && !existingJob && !hasBatch) {
        return null;
      }
      const operation =
        existing ||
        metadataStore.upsertDeletionOperation({
          batchId: effectiveBatchId,
          jobId: effectiveJobId,
          status: "runtime_pending",
          state: {
            jobId: effectiveJobId,
            jobDirectory: getJobDirectory(userDataPath, effectiveJobId),
            objectRootPath: metadataStore.getBatchArtifactPaths(effectiveBatchId).objectRootPath,
            rawObjectPaths: metadataStore.listRawObjectStoragePathsByBatch(effectiveBatchId),
            runtimeDeleted: false,
            metadataDeleted: false,
            artifactsDeleted: false
          }
        });

      try {
        return await executeOperation(operation);
      } catch (error) {
        const latest = metadataStore.getDeletionOperationByBatchId(effectiveBatchId) || operation;
        metadataStore.updateDeletionOperation(operation.operationId, {
          status:
            latest.state?.metadataDeleted ? "artifact_cleanup_pending" : "metadata_pending",
          state: {
            ...latest.state
          },
          error: error instanceof Error ? error.message : "删除失败"
        });
        throw error;
      }
    },
    async resumePendingDeletions() {
      const operations = metadataStore.listPendingDeletionOperations();
      for (const operation of operations) {
        try {
          await executeOperation(operation);
        } catch {
          // Keep the pending operation for the next retry cycle.
        }
      }
    }
  };
}
