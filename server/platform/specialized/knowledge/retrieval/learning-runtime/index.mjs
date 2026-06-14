import { createHash } from "node:crypto";

export const LEARNING_PROTOCOL_VERSION = "v0.0.1:knowledge:learning-1";

const DEFAULT_PROFILE = {
  profileId: "balanced",
  version: 1,
  active: true,
  weights: {
    bm25: 0.55,
    vector: 0.3,
    image: 0.15,
    graph: 0.05,
    feedbackBoost: 0.08
  },
  topK: 20,
  fusionMode: "reciprocal_rank",
  reranker: {
    provider: "builtin:deterministic-rrf",
    model: "",
    explicitModelRequired: true
  },
  thresholds: {
    minScore: 0,
    maxLatencyMs: 1500,
    minRecallDelta: 0,
    minNdcgDelta: 0,
    minMrrDelta: 0
  },
  metrics: {
    mrrAtK: 0,
    ndcgAtK: 0,
    recallAtK: 0,
    latencyP95Ms: 0
  }
};

const SAFE_AUTO_APPLY_SUGGESTION_TYPES = new Set([
  "retrievalProfile",
  "rankingRule",
  "decay"
]);

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.max(min, Math.min(number, max));
}

function hashText(value, length = 24) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function normalizeAction(action) {
  return String(action || "").trim().replace(/-/g, "_");
}

function normalizeProfile(profile = {}) {
  const weights = {
    ...DEFAULT_PROFILE.weights,
    ...(profile.weights || {}),
    bm25: profile.weights?.bm25 ?? profile.retrieval?.bm25Weight ?? profile.bm25Weight ?? DEFAULT_PROFILE.weights.bm25,
    vector: profile.weights?.vector ?? profile.retrieval?.vectorWeight ?? profile.vectorWeight ?? DEFAULT_PROFILE.weights.vector,
    image: profile.weights?.image ?? profile.retrieval?.imageWeight ?? profile.imageWeight ?? DEFAULT_PROFILE.weights.image,
    graph: profile.weights?.graph ?? profile.retrieval?.graphWeight ?? profile.graphWeight ?? DEFAULT_PROFILE.weights.graph,
    feedbackBoost:
      profile.weights?.feedbackBoost ??
      profile.retrieval?.feedbackBoost ??
      profile.feedbackBoost ??
      DEFAULT_PROFILE.weights.feedbackBoost
  };
  const total = Math.max(0.0001, weights.bm25 + weights.vector + weights.image);
  return {
    ...DEFAULT_PROFILE,
    ...profile,
    profileId: String(profile.profileId || profile.id || DEFAULT_PROFILE.profileId),
    version: Math.max(1, Number(profile.version || DEFAULT_PROFILE.version)),
    weights: {
      ...weights,
      bm25: Number((weights.bm25 / total).toFixed(4)),
      vector: Number((weights.vector / total).toFixed(4)),
      image: Number((weights.image / total).toFixed(4)),
      graph: clamp(weights.graph, 0, 1),
      feedbackBoost: clamp(weights.feedbackBoost, 0, 1)
    },
    topK: Math.max(1, Math.min(Number(profile.topK || profile.retrieval?.topK || DEFAULT_PROFILE.topK), 100)),
    fusionMode: String(profile.fusionMode || DEFAULT_PROFILE.fusionMode),
    reranker: {
      ...DEFAULT_PROFILE.reranker,
      ...(profile.reranker || {})
    },
    thresholds: {
      ...DEFAULT_PROFILE.thresholds,
      ...(profile.thresholds || {})
    },
    metrics: {
      ...DEFAULT_PROFILE.metrics,
      ...(profile.metrics || {})
    }
  };
}

function candidateKey(candidate = {}) {
  const row = candidate.row || {};
  const id = candidate.targetType === "asset" ? row.asset_id || candidate.targetId : row.block_id || candidate.targetId;
  return `${candidate.targetType || "target"}::${id || ""}`;
}

function rrfScore(index, k = 60) {
  return 1 / (k + index + 1);
}

function reasonWeight(reason = {}, profile = DEFAULT_PROFILE) {
  const kind = String(reason.kind || reason.reason || "");
  if (kind.includes("image")) {
    return profile.weights.image;
  }
  if (kind.includes("vector")) {
    return profile.weights.vector;
  }
  if (kind.includes("graph")) {
    return profile.weights.graph;
  }
  if (kind.includes("feedback")) {
    return profile.weights.feedbackBoost;
  }
  return profile.weights.bm25;
}

