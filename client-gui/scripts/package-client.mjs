import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const flutterClientRoot = path.join(workspaceRoot, "client-gui");
const clientBuildRoot = path.join(workspaceRoot, "build", "client-gui");
const nativeTargetRoot = path.join(workspaceRoot, "build", "client-cli", "target");
const defaultConfigPath = path.join(flutterClientRoot, "packaging.modules.json");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    platform: normalizePlatform(process.platform),
    mode: "release",
    configPath: defaultConfigPath,
    enabledOverrides: [],
    disabledOverrides: [],
    profile: null,
    skipFlutterBuild: false,
    skipNativeBuild: false,
    keepFlutterBuildCache: process.env.PACT_KEEP_FLUTTER_BUILD_CACHE === "1",
    dryRun: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--platform" && next) {
      options.platform = normalizePlatform(next);
      index += 1;
    } else if (arg === "--mode" && next) {
      options.mode = normalizeMode(next);
      index += 1;
    } else if (arg === "--config" && next) {
      options.configPath = path.resolve(next);
      index += 1;
    } else if ((arg === "--with" || arg === "--modules") && next) {
      options.enabledOverrides.push(...splitList(next));
      index += 1;
    } else if (arg === "--without" && next) {
      options.disabledOverrides.push(...splitList(next));
      index += 1;
    } else if (arg === "--profile" && next) {
      options.profile = normalizeProfile(next);
      index += 1;
    } else if (arg === "--skip-flutter-build") {
      options.skipFlutterBuild = true;
    } else if (arg === "--skip-native-build") {
      options.skipNativeBuild = true;
    } else if (arg === "--keep-flutter-build-cache") {
      options.keepFlutterBuildCache = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
      options.skipFlutterBuild = true;
      options.skipNativeBuild = true;
    } else {
      throw new Error(`Unknown packaging option: ${arg}`);
    }
  }
  return options;
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeProfile(value) {
  const normalized = String(value || "").trim();
  if (normalized === "future-client") {
    return normalized;
  }
  throw new Error(`Unsupported client package profile: ${value}`);
}

function normalizePlatform(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "darwin") {
    return "macos";
  }
  if (normalized === "win32") {
    return "windows";
  }
  if (["macos", "linux", "windows"].includes(normalized)) {
    return normalized;
  }
  throw new Error(`Unsupported client package platform: ${value}`);
}

function normalizeMode(value) {
  const normalized = String(value || "").toLowerCase();
  if (["debug", "profile", "release"].includes(normalized)) {
    return normalized;
  }
  throw new Error(`Unsupported client package mode: ${value}`);
}

