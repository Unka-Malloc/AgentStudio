import { createHash } from "node:crypto";

export const EMBEDDING_PROTOCOL_VERSION = "v0.0.1:knowledge:embedding-1";

export const DEFAULT_EMBEDDING_DIMENSION = 128;
export const DEFAULT_RUNTIME_PROVIDER_ID = "builtin:hashing-vector-runtime";
export const DEFAULT_TEXT_PROVIDER_ID = "builtin:hashing-multilingual-v1";
export const DEFAULT_IMAGE_PROVIDER_ID = "builtin:asset-ocr-caption-v1";
export const DEFAULT_JOINT_PROVIDER_ID = "builtin:mixed-evidence-v1";

export const DEFAULT_LICENSE_MANIFEST = {
  policy: "MIT_OR_APACHE2_COMPATIBLE_ONLY",
  acceptedLicenses: ["MIT", "Apache-2.0", "MIT OR Apache-2.0", "project-internal"],
  components: [
    {
      id: DEFAULT_RUNTIME_PROVIDER_ID,
      role: "offline deterministic hashing embedding runtime",
      license: "project-internal",
      status: "offline-fallback"
    },
    {
      id: DEFAULT_TEXT_PROVIDER_ID,
      role: "offline deterministic text embedding fallback",
      license: "project-internal",
      status: "offline-fallback"
    },
    {
      id: DEFAULT_IMAGE_PROVIDER_ID,
      role: "offline image evidence embedding fallback from OCR/caption/asset metadata",
      license: "project-internal",
      status: "offline-fallback"
    },
    {
      id: DEFAULT_JOINT_PROVIDER_ID,
      role: "offline mixed evidence embedding fallback",
      license: "project-internal",
      status: "offline-fallback"
    }
  ],
  optionalCompatibleTargets: [
    {
      id: "intfloat/multilingual-e5-small",
      role: "text embedding model",
      license: "MIT",
      status: "license-gated-external-model"
    }
  ],
  rejectedClasses: ["GPL", "AGPL", "unknown model weights", "cloud-only runtime"]
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function normalizeDimension(value, fallback = DEFAULT_EMBEDDING_DIMENSION) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  const dimension = Math.floor(number);
  if (dimension < 8 || dimension > 4096) {
    return fallback;
  }
  return dimension;
}

function stableJson(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined && entry !== null && typeof entry !== "function")
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(Object.fromEntries(entries));
}

export function hashText(value, length = 32) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

export function tokenizeEmbeddingText(value) {
  return [
    ...new Set(
      String(value || "")
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]+/gu) || []
    )
  ].filter((token) => token.length > 0 && token.length <= 96);
}

