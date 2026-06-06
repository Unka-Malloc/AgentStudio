export function createMount() {
  return {
    id: "custom/analysis",
    kind: "analysis",
    enabled: true,

    async listModules() {
      return [
        {
          id: "custom:analysis-v1",
          label: "Custom Analysis v1",
          description: "External analysis module"
        }
      ];
    },

    async runModule({ moduleId, sources = [], chunks = [], settings = {} }) {
      void moduleId;
      void chunks;
      void settings;
      return {
        emails: [],
        threads: [],
        transactions: [],
        people: [],
        timeline: [],
        network: {
          nodes: [],
          edges: []
        },
        associations: {
          summary: {
            totalCount: 0,
            strongCount: 0,
            continuationCount: 0,
            crossDepartmentCount: 0
          },
          items: []
        },
        warnings: sources.length === 0 ? ["analysis module received no sources"] : []
      };
    },

    async runAnalysis(input) {
      return this.runModule(input);
    },

    async close() {}
  };
}
