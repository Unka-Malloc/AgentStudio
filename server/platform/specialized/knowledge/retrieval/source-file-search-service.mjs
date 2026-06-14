import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { loadSourceSearchRules } from "../preprocessing/domain/rules/source-search-rules.mjs";
import { setBoundedMapEntry } from "../../../common/platform-core/state-coordinator.mjs";
import { mapWithConcurrency } from "../../../common/platform-core/async-concurrency.mjs";
import {
  extractEmailHeaderValue,
  extractReadableEmailText
} from "../preprocessing/domain/rules/mail-readable-text.mjs";
import {
  getIndexedSourceFileByEvidenceId,
  indexedCandidateFilesForRoot,
  sourceEvidenceIdForPath
} from "../storage/source-file-index-service.mjs";

const SOURCE_EVIDENCE_PREFIX = "source-evidence::";
const SEARCH_CACHE = new Map();
const COMMAND_EXISTS_CACHE = new Map();
const MAX_SEARCH_CACHE_ENTRIES = 128;
const MAX_COMMAND_CACHE_ENTRIES = 64;
const MAX_INTERACTIVE_READ_CONCURRENCY = 64;
const DEFAULT_MAX_EVIDENCE_BYTES = 512 * 1024;
const execFileAsync = promisify(execFile);

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hashText(value, length = 24) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function resolveWithin(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath || ".");
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("路径越界。");
  }
  return resolvedPath;
}

function resolveSourceRootPath(userDataPath, root) {
  if (root.absolutePath || root.directoryPath) {
    return path.resolve(String(root.absolutePath || root.directoryPath));
  }
  return resolveWithin(userDataPath, root.relativePath);
}

