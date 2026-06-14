const DEFAULT_PROTOCOL_VERSION = "v0.0.1:knowledge:core-1";

const SEVERITY_RANK = {
  critical: 3,
  error: 3,
  warning: 2,
  info: 1
};

function asArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hasOwnPath(value, keyPath) {
  if (!keyPath) return false;
  const segments = String(keyPath).split(".").filter(Boolean);
  let cursor = value;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
      return false;
    }
    cursor = cursor[segment];
  }
  return true;
}

function valueAtPath(value, keyPath) {
  const segments = String(keyPath || "").split(".").filter(Boolean);
  let cursor = value;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function countFrom(health, key) {
  return toFiniteNumber(asObject(health.counts)[key], 0);
}

function pushFinding(findings, finding) {
  findings.push({
    id: finding.id,
    severity: finding.severity || "warning",
    area: finding.area || "knowledge",
    title: finding.title || finding.id,
    message: finding.message || "",
    metric: finding.metric || "",
    value: finding.value,
    expected: finding.expected,
    action: finding.action || "",
    metadata: asObject(finding.metadata)
  });
}

function compareSeverity(left, right) {
  return (SEVERITY_RANK[right.severity] || 0) - (SEVERITY_RANK[left.severity] || 0) ||
    String(left.id).localeCompare(String(right.id));
}

function acceptedLicense(license, acceptedLicenses) {
  const normalized = String(license || "").trim();
  if (!normalized) return false;
  if (["project-internal", "internal"].includes(normalized)) return true;
  return acceptedLicenses.some((accepted) => normalized === accepted || normalized.includes(accepted));
}

export function computeHealthFindings(input = {}, options = {}) {
  const health = asObject(input.health || input);
  const settings = asObject(input.settings || input.maintenanceSettings || health.settings);
  const retrieval = asObject(input.retrieval || settings.retrieval || health.retrieval);
  const maintenance = asObject(settings.maintenance || health.settings?.maintenance);
  const markdown = asObject(settings.markdown || health.settings?.markdown);
  const thresholds = {
    minEmbeddingCoverage: 0.95,
    maxTopK: 1000,
    maxWeightSum: 3,
    expectedProtocolVersion: DEFAULT_PROTOCOL_VERSION,
    ...asObject(options.thresholds),
    ...(options.expectedProtocolVersion ? { expectedProtocolVersion: options.expectedProtocolVersion } : {})
  };
  const findings = [];

  if (!Object.keys(health).length) {
    pushFinding(findings, {
      id: "health.snapshot_missing",
      severity: "critical",
      area: "health",
      title: "Missing health snapshot",
      message: "Knowledge maintenance cannot evaluate an empty health snapshot.",
      action: "Call knowledge.health before planning maintenance."
    });
    return findings;
  }

  if (health.ok === false) {
    pushFinding(findings, {
      id: "health.not_ok",
      severity: "critical",
      area: "health",
      title: "Knowledge health is not ok",
      message: "The knowledge module reported ok=false.",
      value: health.ok,
      expected: true,
      action: "Inspect the health payload and storage paths before running retrieval."
    });
  }

  if (health.protocolVersion && health.protocolVersion !== thresholds.expectedProtocolVersion) {
    pushFinding(findings, {
      id: "protocol.version_mismatch",
      severity: "warning",
      area: "protocol",
      title: "Unexpected knowledge protocol version",
      message: "The active module uses a protocol version different from the verifier expectation.",
      value: health.protocolVersion,
      expected: thresholds.expectedProtocolVersion,
      action: "Confirm the server and verification scripts target the same knowledge protocol."
    });
  }

  const documents = countFrom(health, "documents");
  const blocks = countFrom(health, "blocks");
  const assets = countFrom(health, "assets");
  const embeddings = countFrom(health, "embeddings");
  const retrievableObjects = blocks + assets;
  const missingAssets = toFiniteNumber(
    health.maintenance?.missingAssets ?? health.missingAssets,
    0
  );

  if (documents > 0 && blocks === 0) {
    pushFinding(findings, {
      id: "content.documents_without_blocks",
      severity: "warning",
      area: "content",
      title: "Documents have no retrievable blocks",
      message: "Documents exist, but no text blocks are available for retrieval.",
      metric: "counts.blocks",
      value: blocks,
      expected: "> 0 when documents > 0",
      action: "Reingest affected batches or inspect parser output."
    });
  }

  if (missingAssets > 0) {
    pushFinding(findings, {
      id: "assets.missing_files",
      severity: "critical",
      area: "assets",
      title: "Asset files are missing",
      message: "One or more asset database rows point to files that are not readable from the asset store.",
      metric: "maintenance.missingAssets",
      value: missingAssets,
      expected: 0,
      action: "Reingest source batches or repair the knowledge-core/assets directory."
    });
  }

  const embeddingCoverage = retrievableObjects > 0 ? embeddings / retrievableObjects : 1;
  if (retrievableObjects > 0 && embeddingCoverage < thresholds.minEmbeddingCoverage) {
    pushFinding(findings, {
      id: "indexes.embedding_coverage_low",
      severity: embeddings === 0 ? "critical" : "warning",
      area: "indexes",
      title: "Embedding coverage is low",
      message: "The embedding index does not cover all retrievable blocks and assets.",
      metric: "counts.embeddings/(counts.blocks+counts.assets)",
      value: Number(embeddingCoverage.toFixed(4)),
      expected: `>= ${thresholds.minEmbeddingCoverage}`,
      action: "Run knowledge.reindex to rebuild local embeddings.",
      metadata: {
        embeddings,
        retrievableObjects
      }
    });
  }

  if (health.maintenance?.indexStale === true) {
    pushFinding(findings, {
      id: "indexes.stale",
      severity: missingAssets > 0 || embeddingCoverage < thresholds.minEmbeddingCoverage ? "warning" : "info",
      area: "indexes",
      title: "Knowledge index is stale",
      message: "The last successful reindex is older than the configured maintenance horizon, or embeddings are missing.",
      metric: "maintenance.indexAgeHours",
      value: health.maintenance?.indexAgeHours,
      expected: `<= ${maintenance.staleIndexHours || health.maintenance?.staleIndexHours || "configured"} hours`,
      action: "Run knowledge.reindex when retrieval quality has degraded or after changing embedding providers.",
      metadata: {
        lastReindexAt: health.maintenance?.lastReindexAt || "",
        staleIndexHours: health.maintenance?.staleIndexHours || maintenance.staleIndexHours
      }
    });
  }

  const topK = toFiniteNumber(retrieval.topK, NaN);
  if ("topK" in retrieval && (!Number.isFinite(topK) || topK < 1 || topK > thresholds.maxTopK)) {
    pushFinding(findings, {
      id: "settings.topk_invalid",
      severity: "warning",
      area: "settings",
      title: "Invalid retrieval topK",
      message: "Retrieval topK must be a positive bounded number.",
      metric: "retrieval.topK",
      value: retrieval.topK,
      expected: `1..${thresholds.maxTopK}`,
      action: "Update knowledge.maintenance settings with a bounded retrieval.topK."
    });
  }

  const weightKeys = ["bm25Weight", "vectorWeight", "imageWeight"];
  const weights = weightKeys.map((key) => [key, toFiniteNumber(retrieval[key], 0)]);
  const configuredWeights = weights.filter(([key]) => key in retrieval);
  if (configuredWeights.some(([, value]) => value < 0)) {
    pushFinding(findings, {
      id: "settings.retrieval_weight_negative",
      severity: "warning",
      area: "settings",
      title: "Retrieval weight is negative",
      message: "Fusion weights should not be negative.",
      value: Object.fromEntries(configuredWeights),
      expected: "all weights >= 0",
      action: "Reset retrieval fusion weights to non-negative values."
    });
  }
  const weightSum = configuredWeights.reduce((sum, [, value]) => sum + value, 0);
  if (configuredWeights.length && weightSum <= 0) {
    pushFinding(findings, {
      id: "settings.retrieval_weights_disabled",
      severity: "critical",
      area: "settings",
      title: "All retrieval weights are disabled",
      message: "At least one retrieval fusion weight must be positive.",
      value: Number(weightSum.toFixed(4)),
      expected: "> 0",
      action: "Enable lexical, vector, or image retrieval weight."
    });
  } else if (configuredWeights.length && weightSum > thresholds.maxWeightSum) {
    pushFinding(findings, {
      id: "settings.retrieval_weights_high",
      severity: "info",
      area: "settings",
      title: "Retrieval weights are unusually high",
      message: "The retrieval score scale may be hard to compare across profiles.",
      value: Number(weightSum.toFixed(4)),
      expected: `<= ${thresholds.maxWeightSum}`,
      action: "Normalize retrieval weights when comparing score-based quality gates."
    });
  }

  const recencyWeight = toFiniteNumber(retrieval.recencyWeight, 0);
  if ("recencyWeight" in retrieval && (recencyWeight < 0 || recencyWeight > 1)) {
    pushFinding(findings, {
      id: "settings.recency_weight_invalid",
      severity: "warning",
      area: "settings",
      title: "Invalid recency weight",
      message: "Recency weight must stay between 0 and 1.",
      metric: "retrieval.recencyWeight",
      value: retrieval.recencyWeight,
      expected: "0..1",
      action: "Update the KnowledgeCore retrieval recency weight."
    });
  }
  const recencyHalfLifeDays = toFiniteNumber(retrieval.recencyHalfLifeDays, 0);
  if ("recencyHalfLifeDays" in retrieval && recencyHalfLifeDays < 1) {
    pushFinding(findings, {
      id: "settings.recency_half_life_invalid",
      severity: "warning",
      area: "settings",
      title: "Invalid recency half-life",
      message: "Recency half-life must be at least one day.",
      metric: "retrieval.recencyHalfLifeDays",
      value: retrieval.recencyHalfLifeDays,
      expected: ">= 1 day",
      action: "Update the KnowledgeCore retrieval recency half-life."
    });
  }

  if ("reindexBatchSize" in maintenance && toFiniteNumber(maintenance.reindexBatchSize, 0) < 1) {
    pushFinding(findings, {
      id: "settings.reindex_batch_size_invalid",
      severity: "warning",
      area: "settings",
      title: "Invalid reindex batch size",
      message: "Reindex batch size must be positive.",
      value: maintenance.reindexBatchSize,
      expected: "> 0",
      action: "Set maintenance.reindexBatchSize to a positive integer."
    });
  }

  if ("staleIndexHours" in maintenance && toFiniteNumber(maintenance.staleIndexHours, 0) <= 0) {
    pushFinding(findings, {
      id: "settings.stale_index_hours_invalid",
      severity: "warning",
      area: "settings",
      title: "Invalid stale index horizon",
      message: "The stale index horizon must be positive.",
      value: maintenance.staleIndexHours,
      expected: "> 0",
      action: "Set maintenance.staleIndexHours to a positive number of hours."
    });
  }

  if ("includeMachineReadableAppendix" in markdown && markdown.includeMachineReadableAppendix === false) {
    pushFinding(findings, {
      id: "markdown.machine_metadata_disabled",
      severity: "warning",
      area: "markdown",
      title: "Markdown machine-readable metadata is disabled",
      message: "Evidence Markdown should preserve machine-readable metadata for downstream tools.",
      value: false,
      expected: true,
      action: "Set markdown.includeMachineReadableAppendix=true."
    });
  }

  const capabilities = asObject(health.capabilities);
  const modalities = asObject(capabilities.modalities);
  if (assets > 0 && modalities.image === false) {
    pushFinding(findings, {
      id: "capabilities.image_disabled_with_assets",
      severity: "warning",
      area: "capabilities",
      title: "Image capability is disabled while assets exist",
      message: "Stored image assets may not be retrievable through the active capability profile.",
      value: modalities.image,
      expected: true,
      action: "Use a knowledge module profile with image retrieval enabled."
    });
  }

  const storage = asObject(capabilities.storage);
  for (const key of ["structured", "assets", "vector"]) {
    if (capabilities.storage && !storage[key]) {
      pushFinding(findings, {
        id: `capabilities.storage_${key}_missing`,
        severity: "warning",
        area: "capabilities",
        title: `Missing ${key} storage capability`,
        message: `Knowledge capabilities did not report a ${key} storage backend.`,
        action: "Check the active knowledge module capability payload."
      });
    }
  }

  const licensePolicy = asObject(capabilities.licensePolicy);
  const acceptedLicenses = asArray(licensePolicy.acceptedLicenses).map(String);
  for (const component of asArray(licensePolicy.components)) {
    if (!acceptedLicense(component.license, acceptedLicenses)) {
      pushFinding(findings, {
        id: `license.unaccepted.${component.id || "component"}`,
        severity: "critical",
        area: "license",
        title: "Unaccepted knowledge dependency license",
        message: "A knowledge runtime component has a license outside the accepted policy.",
        value: component.license || "",
        expected: acceptedLicenses.join(", "),
        action: "Replace or explicitly approve the component before packaging.",
        metadata: {
          componentId: component.id || "",
          role: component.role || ""
        }
      });
    }
  }

  const runSummary = summarizeMaintenanceRuns(input.runs || input.maintenanceRuns || []);
  if (runSummary.total > 0 && runSummary.lastFailedRun && runSummary.latestRun?.status !== "completed") {
    pushFinding(findings, {
      id: "maintenance.latest_run_failed",
      severity: "warning",
      area: "maintenance",
      title: "Latest maintenance run failed",
      message: "The most recent maintenance run did not complete successfully.",
      value: runSummary.latestRun.status,
      expected: "completed",
      action: "Inspect the failed run output and rerun the maintenance task.",
      metadata: {
        runId: runSummary.latestRun.runId,
        taskType: runSummary.latestRun.taskType
      }
    });
  }

  if (options.includeOkFinding && findings.length === 0) {
    pushFinding(findings, {
      id: "health.ok",
      severity: "info",
      area: "health",
      title: "Knowledge maintenance is healthy",
      message: "No maintenance findings were detected."
    });
  }

  return findings.sort(compareSeverity);
}

function addAction(actions, action) {
  if (actions.has(action.id)) {
    const current = actions.get(action.id);
    current.relatedFindings = [...new Set([...current.relatedFindings, ...asArray(action.relatedFindings)])];
    return;
  }
  actions.set(action.id, {
    id: action.id,
    priority: action.priority || "P2",
    title: action.title,
    reason: action.reason || "",
    command: action.command || "",
    automated: Boolean(action.automated),
    relatedFindings: asArray(action.relatedFindings)
  });
}

function actionForFinding(finding) {
  if (finding.id === "assets.missing_files") {
    return {
      id: "repair-assets",
      priority: "P0",
      title: "Repair or reingest missing asset files",
      reason: finding.message,
      command: "knowledge asset --id <asset-id>",
      automated: false
    };
  }
  if (finding.id === "indexes.embedding_coverage_low") {
    return {
      id: "reindex-knowledge",
      priority: finding.severity === "critical" ? "P0" : "P1",
      title: "Rebuild knowledge embeddings",
      reason: finding.message,
      command: "knowledge maintenance reindex",
      automated: true
    };
  }
  if (finding.id.startsWith("settings.")) {
    return {
      id: "review-maintenance-settings",
      priority: finding.severity === "critical" ? "P0" : "P2",
      title: "Review maintenance settings",
      reason: finding.message,
      command: "knowledge maintenance set --body maintenance.json",
      automated: false
    };
  }
  if (finding.id.startsWith("markdown.")) {
    return {
      id: "enable-markdown-metadata",
      priority: "P1",
      title: "Enable machine-readable Markdown metadata",
      reason: finding.message,
      command: "knowledge maintenance set --body maintenance.json",
      automated: false
    };
  }
  if (finding.id.startsWith("license.")) {
    return {
      id: "review-license-policy",
      priority: "P0",
      title: "Review knowledge runtime license policy",
      reason: finding.message,
      automated: false
    };
  }
  if (finding.id.startsWith("quality.")) {
    return {
      id: "repair-quality-regression",
      priority: "P1",
      title: "Investigate knowledge quality regression",
      reason: finding.message,
      command: "knowledge search --query <query>",
      automated: false
    };
  }
  return {
    id: "inspect-knowledge-health",
    priority: finding.severity === "critical" ? "P0" : "P2",
    title: "Inspect knowledge health",
    reason: finding.message,
    command: "knowledge health",
    automated: false
  };
}

function actionPriorityRank(priority) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority] ?? 4;
}

