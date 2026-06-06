export function createMount({ mountName, userDataPath, runtimeOptions }) {
  return {
    id: `custom/${mountName}`,
    kind: mountName,
    enabled: true,

    supports({ extension = "", mediaTypeHint = "", sourceKind = "" } = {}) {
      return Boolean(extension || mediaTypeHint || sourceKind);
    },

    async extractDocument({ filePath = "", fileName = "", buffer = null }) {
      return {
        parserId: `custom/${mountName}`,
        mediaType: "",
        metadata: {
          fileName,
          filePath
        },
        text: buffer ? buffer.toString("utf8") : "",
        embeddedDocuments: []
      };
    },

    async extractText(input) {
      const document = await this.extractDocument(input);
      return document.text || "";
    },

    async onBatchCompleted({ batchId, jobId, result }) {
      void userDataPath;
      void runtimeOptions;
      void batchId;
      void jobId;
      void result;
    },

    async reload({ settings }) {
      void settings;
    },

    async close() {}
  };
}
