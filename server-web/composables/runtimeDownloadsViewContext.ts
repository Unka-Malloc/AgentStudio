import { inject, provide, type InjectionKey } from "vue";
import type { useRuntimeDownloadsViewController } from "./console-runtime-downloads-view-controller";

export type RuntimeDownloadsViewContext = ReturnType<typeof useRuntimeDownloadsViewController>;

const runtimeDownloadsViewKey = Symbol("runtime-downloads-view") as InjectionKey<RuntimeDownloadsViewContext>;

export function provideRuntimeDownloadsView(context: RuntimeDownloadsViewContext) {
  provide(runtimeDownloadsViewKey, context);
}

export function useRuntimeDownloadsViewContext() {
  const context = inject(runtimeDownloadsViewKey);
  if (!context) {
    throw new Error("Runtime downloads view context is not available");
  }
  return context;
}
