import { sendJson } from "../http-utils.mjs";
import {
  AppearancePresetConfigError,
  importServerAppearancePresetConfig,
  listServerAppearancePresetConfigs,
  parseAppearancePresetConfigText
} from "../../../appearance-presets/appearance-preset-store.mjs";

function parseBody(parseJsonBody, requestBody) {
  return requestBody?.length > 0 ? parseJsonBody(requestBody) : {};
}

function configFromImportPayload(payload) {
  if (typeof payload?.text === "string") {
    return parseAppearancePresetConfigText(payload.text);
  }
  if (payload?.config) {
    return payload.config;
  }
  return payload;
}

function errorPayload(error) {
  if (error instanceof AppearancePresetConfigError) {
    return {
      ok: false,
      error: error.message,
      errors: error.errors
    };
  }
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Appearance preset import failed."
  };
}

export function createSystemControllerAppearancePresetHandlers({
  parseJsonBody,
  userDataPath
}) {
  return {
    async handleAppearancePresets({ response }) {
      const result = await listServerAppearancePresetConfigs({ userDataPath });
      sendJson(response, 200, {
        ok: true,
        directory: result.directory,
        configs: result.configs,
        presets: result.configs,
        errors: result.errors
      });
    },

    async handleImportAppearancePreset({ requestBody, response }) {
      try {
        const payload = parseBody(parseJsonBody, requestBody);
        const result = await importServerAppearancePresetConfig({
          userDataPath,
          config: configFromImportPayload(payload)
        });
        sendJson(response, 200, {
          ok: true,
          directory: result.directory,
          fileName: result.fileName,
          config: result.config,
          configs: result.configs,
          presets: result.configs,
          errors: result.errors
        });
      } catch (error) {
        sendJson(response, 400, errorPayload(error));
      }
    }
  };
}