function toPosixRelative(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function escapeFencedText(value) {
  return String(value || "").replace(/```/g, "`\u200b``");
}

function formatByteCount(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function boundedEvidenceBytes(rules) {
  return Math.max(
    16 * 1024,
    Math.min(
      Number(rules?.maxEvidenceBytes || DEFAULT_MAX_EVIDENCE_BYTES),
      10 * 1024 * 1024
    )
  );
}

async function readTextPreview(file, maxBytes) {
  const stat = await fs.stat(file);
  const byteLimit = Math.max(1, Number(maxBytes || DEFAULT_MAX_EVIDENCE_BYTES));
  const bytesToRead = Math.min(stat.size, byteLimit);
  const buffer = Buffer.alloc(bytesToRead);
  const handle = await fs.open(file, "r");
  try {
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    return {
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      byteSize: stat.size,
      previewBytes: bytesRead,
      truncated: stat.size > bytesRead,
      mtimeMs: stat.mtimeMs
    };
  } finally {
    await handle.close();
  }
}

function extractQueryAtoms(query) {
  return Array.from(
    new Set(
      String(query || "")
        .match(/[A-Za-z0-9][A-Za-z0-9._-]*|[\p{Script=Han}]{2,}/gu)
        ?.map((item) => item.trim())
        .filter(Boolean) || []
    )
  );
}

function termMatchesTrigger(term, trigger) {
  const left = lower(term);
  const right = lower(trigger);
  return left === right || left.includes(right) || right.includes(left);
}

function buildQueryGroups(query, rules) {
  const atoms = extractQueryAtoms(query);
  const sourceTerms = atoms.length ? atoms : normalizeText(query) ? [normalizeText(query)] : [];
  return sourceTerms
    .map((term) => {
      const expansions = (rules.queryExpansions || []).filter((entry) =>
        (entry.triggers || []).some((trigger) => termMatchesTrigger(term, trigger))
      );
      const values = [term, ...expansions.flatMap((entry) => entry.terms || [])]
        .map(normalizeText)
        .filter(Boolean);
      const seen = new Set();
      return {
        queryTerm: term,
        expansionIds: expansions.map((entry) => entry.id),
        terms: values.filter((value) => {
          const key = lower(value);
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        })
      };
    })
    .filter((group) => group.terms.length > 0);
}

function findTermPositions(textLower, terms) {
  const positions = [];
  for (const term of terms) {
    const normalized = lower(term);
    if (!normalized) {
      continue;
    }
    let index = textLower.indexOf(normalized);
    while (index >= 0) {
      positions.push({ term, index });
      index = textLower.indexOf(normalized, index + Math.max(1, normalized.length));
      if (positions.length > 200) {
        return positions;
      }
    }
  }
  return positions;
}

function isRawSearchSafeTerm(term) {
  return /^[\x00-\x7F]+$/.test(String(term || ""));
}

function nativePrefilterGroups(groups) {
  const output = [];
  let omittedReadableOnlyGroupCount = 0;
  for (const group of groups || []) {
    const safeTerms = (group.terms || []).filter(isRawSearchSafeTerm);
    if (safeTerms.length) {
      output.push({
        ...group,
        terms: safeTerms
      });
    } else {
      omittedReadableOnlyGroupCount += 1;
    }
  }
  return {
    groups: output,
    omittedReadableOnlyGroupCount
  };
}

function matchQueryGroups(text, groups) {
  const textLower = lower(text);
  const matches = groups.map((group) => ({
    group,
    positions: findTermPositions(textLower, group.terms)
  }));
  return {
    matches,
    strict: groups.length > 0 && matches.every((entry) => entry.positions.length > 0),
    matchedGroupCount: matches.filter((entry) => entry.positions.length > 0).length,
    firstPosition: Math.min(
      ...matches.flatMap((entry) => entry.positions.map((position) => position.index)),
      Number.POSITIVE_INFINITY
    )
  };
}

function headerValue(raw, name) {
  return extractEmailHeaderValue(raw, name);
}

function searchableTextFromRawEmail(raw) {
  return extractReadableEmailText(raw, { includeHeaders: true, removeUrlNoise: true });
}

function rawSearchTextFromRawEmail(raw) {
  return String(raw || "");
}

function snippetAround(readableText, firstPosition, windowSize) {
  const readable = normalizeText(readableText);
  if (!Number.isFinite(firstPosition)) {
    return readable.slice(0, windowSize * 2);
  }
  const rawStart = Math.max(0, firstPosition - windowSize);
  const rawEnd = Math.min(readable.length, firstPosition + windowSize);
  const snippet = normalizeText(readable.slice(rawStart, rawEnd));
  return snippet || readable.slice(0, windowSize * 2);
}

async function listSourceFiles(root, extensions, maxFiles, ignoredDirectories = []) {
  const files = [];
  const ignoredSet = new Set((ignoredDirectories || []).map((item) => lower(item)).filter(Boolean));
  async function walk(directory) {
    if (files.length >= maxFiles) {
      return;
    }
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        return;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (ignoredSet.has(lower(entry.name))) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (extensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(absolutePath);
      }
    }
  }
  await walk(root);
  return files;
}

function mergedKnowledgeSourceExtensions(rules) {
  const configured = (rules.knowledgeSourceExtensions || []).map((item) => lower(item)).filter(Boolean);
  if (configured.length) {
    return configured;
  }
  return Array.from(new Set((rules.scanRoots || []).flatMap((root) => root.extensions || []).map((item) => lower(item)).filter(Boolean)));
}

async function configuredSourceRoots(userDataPath, rules) {
  const output = [...(rules.scanRoots || [])];
  if (rules.includeKnowledgeSources === false) {
    return output;
  }
  const sourceConfigPath = path.join(userDataPath, "knowledge-sources", "sources.json");
  let parsed = null;
  try {
    parsed = JSON.parse(await fs.readFile(sourceConfigPath, "utf8"));
  } catch {
    return output;
  }
  const extensions = mergedKnowledgeSourceExtensions(rules);
  for (const source of Array.isArray(parsed?.sources) ? parsed.sources : []) {
    const directoryPath = normalizeText(source?.directoryPath);
    if (!directoryPath || source?.enabled === false || !extensions.length) {
      continue;
    }
	    output.push({
	      id: normalizeText(source.sourceId) || `knowledge-source-${hashText(directoryPath, 12)}`,
	      label: normalizeText(source.label) || path.basename(directoryPath),
	      absolutePath: directoryPath,
	      extensions,
	      enabled: true,
	      sourceKind: "knowledge-source",
	      lastIndexSnapshotHash: normalizeText(source.lastIndexSnapshotHash),
	      lastIndexAt: normalizeText(source.lastIndexAt),
	      lastIndexStatus: normalizeText(source.lastIndexStatus)
	    });
  }
  return output;
}

async function configuredSourceFiles(userDataPath, rules) {
  const output = [];
  for (const root of await configuredSourceRoots(userDataPath, rules)) {
    if (root.enabled === false) {
      continue;
    }
    let rootPath;
    try {
      rootPath = resolveSourceRootPath(userDataPath, root);
    } catch {
      continue;
    }
    const extensions = new Set((root.extensions || []).map((item) => lower(item)));
    const files = await listSourceFiles(rootPath, extensions, rules.maxScanFiles, rules.ignoredDirectories || []);
    for (const file of files) {
      output.push({ file, root });
      if (output.length >= rules.maxScanFiles) {
        return output;
      }
    }
  }
  return output;
}

function commandExists(command) {
  if (COMMAND_EXISTS_CACHE.has(command)) {
    return COMMAND_EXISTS_CACHE.get(command);
  }
  try {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500
    });
    const exists = result.status === 0;
    setBoundedMapEntry(COMMAND_EXISTS_CACHE, command, exists, MAX_COMMAND_CACHE_ENTRIES);
    return exists;
  } catch {
    setBoundedMapEntry(COMMAND_EXISTS_CACHE, command, false, MAX_COMMAND_CACHE_ENTRIES);
    return false;
  }
}