export function buildMaintenancePlan(input = {}, options = {}) {
  const generatedAt = options.generatedAt || input.generatedAt || new Date(0).toISOString();
  const findings = asArray(input.findings).length
    ? asArray(input.findings)
    : computeHealthFindings(input, options);
  const actions = new Map();

  for (const finding of findings) {
    const action = actionForFinding(finding);
    addAction(actions, {
      ...action,
      relatedFindings: [finding.id]
    });
  }

  const quality = input.quality || input.qualityAssertions || input.assertionSummary;
  const qualityFailed = Boolean(quality && quality.ok === false);
  if (qualityFailed) {
    const findingId = "quality.assertions_failed";
    addAction(actions, {
      id: "repair-quality-regression",
      priority: "P1",
      title: "Investigate failed quality assertions",
      reason: `${quality.failed || 0} knowledge quality assertion(s) failed.`,
      command: "knowledge search --query <query>",
      automated: false,
      relatedFindings: [findingId]
    });
  }

  const retrievalComparison = input.retrievalComparison || input.profileComparison;
  const retrievalRegressed = Boolean(
    retrievalComparison && asArray(retrievalComparison.regressions).length > 0
  );
  if (retrievalRegressed) {
    addAction(actions, {
      id: "compare-retrieval-profiles",
      priority: "P1",
      title: "Review retrieval profile regression",
      reason: `${retrievalComparison.regressions.length} retrieval comparison regression(s) were detected.`,
      command: "knowledge search --query <query>",
      automated: false,
      relatedFindings: ["quality.retrieval_profile_regression"]
    });
  }

  const actionList = [...actions.values()].sort(
    (left, right) => actionPriorityRank(left.priority) - actionPriorityRank(right.priority) ||
      String(left.id).localeCompare(String(right.id))
  );
  const hasCritical = findings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK.critical);
  const hasWarning = findings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK.warning);

  return {
    generatedAt,
    status: hasCritical ? "action-required" : hasWarning || actionList.length ? "needs-attention" : "healthy",
    ok: !hasCritical && !qualityFailed && !retrievalRegressed,
    findings,
    actions: actionList,
    runbook: actionList.map((action, index) => ({
      step: index + 1,
      actionId: action.id,
      title: action.title,
      command: action.command,
      automated: action.automated
    }))
  };
}

