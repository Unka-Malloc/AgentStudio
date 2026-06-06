import { createCloudDrivePort } from "../agent/cloud-drive-port/index.mjs";

export const CLOUD_DRIVE_UPSTREAM_SERVICE_ID = "pact.upstream.cloud-drive";
export const CLOUD_DRIVE_UPSTREAM_TYPE = "cloud-drive";
export const CLOUD_DRIVE_UPSTREAM_GATEWAY_PROTOCOL_VERSION = "pact.cloud-drive-upstream-gateway.v1";

const CLOUD_DRIVE_OPERATION_SPECS = Object.freeze({
  "external.cloudDrive.connect": Object.freeze({ method: "connect", status: 200, legacyOperationId: "sharedspace.drive.connect" }),
  "external.cloudDrive.status": Object.freeze({ method: "status", status: 200, legacyOperationId: "sharedspace.drive.status" }),
  "external.cloudDrive.item.list": Object.freeze({ method: "listItems", status: 200, legacyOperationId: "sharedspace.drive.item.list" }),
  "external.cloudDrive.file.download": Object.freeze({ method: "downloadFile", status: 200, legacyOperationId: "sharedspace.drive.file.download" }),
  "external.cloudDrive.file.upload": Object.freeze({ method: "uploadFile", status: 201, legacyOperationId: "sharedspace.drive.file.upload" }),
  "external.cloudDrive.sync.plan": Object.freeze({ method: "syncPlan", status: 200, legacyOperationId: "sharedspace.drive.sync.plan" }),
  "external.cloudDrive.sync.apply": Object.freeze({ method: "syncApply", status: 200, legacyOperationId: "sharedspace.drive.sync.apply" }),
  "external.cloudDrive.permission.list": Object.freeze({ method: "permissionList", status: 200, legacyOperationId: "sharedspace.drive.permission.list" }),
  "sharedspace.drive.connect": Object.freeze({ method: "connect", status: 200, replacementOperationId: "external.cloudDrive.connect" }),
  "sharedspace.drive.status": Object.freeze({ method: "status", status: 200, replacementOperationId: "external.cloudDrive.status" }),
  "sharedspace.drive.item.list": Object.freeze({ method: "listItems", status: 200, replacementOperationId: "external.cloudDrive.item.list" }),
  "sharedspace.drive.file.download": Object.freeze({ method: "downloadFile", status: 200, replacementOperationId: "external.cloudDrive.file.download" }),
  "sharedspace.drive.file.upload": Object.freeze({ method: "uploadFile", status: 201, replacementOperationId: "external.cloudDrive.file.upload" }),
  "sharedspace.drive.sync.plan": Object.freeze({ method: "syncPlan", status: 200, replacementOperationId: "external.cloudDrive.sync.plan" }),
  "sharedspace.drive.sync.apply": Object.freeze({ method: "syncApply", status: 200, replacementOperationId: "external.cloudDrive.sync.apply" }),
  "sharedspace.drive.permission.list": Object.freeze({ method: "permissionList", status: 200, replacementOperationId: "external.cloudDrive.permission.list" })
});

export function isCloudDriveUpstreamGatewayOperation(operationId = "") {
  return Boolean(CLOUD_DRIVE_OPERATION_SPECS[String(operationId || "").trim()]);
}

function gatewayPayload(payload, operationId, spec) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  return {
    ...payload,
    upstreamService: {
      protocolVersion: CLOUD_DRIVE_UPSTREAM_GATEWAY_PROTOCOL_VERSION,
      serviceId: CLOUD_DRIVE_UPSTREAM_SERVICE_ID,
      upstreamType: CLOUD_DRIVE_UPSTREAM_TYPE,
      operationId,
      ...(spec.legacyOperationId ? { legacyOperationId: spec.legacyOperationId } : {}),
      ...(spec.replacementOperationId ? { replacementOperationId: spec.replacementOperationId } : {}),
      gatewayAspect: "upstream-service"
    }
  };
}

export function createCloudDriveUpstreamGateway({ userDataPath = "" } = {}) {
  const port = createCloudDrivePort({ userDataPath });
  return {
    protocolVersion: CLOUD_DRIVE_UPSTREAM_GATEWAY_PROTOCOL_VERSION,
    serviceId: CLOUD_DRIVE_UPSTREAM_SERVICE_ID,
    upstreamType: CLOUD_DRIVE_UPSTREAM_TYPE,
    async execute({ operationId = "", input = {} } = {}) {
      const id = String(operationId || "").trim();
      const spec = CLOUD_DRIVE_OPERATION_SPECS[id];
      if (!spec) {
        return null;
      }
      const method = port[spec.method];
      if (typeof method !== "function") {
        throw new Error(`Cloud drive upstream gateway method is not available: ${spec.method}`);
      }
      const payload = await method({
        ...input,
        operationId: id
      });
      return {
        status: spec.status,
        payload: gatewayPayload(payload, id, spec)
      };
    }
  };
}