async function rgFilesForGroup(rootPath, extensions, group, ignoredDirectories = []) {
  const terms = (group.terms || []).map(normalizeText).filter(Boolean).slice(0, 64);
  if (!terms.length) {
    return null;
  }
  const args = [
    "--files-with-matches",
    "--fixed-strings",
    "--ignore-case",
    "--no-messages",
    "--color",
    "never"
  ];
  for (const extension of extensions) {
    args.push("--glob", `*${extension}`);
  }
  for (const directory of ignoredDirectories || []) {
    const normalized = normalizeText(directory);
    if (normalized) {
      args.push("--glob", `!**/${normalized}/**`);
    }
  }
  for (const term of terms) {
    args.push("-e", term);
  }
  args.push(".");
  let stdout = "";
  try {
    const result = await execFileAsync("rg", args, {
      cwd: rootPath,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30000
    });
    stdout = result.stdout || "";
  } catch (error) {
    if (error?.code !== 1) {
      stdout = error?.stdout || "";
    } else {
      stdout = "";
    }
  }
  return new Set(
    String(stdout || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => path.resolve(rootPath, item))
  );
}

async function rgCandidateFiles(rootPath, extensions, groups, ignoredDirectories = []) {
  if (!commandExists("rg")) {
    return null;
  }
  const groupSets = (await Promise.all(groups.map((group) => rgFilesForGroup(rootPath, extensions, group, ignoredDirectories))))
    .filter(Boolean);
  if (!groupSets.length) {
    return null;
  }
  let current = groupSets[0];
  for (const nextSet of groupSets.slice(1)) {
    current = new Set([...current].filter((item) => nextSet.has(item)));
  }
  return current;
}