function profileName(profile, fallback) {
  return String(profile?.name || profile?.profileName || profile?.id || fallback);
}

function itemKey(item) {
  return String(
    item?.itemId ||
    item?.documentId ||
    item?.evidenceId ||
    item?.assetId ||
    item?.blockId ||
    item?.id ||
    item?.title ||
    ""
  );
}

function normalizeQueryResults(profile) {
  const normalized = new Map();
  if (!profile || typeof profile !== "object") {
    return normalized;
  }

  const addResult = (query, result) => {
    const resolvedQuery = normalizeText(query || result?.query || result?.q || "default");
    normalized.set(resolvedQuery, {
      query: resolvedQuery,
      result: result || {},
      items: asArray(result?.items || result?.results || result?.hits)
    });
  };

  if (Array.isArray(profile.results)) {
    for (const result of profile.results) {
      addResult(result?.query || result?.q, result);
    }
  } else if (Array.isArray(profile.queries)) {
    for (const result of profile.queries) {
      addResult(result?.query || result?.q, result);
    }
  } else if (profile.searchResults && typeof profile.searchResults === "object") {
    for (const [query, result] of Object.entries(profile.searchResults)) {
      addResult(query, result);
    }
  } else if (profile.results && typeof profile.results === "object") {
    for (const [query, result] of Object.entries(profile.results)) {
      addResult(query, result);
    }
  } else if (profile.items || profile.hits) {
    addResult(profile.query || profile.q || "default", profile);
  }

  return normalized;
}

