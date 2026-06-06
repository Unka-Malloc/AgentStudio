import { ref } from "vue";
import { describe, expect, it } from "vitest";
import { createConsoleKnowledgeIngestTargetController } from "../../../server-web/composables/console-knowledge-ingest-target-controller";
import type { KnowledgeIngestTargetKind } from "../../../server-web/lib/types";

function createFixture() {
  const knowledgeIngestTargets = ref<Record<KnowledgeIngestTargetKind, boolean>>({
    global: false,
    external: false,
    team: false,
    user: false,
  });
  const knowledgeIngestExternalProvider = ref("dify");
  const knowledgeIngestExternalRefs = ref("");
  const knowledgeIngestExternalTargetLabels = ref<Record<string, string>>({});
  const knowledgeIngestTeamRefs = ref("");
  const knowledgeIngestUserRefs = ref("");
  const realKnowledgeBackendSpaces = ref<Array<Record<string, unknown>>>([
    { provider: "Dify", spaceId: "space-a", title: "Alpha" },
    { provider: "dify", spaceId: "space-a", title: "Duplicate" },
    { provider: "ragflow", spaceId: "space-b", label: "Beta" },
    { provider: "ragflow", spaceId: "", label: "Ignored" },
    { provider: "", spaceId: "space-c", label: "Ignored" },
  ]);

  const controller = createConsoleKnowledgeIngestTargetController({
    externalProviderLabel: (provider) => `provider:${String(provider || "") || "fallback"}`,
    knowledgeBackendSpaceDisplayName: (space, providerLabel) =>
      `${providerLabel} / ${String(space.title || space.label || space.spaceId || "")}`,
    knowledgeIngestExternalProvider,
    knowledgeIngestExternalRefs,
    knowledgeIngestExternalTargetLabels,
    knowledgeIngestTargets,
    knowledgeIngestTeamRefs,
    knowledgeIngestUserRefs,
    knowledgeLibraryDisplayTitle: (provider, fallback) => String(provider || fallback),
    realKnowledgeBackendSpaces,
    textField: (record, key, fallback = "") => String(record[key] ?? fallback).trim(),
  });

  return {
    controller,
    knowledgeIngestExternalProvider,
    knowledgeIngestExternalRefs,
    knowledgeIngestExternalTargetLabels,
    knowledgeIngestTargets,
    knowledgeIngestTeamRefs,
    knowledgeIngestUserRefs,
    realKnowledgeBackendSpaces,
  };
}

describe("console knowledge ingest target controller extra coverage", () => {
  it("builds deduped target options and exposes the empty summary state", () => {
    const { controller } = createFixture();

    expect(controller.knowledgeIngestTargetOptions.value).toEqual([
      {
        value: "external:dify:space-a",
        label: "Dify / Alpha",
        provider: "dify",
        spaceId: "space-a",
      },
      {
        value: "external:ragflow:space-b",
        label: "ragflow / Beta",
        provider: "ragflow",
        spaceId: "space-b",
      },
    ]);
    expect(controller.parseKnowledgeIngestExternalValue("external:dify:space-a")).toEqual({
      provider: "dify",
      spaceId: "space-a",
    });
    expect(controller.parseKnowledgeIngestExternalValue("dify:space-a")).toBeNull();
    expect(controller.parseKnowledgeIngestExternalRef("space-x")).toBe("external:dify:space-x");
    expect(controller.parseKnowledgeIngestExternalRef("")).toBe("");
    expect(controller.knowledgeIngestTargetValues.value).toEqual([]);
    expect(controller.knowledgeIngestTargetDisplaySummary.value).toBe("请选择入库目标");
  });

  it("round-trips selected values and clears unrelated form fields", () => {
    const {
      controller,
      knowledgeIngestExternalProvider,
      knowledgeIngestExternalRefs,
      knowledgeIngestExternalTargetLabels,
      knowledgeIngestTargets,
      knowledgeIngestTeamRefs,
      knowledgeIngestUserRefs,
    } = createFixture();

    controller.setKnowledgeIngestTargetValues([
      "global",
      "external:dify:space-a",
      "external:ragflow:space-b",
      "ignored",
      1,
    ]);

    expect(knowledgeIngestTargets.value).toEqual({
      global: false,
      external: true,
      team: false,
      user: false,
    });
    expect(knowledgeIngestExternalProvider.value).toBe("dify");
    expect(knowledgeIngestExternalRefs.value).toBe("dify:space-a, ragflow:space-b");
    expect(knowledgeIngestExternalTargetLabels.value).toEqual({
      "dify:space-a": "Dify / Alpha",
      "ragflow:space-b": "ragflow / Beta",
    });
    expect(knowledgeIngestTeamRefs.value).toBe("");
    expect(knowledgeIngestUserRefs.value).toBe("");
    expect(controller.knowledgeIngestTargetValues.value).toEqual([
      "external:dify:space-a",
      "external:ragflow:space-b",
    ]);
    expect(controller.knowledgeIngestTargetDisplaySummary.value).toBe("将入库到：Dify / Alpha、ragflow / Beta");

    knowledgeIngestTargets.value = { global: true, external: true, team: false, user: false };
    knowledgeIngestExternalRefs.value = "dify:space-a, dify:missing, external:bad";
    expect(controller.knowledgeIngestTargetValues.value).toEqual(["external:dify:space-a"]);
    expect(controller.knowledgeIngestTargetDisplaySummary.value).toBe("将入库到：Dify / Alpha");

    controller.setKnowledgeIngestTargetValues([]);
    expect(knowledgeIngestTargets.value).toEqual({
      global: false,
      external: false,
      team: false,
      user: false,
    });
    expect(knowledgeIngestExternalRefs.value).toBe("");
    expect(controller.knowledgeIngestTargetValues.value).toEqual([]);
    expect(controller.knowledgeIngestTargetDisplaySummary.value).toBe("请选择入库目标");
  });
});