async function candidateSourceFiles(userDataPath, rules, groups, sourceRoots = null) {
  const output = [];
  let usedNativeCandidateSearch = false;
  let usedInvertedIndex = false;
  let candidateFileCount = 0;
  const indexUnavailableSourceIds = [];
  for (const root of sourceRoots || await configuredSourceRoots(userDataPath, rules)) {
    if (root.enabled === false) {
      continue;
    }
    if (rules.useInvertedIndex !== false) {
      const indexed = await indexedCandidateFilesForRoot({
        userDataPath,
        root,
        groups
      });
      if (indexed.available) {
        usedInvertedIndex = true;
        candidateFileCount += indexed.candidateFileCount;
        for (const entry of indexed.files) {
          output.push(entry);
          if (output.length >= rules.maxScanFiles) {
            return {
              files: output,
              usedNativeCandidateSearch,
              usedInvertedIndex,
              indexUnavailableSourceIds,
              candidateFileCount
            };
          }
        }
        continue;
      }
      if (root.sourceKind === "knowledge-source") {
        indexUnavailableSourceIds.push({
          sourceId: root.id,
          reason: indexed.reason || "index_unavailable"
        });
        if (rules.scanFallbackWhenIndexMissing !== true) {
          continue;
        }
      }
    }
    let rootPath;
    try {
      rootPath = resolveSourceRootPath(userDataPath, root);
    } catch {
      continue;
    }
    const extensions = new Set((root.extensions || []).map((item) => lower(item)));
    const nativePrefilter = nativePrefilterGroups(groups);
    const nativeCandidates = nativePrefilter.groups.length
      ? await rgCandidateFiles(rootPath, extensions, nativePrefilter.groups, rules.ignoredDirectories || [])
      : null;
    if (nativeCandidates?.size > 0) {
      usedNativeCandidateSearch = true;
      candidateFileCount += nativeCandidates.size;
      for (const file of nativeCandidates) {
        output.push({ file, root });
        if (output.length >= rules.maxScanFiles) {
          return {
            files: output,
            usedNativeCandidateSearch,
            usedInvertedIndex,
            indexUnavailableSourceIds,
            candidateFileCount
          };
        }
      }
      continue;
    }
    if (nativeCandidates?.size === 0 && nativePrefilter.omittedReadableOnlyGroupCount === 0) {
      usedNativeCandidateSearch = true;
      continue;
    }
    const files = await listSourceFiles(rootPath, extensions, rules.maxScanFiles, rules.ignoredDirectories || []);
    candidateFileCount += files.length;
    for (const file of files) {
      output.push({ file, root });
      if (output.length >= rules.maxScanFiles) {
        return {
          files: output,
          usedNativeCandidateSearch,
          usedInvertedIndex,
          indexUnavailableSourceIds,
          candidateFileCount
        };
      }
    }
  }
  return {
    files: output,
    usedNativeCandidateSearch,
    usedInvertedIndex,
    indexUnavailableSourceIds,
    candidateFileCount
  };
}

function evidenceIdForPath(userDataPath, absolutePath) {
  return sourceEvidenceIdForPath(userDataPath, absolutePath);
}

function queryGroupReport(match) {
  return match.matches.map((entry) => ({
    queryTerm: entry.group.queryTerm,
    expansionIds: entry.group.expansionIds,
    matchedTerms: Array.from(new Set(entry.positions.map((position) => position.term))).slice(0, 10)
  }));
}

function resultFromHit({
  userDataPath,
  file,
  raw,
  contentHash,
  score,
  snippet,
  rawMatch,
  readableMatch,
  effectiveMatch,
  relevanceTier,
  rules
}) {
  const relativePath = toPosixRelative(userDataPath, file);
  const subject = headerValue(raw, "Subject");
  const from = headerValue(raw, "From");
  const date = headerValue(raw, "Date");
  const evidenceId = evidenceIdForPath(userDataPath, file);
  const lowRelevance = relevanceTier === "low";
  return {
    evidenceId,
    itemId: evidenceId,
    documentId: evidenceId,
    itemType: "raw-source",
    title: subject || path.basename(file),
    snippet,
    score,
    finalScore: score,
    relevanceScore: score,
    relevanceTier,
    contextEligible: !lowRelevance,
    lowRelevance: lowRelevance || undefined,
    lowRelevanceReason: lowRelevance
      ? "query_matched_raw_eml_only_after_readable_body_gate_removed"
      : "",
    modalities: ["text"],
    source: {
      kind: "raw-source-file",
      sourcePath: relativePath,
      relativePath,
      mediaType: path.extname(file).toLowerCase() === ".eml" ? "message/rfc822" : "text/plain",
      contentHash,
      from,
      date
    },
    sourceLocator: {
      kind: "raw-source-file",
      sourcePath: relativePath,
      relativePath,
      contentHash
    },
    reasons: [
      {
        kind: "raw-source-keyword",
        strict: rawMatch.strict,
        matchedGroupCount: rawMatch.matchedGroupCount,
        queryGroups: queryGroupReport(rawMatch),
        readableStrict: readableMatch.strict,
        readableMatchedGroupCount: readableMatch.matchedGroupCount,
        readableQueryGroups: queryGroupReport(readableMatch),
        effectiveMatchedGroupCount: effectiveMatch.matchedGroupCount,
        relevanceTier,
        rulesVersion: rules.updatedAt || ""
      }
    ],
    rawSource: true
  };
}