function explainCandidate(candidate = {}, profile = DEFAULT_PROFILE, index = 0) {
  const baseScore = Number(candidate.combinedScore || candidate.score || 0);
  const reasonScore = asArray(candidate.reasons).reduce(
    (sum, reason) => sum + Number(reason.score || 0) * reasonWeight(reason, profile),
    0
  );
  const fusedScore = baseScore + reasonScore + rrfScore(index);
  return {
    key: candidateKey(candidate),
    baseScore,
    reasonScore: Number(reasonScore.toFixed(6)),
    rrfScore: Number(rrfScore(index).toFixed(6)),
    fusedScore: Number(fusedScore.toFixed(6))
  };
}

function frameworkStatus() {
  return {
    llamaIndex: {
      providerId: "llamaindex",
      status: "external-component-via-js-adapter",
      requiredForDefaultRuntime: false
    },
    lanceDb: {
      providerId: "lancedb",
      status: "external-component-via-js-adapter-or-service",
      requiredForDefaultRuntime: false
    }
  };
}

export function createLearningRuntime(options = {}) {
  let settings = options.settings || {};

  async function health() {
    return {
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      ok: true,
      degraded: false,
      runtime: "builtin-deterministic-fallback",
      frameworks: frameworkStatus(),
      noImplicitDownloads: true
    };
  }

  function capabilities() {
    return {
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      frameworkPreference: ["javascript-adapter", "external-service"],
      defaultRuntime: "builtin-deterministic-fallback",
      optionalRuntime: "external-js-adapter",
      noImplicitDownloads: true,
      autoApplyBoundaries: {
        retrievalProfiles: true,
        rankingRules: true,
        canonicalFacts: false,
        entityMerges: false,
        relations: false,
        taxonomy: false
      },
      safeAutoApplySuggestionTypes: [...SAFE_AUTO_APPLY_SUGGESTION_TYPES]
    };
  }

  async function fuseCandidates(input = {}) {
    const profile = normalizeProfile(input.profile || input.retrievalProfile || {});
    const candidates = asArray(input.candidates);
    const explanations = candidates.map((candidate, index) => explainCandidate(candidate, profile, index));
    const scoreByKey = new Map(explanations.map((entry) => [entry.key, entry.fusedScore]));
    return {
      runtime: "builtin-deterministic-fallback",
      degraded: false,
      candidates: [...candidates].sort(
        (left, right) => (scoreByKey.get(candidateKey(right)) || 0) - (scoreByKey.get(candidateKey(left)) || 0)
      ),
      explanations
    };
  }

  function fuseCandidatesSync(input = {}) {
    const profile = normalizeProfile(input.profile || input.retrievalProfile || {});
    const candidates = asArray(input.candidates);
    const explanations = candidates.map((candidate, index) => explainCandidate(candidate, profile, index));
    const scoreByKey = new Map(explanations.map((entry) => [entry.key, entry.fusedScore]));
    return {
      runtime: "builtin-deterministic-fallback",
      degraded: true,
      candidates: [...candidates].sort(
        (left, right) => (scoreByKey.get(candidateKey(right)) || 0) - (scoreByKey.get(candidateKey(left)) || 0)
      ),
      explanations
    };
  }

  function proposeProfile({ activeProfile = DEFAULT_PROFILE, feedback = [] } = {}) {
    const profile = normalizeProfile(activeProfile);
    const counts = {
      positive: 0,
      negative: 0,
      searchMiss: 0,
      vector: 0,
      lexical: 0,
      image: 0
    };

    for (const item of feedback) {
      const action = normalizeAction(item.action);
      if ([
        "open",
        "copy",
        "export",
        "thumb_up",
        "thumbUp",
        "human_expert_clarification",
        "human_expert_correction",
        "expert_choice",
        "expert_feedback"
      ].includes(action) || item.context?.gold === true || item.context?.humanExpert === true) {
        counts.positive += 1;
      }
      if (["thumb_down", "thumbDown"].includes(action)) {
        counts.negative += 1;
      }
      if (action === "search_miss" || action === "searchMiss") {
        counts.searchMiss += 1;
        counts.negative += 1;
      }
      const context = item.context || {};
      const reasons = asArray(context.reasons || context.retrievalReasons);
      if (reasons.some((reason) => String(reason.kind || "").includes("vector"))) {
        counts.vector += 1;
      }
      if (reasons.some((reason) => String(reason.kind || "").includes("image"))) {
        counts.image += 1;
      }
      if (reasons.some((reason) => String(reason.kind || "").includes("bm25") || String(reason.kind || "").includes("like"))) {
        counts.lexical += 1;
      }
    }

    const candidate = normalizeProfile({
      ...profile,
      profileId: profile.profileId,
      version: profile.version + 1,
      active: false,
      topK: clamp(profile.topK + Math.min(counts.searchMiss, 5), 5, 100),
      weights: {
        ...profile.weights,
        bm25: profile.weights.bm25 + (counts.lexical > counts.vector ? 0.04 : 0),
        vector: profile.weights.vector + (counts.vector >= counts.lexical ? 0.04 : 0),
        image: profile.weights.image + (counts.image > 0 ? 0.02 : 0)
      },
      metrics: {
        mrrAtK: Number((profile.metrics.mrrAtK + counts.positive * 0.01 - counts.negative * 0.003).toFixed(4)),
        ndcgAtK: Number((profile.metrics.ndcgAtK + counts.positive * 0.008 - counts.negative * 0.002).toFixed(4)),
        recallAtK: Number((profile.metrics.recallAtK + counts.searchMiss * 0.01).toFixed(4)),
        latencyP95Ms: Number(profile.metrics.latencyP95Ms || 0)
      }
    });

    return {
      candidate,
      counts,
      metricsBefore: profile.metrics,
      metricsAfter: candidate.metrics,
      autoApplicable:
        candidate.metrics.mrrAtK >= profile.metrics.mrrAtK + Number(profile.thresholds.minMrrDelta || 0) &&
        candidate.metrics.ndcgAtK >= profile.metrics.ndcgAtK + Number(profile.thresholds.minNdcgDelta || 0) &&
        candidate.metrics.recallAtK >= profile.metrics.recallAtK + Number(profile.thresholds.minRecallDelta || 0) &&
        candidate.metrics.latencyP95Ms <= Number(profile.thresholds.maxLatencyMs || 1500)
    };
  }

  function generateSuggestions({ feedback = [], activeProfile = DEFAULT_PROFILE } = {}) {
    const suggestions = [];
    const searchMisses = asArray(feedback).filter((item) => {
      const action = normalizeAction(item.action);
      return action === "search_miss" || action === "searchMiss";
    });
    for (const item of searchMisses.slice(0, 20)) {
      const query = String(item.query || item.context?.query || "").trim();
      if (!query) {
        continue;
      }
      suggestions.push({
        suggestionId: `suggestion::rankingRule::${hashText([query, item.createdAt || nowIso()].join("\u001f"))}`,
        type: "rankingRule",
        confidence: 0.62,
        proposedPatch: {
          query,
          retrievalProfileId: activeProfile.profileId || DEFAULT_PROFILE.profileId,
          reason: "search_miss",
          rule: "expand_candidates_before_rerank"
        },
        evidenceRefs: asArray(item.context?.evidenceRefs),
        status: "pending"
      });
    }
    const expertGuidance = asArray(feedback).filter((item) => {
      const action = normalizeAction(item.action);
      return item.context?.gold === true ||
        item.context?.humanExpert === true ||
        ["human_expert_clarification", "human_expert_correction", "expert_choice", "expert_feedback"].includes(action);
    });
    for (const item of expertGuidance.slice(0, 20)) {
      const query = String(item.query || item.context?.query || "").trim();
      const selected = item.context?.selectedOption || {};
      suggestions.push({
        suggestionId: `suggestion::expertGuidance::${hashText([item.feedbackId, query, item.createdAt || nowIso()].join("\u001f"))}`,
        type: "retrievalRule",
        confidence: 0.82,
        proposedPatch: {
          query,
          retrievalProfileId: activeProfile.profileId || DEFAULT_PROFILE.profileId,
          reason: "human_expert_guidance",
          rule: "prefer_human_confirmed_direction",
          guidance: {
            label: selected.label || "",
            followUpQuestion: selected.followUpQuestion || "",
            anchor: item.context?.anchor || ""
          }
        },
        evidenceRefs: asArray(item.context?.evidenceRefs),
        status: "pending"
      });
    }
    return suggestions;
  }

  function evaluateCandidateProfile({ baseline = {}, candidate = {} } = {}) {
    const baseMetrics = baseline.metrics || DEFAULT_PROFILE.metrics;
    const candidateMetrics = candidate.metrics || DEFAULT_PROFILE.metrics;
    return {
      ok:
        Number(candidateMetrics.mrrAtK || 0) >= Number(baseMetrics.mrrAtK || 0) &&
        Number(candidateMetrics.ndcgAtK || 0) >= Number(baseMetrics.ndcgAtK || 0) &&
        Number(candidateMetrics.recallAtK || 0) >= Number(baseMetrics.recallAtK || 0),
      metricsBefore: baseMetrics,
      metricsAfter: candidateMetrics
    };
  }

  return {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    defaultProfile: DEFAULT_PROFILE,
    safeAutoApplySuggestionTypes: SAFE_AUTO_APPLY_SUGGESTION_TYPES,
    health,
    capabilities,
    fuseCandidates,
    fuseCandidatesSync,
    proposeProfile,
    generateSuggestions,
    evaluateCandidateProfile,
    reload({ settings: nextSettings = {} } = {}) {
      settings = {
        ...settings,
        ...nextSettings
      };
    },
    async close() {}
  };
}

export default createLearningRuntime;
