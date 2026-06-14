import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createKnowledgeCoreMount } from "../platform/specialized/knowledge/storage/knowledge-core/index.mjs";
import { createKnowledgeSkillRuntime } from "../platform/specialized/knowledge/invocation/knowledge-skill-runtime/index.mjs";
import { loadBundledKnowledgeTaxonomy } from "../platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/default-taxonomy.mjs";
import { ServerConfig } from "../platform/common/config/ServerConfig.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(parsed, max));
}

function categoryTitle(category = {}) {
  const pathText = asArray(category.pathSegments).filter(Boolean).join("/");
  return pathText || normalizeText(category.path || category.label || category.categoryId);
}

function categoryQuery(category = {}) {
  const pathTerms = asArray(category.pathSegments).map(normalizeText).filter(Boolean);
  return [
    ...pathTerms,
    category.label,
    category.intentLabel,
    ...asArray(category.queryTriggers).slice(0, 8)
  ]
    .map(normalizeText)
    .filter(Boolean)
    .filter((term, index, list) => list.indexOf(term) === index)
    .join(" ");
}

function categoryTerms(category = {}) {
  return [
    ...asArray(category.queryTriggers),
    ...asArray(category.strongTerms),
    ...asArray(category.anchorTerms),
    ...asArray(category.primaryTerms),
    ...asArray(category.keywords)
  ]
    .map((term) => normalizeText(term).toLowerCase())
    .filter((term) => term.length >= 2)
    .filter((term, index, list) => list.indexOf(term) === index)
    .slice(0, 64);
}

function evidenceQueries(category = {}, limit = 6) {
  return [
    ...asArray(category.queryTriggers),
    ...asArray(category.anchorTerms),
    ...asArray(category.strongTerms),
    category.label,
    ...asArray(category.pathSegments)
  ]
    .map(normalizeText)
    .filter((term) => term.length >= 2)
    .filter((term, index, list) => list.indexOf(term) === index)
    .slice(0, limit);
}

function coreConceptsForCategory(category = {}, evidenceRefs = []) {
  return [
    ...asArray(category.queryTriggers),
    ...asArray(category.anchorTerms),
    ...asArray(category.strongTerms)
  ]
    .map(normalizeText)
    .filter(Boolean)
    .filter((term, index, list) => list.indexOf(term) === index)
    .slice(0, 12)
    .map((term, index) => ({
      term,
      weight: Math.max(1, 12 - index),
      evidenceRefs: evidenceRefs.slice(0, 4)
    }));
}

function compileCategoryMatchers(taxonomy) {
  return asArray(taxonomy.categories).map((category) => ({
    category,
    terms: categoryTerms(category),
    negativeTerms: asArray(category.negativeTerms)
      .map((term) => normalizeText(term).toLowerCase())
      .filter((term) => term.length >= 2)
      .slice(0, 48)
  }));
}

function collectSearchItems(result = []) {
  return asArray(result.items || result.results)
    .map((item) => ({
      evidenceId: normalizeText(item.evidenceId || item.id),
      title: normalizeText(item.title),
      score: Number(item.score || item.finalScore || 0),
      snippet: normalizeText(item.snippet || item.summary || "")
    }))
    .filter((item) => item.evidenceId);
}

async function collectEvidenceForCategory({ knowledgeCore, category, searchLimit, queryLimit }) {
  const byId = new Map();
  const queries = evidenceQueries(category, queryLimit);
  for (const query of queries) {
    if (byId.size >= searchLimit) {
      break;
    }
    const result = await knowledgeCore.search({
      query,
      limit: Math.min(6, Math.max(3, searchLimit)),
      explain: true,
      learningEnabled: true,
      modalityPolicy: "multimodal"
    });
    for (const item of collectSearchItems(result)) {
      if (!byId.has(item.evidenceId)) {
        byId.set(item.evidenceId, {
          ...item,
          query
        });
      }
      if (byId.size >= searchLimit) {
        break;
      }
    }
  }
  return {
    queries,
    items: [...byId.values()],
    evidenceRefs: [...byId.keys()]
  };
}

function documentText(row = {}) {
  return [
    row.title,
    row.summary
  ]
    .map((item) => String(item || ""))
    .join("\n")
    .slice(0, 1800);
}

function loadDocumentRows(userDataPath, maxDocuments) {
  const dbPath = path.join(userDataPath, "knowledge-core", "knowledge.sqlite");
  if (!fs.existsSync(dbPath)) {
    throw new Error(`知识库 SQLite 不存在：${dbPath}`);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`
      SELECT
        d.document_id,
        d.title,
        substr(d.summary, 1, 1600) AS summary,
        d.document_type
      FROM kc_documents d
      ORDER BY d.updated_at DESC, d.title ASC
      LIMIT ?
    `).all(maxDocuments);
  } finally {
    db.close();
  }
}