async function inspectCandidateFile({ userDataPath, file, groups, rules }) {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return { scanned: 1, skippedLarge: 0, result: null };
  }
  if (stat.size > rules.maxFileBytes) {
    return { scanned: 1, skippedLarge: 1, result: null };
  }
  let raw = "";
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return { scanned: 1, skippedLarge: 0, result: null };
  }
  const rawSearchText = rawSearchTextFromRawEmail(raw);
  const rawMatch = matchQueryGroups(rawSearchText, groups);
  const searchableText = searchableTextFromRawEmail(raw);
  const readableMatch = matchQueryGroups(searchableText, groups);
  if (!rawMatch.strict && !readableMatch.strict) {
    return { scanned: 1, skippedLarge: 0, result: null };
  }
  const highRelevance = readableMatch.strict;
  const effectiveMatch = highRelevance ? readableMatch : rawMatch;
  const searchableForSnippet = highRelevance ? searchableText : searchableText || rawSearchText;
  const contentHash = crypto.createHash("sha256").update(raw).digest("hex");
  const occurrenceCount = effectiveMatch.matches.reduce((sum, entry) => sum + entry.positions.length, 0);
  const subject = headerValue(raw, "Subject");
  const headerBoost = lower(`${subject}\n${headerValue(raw, "From")}`).includes(lower(groups[0]?.queryTerm || ""))
    ? 0.25
    : 0;
  const relevanceBase = highRelevance ? 0.55 : 0.14;
  const score = Number(
    Math.min(
      highRelevance ? 1 : 0.42,
      relevanceBase +
        effectiveMatch.matchedGroupCount / Math.max(1, groups.length) * (highRelevance ? 0.25 : 0.1) +
        Math.log10(occurrenceCount + 1) * (highRelevance ? 0.12 : 0.04) +
        (highRelevance ? headerBoost : Math.min(headerBoost, 0.08))
    ).toFixed(6)
  );
  const snippet = snippetAround(searchableForSnippet, effectiveMatch.firstPosition, rules.snippetWindow);
  return {
    scanned: 1,
    skippedLarge: 0,
    result: resultFromHit({
      userDataPath,
      file,
      raw,
      contentHash,
      score,
      snippet,
      rawMatch,
      readableMatch,
      effectiveMatch,
      relevanceTier: highRelevance ? "high" : "low",
      rules
    })
  };
}

export function isSourceEvidenceId(evidenceId) {
  return String(evidenceId || "").startsWith(SOURCE_EVIDENCE_PREFIX);
}

