import { getJson } from "./bridge-http";
import type { ServerConsoleState } from "./types";

export function getServerConsoleState() {
  return getJson<ServerConsoleState>("/api/console/state");
}