export function vectorForText(text, dimension = DEFAULT_EMBEDDING_DIMENSION) {
  const resolvedDimension = normalizeDimension(dimension);
  const vector = Array.from({ length: resolvedDimension }, () => 0);
  const tokens = tokenizeEmbeddingText(text);
  if (!tokens.length) {
    return vector;
  }

  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    for (let offset = 0; offset < 8; offset += 1) {
      const index = digest[offset] % resolvedDimension;
      const sign = digest[offset + 8] % 2 === 0 ? 1 : -1;
      vector[index] += sign * (1 + (digest[offset + 16] % 7) / 10);
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

function mergeManifests(inputManifest = {}) {
  const manifest = {
    ...DEFAULT_LICENSE_MANIFEST,
    ...(inputManifest || {})
  };
  const defaultComponents = asArray(DEFAULT_LICENSE_MANIFEST.components);
  const inputComponents = asArray(inputManifest.components);
  const components = new Map(defaultComponents.map((component) => [component.id, component]));
  for (const component of inputComponents) {
    if (component && component.id) {
      components.set(component.id, {
        ...(components.get(component.id) || {}),
        ...component
      });
    }
  }
  return {
    ...manifest,
    acceptedLicenses: asArray(manifest.acceptedLicenses),
    components: [...components.values()],
    optionalCompatibleTargets: asArray(manifest.optionalCompatibleTargets),
    rejectedClasses: asArray(manifest.rejectedClasses)
  };
}

function findManifestComponent(manifest, providerId) {
  return asArray(manifest.components).find((component) => component?.id === providerId) || null;
}

function providerConfig({ manifest, settings, runtimeSettings, providerId, modality, defaultLicense, defaultStatus }) {
  const component = findManifestComponent(manifest, providerId) || {};
  const providerSettings = runtimeSettings.providers?.[modality] || settings.embeddingProviders?.[modality] || {};
  return compactObject({
    providerId,
    modality,
    license: providerSettings.license || runtimeSettings.license || settings.license || component.license || defaultLicense,
    status: providerSettings.status || runtimeSettings.status || settings.status || component.status || defaultStatus,
    role: component.role,
    dimension: normalizeDimension(
      providerSettings.dimension || runtimeSettings.dimension || settings.dimension || manifest.dimension,
      DEFAULT_EMBEDDING_DIMENSION
    )
  });
}

function readRuntimeSettings(settings = {}) {
  return settings.embeddingRuntime || settings.embedding || {};
}

function readEmbeddingModelSettings(settings = {}) {
  return settings.embeddingModel || {};
}

function readProviderIds({ options, settings, manifest }) {
  const runtimeSettings = readRuntimeSettings(settings);
  const modelSettings = readEmbeddingModelSettings(settings);
  return {
    runtime: String(
      options.providerId ||
        runtimeSettings.providerId ||
        settings.providerId ||
        manifest.providerId ||
        DEFAULT_RUNTIME_PROVIDER_ID
    ),
    text: String(
      options.textProviderId ||
        modelSettings.text ||
        runtimeSettings.textProviderId ||
        settings.textProviderId ||
        DEFAULT_TEXT_PROVIDER_ID
    ),
    image: String(
      options.imageProviderId ||
        modelSettings.image ||
        runtimeSettings.imageProviderId ||
        settings.imageProviderId ||
        DEFAULT_IMAGE_PROVIDER_ID
    ),
    joint: String(
      options.jointProviderId ||
        modelSettings.joint ||
        runtimeSettings.jointProviderId ||
        settings.jointProviderId ||
        DEFAULT_JOINT_PROVIDER_ID
    )
  };
}

function textFromEvidence(value = {}) {
  if (typeof value === "string") {
    return normalizeText(value);
  }
  return [
    value.title,
    value.name,
    value.text,
    value.content,
    value.snippet,
    value.summary,
    value.caption,
    value.ocrText,
    value.ocr_text,
    stableJson(value.metadata)
  ]
    .filter(Boolean)
    .join("\n");
}

function imageTextFromEvidence(asset = {}) {
  return [
    asset.title,
    asset.name,
    asset.caption,
    asset.altText,
    asset.text,
    asset.ocrText,
    asset.ocr_text,
    asset.mediaType,
    asset.media_type,
    asset.relativePath,
    asset.relative_path,
    asset.sha256,
    asset.hash,
    stableJson(asset.sourceLocator || asset.source_locator),
    stableJson(asset.metadata)
  ]
    .filter(Boolean)
    .join("\n");
}

function jointTextFromEvidence(evidence = {}) {
  if (typeof evidence === "string") {
    return normalizeText(evidence);
  }

  const blocks = asArray(evidence.blocks).map(textFromEvidence);
  const assets = [...asArray(evidence.assets), ...asArray(evidence.images)].map(imageTextFromEvidence);
  return [
    evidence.query,
    evidence.title,
    evidence.name,
    evidence.text,
    evidence.content,
    evidence.snippet,
    evidence.summary,
    textFromEvidence(evidence.block || {}),
    imageTextFromEvidence(evidence.asset || {}),
    ...blocks,
    ...assets,
    stableJson(evidence.metadata)
  ]
    .filter(Boolean)
    .join("\n");
}

function validateManifest(inputManifest = {}, providerIds = []) {
  const manifest = mergeManifests(inputManifest);
  const acceptedLicenses = new Set(asArray(manifest.acceptedLicenses).map((license) => String(license).toLowerCase()));
  const rejectedClasses = asArray(manifest.rejectedClasses).map((entry) => String(entry).toLowerCase());
  const issues = [];

  for (const providerId of providerIds.filter(Boolean)) {
    const component = findManifestComponent(manifest, providerId);
    if (!component) {
      issues.push({
        providerId,
        code: "missing-component",
        message: `Provider ${providerId} is not present in the embedding license manifest.`
      });
      continue;
    }

    const license = String(component.license || "").trim();
    const status = String(component.status || "").trim();
    const normalizedLicense = license.toLowerCase();
    if (!license) {
      issues.push({
        providerId,
        code: "missing-license",
        message: `Provider ${providerId} does not declare a license.`
      });
    } else if (acceptedLicenses.size > 0 && !acceptedLicenses.has(normalizedLicense)) {
      issues.push({
        providerId,
        code: "unaccepted-license",
        license,
        message: `Provider ${providerId} declares unaccepted license ${license}.`
      });
    }

    if (rejectedClasses.some((rejected) => normalizedLicense.includes(rejected))) {
      issues.push({
        providerId,
        code: "rejected-license-class",
        license,
        message: `Provider ${providerId} matches a rejected license class.`
      });
    }

    if (/^(rejected|blocked|disabled)$/i.test(status)) {
      issues.push({
        providerId,
        code: "rejected-status",
        status,
        message: `Provider ${providerId} has rejected status ${status}.`
      });
    }
  }

  return {
    protocolVersion: EMBEDDING_PROTOCOL_VERSION,
    ok: issues.length === 0,
    policy: manifest.policy || "",
    checkedProviders: providerIds.filter(Boolean),
    issues,
    manifest
  };
}

export function validateLicenseManifest(manifest = DEFAULT_LICENSE_MANIFEST, options = {}) {
  const mergedManifest = mergeManifests(manifest);
  const providerIds = asArray(options.providerIds);
  return validateManifest(
    mergedManifest,
    providerIds.length ? providerIds : asArray(mergedManifest.components).map((component) => component.id)
  );
}

export function createEmbeddingRuntime(options = {}) {
  const settings = options.settings || {};
  const runtimeSettings = readRuntimeSettings(settings);
  const manifest = mergeManifests(options.manifest || options.licenseManifest || settings.licenseManifest || {});
  const providerIds = readProviderIds({ options, settings, manifest });
  const dimension = normalizeDimension(
    options.dimension || runtimeSettings.dimension || settings.dimension || manifest.dimension,
    DEFAULT_EMBEDDING_DIMENSION
  );

  const providers = {
    runtime: providerConfig({
      manifest,
      settings,
      runtimeSettings,
      providerId: providerIds.runtime,
      modality: "runtime",
      defaultLicense: "project-internal",
      defaultStatus: "offline-fallback"
    }),
    text: providerConfig({
      manifest,
      settings,
      runtimeSettings,
      providerId: providerIds.text,
      modality: "text",
      defaultLicense: "project-internal",
      defaultStatus: "offline-fallback"
    }),
    image: providerConfig({
      manifest,
      settings,
      runtimeSettings,
      providerId: providerIds.image,
      modality: "image",
      defaultLicense: "project-internal",
      defaultStatus: "offline-fallback"
    }),
    joint: providerConfig({
      manifest,
      settings,
      runtimeSettings,
      providerId: providerIds.joint,
      modality: "joint",
      defaultLicense: "project-internal",
      defaultStatus: "offline-fallback"
    })
  };

  function embed({ modality, text, provider, embedOptions = {} }) {
    const resolvedDimension = normalizeDimension(embedOptions.dimension || provider.dimension || dimension, dimension);
    return {
      protocolVersion: EMBEDDING_PROTOCOL_VERSION,
      provider: provider.providerId,
      providerId: provider.providerId,
      runtimeProvider: providerIds.runtime,
      modality,
      dimension: resolvedDimension,
      vector: vectorForText(text, resolvedDimension),
      offlineFallback: true,
      metadata: compactObject({
        providerType: "deterministic-hashing",
        license: provider.license,
        status: provider.status,
        sourceHash: hashText(text)
      })
    };
  }

  function embedText(input = "", embedOptions = {}) {
    return embed({
      modality: "text",
      text: textFromEvidence(input),
      provider: providers.text,
      embedOptions
    });
  }

  function embedImageEvidence(asset = {}, embedOptions = {}) {
    return embed({
      modality: "image",
      text: imageTextFromEvidence(asset),
      provider: providers.image,
      embedOptions
    });
  }

  function embedJointEvidence(evidence = {}, embedOptions = {}) {
    return embed({
      modality: "joint",
      text: jointTextFromEvidence(evidence),
      provider: providers.joint,
      embedOptions
    });
  }

  function manifestWithRuntimeProviders(inputManifest = manifest) {
    const mergedManifest = mergeManifests(inputManifest);
    const components = new Map(asArray(mergedManifest.components).map((component) => [component.id, component]));
    for (const provider of Object.values(providers)) {
      components.set(provider.providerId, {
        ...(components.get(provider.providerId) || {}),
        id: provider.providerId,
        role: provider.role || `${provider.modality} embedding provider`,
        license: provider.license || "project-internal",
        status: provider.status || "offline-fallback"
      });
    }
    return {
      ...mergedManifest,
      components: [...components.values()]
    };
  }

  function validateRuntimeLicenseManifest(inputManifest = manifest) {
    return validateManifest(manifestWithRuntimeProviders(inputManifest), [
      providerIds.runtime,
      providerIds.text,
      providerIds.image,
      providerIds.joint
    ]);
  }

  function capabilities() {
    return {
      protocolVersion: EMBEDDING_PROTOCOL_VERSION,
      providerId: providerIds.runtime,
      providerType: "offline-fallback",
      offlineFallback: true,
      deterministic: true,
      dimensions: {
        default: dimension,
        min: 8,
        max: 4096,
        configurable: true
      },
      modalities: {
        text: true,
        image: "ocr-caption-asset-metadata-fallback",
        joint: "text-image-evidence-fusion-fallback"
      },
      providers,
      licensePolicy: manifest
    };
  }

  function health() {
    const validation = validateRuntimeLicenseManifest();
    return {
      protocolVersion: EMBEDDING_PROTOCOL_VERSION,
      ok: validation.ok,
      providerId: providerIds.runtime,
      providerType: "offline-fallback",
      offlineFallback: true,
      dimension,
      status: providers.runtime.status || "offline-fallback",
      license: providers.runtime.license || "project-internal",
      validation,
      capabilities: capabilities()
    };
  }

  return {
    protocolVersion: EMBEDDING_PROTOCOL_VERSION,
    providerId: providerIds.runtime,
    providerType: "offline-fallback",
    dimensions: dimension,
    defaultDimension: dimension,
    offlineFallback: true,
    embedText,
    embedImageEvidence,
    embedJointEvidence,
    capabilities,
    health,
    validateLicenseManifest: validateRuntimeLicenseManifest
  };
}

export default createEmbeddingRuntime;