export async function searchSourceFiles({ userDataPath, query = "", limit = 20, returnAll = false } = {}) {
  const rules = await loadSourceSearchRules(userDataPath);
  const sourceRoots = await configuredSourceRoots(userDataPath, rules);
  const safeLimit = returnAll ? Number.POSITIVE_INFINITY : Math.max(1, Math.min(Number(limit || 20), 5000));
  const readConcurrency = Math.max(
    1,
    Math.min(Number(rules.readConcurrency || 1), MAX_INTERACTIVE_READ_CONCURRENCY)
  );
  const groups = buildQueryGroups(query, rules);
  const cacheKey = JSON.stringify({
    userDataPath: path.resolve(userDataPath),
    query: normalizeText(query).toLowerCase(),
    limit: Number.isFinite(safeLimit) ? safeLimit : "all",
    returnAll,
    rulesUpdatedAt: rules.updatedAt,
    readConcurrency,
    scanRoots: sourceRoots.map((root) => ({
      id: root.id,
      relativePath: root.relativePath || "",
	      absolutePath: root.absolutePath || root.directoryPath || "",
	      extensions: root.extensions || [],
	      enabled: root.enabled !== false,
	      lastIndexSnapshotHash: root.lastIndexSnapshotHash || "",
	      lastIndexAt: root.lastIndexAt || "",
	      lastIndexStatus: root.lastIndexStatus || ""
	    }))
	  });
  const cached = SEARCH_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < rules.cacheTtlMs) {
    return {
      ...cached.result,
      fromCache: true
    };
  }

  const startedAt = Date.now();
  const candidateStartedAt = Date.now();
  const {
    files,
    usedNativeCandidateSearch,
    usedInvertedIndex,
    indexUnavailableSourceIds,
    candidateFileCount
  } = await candidateSourceFiles(userDataPath, rules, groups, sourceRoots);
  const candidateElapsedMs = Date.now() - candidateStartedAt;
  const hitsByHash = new Map();
  let scannedFiles = 0;
  let skippedLargeFiles = 0;
  const inspectStartedAt = Date.now();
  const inspected = await mapWithConcurrency(files, readConcurrency, ({ file }) =>
    inspectCandidateFile({ userDataPath, file, groups, rules })
  );
  const inspectElapsedMs = Date.now() - inspectStartedAt;
  for (const entry of inspected) {
    scannedFiles += Number(entry?.scanned || 0);
    skippedLargeFiles += Number(entry?.skippedLarge || 0);
    const result = entry?.result;
    if (!result) {
      continue;
    }
    const contentHash = String(result.source?.contentHash || result.sourceLocator?.contentHash || result.evidenceId || "");
    const current = hitsByHash.get(contentHash);
    const shouldReplace = !current ||
      (result.relevanceTier !== current.relevanceTier
        ? result.relevanceTier === "high"
        : result.score > current.score);
    if (shouldReplace) {
      hitsByHash.set(contentHash, result);
    }
  }

  const sortedItems = [...hitsByHash.values()]
    .sort((left, right) => {
      const leftTier = left.relevanceTier === "low" ? 1 : 0;
      const rightTier = right.relevanceTier === "low" ? 1 : 0;
      return leftTier - rightTier || right.score - left.score || String(left.title).localeCompare(String(right.title));
    });
  const items = Number.isFinite(safeLimit) ? sortedItems.slice(0, safeLimit) : sortedItems;
  const highRelevanceCount = sortedItems.filter((item) => item.relevanceTier !== "low").length;
  const lowRelevanceCount = sortedItems.length - highRelevanceCount;
  const result = {
    protocolVersion: "v0.0.1:knowledge:source-search-1",
    query: normalizeText(query),
    limit: returnAll ? "all" : safeLimit,
    retrievalMode: "raw-source-keyword",
    sourceSearch: true,
    rawSourceSearch: true,
    fromCache: false,
    items,
    results: items,
    explain: {
      scannedFiles,
      skippedLargeFiles,
      readConcurrency,
      configuredReadConcurrency: rules.readConcurrency,
      candidateSearch: usedInvertedIndex
        ? usedNativeCandidateSearch
          ? "sqlite-inverted-index+ripgrep-fixed-strings"
          : "sqlite-inverted-index"
        : usedNativeCandidateSearch
          ? "ripgrep-fixed-strings"
          : "js-directory-walk",
      invertedIndex: {
        enabled: rules.useInvertedIndex !== false,
        used: Boolean(usedInvertedIndex),
        unavailableSources: indexUnavailableSourceIds || [],
        scanFallbackWhenIndexMissing: rules.scanFallbackWhenIndexMissing === true
      },
      candidateFileCount,
      candidateElapsedMs,
      inspectElapsedMs,
      matchedUniqueFiles: hitsByHash.size,
      highRelevanceCount,
      lowRelevanceCount,
      returned: items.length,
      elapsedMs: Date.now() - startedAt,
      queryGroups: groups.map((group) => ({
        queryTerm: group.queryTerm,
        expansionIds: group.expansionIds,
        termCount: group.terms.length
      })),
      rulesPath: "rules/source-search-rules.json"
    }
  };
  setBoundedMapEntry(SEARCH_CACHE, cacheKey, {
    cachedAt: Date.now(),
    result
  }, MAX_SEARCH_CACHE_ENTRIES);
  return result;
}

