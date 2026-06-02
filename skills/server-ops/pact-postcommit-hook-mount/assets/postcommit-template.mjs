export function createMount({ mountName }) {
  return {
    id: `custom/${mountName}`,
    kind: mountName,
    enabled: true,

    async onBatchCompleted({ batchId, jobId, result, settings }) {
      const payload = {
        batchId,
        jobId,
        generatedAt: result?.generatedAt || "",
        sourceCount: result?.sourceFiles?.length || 0,
        chunkCount: result?.chunks?.length || 0,
        settings
      };

      // Replace this with vector DB, graph DB, or knowledge-base sync logic.
      return payload;
    },

    async reload() {},
    async close() {}
  };
}