function modeDirectoryName(mode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: workspaceRoot,
    stdio: "inherit",
    ...options
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function loadPackagingConfig(configPath) {
  const config = readJson(configPath);
  if (config.schemaVersion !== 1 || !config.modules || typeof config.modules !== "object") {
    throw new Error(`Invalid client packaging module config: ${configPath}`);
  }
  return config;
}

function platformSupported(moduleConfig, platform) {
  const platforms = Array.isArray(moduleConfig.platforms) ? moduleConfig.platforms : [];
  return platforms.length === 0 || platforms.includes(platform);
}

function selectModules(config, options) {
  const activeProfile = options.profile || config.packageProfile || "future-client";
  if (activeProfile !== "future-client") {
    throw new Error(`Unsupported client package profile: ${activeProfile}`);
  }
  const modules = Object.entries(config.modules).map(([id, moduleConfig]) => ({
    id,
    ...moduleConfig
  }));
  const overrides = new Map();
  for (const id of options.enabledOverrides) {
    overrides.set(id, true);
  }
  for (const id of options.disabledOverrides) {
    overrides.set(id, false);
  }

  const knownIds = new Set(modules.map((item) => item.id));
  for (const id of overrides.keys()) {
    if (!knownIds.has(id)) {
      throw new Error(`Unknown client packaging module override: ${id}`);
    }
  }

  const selected = [];
  const skipped = [];
  for (const moduleConfig of modules) {
    const supported = platformSupported(moduleConfig, options.platform);
    const enabled = overrides.has(moduleConfig.id)
      ? overrides.get(moduleConfig.id)
      : moduleConfig.enabled !== false;
    if (!supported) {
      skipped.push({ ...moduleConfig, status: "skipped-platform" });
      continue;
    }
    if (moduleConfig.required && !enabled) {
      throw new Error(`Required client packaging module cannot be disabled: ${moduleConfig.id}`);
    }
    if (!enabled) {
      skipped.push({ ...moduleConfig, status: "disabled" });
      continue;
    }
    selected.push({ ...moduleConfig, status: "enabled" });
  }

  const selectedIds = new Set(selected.map((item) => item.id));
  for (const moduleConfig of selected) {
    for (const dependency of moduleConfig.requires || []) {
      if (!selectedIds.has(dependency)) {
        throw new Error(
          `Client packaging module ${moduleConfig.id} requires disabled or unsupported module ${dependency}`
        );
      }
    }
  }
  return { selected, skipped };
}

function cargoProfile(mode) {
  return mode === "release" ? "release" : "debug";
}

function cargoTargetDir(mode) {
  return path.join(nativeTargetRoot, cargoProfile(mode));
}

function binarySuffix(platform) {
  return platform === "windows" ? ".exe" : "";
}

function buildNativeSidecars(selected, options) {
  const bins = [
    ...new Set(
      selected
        .filter((item) => item.cargoBin)
        .map((item) => item.cargoBin)
    )
  ];
  if (bins.length === 0 || options.skipNativeBuild || options.dryRun) {
    return;
  }
  const args = ["build", "--manifest-path", path.join("client-cli", "Cargo.toml")];
  if (options.mode === "release") {
    args.push("--release");
  }
  for (const bin of bins) {
    args.push("--bin", bin);
  }
  run("cargo", args, {
    env: {
      ...process.env,
      CARGO_TARGET_DIR: nativeTargetRoot
    }
  });
}

function buildSwiftSidecars(selected, options) {
  if (options.platform !== "macos" || options.skipNativeBuild || options.dryRun) {
    return;
  }
  for (const moduleConfig of selected.filter((item) => item.packaging === "swift-sidecar")) {
    const source = path.join(workspaceRoot, moduleConfig.swiftSource || "");
    const artifactName = moduleConfig.artifactName || moduleConfig.id;
    const target = path.join(cargoTargetDir(options.mode), artifactName);
    mkdirSync(path.dirname(target), { recursive: true });
    run("xcrun", ["swiftc", "-parse-as-library", "-O", "-o", target, source]);
    chmodSync(target, 0o755);
  }
}

function buildFlutterApp(options) {
  if (options.skipFlutterBuild || options.dryRun) {
    return false;
  }
  cleanStaleFlutterAppBundle(options);
  run("flutter", ["build", options.platform, `--${options.mode}`], {
    cwd: flutterClientRoot
  });
  return true;
}

function cleanStaleFlutterAppBundle(options) {
  if (options.platform !== "macos") {
    return;
  }
  const appDir = path.join(
    flutterClientRoot,
    "build",
    "macos",
    "Build",
    "Products",
    modeDirectoryName(options.mode),
    "flutter_client.app"
  );
  rmSync(appDir, { recursive: true, force: true });
}

function rawFlutterBuildRoot() {
  return path.join(flutterClientRoot, "build");
}

function packagedBundleRoot(options) {
  return path.join(clientBuildRoot, "bundles", options.platform, options.mode, "bundle");
}

function findLinuxBundleSource(mode) {
  const linuxBuildRoot = path.join(rawFlutterBuildRoot(), "linux");
  if (!existsSync(linuxBuildRoot)) {
    throw new Error(`Linux build directory does not exist: ${linuxBuildRoot}`);
  }
  const candidates = [];
  for (const arch of readdirSync(linuxBuildRoot)) {
    const bundleDir = path.join(linuxBuildRoot, arch, mode, "bundle");
    if (existsSync(path.join(bundleDir, "flutter_client"))) {
      candidates.push(bundleDir);
    }
  }
  if (candidates.length === 0) {
    throw new Error(`No Flutter Linux ${mode} bundle was produced.`);
  }
  candidates.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return candidates[0];
}

function findMacosBundleSource(mode) {
  const productsDir = path.join(
    rawFlutterBuildRoot(),
    "macos",
    "Build",
    "Products",
    modeDirectoryName(mode)
  );
  const appDir = path.join(productsDir, "flutter_client.app");
  if (!existsSync(path.join(appDir, "Contents", "MacOS", "flutter_client"))) {
    throw new Error(`macOS app bundle was not found: ${appDir}`);
  }
  return productsDir;
}

function findWindowsBundleSource(mode) {
  const modeDir = modeDirectoryName(mode);
  const candidates = [
    path.join(rawFlutterBuildRoot(), "windows", "x64", "runner", modeDir),
    path.join(rawFlutterBuildRoot(), "windows", "runner", modeDir)
  ];
  const bundleDir = candidates.find((item) => existsSync(path.join(item, "flutter_client.exe")));
  if (!bundleDir) {
    throw new Error(`Windows Flutter ${mode} bundle was not found.`);
  }
  return bundleDir;
}

function findFlutterBundleSource(options) {
  if (options.platform === "linux") {
    return findLinuxBundleSource(options.mode);
  }
  if (options.platform === "macos") {
    return findMacosBundleSource(options.mode);
  }
  return findWindowsBundleSource(options.mode);
}

function flutterExecutableForRoot(root, platform) {
  if (platform === "macos") {
    return path.join(root, "flutter_client.app", "Contents", "MacOS", "flutter_client");
  }
  return path.join(root, platform === "windows" ? "flutter_client.exe" : "flutter_client");
}

function stagedBundleExists(root, platform) {
  return existsSync(flutterExecutableForRoot(root, platform));
}

function stageFlutterBundle(options) {
  const source = findFlutterBundleSource(options);
  const target = packagedBundleRoot(options);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, dereference: false });
  return target;
}