export async function getSourceFileEvidence({ userDataPath, evidenceId } = {}) {
  if (!isSourceEvidenceId(evidenceId)) {
    return null;
  }
  const rules = await loadSourceSearchRules(userDataPath);
  const indexedMatch = await getIndexedSourceFileByEvidenceId({ userDataPath, evidenceId });
  const files = indexedMatch ? [] : await configuredSourceFiles(userDataPath, rules);
  const match = indexedMatch || files.find(({ file }) => evidenceIdForPath(userDataPath, file) === evidenceId);
  if (!match) {
    return null;
  }
  let preview;
  try {
    preview = await readTextPreview(match.file, boundedEvidenceBytes(rules));
  } catch {
    return null;
  }
  const raw = preview.text;
  const relativePath = toPosixRelative(userDataPath, match.file);
  const title = headerValue(raw, "Subject") || path.basename(match.file);
  const snippet = snippetAround(searchableTextFromRawEmail(raw), Number.POSITIVE_INFINITY, rules.snippetWindow);
  const contentHash = crypto
    .createHash("sha256")
    .update(raw)
    .update(`:${preview.byteSize}:${preview.mtimeMs}`)
    .digest("hex");
  const truncationNotice = preview.truncated
    ? `\n\n[Pact evidence preview: 原始文件大小 ${formatByteCount(preview.byteSize)}，为保证服务端和界面稳定，本次只显示前 ${formatByteCount(preview.previewBytes)}。]`
    : "";
  const displayText = `${raw}${truncationNotice}`;
  const evidence = {
    evidenceId,
    batchId: relativePath.split("/")[2] || "",
    documentId: evidenceId,
    sectionId: "",
    blockId: evidenceId,
    assetId: "",
    title,
    snippet,
    score: 1,
    reasons: [{ kind: "raw-source-file" }],
    locator: {
      kind: "raw-source-file",
      sourcePath: relativePath,
      relativePath,
      contentHash
    },
    sourceLocator: {
      kind: "raw-source-file",
      sourcePath: relativePath,
      relativePath,
      contentHash,
      byteSize: preview.byteSize,
      previewBytes: preview.previewBytes,
      truncated: preview.truncated
    },
    payload: {
      document: {
        documentId: evidenceId,
        documentType: "email",
        title,
        sourcePath: relativePath,
        metadata: {
          from: headerValue(raw, "From"),
          date: headerValue(raw, "Date"),
          contentHash,
          byteSize: preview.byteSize,
          previewBytes: preview.previewBytes,
          truncated: preview.truncated
        }
      },
      section: null,
      blocks: [
        {
          blockId: evidenceId,
          title,
          text: displayText,
          snippet,
          sourceLocator: {
            kind: "raw-source-file",
            sourcePath: relativePath,
            relativePath,
            truncated: preview.truncated
          }
        }
      ],
      assets: []
    },
    markdown: [
      `# ${title}`,
      "",
      `来源：${relativePath}`,
      preview.truncated
        ? `预览：仅返回前 ${formatByteCount(preview.previewBytes)} / ${formatByteCount(preview.byteSize)}，避免大文件导致服务端或浏览器内存膨胀。`
        : "",
      "",
      "```eml",
      escapeFencedText(displayText),
      "```"
    ].join("\n"),
    createdAt: nowIso()
  };
  return evidence;
}
