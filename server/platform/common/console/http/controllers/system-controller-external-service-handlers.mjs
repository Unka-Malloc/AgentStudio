import { sendJson } from "../http-utils.mjs";
import {
  describeExternalServices,
  refreshExternalServiceRuntime,
  saveExternalServiceConfig,
  verifyExternalServiceConfigPayload
} from "../../../composition-management/external-service-registry.mjs";

export function createSystemControllerExternalServiceHandlers({
  parseJsonBody,
  userDataPath,
  getToolManagementPlatform = () => null
}) {
  function parsePayload(requestBody) {
    return requestBody?.length > 0 ? parseJsonBody(requestBody) : {};
  }

  return {
    async handleExternalServices({ response }) {
      sendJson(response, 200, await describeExternalServices({ userDataPath }));
    },
    async handleExternalServiceConfig({ response }) {
      sendJson(response, 200, await describeExternalServices({ userDataPath }));
    },
    async handleExternalServiceConfigSave({ requestBody, response }) {
      const result = await saveExternalServiceConfig({
        userDataPath,
        payload: parsePayload(requestBody)
      });
      if (result.ok) {
        const refresh = getToolManagementPlatform()?.refreshExternalServiceTools?.();
        if (refresh) {
          result.toolCatalogRefresh = refresh;
        }
      }
      sendJson(response, result.ok ? 200 : 400, result);
    },
    async handleExternalServiceRuntimeRefresh({ requestBody, response }) {
      const payload = parsePayload(requestBody);
      const result = await refreshExternalServiceRuntime({
        userDataPath,
        serviceId: payload.serviceId
      });
      const refresh = getToolManagementPlatform()?.refreshExternalServiceTools?.();
      if (refresh) {
        result.toolCatalogRefresh = refresh;
      }
      sendJson(response, 200, result);
    },
    async handleExternalServiceConfigVerify({ requestBody, response }) {
      const payload = parsePayload(requestBody);
      const result = await verifyExternalServiceConfigPayload({
        payload,
        requireKnownPaths: payload.requireKnownPaths === true
      });
      sendJson(response, 200, result);
    }
  };
}
