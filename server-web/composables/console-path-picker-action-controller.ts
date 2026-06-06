import type { Ref } from "vue";
import type { AgentSettings } from "../lib/types";
import type { PathPickerMode } from "../types/app";

type OpenServerPathPicker = (options: {
  title: string;
  mode: PathPickerMode;
  value?: string;
  extensions?: string[];
  closeOnSelect?: boolean;
  applyPath: (nextPath: string) => void;
}) => void;

type CorpusPathInput = {
  path: string;
  type: "directory" | "file";
};

type SettingsPathField = "ocrPythonPath" | "tikaJarPath" | "javaBinPath";

type ConsolePathPickerActionControllerOptions = {
  addWordCloudCorpusPaths: (nextItems: CorpusPathInput[]) => void | Promise<void>;
  applyLocalSourceDirectoryPath: (nextPath: string) => void;
  localSourceForm: Ref<{ directoryPath: string }>;
  openServerPathPicker: OpenServerPathPicker;
  settingsDraft: Ref<AgentSettings>;
};

export function createConsolePathPickerActionController(
  options: ConsolePathPickerActionControllerOptions,
) {
  function openLocalSourceDirectoryPicker() {
    options.openServerPathPicker({
      title: "选择本地目录",
      mode: "directory",
      value: options.localSourceForm.value.directoryPath,
      applyPath: (nextPath) => {
        options.applyLocalSourceDirectoryPath(nextPath);
      },
    });
  }

  function openWordCloudCorpusDirectoryPicker() {
    options.openServerPathPicker({
      title: "选择词云语料目录",
      mode: "directory",
      closeOnSelect: false,
      applyPath: (nextPath) => {
        void options.addWordCloudCorpusPaths([{ path: nextPath, type: "directory" }]);
      },
    });
  }

  function openWordCloudCorpusFilePicker() {
    options.openServerPathPicker({
      title: "选择词云语料文件",
      mode: "file",
      closeOnSelect: false,
      applyPath: (nextPath) => {
        void options.addWordCloudCorpusPaths([{ path: nextPath, type: "file" }]);
      },
    });
  }

  function openSettingsPathPicker(
    field: SettingsPathField,
    title: string,
    extensions: string[] = [],
  ) {
    options.openServerPathPicker({
      title,
      mode: "file",
      value: String(options.settingsDraft.value[field] || ""),
      extensions,
      applyPath: (nextPath) => {
        options.settingsDraft.value = {
          ...options.settingsDraft.value,
          [field]: nextPath,
        };
      },
    });
  }

  return {
    openLocalSourceDirectoryPicker,
    openSettingsPathPicker,
    openWordCloudCorpusDirectoryPicker,
    openWordCloudCorpusFilePicker,
  };
}
