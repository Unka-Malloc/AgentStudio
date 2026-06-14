export function createNoopDocumentOutlineRuntime() {
  return {
    protocolVersion: "v0.0.1:knowledge:document-outline-1",
    build({ document = {}, sections = [], blocks = [], assets = [] } = {}) {
      return {
        protocolVersion: "v0.0.1:knowledge:document-outline-1",
        documentId: document.documentId || "",
        nodeCount: 0,
        syntheticNodeCount: 0,
        nodes: [],
        qualityFindings: [{
          code: "outline_runtime_disabled",
          severity: "low",
          message: "Document outline runtime is disabled by the active feature profile."
        }],
        sourceStats: {
          sectionCount: Array.isArray(sections) ? sections.length : 0,
          blockCount: Array.isArray(blocks) ? blocks.length : 0,
          assetCount: Array.isArray(assets) ? assets.length : 0
        }
      };
    },
    rangeContainsPosition() {
      return false;
    }
  };
}

export async function resolveDocumentOutlineRuntime({ enabled = true } = {}) {
  if (!enabled) {
    return createNoopDocumentOutlineRuntime();
  }
  const { createDocumentOutlineRuntime } = await import("./DocumentOutlineRuntime.mjs");
  return createDocumentOutlineRuntime();
}
