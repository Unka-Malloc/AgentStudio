import { useServerConsoleShellContext } from "./serverConsoleShellContext";

export function useModulesViewConsole() {
  const {
    busyKey,
    canBrowseServerPaths,
    consoleState,
    disableMountModule,
    enableMountModule,
    enabledMountCount,
    moduleGroups,
    mountDraft,
    openMountPathPicker,
    totalMountCount,
  } = useServerConsoleShellContext();

  return {
    busyKey,
    canBrowseServerPaths,
    consoleState,
    disableMountModule,
    enableMountModule,
    enabledMountCount,
    moduleGroups,
    mountDraft,
    openMountPathPicker,
    totalMountCount,
  };
}