function flattenSettings(value, prefix = "", output = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return output;
  }
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      flattenSettings(entry, path, output);
    } else {
      output[path] = entry;
    }
  }
  return output;
}

function compareSettings(left = {}, right = {}) {
  const leftFlat = flattenSettings(left);
  const rightFlat = flattenSettings(right);
  return [...new Set([...Object.keys(leftFlat), ...Object.keys(rightFlat)])]
    .filter((key) => leftFlat[key] !== rightFlat[key])
    .map((key) => ({
      key,
      baseline: leftFlat[key],
      candidate: rightFlat[key],
      delta: Number.isFinite(Number(leftFlat[key])) && Number.isFinite(Number(rightFlat[key]))
        ? Number(rightFlat[key]) - Number(leftFlat[key])
        : undefined
    }));
}

export function compareRetrievalProfiles(baseline = {}, candidate = {}, options = {}) {
  const minOverlap = toFiniteNumber(options.minOverlap, 0.5);
  const maxTopScoreDrop = toFiniteNumber(options.maxTopScoreDrop, 0.15);
  const baselineResults = normalizeQueryResults(baseline);
  const candidateResults = normalizeQueryResults(candidate);
  const queryKeys = [...new Set([...baselineResults.keys(), ...candidateResults.keys()])];
  const queries = [];
  const regressions = [];
  const improvements = [];

  for (const query of queryKeys) {
    const left = baselineResults.get(query) || { items: [] };
    const right = candidateResults.get(query) || { items: [] };
    const leftKeys = left.items.map(itemKey).filter(Boolean);
    const rightKeys = right.items.map(itemKey).filter(Boolean);
    const rightKeySet = new Set(rightKeys);
    const overlapCount = leftKeys.filter((key) => rightKeySet.has(key)).length;
    const denominator = Math.max(1, Math.max(leftKeys.length, rightKeys.length));
    const topOverlap = overlapCount / denominator;
    const baselineTop = left.items[0] || null;
    const candidateTop = right.items[0] || null;
    const baselineTopScore = toFiniteNumber(baselineTop?.score, 0);
    const candidateTopScore = toFiniteNumber(candidateTop?.score, 0);
    const topScoreDelta = candidateTopScore - baselineTopScore;
    const topItemChanged = itemKey(baselineTop) !== itemKey(candidateTop);
    const querySummary = {
      query,
      baselineCount: left.items.length,
      candidateCount: right.items.length,
      overlapCount,
      topOverlap: Number(topOverlap.toFixed(4)),
      topItemChanged,
      baselineTopId: itemKey(baselineTop),
      candidateTopId: itemKey(candidateTop),
      baselineTopScore,
      candidateTopScore,
      topScoreDelta: Number(topScoreDelta.toFixed(4))
    };
    queries.push(querySummary);

    if (left.items.length > 0 && right.items.length === 0) {
      regressions.push({
        id: `query.${query}.no_candidate_results`,
        query,
        reason: "Candidate returned no results while baseline returned results.",
        baselineCount: left.items.length,
        candidateCount: right.items.length
      });
    } else if (left.items.length > 0 && right.items.length > 0 && topOverlap < minOverlap) {
      regressions.push({
        id: `query.${query}.overlap_low`,
        query,
        reason: "Candidate top-k overlap is below the accepted threshold.",
        value: Number(topOverlap.toFixed(4)),
        expected: `>= ${minOverlap}`
      });
    }

    if (left.items.length > 0 && right.items.length > 0 && topScoreDelta < -maxTopScoreDrop) {
      regressions.push({
        id: `query.${query}.score_drop`,
        query,
        reason: "Candidate top score dropped beyond the accepted threshold.",
        value: Number(topScoreDelta.toFixed(4)),
        expected: `>= -${maxTopScoreDrop}`
      });
    }

    if (options.requireSameTopItem && left.items.length > 0 && right.items.length > 0 && topItemChanged) {
      regressions.push({
        id: `query.${query}.top_item_changed`,
        query,
        reason: "Candidate changed the top retrieval item.",
        baselineTopId: querySummary.baselineTopId,
        candidateTopId: querySummary.candidateTopId
      });
    }

    if (left.items.length === 0 && right.items.length > 0) {
      improvements.push({
        id: `query.${query}.new_results`,
        query,
        reason: "Candidate returned results where baseline returned none.",
        candidateCount: right.items.length
      });
    } else if (topScoreDelta > maxTopScoreDrop) {
      improvements.push({
        id: `query.${query}.score_improved`,
        query,
        reason: "Candidate top score improved beyond the comparison threshold.",
        value: Number(topScoreDelta.toFixed(4))
      });
    }
  }

  const averageOverlap = queries.length
    ? queries.reduce((sum, query) => sum + query.topOverlap, 0) / queries.length
    : 1;
  const averageScoreDelta = queries.length
    ? queries.reduce((sum, query) => sum + query.topScoreDelta, 0) / queries.length
    : 0;

  return {
    ok: regressions.length === 0,
    baseline: {
      name: profileName(baseline, "baseline"),
      queryCount: baselineResults.size
    },
    candidate: {
      name: profileName(candidate, "candidate"),
      queryCount: candidateResults.size
    },
    settingsDelta: compareSettings(
      baseline.settings || baseline.retrievalProfile || baseline.retrieval || {},
      candidate.settings || candidate.retrievalProfile || candidate.retrieval || {}
    ),
    queries,
    regressions,
    improvements,
    summary: {
      queryCount: queries.length,
      averageOverlap: Number(averageOverlap.toFixed(4)),
      averageScoreDelta: Number(averageScoreDelta.toFixed(4)),
      changedTopItems: queries.filter((query) => query.topItemChanged).length
    }
  };
}