function resolveBundle(options) {
  let root = packagedBundleRoot(options);
  if (!stagedBundleExists(root, options.platform)) {
    root = stageFlutterBundle(options);
  }
  if (options.platform === "linux") {
    return {
      root,
      executableDir: root,
      portableDataDir: path.join(root, "portable-data"),
      moduleResourceDir: path.join(root, "modules"),
      flutterExecutable: flutterExecutableForRoot(root, options.platform)
    };
  }
  if (options.platform === "macos") {
    const appDir = path.join(root, "flutter_client.app");
    return {
      root,
      executableDir: path.join(appDir, "Contents", "MacOS"),
      portableDataDir: path.join(root, "portable-data"),
      moduleResourceDir: path.join(root, "modules"),
      flutterExecutable: flutterExecutableForRoot(root, options.platform)
    };
  }
  return {
    root,
    executableDir: root,
    portableDataDir: path.join(root, "portable-data"),
    moduleResourceDir: path.join(root, "modules"),
    flutterExecutable: flutterExecutableForRoot(root, options.platform)
  };
}

function copySidecar(binaryName, bundle, options) {
  const suffix = binarySuffix(options.platform);
  const source = path.join(cargoTargetDir(options.mode), `${binaryName}${suffix}`);
  if (!existsSync(source)) {
    throw new Error(`Sidecar binary is missing: ${source}`);
  }
  const target = path.join(bundle.executableDir, `${binaryName}${suffix}`);
  copyFileSync(source, target);
  if (options.platform !== "windows") {
    chmodSync(target, 0o755);
  }
  return target;
}

function copySwiftSidecar(moduleConfig, bundle, options) {
  const artifactName = moduleConfig.artifactName || moduleConfig.id;
  const source = path.join(cargoTargetDir(options.mode), artifactName);
  if (!existsSync(source)) {
    throw new Error(`Swift sidecar is missing: ${source}`);
  }
  const target = path.join(bundle.executableDir, artifactName);
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  return target;
}

function copyModuleResources(moduleConfig, bundle) {
  const copied = [];
  for (const includePath of moduleConfig.includePaths || []) {
    const source = path.join(workspaceRoot, includePath);
    if (!existsSync(source)) {
      throw new Error(`Module resource path does not exist: ${source}`);
    }
    const target = path.join(bundle.moduleResourceDir, moduleConfig.id, path.basename(source));
    rmSync(target, { recursive: true, force: true });
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true, dereference: false });
    copied.push(target);
  }
  return copied;
}

function removeSkippedArtifacts(skipped, bundle) {
  for (const moduleConfig of skipped) {
    if (moduleConfig.packaging === "swift-sidecar") {
      const artifactName = moduleConfig.artifactName || moduleConfig.id;
      rmSync(path.join(bundle.executableDir, artifactName), { force: true });
    } else if (moduleConfig.packaging === "module-resources") {
      rmSync(path.join(bundle.moduleResourceDir, moduleConfig.id), { recursive: true, force: true });
    }
  }
}

function targetSkippedModules(skipped) {
  return skipped.filter((item) => item.status !== "skipped-platform");
}

