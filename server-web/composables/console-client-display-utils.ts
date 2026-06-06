import type { ClientMigrationState, ServerConsoleState } from "../lib/types";
import { migrationStateLabels } from "./console-defaults";
import { migrationTone } from "./console-status-utils";

type ClientConnectionRow = NonNullable<ServerConsoleState["clients"]["items"][number]>;

export function clientConnectionMethodLabel(client: ClientConnectionRow) {
  if (client.connectionKind === "mcp-plugin") {
    return "MCP 服务";
  }
  return String(client.connectionMethod || "pact-client 封装");
}

export function clientConnectionDetail(client: ClientConnectionRow) {
  if (client.connectionKind === "mcp-plugin") {
    return "";
  }
  if (client.connectionDetail) {
    return String(client.connectionDetail);
  }
  return "Discovery Check-in";
}

export function clientStatusLabel(client: ClientConnectionRow) {
  if (client.connectionKind === "mcp-plugin") {
    return String(client.connectionStatusLabel || "已配对");
  }
  return migrationStateLabels[client.migrationState as ClientMigrationState] || "未知";
}

export function clientStatusTone(client: ClientConnectionRow) {
  if (client.connectionKind !== "mcp-plugin") {
    return migrationTone(client.migrationState as ClientMigrationState);
  }

  if (
    client.connectionState === "disabled" ||
    client.connectionState === "revoked" ||
    client.connectionState === "offline"
  ) {
    return "offline";
  }
  if (client.connectionState === "pending") {
    return "attention";
  }
  return "online";
}

export function clientConfigReportLabel(client: ClientConnectionRow) {
  return String(client.configVersion || "").trim() ? "已上报" : "未上报";
}

export function clientConfigReportTone(client: ClientConnectionRow) {
  return String(client.configVersion || "").trim() ? "success" : "warning";
}
