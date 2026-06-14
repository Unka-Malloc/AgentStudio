import { getProductionHealth, getV001BaselineStatus } from "./production-health-client";
import type { ProductionHealthResponse, V001BaselineStatus } from "./types";

type VersionReleaseSnapshot = {
  baseline?: V001BaselineStatus;
  baselineError?: string;
  productionHealth?: ProductionHealthResponse;
  productionHealthError?: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function loadVersionReleaseSnapshot(): Promise<VersionReleaseSnapshot> {
  const [baselineResult, productionHealthResult] = await Promise.allSettled([
    getV001BaselineStatus(),
    getProductionHealth(),
  ]);
  const snapshot: VersionReleaseSnapshot = {};
  if (baselineResult.status === "fulfilled") {
    snapshot.baseline = baselineResult.value;
  } else {
    snapshot.baselineError = errorMessage(baselineResult.reason);
  }
  if (productionHealthResult.status === "fulfilled") {
    snapshot.productionHealth = productionHealthResult.value;
  } else {
    snapshot.productionHealthError = errorMessage(productionHealthResult.reason);
  }
  return snapshot;
}

export type { ProductionHealthResponse, V001BaselineStatus };