function preparePortableData(config, selected, skipped, bundle, options) {
  mkdirSync(bundle.portableDataDir, { recursive: true });
  for (const moduleConfig of selected) {
    for (const directory of moduleConfig.portableDirectories || []) {
      mkdirSync(path.join(bundle.portableDataDir, directory), { recursive: true });
    }
  }
  const manifestPath = path.join(
    bundle.root,
    config.bundle?.manifestPath || "portable-data/future-client/packaging-modules.json"
  );
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform: options.platform,
    mode: options.mode,
    configPath: path.relative(workspaceRoot, options.configPath),
    bundleRoot: bundle.root,
    flutterExecutable: bundle.flutterExecutable,
    featureProfile: config.featureProfile || null,
    modules: selected.map(publicModuleRecord),
    skippedModules: targetSkippedModules(skipped).map(publicModuleRecord)
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

function publicModuleRecord(moduleConfig) {
  return {
    id: moduleConfig.id,
    label: moduleConfig.label || moduleConfig.id,
    category: moduleConfig.category || "",
    packaging: moduleConfig.packaging || "",
    profile: moduleConfig.profile || "",
    required: moduleConfig.required === true,
    status: moduleConfig.status || ""
  };
}

function writeBundleNotes(config, selected, bundle, options) {
  const lines = [
    `Pact ${options.platform} Client Bundle`,
    "",
    "Run the Flutter desktop frontend from this bundle.",
    "The frontend resolves pact-client as its future client sidecar.",
    "Run pact-client for command-line operations against the same portable-data workspace.",
    "",
    "Enabled modules:",
    ...selected.map((item) => `- ${item.id}: ${item.label || item.id}`),
    "",
    `Packaging config: ${path.relative(workspaceRoot, options.configPath)}`,
    `Packaging manifest: ${path.relative(bundle.root, path.join(bundle.root, config.bundle?.manifestPath || "portable-data/future-client/packaging-modules.json"))}`,
    ""
  ];
  const fileName = options.platform === "windows" ? "README-windows.txt" : `README-${options.platform}.txt`;
  writeFileSync(path.join(bundle.root, fileName), lines.join("\n"), "utf8");
}

function macosEntitlementsPath(mode) {
  const fileName = mode === "release" ? "Release.entitlements" : "DebugProfile.entitlements";
  return path.join(flutterClientRoot, "macos", "Runner", fileName);
}

function signMacosArtifact(artifactPath, entitlementsPath) {
  run("codesign", ["--force", "--sign", "-", "--entitlements", entitlementsPath, artifactPath]);
}

function signMacosBundle(bundle, copiedArtifacts, options) {
  if (options.platform !== "macos") {
    return;
  }
  const entitlementsPath = macosEntitlementsPath(options.mode);
  if (!existsSync(entitlementsPath)) {
    throw new Error(`macOS entitlements file is missing: ${entitlementsPath}`);
  }
  for (const artifact of copiedArtifacts) {
    if (existsSync(artifact) && statSync(artifact).isFile()) {
      signMacosArtifact(artifact, entitlementsPath);
    }
  }
  const appDir = path.resolve(bundle.executableDir, "..", "..");
  signMacosArtifact(appDir, entitlementsPath);
}

function applyPackage(config, selected, skipped, options) {
  const bundle = resolveBundle(options);
  mkdirSync(bundle.executableDir, { recursive: true });
  mkdirSync(bundle.moduleResourceDir, { recursive: true });
  removeSkippedArtifacts(skipped, bundle);

  const copiedArtifacts = [];
  for (const moduleConfig of selected) {
    if (moduleConfig.cargoBin) {
      copiedArtifacts.push(copySidecar(moduleConfig.cargoBin, bundle, options));
    } else if (moduleConfig.packaging === "swift-sidecar") {
      copiedArtifacts.push(copySwiftSidecar(moduleConfig, bundle, options));
    } else if (moduleConfig.packaging === "module-resources") {
      copiedArtifacts.push(...copyModuleResources(moduleConfig, bundle));
    }
  }
  const manifestPath = preparePortableData(config, selected, skipped, bundle, options);
  writeBundleNotes(config, selected, bundle, options);
  signMacosBundle(bundle, copiedArtifacts, options);
  return { bundle, copiedArtifacts, manifestPath };
}

function cleanupFlutterBuildCache(options, flutterBuildRan) {
  if (!flutterBuildRan || options.keepFlutterBuildCache) {
    return;
  }
  rmSync(rawFlutterBuildRoot(), { recursive: true, force: true });
}

function printPlan(selected, skipped, options, config) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        platform: options.platform,
        mode: options.mode,
        profile: options.profile || config.packageProfile || "future-client",
        configPath: options.configPath,
        enabledModules: selected.map(publicModuleRecord),
        skippedModules: skipped.map(publicModuleRecord)
      },
      null,
      2
    )
  );
}

export function packageClient(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const config = loadPackagingConfig(options.configPath);
  const { selected, skipped } = selectModules(config, options);
  if (options.dryRun) {
    printPlan(selected, skipped, options, config);
    return null;
  }
  buildNativeSidecars(selected, options);
  buildSwiftSidecars(selected, options);
  const flutterBuildRan = buildFlutterApp(options);
  if (flutterBuildRan) {
    rmSync(packagedBundleRoot(options), { recursive: true, force: true });
  }
  const result = applyPackage(config, selected, skipped, options);
  cleanupFlutterBuildCache(options, flutterBuildRan);
  console.log("");
  console.log(`${options.platform} client bundle ready: ${result.bundle.root}`);
  console.log(`Flutter executable: ${result.bundle.flutterExecutable}`);
  console.log(`Portable data dir: ${result.bundle.portableDataDir}`);
  console.log(`Packaging manifest: ${result.manifestPath}`);
  for (const artifact of result.copiedArtifacts) {
    console.log(`Packaged artifact: ${artifact}`);
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    packageClient();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
