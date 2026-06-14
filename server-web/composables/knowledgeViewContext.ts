import { inject, provide, type InjectionKey } from "vue";
import type { useKnowledgeViewConsole } from "./useKnowledgeViewConsole";

export type KnowledgeViewContext = ReturnType<typeof useKnowledgeViewConsole>;
export type KnowledgeIngestContext = KnowledgeViewContext["ingest"];
export type KnowledgeLibraryContext = KnowledgeViewContext["library"];
export type KnowledgeMaintenanceContext = KnowledgeViewContext["maintenance"];
export type KnowledgeRulesContext = KnowledgeViewContext["rules"];
export type KnowledgeWordCloudContext = KnowledgeViewContext["wordCloud"];

const knowledgeIngestKey = Symbol("knowledge-ingest") as InjectionKey<KnowledgeIngestContext>;
const knowledgeLibraryKey = Symbol("knowledge-library") as InjectionKey<KnowledgeLibraryContext>;
const knowledgeMaintenanceKey = Symbol("knowledge-maintenance") as InjectionKey<KnowledgeMaintenanceContext>;
const knowledgeRulesKey = Symbol("knowledge-rules") as InjectionKey<KnowledgeRulesContext>;
const knowledgeWordCloudKey = Symbol("knowledge-word-cloud") as InjectionKey<KnowledgeWordCloudContext>;

export function provideKnowledgeView(context: KnowledgeViewContext) {
  provide(knowledgeIngestKey, context.ingest);
  provide(knowledgeLibraryKey, context.library);
  provide(knowledgeMaintenanceKey, context.maintenance);
  provide(knowledgeRulesKey, context.rules);
  provide(knowledgeWordCloudKey, context.wordCloud);
}

function useRequiredKnowledgeContext<T>(key: InjectionKey<T>, label: string) {
  const context = inject(key);
  if (!context) {
    throw new Error(`${label} context is not available`);
  }
  return context;
}

export function useKnowledgeIngestContext() {
  return useRequiredKnowledgeContext(knowledgeIngestKey, "Knowledge ingest");
}

export function useKnowledgeLibraryContext() {
  return useRequiredKnowledgeContext(knowledgeLibraryKey, "Knowledge library");
}

export function useKnowledgeMaintenanceContext() {
  return useRequiredKnowledgeContext(knowledgeMaintenanceKey, "Knowledge maintenance");
}

export function useKnowledgeRulesContext() {
  return useRequiredKnowledgeContext(knowledgeRulesKey, "Knowledge rules");
}

export function useKnowledgeWordCloudContext() {
  return useRequiredKnowledgeContext(knowledgeWordCloudKey, "Knowledge word-cloud");
}
