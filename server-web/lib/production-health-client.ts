import { getJson } from "./bridge-http";
import type { ProductionHealthResponse, V001BaselineStatus } from "./types";

export function getProductionHealth() {
  return getJson<ProductionHealthResponse>("/api/production/health");
}

export function getV001BaselineStatus() {
  return getJson<V001BaselineStatus>("/api/v001/baseline/status");
}
