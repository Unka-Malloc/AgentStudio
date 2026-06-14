import {
  acknowledgeMonitorAlert,
  getMonitorAlertState,
  runMonitorAlertCycle,
  saveMonitorAlertConfig
} from "./monitor-alert-core/monitor-alerts.mjs";
import { getBackgroundProcessStatus } from "./process-status/background-process-status.mjs";
import { recoverBackgroundSupervisor } from "./supervisor-recovery/supervisor-recovery.mjs";
import {
  composeUnifiedSystemStatus,
  normalizeUnifiedRegistration
} from "./unified-registration-core/unified-registration.mjs";

export const DEVOPS_PROTOCOL_VERSION = "v0.0.1:platform:devops-1";

export function createDevopsProvider({ userDataPath = "" } = {}) {
  return Object.freeze({
    protocolVersion: DEVOPS_PROTOCOL_VERSION,
    getBackgroundProcessStatus(input = {}) {
      return getBackgroundProcessStatus(input.userDataPath || userDataPath);
    },
    getMonitorAlertState(input = {}) {
      return getMonitorAlertState(input.userDataPath || userDataPath, input);
    },
    saveMonitorAlertConfig(input = {}) {
      return saveMonitorAlertConfig(input.userDataPath || userDataPath, input.config || input);
    },
    runMonitorAlertCycle(input = {}) {
      return runMonitorAlertCycle(input.userDataPath || userDataPath, input);
    },
    acknowledgeMonitorAlert(input = {}) {
      return acknowledgeMonitorAlert(
        input.userDataPath || userDataPath,
        input.alertId || input["alert-id"] || input.id || "",
        input
      );
    },
    async recoverBackgroundSupervisor(input = {}) {
      const effectiveUserDataPath = input.userDataPath || userDataPath;
      const backgroundStatus = input.backgroundStatus ||
        await getBackgroundProcessStatus(effectiveUserDataPath);
      return recoverBackgroundSupervisor({
        ...input,
        userDataPath: effectiveUserDataPath,
        backgroundStatus
      });
    },
    createMonitorAlertApi({ queueMonitor = null } = {}) {
      return Object.freeze({
        getState: () => getMonitorAlertState(userDataPath, { queueMonitor }),
        saveConfig: (input = {}) => saveMonitorAlertConfig(userDataPath, input),
        acknowledge: (alertId = "") => acknowledgeMonitorAlert(userDataPath, alertId, { queueMonitor })
      });
    },
    normalizeUnifiedRegistration,
    composeUnifiedSystemStatus,
    listCapabilities() {
      return {
        protocolVersion: DEVOPS_PROTOCOL_VERSION,
        capabilities: [
          {
            id: "process-status",
            kind: "observation",
            operations: ["getBackgroundProcessStatus"]
          },
          {
            id: "monitor-alerts",
            kind: "observation-and-control",
            operations: [
              "getMonitorAlertState",
              "saveMonitorAlertConfig",
              "runMonitorAlertCycle",
              "acknowledgeMonitorAlert",
              "recoverBackgroundSupervisor",
              "createMonitorAlertApi"
            ]
          },
          {
            id: "unified-registration",
            kind: "normalization",
            operations: ["normalizeUnifiedRegistration", "composeUnifiedSystemStatus"]
          }
        ]
      };
    }
  });
}
