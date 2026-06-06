import { createKnowledgeSourceService } from "../../../../platform/interactive/product-api.mjs";
import { createJobManager } from "../jobs/job-manager.mjs";
import { createProtocolEventBus } from "../../../../protocols/pubsub/event-bus.mjs";

export async function createSourceWatcherWorkerRuntime({ userDataPath }) {
  const protocolEventBus = createProtocolEventBus({ userDataPath });
  const jobManager = createJobManager({
    userDataPath,
    processingEnabled: false,
    protocolEventBus
  });
  const knowledgeSourceService = await createKnowledgeSourceService({
    userDataPath,
    jobManager,
    protocolEventBus,
    watchingEnabled: true
  });
  await knowledgeSourceService.start();

  return {
    mode: "active",
    async tick() {
      const state = await knowledgeSourceService.reconcileWatchers();
      return {
        status: "running",
        details: {
          mode: "external_source_watcher",
          sources: state.summary
        }
      };
    },
    async close() {
      await knowledgeSourceService.close();
      await jobManager.close();
      await protocolEventBus.close?.();
    }
  };
}
