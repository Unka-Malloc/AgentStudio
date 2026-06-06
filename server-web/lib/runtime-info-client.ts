import { getJson, postJson } from "./bridge-http";
import type {
  RuntimeInfoResponse,
  ServerPathBrowseResponse,
} from "./types";

export type ServerPathBrowsePayload = {
  path?: string;
  mode?: "directory" | "file";
  extensions?: string[];
  includeHidden?: boolean;
};

export function getRuntimeInfo() {
  return getJson<RuntimeInfoResponse>("/api/runtime/info");
}

export function browseServerPath(payload: ServerPathBrowsePayload) {
  return postJson<ServerPathBrowseResponse>("/api/runtime/path-browse", payload);
}