function rankCategories({ rows, taxonomy, minDocuments }) {
  const byId = new Map(asArray(taxonomy.categories).map((category) => [category.categoryId, {
    category,
    documentCount: 0,
    examples: []
  }]));
  const matchers = compileCategoryMatchers(taxonomy);
  for (const row of rows) {
    const text = documentText(row).toLowerCase();
    const best = matchers
      .map((matcher) => {
        const positive = matcher.terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
        if (!positive) {
          return null;
        }
        const negative = matcher.negativeTerms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
        return {
          category: matcher.category,
          positive,
          negative,
          score: positive - negative * Number(matcher.category.negativeDominance || 1)
        };
      })
      .filter(Boolean)
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || right.positive - left.positive)[0];
    const categoryId = best?.category?.categoryId || "";
    if (!categoryId || !byId.has(categoryId)) {
      continue;
    }
    const entry = byId.get(categoryId);
    entry.documentCount += 1;
    if (entry.examples.length < 5) {
      entry.examples.push({
        documentId: row.document_id,
        title: row.title,
        documentType: row.document_type,
        confidence: Math.min(1, Math.max(0.1, Number((best.score / Math.max(best.positive, 1)).toFixed(3)))),
        path: categoryTitle(best.category)
      });
    }
  }
  return [...byId.values()]
    .filter((entry) => entry.documentCount >= minDocuments)
    .sort((left, right) => right.documentCount - left.documentCount || categoryTitle(left.category).localeCompare(categoryTitle(right.category)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userDataPath = path.resolve(
    String(args["data-dir"] || process.env.PACT_SERVER_DATA_DIR || ServerConfig.getDataDir())
  );
  const maxDocuments = Math.floor(clampNumber(args["max-documents"], 20000, 1, 200000));
  const topicLimit = Math.floor(clampNumber(args.limit, 16, 1, 100));
  const minDocuments = Math.floor(clampNumber(args["min-documents"], 3, 1, 100000));
  const searchLimit = Math.floor(clampNumber(args["search-limit"], 12, 1, 50));
  const queryLimit = Math.floor(clampNumber(args["query-limit"], 6, 1, 24));
  const publish = args.publish === true || args.publish === "true";
  const status = publish ? "published" : normalizeText(args.status || "pending_review");
  const dryRun = args["dry-run"] === true || args["dry-run"] === "true";

  const taxonomy = loadBundledKnowledgeTaxonomy();
  const rows = loadDocumentRows(userDataPath, maxDocuments);
  const selected = rankCategories({ rows, taxonomy, minDocuments }).slice(0, topicLimit);

  const report = {
    protocolVersion: "v0.0.1:knowledge:skill-distillation-1",
    userDataPath,
    dryRun,
    scannedDocumentCount: rows.length,
    selectedTopicCount: selected.length,
    minDocuments,
    searchLimit,
    queryLimit,
    status,
    publish,
    topics: selected.map((entry) => ({
      categoryId: entry.category.categoryId,
      title: categoryTitle(entry.category),
      label: entry.category.label || "",
      documentCount: entry.documentCount,
      examples: entry.examples
    })),
    skills: []
  };

  if (!dryRun) {
    const knowledgeCore = await createKnowledgeCoreMount({ userDataPath });
    const skillRuntime = createKnowledgeSkillRuntime({
      userDataPath,
      runtime: {
        mounts: {
          knowledgeBase: knowledgeCore
        }
      }
    });
    try {
      for (const entry of selected) {
        const query = categoryQuery(entry.category);
        const collected = await collectEvidenceForCategory({
          knowledgeCore,
          category: entry.category,
          searchLimit,
          queryLimit
        });
        if (!collected.evidenceRefs.length) {
          const archived = skillRuntime.resolveSkill({
            skillId: `knowledge_skill_taxonomy_${entry.category.categoryId}`,
            action: "archive"
          });
          report.skills.push({
            categoryId: entry.category.categoryId,
            skillId: `knowledge_skill_taxonomy_${entry.category.categoryId}`,
            title: `${categoryTitle(entry.category)} Skill`,
            status: archived?.skill?.status || "skipped",
            sourceQuery: query,
            documentCount: entry.documentCount,
            evidenceCount: 0,
            distinctDocumentCount: 0,
            qualityScore: 0,
            qualityPassed: false,
            statusReason: "no_evidence_collected",
            recommendations: ["当前主题未能通过短查询收集 evidence，已跳过或归档。"],
            evidenceQueries: collected.queries
          });
          continue;
        }
        const result = await skillRuntime.proposeSkill({
          skillId: `knowledge_skill_taxonomy_${entry.category.categoryId}`,
          query,
          sourceType: "manual",
          status,
          publish,
          proposal: {
            title: `${categoryTitle(entry.category)} Skill`,
            sourceQuery: query,
            evidenceRefs: collected.evidenceRefs,
            coreConcepts: coreConceptsForCategory(entry.category, collected.evidenceRefs)
          },
          evidenceRefs: collected.evidenceRefs
        });
        report.skills.push({
          categoryId: entry.category.categoryId,
          skillId: result.skill.skillId,
          title: result.skill.title,
          status: result.skill.status,
          sourceQuery: result.skill.sourceQuery,
          documentCount: entry.documentCount,
          evidenceCount: result.qualityReport.evidenceCount,
          distinctDocumentCount: result.qualityReport.distinctDocumentCount,
          qualityScore: result.qualityReport.score,
          qualityPassed: result.qualityReport.passed,
          statusReason: result.statusReason,
          recommendations: result.qualityReport.recommendations,
          evidenceQueries: collected.queries,
          sampledEvidence: collected.items.slice(0, 5)
        });
      }
    } finally {
      await knowledgeCore.close();
      skillRuntime.close();
    }
  }

  const outputDir = path.join(userDataPath, "knowledge-skills");
  await fsp.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(outputDir, `distillation-report-${stamp}.json`);
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    reportPath,
    scannedDocumentCount: report.scannedDocumentCount,
    selectedTopicCount: report.selectedTopicCount,
    createdSkillCount: report.skills.length,
    dryRun: report.dryRun,
    skills: report.skills
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
