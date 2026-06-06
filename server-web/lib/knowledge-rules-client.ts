import { getJson, postJson } from "./bridge-http";
import type {
  EmailRuleSet,
  EmailRuleSetResponse,
  ExpertVocabulary,
  ExpertVocabularyHistoryResponse,
  ExpertVocabularyResponse,
  KnowledgeRuleAuthoringResponse,
} from "./types";

export function getEmailRules() {
  return getJson<EmailRuleSetResponse>("/api/email-rules");
}

export function saveEmailRules(rules: EmailRuleSet) {
  return postJson<EmailRuleSetResponse>(
    "/api/email-rules",
    { rules },
    { safetyConfirm: true },
  );
}

export function getGoldenRules() {
  return getJson<Record<string, unknown>>("/api/knowledge/golden-rules?includeRules=true");
}

export function saveGoldenRules(payload: Record<string, unknown>) {
  return postJson<Record<string, unknown>>(
    "/api/knowledge/golden-rules",
    payload,
    { safetyConfirm: true },
  );
}

export function publishGoldenRules(packageId: string, payload: Record<string, unknown>) {
  return postJson<Record<string, unknown>>(
    `/api/knowledge/golden-rules/${encodeURIComponent(packageId)}/publish`,
    payload,
    { safetyConfirm: true },
  );
}

export function getExpertVocabulary() {
  return getJson<ExpertVocabularyResponse>("/api/expert-vocabulary");
}

export function saveExpertVocabulary(vocabulary: ExpertVocabulary) {
  return postJson<ExpertVocabularyResponse>(
    "/api/expert-vocabulary",
    { vocabulary },
    { safetyConfirm: true },
  );
}

export function getExpertVocabularyVersions() {
  return getJson<ExpertVocabularyHistoryResponse>("/api/expert-vocabulary/versions");
}

export function chatKnowledgeRuleAuthoring(payload: Record<string, unknown>) {
  return postJson<KnowledgeRuleAuthoringResponse>(
    "/api/knowledge/rule-authoring/chat",
    payload,
    { safetyConfirm: true },
  );
}