function parseDateMs(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeRun(run = {}) {
  const startedAt = run.startedAt || run.started_at || "";
  const finishedAt = run.finishedAt || run.finished_at || "";
  const durationMs = Number.isFinite(Number(run.durationMs))
    ? Number(run.durationMs)
    : startedAt && finishedAt
      ? Math.max(0, parseDateMs(finishedAt) - parseDateMs(startedAt))
      : 0;
  return {
    runId: String(run.runId || run.run_id || run.id || ""),
    taskType: String(run.taskType || run.task_type || run.type || run.task || "maintenance"),
    status: String(run.status || "unknown").toLowerCase(),
    input: run.input || run.input_json || {},
    output: run.output || run.output_json || {},
    startedAt,
    finishedAt,
    durationMs
  };
}

export function summarizeMaintenanceRuns(input = [], options = {}) {
  const runs = asArray(input.runs || input.maintenanceRuns || input).map(normalizeRun);
  const sorted = [...runs].sort((left, right) => parseDateMs(right.startedAt) - parseDateMs(left.startedAt));
  const byStatus = {};
  const byTaskType = {};
  let durationTotal = 0;
  let durationCount = 0;

  for (const run of runs) {
    byStatus[run.status] = (byStatus[run.status] || 0) + 1;
    byTaskType[run.taskType] = (byTaskType[run.taskType] || 0) + 1;
    if (run.durationMs > 0) {
      durationTotal += run.durationMs;
      durationCount += 1;
    }
  }

  const completedRuns = runs.filter((run) => ["completed", "success", "succeeded"].includes(run.status));
  const failedRuns = runs.filter((run) => ["failed", "error", "cancelled", "canceled"].includes(run.status));
  const latestRun = sorted[0] || null;
  const lastSuccessfulRun = sorted.find((run) => completedRuns.includes(run)) || null;
  const lastFailedRun = sorted.find((run) => failedRuns.includes(run)) || null;
  const warnings = [];

  if (runs.length && !lastSuccessfulRun) {
    warnings.push("No successful maintenance run is present.");
  }
  if (latestRun && failedRuns.includes(latestRun)) {
    warnings.push("The latest maintenance run failed.");
  }
  if (options.maxFailureRate !== undefined && runs.length > 0) {
    const failureRate = failedRuns.length / runs.length;
    if (failureRate > Number(options.maxFailureRate)) {
      warnings.push(`Failure rate ${failureRate.toFixed(4)} exceeds ${options.maxFailureRate}.`);
    }
  }

  return {
    total: runs.length,
    byStatus,
    byTaskType,
    latestRun,
    lastSuccessfulRun,
    lastFailedRun,
    completedRuns: completedRuns.length,
    failedRuns: failedRuns.length,
    successRate: runs.length ? Number((completedRuns.length / runs.length).toFixed(4)) : 1,
    averageDurationMs: durationCount ? Math.round(durationTotal / durationCount) : 0,
    warnings
  };
}

function textIncludesTerm(text, term) {
  return normalizeText(text).toLocaleLowerCase().includes(normalizeText(term).toLocaleLowerCase());
}

function collectText(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => collectText(entry, depth + 1)).join("\n");
  }
  if (typeof value === "object") {
    return Object.values(value).map((entry) => collectText(entry, depth + 1)).join("\n");
  }
  return "";
}

