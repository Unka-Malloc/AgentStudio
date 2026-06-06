import { inject, provide, type InjectionKey } from "vue";
import type { useServerConsoleShell } from "./useServerConsoleShell";

export type ServerConsoleShellContext = ReturnType<typeof useServerConsoleShell>;

const serverConsoleShellKey = Symbol("server-console-shell") as InjectionKey<ServerConsoleShellContext>;

export function provideServerConsoleShell(shell: ServerConsoleShellContext) {
  provide(serverConsoleShellKey, shell);
}

export function useServerConsoleShellContext() {
  const shell = inject(serverConsoleShellKey);
  if (!shell) {
    throw new Error("Server console shell context is not available");
  }
  return shell;
}
