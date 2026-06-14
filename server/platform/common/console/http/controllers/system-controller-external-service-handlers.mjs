import { sendJson } from "../http-utils.mjs";
import {
  describeExternalServices,
  adoptExternalServiceTools,
  inspectExternalServiceHealth,
  promoteExternalServiceTools,
  rollbackExternalServiceTools,
  refreshExternalServiceRuntime,
  saveExternalServiceConfig,
  verifyExternalServiceProductionGates,
  verifyExternalServiceConfigPayload
} from "../../../composition-management/external-service-registry.mjs";
import {
  createExternalServiceDraft,
  listExternalServiceTemplates
} from "../../../composition-management/external-service-template-catalog.mjs";

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
    async handleExternalServiceTemplates({ response }) {
      sendJson(response, 200, {
        ok: true,
        ...listExternalServiceTemplates()
      });
    },
    async handleExternalServiceTemplateDraft({ requestBody, response }) {
      const payload = parsePayload(requestBody);
      const draft = createExternalServiceDraft({
        templateId: payload.templateId,
        serviceId: payload.serviceId
      });
      sendJson(response, 200, {
        ok: true,
        draft,
        draftText: `${JSON.stringify(draft, null, 2)}\n`
      });
    },
    async handleExternalServiceConfigSave({ requestBody, response }) {
      const result = await saveExternalServiceConfig({
        userDataPath,
        payload: parsePayload(requestBody)
      });
      if (result.ok) {
        const refresh = getToolManagementPlatform()?.refreshExternalServiceTools?.(result.catalogChange);
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
      const refresh = getToolManagementPlatform()?.refreshExternalServiceTools?.(result.catalogChange);
      if (refresh) {
        result.toolCatalogRefresh = refresh;
      }
      sendJson(response, 200, result);
    },
    async handleExternalServiceProductionVerify({ requestBody, response }) {
      const payload = parsePayload(requestBody);
      try {
        const result = await verifyExternalServiceProductionGates({
          userDataPath,
          serviceId: payload.serviceId,
          candidateVersionId: payload.candidateVersionId || "",
          expectedCandidateVersionId: payload.expectedCandidateVersionId || "",
          expectedCandidateFingerprint: payload.expectedCandidateFingerprint || "",
          verifierId: payload.verifierId || "",
          verifiedBy: payload.verifiedBy || payload.operatorId || "operator"
        });
        const refresh = getToolManagementPlatform()?.refreshExternalServiceTools?.(result.catalogChange);
        if (refresh) {
          result.toolCatalogRefresh = refresh;
        }
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, error?.statusCode || 400, {
          ok: false,
          error: error instanceof Error ? error.message : "External service production verification failed.",
          code: error?.code || "external_service_production_verification_failed",
          details: {
            serviceId: error?.serviceId || payload.serviceId || "",
            expectedCandidateVersionId: error?.expectedCandidateVersionId || "",
            currentCandidateVersionId: error?.currentCandidateVersionId || "",
            expectedCandidateFingerprint: error?.expectedCandidateFingerprint || "",
            currentCandidateFingerprint: error?.currentCandidateFingerprint || "",
            manifestFingerprint: error?.manifestFingerprint || "",
            cacheManifestFingerprint: error?.cacheManifestFingerprint || ""
          }
        });
      }
    },
    async handleExternalServiceToolsAdopt({ requestBody, response }) {
      const payload = parsePayload(requestBody);
      try {
        const result = await adoptExternalServiceTools({
          userDataPath,
          serviceId: payload.serviceId,
          toolNames: payload.toolNames,
          adoptAll: payload.adoptAll === true,
          adoptedBy: payload.adoptedBy || "operator",
          expectedFingerprints: payload.expectedFingerprints || {},
          acknowledgeRisk: payload.acknowledgeRisk === true,
          allowRiskyTools: payload.allowRiskyTools === true
        });
        const refresh = getToolManagementPlatform()?.refreshExternalServiceTools?.(result.catalogChange);
        if (refresh) {
          result.toolCatalogRefresh = refresh;
        }
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, error?.statusCode || 400, {
          ok: false,
          error: error instanceof Error ? error.message : "External service tool adoption failed.",
          code: error?.code || "external_service_tool_adoption_failed",
          details: {
            toolName: error?.toolName || "",
            expectedFingerprint: error?.expectedFingerprint || "",
            currentFingerprint: error?.currentFingerprint || "",
            blockingFlagCodes: error?.blockingFlagCodes || []
          }
        });
      }
    },
    async handleExternalServiceToolsPromote({ requestBody, response }) {
      const payload = parsePayload(requestBody);
      try {
        const result = await promoteExternalServiceTools({
          userDataPath,
          serviceId: payload.serviceId,
          toolNames: payload.toolNames,
          adoptAll: payload.adoptAll === true,
          promotedBy: payload.promotedBy || payload.adoptedBy || "operator",
          expectedFingerprints: payload.expectedFingerprints || {},
          candidateVersionId: payload.candidateVersionId || "",
          expectedCandidateVersionId: payload.expectedCandidateVersionId || "",
          expectedCandidateFingerprint: payload.expectedCandidateFingerprint || "",
          acknowledgeRisk: payload.acknowledgeRisk === true,
          allowRiskyTools: payload.allowRiskyTools === true
        });
        const refresh = getToolManagementPlatform()?.refreshExternalServiceTools?.(result.catalogChange);
        if (refresh) {
          result.toolCatalogRefresh = refresh;
        }
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, error?.statusCode || 400, {
          ok: false,
          error: error instanceof Error ? error.message : "External service tool promotion failed.",
          code: error?.code || "external_service_tool_promotion_failed",
          details: {
            toolName: error?.toolName || "",
            expectedFingerprint: error?.expectedFingerprint || "",
            currentFingerprint: error?.currentFingerprint || "",
            expectedCandidateVersionId: error?.expectedCandidateVersionId || "",
            currentCandidateVersionId: error?.currentCandidateVersionId || "",
            expectedCandidateFingerprint: error?.expectedCandidateFingerprint || "",
            currentCandidateFingerprint: error?.currentCandidateFingerprint || "",
            blockingFlagCodes: error?.blockingFlagCodes || []
          }
        });
      }
    },
    async handleExternalServiceToolsRollback({ requestBody, response }) {
      const payload = parsePayload(requestBody);
      try {
        const result = await rollbackExternalServiceTools({
          userDataPath,
          serviceId: payload.serviceId,
          targetVersionId: payload.targetVersionId || "",
          rolledBackBy: payload.rolledBackBy || "operator",
          reason: payload.reason || "operator_rollback"
        });
        const refresh = getToolManagementPlatform()?.refreshExternalServiceTools?.(result.catalogChange);
        if (refresh) {
          result.toolCatalogRefresh = refresh;
        }
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, error?.statusCode || 400, {
          ok: false,
          error: error instanceof Error ? error.message : "External service rollback failed.",
          code: error?.code || "external_service_tool_rollback_failed",
          details: {
            targetVersionId: error?.targetVersionId || ""
          }
        });
      }
    },
    async handleExternalServiceHealthInspect({ requestBody, response }) {
      const payload = parsePayload(requestBody);
      const result = await inspectExternalServiceHealth({
        userDataPath,
        serviceId: payload.serviceId
      });
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