function extractItems(actual) {
  return asArray(
    actual?.items ||
    actual?.results ||
    actual?.hits ||
    actual?.result?.items ||
    actual?.searchResult?.items
  );
}

function extractAssets(actual) {
  return asArray(
    actual?.assets ||
    actual?.payload?.assets ||
    actual?.evidence?.payload?.assets ||
    actual?.result?.payload?.assets
  );
}

function extractModalities(actual, items) {
  const modalities = new Set(asArray(actual?.modalities));
  for (const item of items) {
    for (const modality of asArray(item?.modalities)) {
      modalities.add(String(modality));
    }
  }
  if (asArray(actual?.payload?.blocks).length > 0) {
    modalities.add("text");
  }
  if (asArray(actual?.payload?.assets).length > 0 || extractAssets(actual).length > 0) {
    modalities.add("image");
  }
  return [...modalities].filter(Boolean);
}

function parseScalar(value) {
  const trimmed = String(value || "").trim();
  if (/^\[.*\]$/.test(trimmed)) {
    return trimmed.slice(1, -1).split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed.replace(/^['"]|['"]$/g, "");
}

function parseMarkdownMetadata(markdown) {
  const text = String(markdown || "");
  const yaml = {};
  const frontMatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (frontMatterMatch) {
    const lines = frontMatterMatch[1].split(/\r?\n/);
    let section = "";
    for (const line of lines) {
      const sectionMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        yaml[section] = asObject(yaml[section]);
        continue;
      }
      const entryMatch = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*(.*)$/);
      if (section && entryMatch) {
        yaml[section][entryMatch[1]] = parseScalar(entryMatch[2]);
      }
    }
  }

  const jsonBlocks = [];
  const jsonPattern = /```json\s*([\s\S]*?)```/g;
  let match = jsonPattern.exec(text);
  while (match) {
    try {
      jsonBlocks.push(JSON.parse(match[1]));
    } catch {
      jsonBlocks.push({
        parseError: true,
        raw: match[1]
      });
    }
    match = jsonPattern.exec(text);
  }

  return {
    hasFrontMatter: Boolean(frontMatterMatch),
    yaml,
    jsonBlocks,
    machineReadable: {
      ...(asObject(yaml.pact_knowledge)),
      ...(jsonBlocks.find((block) => block && !block.parseError && block.protocolVersion) || {})
    }
  };
}

function resolveAssertionActual(assertion, context) {
  if ("actual" in assertion) return assertion.actual;
  const target = String(assertion.target || "").toLowerCase();
  if (target === "health") return context.health || {};
  if (target === "markdown") return context.rendered || context.markdown || {};
  if (target === "evidence") return context.evidence || {};
  if (target === "asset") return context.asset || {};
  if (assertion.query && context.searchResults) {
    if (Array.isArray(context.searchResults)) {
      return context.searchResults.find((result) => result?.query === assertion.query) || {};
    }
    return context.searchResults[assertion.query] || {};
  }
  if (assertion.evidenceId && context.evidenceById) {
    return context.evidenceById[assertion.evidenceId] || {};
  }
  if (assertion.id && context[assertion.id]) {
    return context[assertion.id];
  }
  return context.actual || context.result || {};
}

function markdownTextFrom(assertion, actual, context) {
  if (typeof assertion.markdown === "string") return assertion.markdown;
  return String(
    assertion.markdown?.text ||
    actual?.markdown ||
    actual?.rendered?.markdown ||
    context.rendered?.markdown ||
    context.markdown ||
    ""
  );
}

function assetReadabilityEntries(context, assertion) {
  const source = assertion.assetReadability || context.assetReadability || context.assetsReadability || {};
  if (Array.isArray(source)) return source;
  return Object.entries(source).map(([assetId, value]) => ({
    assetId,
    ...(typeof value === "object" ? value : { readable: Boolean(value) })
  }));
}

function validateOneAssertion(assertion, context) {
  const actual = resolveAssertionActual(assertion, context);
  const items = extractItems(actual);
  const assets = extractAssets(actual);
  const modalities = extractModalities(actual, items);
  const failures = [];
  const warnings = [];
  const expected = asObject(assertion.expected);
  const text = collectText(actual);

  const minItems = assertion.minItems ?? expected.minItems;
  if (minItems !== undefined && items.length < Number(minItems)) {
    failures.push(`Expected at least ${minItems} item(s), got ${items.length}.`);
  }

  const maxItems = assertion.maxItems ?? expected.maxItems;
  if (maxItems !== undefined && items.length > Number(maxItems)) {
    failures.push(`Expected at most ${maxItems} item(s), got ${items.length}.`);
  }

  const minScore = assertion.minScore ?? expected.minScore;
  if (minScore !== undefined) {
    const topScore = Math.max(0, ...items.map((item) => toFiniteNumber(item.score, 0)), toFiniteNumber(actual?.score, 0));
    if (topScore < Number(minScore)) {
      failures.push(`Expected top score >= ${minScore}, got ${topScore}.`);
    }
  }

  const requiredTerms = asArray(assertion.requiredTerms || assertion.contains || expected.terms);
  for (const term of requiredTerms) {
    if (!textIncludesTerm(text, term)) {
      failures.push(`Missing required term: ${term}.`);
    }
  }

  const forbiddenTerms = asArray(assertion.forbiddenTerms || expected.forbiddenTerms);
  for (const term of forbiddenTerms) {
    if (textIncludesTerm(text, term)) {
      failures.push(`Found forbidden term: ${term}.`);
    }
  }

  const requiredModalities = asArray(assertion.requiredModalities || expected.modalities);
  for (const modality of requiredModalities) {
    if (!modalities.includes(String(modality))) {
      failures.push(`Missing required modality: ${modality}.`);
    }
  }

  const itemIds = new Set(items.map(itemKey).filter(Boolean));
  for (const id of asArray(assertion.requiredItemIds || expected.itemIds || expected.documentIds || expected.evidenceIds)) {
    if (!itemIds.has(String(id))) {
      failures.push(`Missing required result id: ${id}.`);
    }
  }

  const minAssets = assertion.minAssets ?? expected.minAssets;
  if (minAssets !== undefined && assets.length < Number(minAssets)) {
    failures.push(`Expected at least ${minAssets} asset(s), got ${assets.length}.`);
  }

  const requiredAssetIds = asArray(assertion.requiredAssetIds || expected.assetIds);
  const assetIds = new Set(assets.map((asset) => String(asset.assetId || asset.id || "")).filter(Boolean));
  for (const assetId of requiredAssetIds) {
    if (!assetIds.has(String(assetId))) {
      failures.push(`Missing required asset id: ${assetId}.`);
    }
  }

  if (assertion.requireReadableAssets || expected.readableAssets) {
    const readability = assetReadabilityEntries(context, assertion);
    const readableAssetIds = new Set(
      readability
        .filter((entry) => entry.ok !== false && entry.readable !== false && toFiniteNumber(entry.byteLength ?? entry.bytes ?? 1, 1) > 0)
        .map((entry) => String(entry.assetId || entry.id || ""))
        .filter(Boolean)
    );
    for (const assetId of requiredAssetIds.length ? requiredAssetIds : assetIds) {
      if (!readableAssetIds.has(String(assetId))) {
        failures.push(`Asset is not marked readable: ${assetId}.`);
      }
    }
  }

  const markdownText = markdownTextFrom(assertion, actual, context);
  const markdownExpectation = typeof assertion.markdown === "object" ? assertion.markdown : {};
  const requiresMetadata = assertion.requireMarkdownMetadata ||
    markdownExpectation.requireMachineReadableMetadata ||
    expected.machineReadableMetadata;
  const requiredMetadataKeys = asArray(
    assertion.requiredMetadataKeys ||
    markdownExpectation.requiredMetadataKeys ||
    expected.metadataKeys
  );
  if (requiresMetadata || requiredMetadataKeys.length > 0 || markdownExpectation.requiredAssetRefs) {
    const metadata = parseMarkdownMetadata(markdownText);
    if (!metadata.hasFrontMatter) {
      failures.push("Markdown is missing front matter metadata.");
    }
    if (!metadata.jsonBlocks.some((block) => block && !block.parseError)) {
      failures.push("Markdown is missing a parseable JSON metadata block.");
    }
    for (const keyPath of requiredMetadataKeys) {
      if (!hasOwnPath(metadata.machineReadable, keyPath)) {
        failures.push(`Markdown metadata is missing key: ${keyPath}.`);
      }
    }
    for (const [keyPath, expectedValue] of Object.entries(asObject(expected.metadata))) {
      if (valueAtPath(metadata.machineReadable, keyPath) !== expectedValue) {
        failures.push(`Markdown metadata ${keyPath} did not match expected value.`);
      }
    }
    for (const assetRef of asArray(markdownExpectation.requiredAssetRefs || expected.assetRefs)) {
      if (!markdownText.includes(String(assetRef))) {
        failures.push(`Markdown is missing required asset reference: ${assetRef}.`);
      }
    }
  } else if (markdownText && !parseMarkdownMetadata(markdownText).hasFrontMatter) {
    warnings.push("Markdown was provided without front matter metadata.");
  }

  const ok = failures.length === 0;
  return {
    id: assertion.id || assertion.query || "quality-assertion",
    ok,
    status: ok ? "passed" : "failed",
    failures,
    warnings,
    metrics: {
      itemCount: items.length,
      assetCount: assets.length,
      modalities
    }
  };
}

export function validateKnowledgeQualityAssertions(assertions = [], context = {}, options = {}) {
  const list = asArray(assertions.assertions || assertions);
  const results = list.map((assertion) => validateOneAssertion(asObject(assertion), asObject(context)));
  const failedResults = results.filter((result) => !result.ok);
  const skipped = options.skipEmpty === true && list.length === 0 ? 1 : 0;
  return {
    ok: failedResults.length === 0,
    total: list.length,
    passed: results.length - failedResults.length,
    failed: failedResults.length,
    skipped,
    results
  };
}
