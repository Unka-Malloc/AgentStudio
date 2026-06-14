import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

const DEFAULT_GERRIT_BASE_URL = "http://127.0.0.1:18080";
const XSSI_PREFIX = ")]}'";
const MAX_GERRIT_RESPONSE_BYTES = 4 * 1024 * 1024;

const READ_ACTIONS = new Set([
  "server.version",
  "server.info",
  "projects.list",
  "projects.get",
  "branches.list",
  "branches.get",
  "changes.query",
  "changes.get",
  "changes.detail",
  "changes.commit_message.get",
  "changes.topic.get",
  "changes.hashtags.get",
  "changes.custom_keyed_values.get",
  "changes.validation_options.get",
  "changes.messages.list",
  "changes.drafts.list",
  "changes.comments.list",
  "changes.submitted_together",
  "reviewers.list",
  "reviewers.suggest",
  "reviewers.get",
  "reviewers.votes.list",
  "revisions.get",
  "revisions.commit.get",
  "revisions.description.get",
  "revisions.actions.get",
  "revisions.files.list",
  "revisions.file.content",
  "revisions.file.diff",
  "revisions.file.blame",
  "revisions.patch.get",
  "revisions.related",
  "revisions.review.get",
  "revisions.mergeable.get",
  "revisions.submit_type.get",
  "revisions.comments.list",
  "revisions.comment.get",
  "revisions.drafts.list",
  "revisions.draft.get",
  "revisions.reviewers.list",
  "revisions.reviewers.votes.list",
  "changes.included_in",
  "attention_set.get"
]);

async function readResponseTextWithLimit(response, maxBytes = MAX_GERRIT_RESPONSE_BYTES) {
  if (!response?.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`Gerrit response exceeded the ${maxBytes} byte limit.`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Gerrit response exceeded the ${maxBytes} byte limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const WRITE_ACTIONS = new Set([
  "changes.create",
  "changes.commit_message.set",
  "changes.topic.set",
  "changes.topic.delete",
  "changes.wip.set",
  "changes.ready.set",
  "changes.private.set",
  "changes.private.delete",
  "changes.hashtags.set",
  "changes.custom_keyed_values.set",
  "reviewers.add",
  "reviewers.delete",
  "reviewers.vote.delete",
  "revisions.description.set",
  "revisions.review.set",
  "revisions.reviewed.set",
  "revisions.reviewed.delete",
  "drafts.create",
  "drafts.update",
  "drafts.delete",
  "edit.get",
  "edit.file.put",
  "edit.file.delete",
  "edit.publish",
  "edit.rebase",
  "edit.delete",
  "attention_set.add",
  "attention_set.remove"
]);

const MAINTAIN_ACTIONS = new Set([
  "projects.create",
  "branches.create",
  "branches.delete",
  "changes.abandon",
  "changes.restore",
  "changes.rebase",
  "changes.rebase_chain",
  "changes.move",
  "changes.submit",
  "changes.revert",
  "changes.submission.revert",
  "changes.delete",
  "changes.index",
  "changes.check",
  "changes.fix",
  "comments.delete",
  "revisions.rebase",
  "revisions.submit",
  "revisions.cherrypick"
]);

export const GERRIT_ACTIONS = Object.freeze({
  read: [...READ_ACTIONS].sort(),
  write: [...WRITE_ACTIONS].sort(),
  maintain: [...MAINTAIN_ACTIONS].sort()
});

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requireString(input, key) {
  const value = String(input[key] || "").trim();
  if (!value) {
    throw new Error(`Gerrit action requires input.${key}.`);
  }
  return value;
}

function optionalString(input, key) {
  const value = String(input[key] || "").trim();
  return value || "";
}

function enc(value) {
  return encodeURIComponent(String(value || ""));
}

function normalizeBaseUrl(input = {}) {
  const baseUrl = String(
    input.baseUrl ||
      process.env.PACT_GERRIT_BASE_URL ||
      DEFAULT_GERRIT_BASE_URL
  ).trim();
  return baseUrl.replace(/\/+$/, "");
}

function resolveAuth(input = {}) {
  const username = String(input.username || process.env.PACT_GERRIT_USERNAME || "").trim();
  const password = String(process.env.PACT_GERRIT_HTTP_PASSWORD || "").trim();
  const bearerToken = String(process.env.PACT_GERRIT_BEARER_TOKEN || "").trim();
  const authMode = String(input.authMode || process.env.PACT_GERRIT_AUTH_MODE || "").trim();
  const authenticated =
    input.authenticated === true ||
    authMode === "basic" ||
    authMode === "bearer" ||
    Boolean((username && password) || bearerToken);
  return {
    authenticated,
    username,
    password,
    bearerToken,
    authMode: bearerToken ? "bearer" : username && password ? "basic" : authMode
  };
}

function appendQuery(url, query = {}) {
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") {
          url.searchParams.append(key, String(item));
        }
      }
      continue;
    }
    if (value === true) {
      url.searchParams.set(key, "true");
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

function stripXssi(text) {
  const trimmed = String(text || "");
  if (trimmed.startsWith(XSSI_PREFIX)) {
    const newline = trimmed.indexOf("\n");
    return newline >= 0 ? trimmed.slice(newline + 1) : "";
  }
  return trimmed;
}

function parseGerritBody(text, contentType = "") {
  const stripped = stripXssi(text).trim();
  if (!stripped) {
    return null;
  }
  if (/json/i.test(contentType) || /^[{["0-9tfn-]/.test(stripped)) {
    try {
      return JSON.parse(stripped);
    } catch {
      return stripped;
    }
  }
  return stripped;
}

async function gerritRequest({
  input = {},
  method = "GET",
  path: requestPath = "/",
  query = {},
  body = undefined,
  rawBody = undefined,
  contentType = "application/json; charset=UTF-8",
  authenticated = false
}) {
  const baseUrl = normalizeBaseUrl(input);
  const auth = resolveAuth(input);
  const prefix = authenticated || auth.authenticated ? "/a" : "";
  const url = new URL(`${prefix}${requestPath}`, `${baseUrl}/`);
  appendQuery(url, { pp: 0, ...query });

  const headers = {
    Accept: "application/json"
  };
  let requestBody = undefined;
  if (rawBody !== undefined) {
    requestBody = rawBody;
    headers["Content-Type"] = contentType || "text/plain; charset=UTF-8";
  } else if (body !== undefined) {
    requestBody = JSON.stringify(body || {});
    headers["Content-Type"] = contentType;
  }
  if (auth.bearerToken) {
    headers.Authorization = `Bearer ${auth.bearerToken}`;
  } else if (auth.username && auth.password) {
    headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: requestBody
  });
  const text = await readResponseTextWithLimit(response);
  const payload = parseGerritBody(text, response.headers.get("content-type") || "");
  const result = {
    ok: response.ok,
    status: response.status,
    method,
    url: `${baseUrl}${prefix}${requestPath}`,
    authenticated: authenticated || auth.authenticated,
    traceId: response.headers.get("x-gerrit-trace") || "",
    updatedRefs: [],
    payload
  };
  const updatedRefHeader = response.headers.get("x-gerrit-updatedref");
  if (updatedRefHeader) {
    result.updatedRefs = [updatedRefHeader];
  }
  if (!response.ok) {
    return {
      ...result,
      error: typeof payload === "string" ? payload : response.statusText
    };
  }
  return result;
}

function bodyFrom(input, keys = []) {
  if (input.body && typeof input.body === "object" && !Array.isArray(input.body)) {
    return input.body;
  }
  const body = {};
  for (const key of keys) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== "") {
      body[key] = input[key];
    }
  }
  return body;
}

function buildReadRequest(action, input) {
  const revision = optionalString(input, "revision") || "current";
  switch (action) {
    case "server.version":
      return { method: "GET", path: "/config/server/version" };
    case "server.info":
      return { method: "GET", path: "/config/server/info" };
    case "projects.list":
      return {
        method: "GET",
        path: "/projects/",
        query: {
          d: input.description === true ? true : undefined,
          p: input.prefix || undefined,
          m: input.match || undefined,
          state: input.state || undefined,
          type: input.type || undefined,
          limit: input.limit || undefined,
          start: input.start || undefined
        }
      };
    case "projects.get":
      return { method: "GET", path: `/projects/${enc(requireString(input, "project"))}` };
    case "branches.list":
      return {
        method: "GET",
        path: `/projects/${enc(requireString(input, "project"))}/branches/`,
        query: { m: input.match || undefined, s: input.start || undefined, n: input.limit || undefined }
      };
    case "branches.get":
      return {
        method: "GET",
        path: `/projects/${enc(requireString(input, "project"))}/branches/${enc(requireString(input, "branch"))}`
      };
    case "changes.query":
      return {
        method: "GET",
        path: "/changes/",
        query: {
          q: input.query || input.q || "status:open",
          n: input.limit || input.n || undefined,
          S: input.start || input.S || undefined,
          o: input.options || input.o || undefined
        }
      };
    case "changes.get":
      return {
        method: "GET",
        path: `/changes/${enc(requireString(input, "changeId"))}`,
        query: { o: input.options || input.o || undefined }
      };
    case "changes.detail":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/detail` };
    case "changes.commit_message.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/message` };
    case "changes.topic.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/topic` };
    case "changes.hashtags.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/hashtags` };
    case "changes.custom_keyed_values.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/custom_keyed_values` };
    case "changes.validation_options.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/validation-options` };
    case "changes.messages.list":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/messages` };
    case "changes.drafts.list":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/drafts`, authenticated: true };
    case "changes.comments.list":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/comments` };
    case "changes.submitted_together":
      return {
        method: "GET",
        path: `/changes/${enc(requireString(input, "changeId"))}/submitted_together`,
        query: { o: input.options || input.o || undefined }
      };
    case "reviewers.list":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/reviewers/` };
    case "reviewers.suggest":
      return {
        method: "GET",
        path: `/changes/${enc(requireString(input, "changeId"))}/suggest_reviewers`,
        query: {
          q: input.query || input.q || undefined,
          n: input.limit || input.n || undefined,
          "reviewer-state": input.reviewerState || input.reviewer_state || undefined,
          "exclude-groups": input.excludeGroups === true ? true : undefined
        }
      };
    case "reviewers.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/reviewers/${enc(requireString(input, "accountId"))}` };
    case "reviewers.votes.list":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/reviewers/${enc(requireString(input, "accountId"))}/votes/` };
    case "changes.included_in":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/in` };
    case "revisions.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}` };
    case "revisions.commit.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/commit` };
    case "revisions.description.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/description` };
    case "revisions.actions.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/actions` };
    case "revisions.files.list":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/files/` };
    case "revisions.file.content":
      return {
        method: "GET",
        path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/files/${enc(requireString(input, "fileId"))}/content`
      };
    case "revisions.file.diff":
      return {
        method: "GET",
        path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/files/${enc(requireString(input, "fileId"))}/diff`,
        query: { base: input.base || undefined, context: input.context || undefined, intraline: input.intraline === true ? true : undefined }
      };
    case "revisions.file.blame":
      return {
        method: "GET",
        path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/files/${enc(requireString(input, "fileId"))}/blame`,
        query: { base: input.base === true ? true : undefined }
      };
    case "revisions.patch.get":
      return {
        method: "GET",
        path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/patch`,
        query: { zip: input.zip === true ? true : undefined, download: input.download === true ? true : undefined }
      };
    case "revisions.related":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/related` };
    case "revisions.review.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/review` };
    case "revisions.mergeable.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/mergeable` };
    case "revisions.submit_type.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/submit_type` };
    case "revisions.comments.list":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/comments/` };
    case "revisions.comment.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/comments/${enc(requireString(input, "commentId"))}` };
    case "revisions.drafts.list":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/drafts/`, authenticated: true };
    case "revisions.draft.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/drafts/${enc(requireString(input, "draftId"))}`, authenticated: true };
    case "revisions.reviewers.list":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/reviewers/` };
    case "revisions.reviewers.votes.list":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/reviewers/${enc(requireString(input, "accountId"))}/votes/` };
    case "attention_set.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/attention` };
    default:
      throw new Error(`Unsupported Gerrit read action: ${action}`);
  }
}

function buildWriteRequest(action, input) {
  const changeId = optionalString(input, "changeId");
  const revision = optionalString(input, "revision") || "current";
  switch (action) {
    case "changes.create":
      return {
        method: "POST",
        path: "/changes/",
        authenticated: true,
        body: bodyFrom(input, ["project", "branch", "subject", "topic", "status", "work_in_progress", "is_private"])
      };
    case "changes.commit_message.set":
      return { method: "PUT", path: `/changes/${enc(requireString(input, "changeId"))}/message`, authenticated: true, body: bodyFrom(input, ["message", "notify"]) };
    case "changes.topic.set":
      return { method: "PUT", path: `/changes/${enc(requireString(input, "changeId"))}/topic`, authenticated: true, body: bodyFrom(input, ["topic"]) };
    case "changes.topic.delete":
      return { method: "DELETE", path: `/changes/${enc(requireString(input, "changeId"))}/topic`, authenticated: true };
    case "changes.wip.set":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/wip`, authenticated: true, body: bodyFrom(input, ["message"]) };
    case "changes.ready.set":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/ready`, authenticated: true, body: bodyFrom(input, ["message"]) };
    case "changes.private.set":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/private`, authenticated: true, body: bodyFrom(input, ["message"]) };
    case "changes.private.delete":
      return { method: "DELETE", path: `/changes/${enc(requireString(input, "changeId"))}/private`, authenticated: true };
    case "changes.hashtags.set":
      return {
        method: "POST",
        path: `/changes/${enc(requireString(input, "changeId"))}/hashtags`,
        authenticated: true,
        body: Array.isArray(input.hashtags)
          ? { add: input.hashtags }
          : input.hashtags && typeof input.hashtags === "object"
            ? input.hashtags
            : bodyFrom(input, ["add", "remove"])
      };
    case "changes.custom_keyed_values.set":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/custom_keyed_values`, authenticated: true, body: input.values || bodyFrom(input, ["add", "remove"]) };
    case "reviewers.add":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/reviewers`, authenticated: true, body: bodyFrom(input, ["reviewer", "state", "confirmed"]) };
    case "reviewers.delete":
      return { method: "DELETE", path: `/changes/${enc(requireString(input, "changeId"))}/reviewers/${enc(requireString(input, "accountId"))}`, authenticated: true, body: bodyFrom(input, ["notify", "reason"]) };
    case "reviewers.vote.delete":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/reviewers/${enc(requireString(input, "accountId"))}/votes/${enc(requireString(input, "labelId"))}/delete`, authenticated: true, body: bodyFrom(input, ["notify", "reason"]) };
    case "revisions.description.set":
      return { method: "PUT", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/description`, authenticated: true, body: bodyFrom(input, ["description"]) };
    case "revisions.review.set":
      return { method: "POST", path: `/changes/${enc(changeId || requireString(input, "changeId"))}/revisions/${enc(revision)}/review`, authenticated: true, body: input.review || bodyFrom(input, ["message", "labels", "comments", "drafts", "notify", "tag"]) };
    case "revisions.reviewed.set":
      return { method: "PUT", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/files/${enc(requireString(input, "fileId"))}/reviewed`, authenticated: true };
    case "revisions.reviewed.delete":
      return { method: "DELETE", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/files/${enc(requireString(input, "fileId"))}/reviewed`, authenticated: true };
    case "drafts.create":
      return { method: "PUT", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/drafts/${enc(requireString(input, "fileId"))}`, authenticated: true, body: input.comment || bodyFrom(input, ["line", "message", "range", "side", "unresolved"]) };
    case "drafts.update":
      return { method: "PUT", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/drafts/${enc(requireString(input, "draftId"))}`, authenticated: true, body: input.comment || bodyFrom(input, ["line", "message", "range", "side", "unresolved"]) };
    case "drafts.delete":
      return { method: "DELETE", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/drafts/${enc(requireString(input, "draftId"))}`, authenticated: true };
    case "edit.get":
      return { method: "GET", path: `/changes/${enc(requireString(input, "changeId"))}/edit`, authenticated: true };
    case "edit.file.put":
      return {
        method: "PUT",
        path: `/changes/${enc(requireString(input, "changeId"))}/edit/${enc(requireString(input, "fileId"))}`,
        authenticated: true,
        rawBody: input.contentBase64 ? Buffer.from(String(input.contentBase64), "base64") : String(input.content || ""),
        contentType: input.contentType || "text/plain; charset=UTF-8"
      };
    case "edit.file.delete":
      return { method: "DELETE", path: `/changes/${enc(requireString(input, "changeId"))}/edit/${enc(requireString(input, "fileId"))}`, authenticated: true };
    case "edit.publish":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/edit:publish`, authenticated: true, body: bodyFrom(input, ["notify"]) };
    case "edit.rebase":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/edit:rebase`, authenticated: true };
    case "edit.delete":
      return { method: "DELETE", path: `/changes/${enc(requireString(input, "changeId"))}/edit`, authenticated: true };
    case "attention_set.add":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/attention`, authenticated: true, body: bodyFrom(input, ["user", "reason", "notify"]) };
    case "attention_set.remove":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/attention/${enc(requireString(input, "accountId"))}/delete`, authenticated: true, body: bodyFrom(input, ["reason", "notify"]) };
    default:
      throw new Error(`Unsupported Gerrit write action: ${action}`);
  }
}

function buildMaintainRequest(action, input) {
  const revision = optionalString(input, "revision") || "current";
  switch (action) {
    case "projects.create":
      return {
        method: "PUT",
        path: `/projects/${enc(requireString(input, "project"))}`,
        authenticated: true,
        body: input.projectConfig || input.config || input.body || bodyFrom(input, ["description", "parent", "owners", "branches", "create_empty_commit", "permissions_only"])
      };
    case "branches.create":
      return { method: "PUT", path: `/projects/${enc(requireString(input, "project"))}/branches/${enc(requireString(input, "branch"))}`, authenticated: true, body: bodyFrom(input, ["revision"]) };
    case "branches.delete":
      return { method: "DELETE", path: `/projects/${enc(requireString(input, "project"))}/branches/${enc(requireString(input, "branch"))}`, authenticated: true };
    case "changes.abandon":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/abandon`, authenticated: true, body: bodyFrom(input, ["message", "notify"]) };
    case "changes.restore":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/restore`, authenticated: true, body: bodyFrom(input, ["message", "notify"]) };
    case "changes.rebase":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/rebase`, authenticated: true, body: bodyFrom(input, ["base", "allow_conflicts", "validation_options"]) };
    case "changes.rebase_chain":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/rebase:chain`, authenticated: true, body: bodyFrom(input, ["base", "allow_conflicts", "validation_options"]) };
    case "changes.move":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/move`, authenticated: true, body: bodyFrom(input, ["destination_branch", "message", "keep_all_votes"]) };
    case "changes.submit":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/submit`, authenticated: true, body: bodyFrom(input, ["wait_for_merge", "on_behalf_of"]) };
    case "changes.revert":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/revert`, authenticated: true, body: bodyFrom(input, ["message", "topic", "work_in_progress", "validation_options"]) };
    case "changes.submission.revert":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/revert_submission`, authenticated: true, body: bodyFrom(input, ["message", "topic", "work_in_progress", "validation_options"]) };
    case "changes.delete":
      return { method: "DELETE", path: `/changes/${enc(requireString(input, "changeId"))}`, authenticated: true };
    case "changes.index":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/index`, authenticated: true };
    case "changes.check":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/check`, authenticated: true, body: bodyFrom(input, ["fix"]) };
    case "changes.fix":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/fix`, authenticated: true, body: bodyFrom(input, ["delete_patch_set_if_commit_missing", "expect_merged_as"]) };
    case "comments.delete":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/comments/${enc(requireString(input, "commentId"))}/delete`, authenticated: true, body: bodyFrom(input, ["reason"]) };
    case "revisions.rebase":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/rebase`, authenticated: true, body: bodyFrom(input, ["base", "allow_conflicts", "validation_options"]) };
    case "revisions.submit":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/submit`, authenticated: true, body: bodyFrom(input, ["wait_for_merge", "on_behalf_of"]) };
    case "revisions.cherrypick":
      return { method: "POST", path: `/changes/${enc(requireString(input, "changeId"))}/revisions/${enc(revision)}/cherrypick`, authenticated: true, body: bodyFrom(input, ["destination", "base", "message", "topic", "allow_conflicts", "notify"]) };
    default:
      throw new Error(`Unsupported Gerrit maintain action: ${action}`);
  }
}

function actionsForMode(mode) {
  if (mode === "read") return READ_ACTIONS;
  if (mode === "write") return WRITE_ACTIONS;
  if (mode === "maintain") return MAINTAIN_ACTIONS;
  return new Set();
}

function buildRequestForMode(mode, action, input) {
  if (mode === "read") return buildReadRequest(action, input);
  if (mode === "write") return buildWriteRequest(action, input);
  if (mode === "maintain") return buildMaintainRequest(action, input);
  throw new Error(`Unsupported Gerrit operation mode: ${mode}`);
}

function publicRequestPlan(request = {}) {
  const plan = {
    method: request.method || "GET",
    path: request.path || "/",
    authenticated: request.authenticated === true,
    query: request.query || {}
  };
  if (request.rawBody !== undefined) {
    const body = Buffer.isBuffer(request.rawBody)
      ? request.rawBody
      : Buffer.from(String(request.rawBody || ""), "utf8");
    plan.rawBody = {
      byteLength: body.length,
      contentType: request.contentType || "text/plain; charset=UTF-8"
    };
  } else if (request.body !== undefined) {
    plan.bodyKeys = Object.keys(asObject(request.body)).sort();
  }
  return plan;
}

export async function executeGerritCommonOperation({ mode, input = {} }) {
  const payload = asObject(input);
  const action = String(payload.action || "").trim();
  const allowed = actionsForMode(mode);
  if (!allowed.has(action)) {
    return {
      ok: false,
      status: 400,
      error: `Unsupported Gerrit ${mode} action: ${action || "(empty)"}`,
      allowedActions: [...allowed].sort()
    };
  }
  const request = buildRequestForMode(mode, action, payload);
  if (payload.dryRun === true) {
    return {
      ok: true,
      action,
      mode,
      dryRun: true,
      gerrit: {
        authenticated: request.authenticated === true,
        baseUrl: normalizeBaseUrl(payload)
      },
      result: publicRequestPlan(request)
    };
  }
  const result = await gerritRequest({
    input: payload,
    ...request
  });
  return {
    ok: result.ok,
    action,
    mode,
    gerrit: {
      status: result.status,
      traceId: result.traceId,
      authenticated: result.authenticated,
      url: result.url
    },
    result: result.payload,
    error: result.error || undefined
  };
}

function pushOption(name, value) {
  const normalized = String(value || "").trim();
  return normalized ? `${name}=${encodeURIComponent(normalized)}` : "";
}

function appendRepeatedPushOptions(params, name, value) {
  if (!value) {
    return;
  }
  const values = Array.isArray(value) ? value : String(value).split(",");
  for (const item of values.map((entry) => String(entry || "").trim()).filter(Boolean)) {
    const option = pushOption(name, item);
    if (option) {
      params.push(option);
    }
  }
}

function gitRefForReview(input = {}) {
  const branch = String(input.branch || "main").trim();
  const params = [];
  const topic = pushOption("topic", input.topic);
  if (topic) params.push(topic);
  appendRepeatedPushOptions(params, "hashtag", input.hashtags || input.hashtag);
  appendRepeatedPushOptions(params, "r", input.reviewers || input.reviewer);
  appendRepeatedPushOptions(params, "cc", input.cc);
  appendRepeatedPushOptions(params, "notify-to", input.notifyTo || input.notify_to);
  appendRepeatedPushOptions(params, "notify-cc", input.notifyCc || input.notify_cc);
  appendRepeatedPushOptions(params, "notify-bcc", input.notifyBcc || input.notify_bcc);
  const notify = pushOption("notify", input.notify);
  if (notify) params.push(notify);
  const trace = pushOption("trace", input.traceId || input.trace);
  if (trace) params.push(trace);
  if (input.workInProgress || input.wip) params.push("wip");
  if (input.ready) params.push("ready");
  if (input.isPrivate || input.private) params.push("private");
  return `HEAD:refs/for/${branch}${params.length ? `%${params.join(",")}` : ""}`;
}

function stripReviewOptions(ref = "") {
  return String(ref || "").split("%")[0];
}

function branchFromReviewRef(input = {}, targetRef = "") {
  const explicit = String(input.branch || "").trim();
  if (explicit) {
    return explicit.replace(/^refs\/heads\//, "").replace(/^refs\/for\//, "");
  }
  const normalized = stripReviewOptions(targetRef)
    .replace(/^HEAD:/, "")
    .replace(/^refs\/for\//, "")
    .replace(/^refs\/heads\//, "");
  return normalized || "main";
}

function redactUrlCredentials(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    parsed.username = parsed.username ? "<redacted>" : "";
    parsed.password = parsed.password ? "<redacted>" : "";
    return parsed.toString().replace(/\/$/, raw.endsWith("/") ? "/" : "");
  } catch {
    return raw.replace(/\/\/([^/@\s]+):([^/@\s]+)@/, "//<redacted>:<redacted>@");
  }
}

function baseUrlFromRemoteUrl(remoteUrl = "") {
  try {
    const parsed = new URL(String(remoteUrl || "").trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      parsed.username = "";
      parsed.password = "";
      parsed.pathname = "/";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    // Non-URL remotes such as ssh/scp style cannot provide an HTTP base URL.
  }
  return "";
}

function projectFromRemoteUrl(remoteUrl = "") {
  const raw = String(remoteUrl || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    let project = decodeURIComponent(parsed.pathname || "")
      .replace(/^\/+/, "")
      .replace(/^a\//, "")
      .replace(/\.git$/, "");
    return project;
  } catch {
    const scp = raw.match(/^[^@:\s]+@[^:\s]+:(.+)$/);
    if (scp) {
      return scp[1].replace(/\.git$/, "");
    }
  }
  return "";
}

function encodeGerritProjectPath(project = "") {
  return String(project || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function reviewUrlForChange({ baseUrl = "", project = "", number = "" } = {}) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  const changeNumber = String(number || "").trim();
  if (!root || !changeNumber) {
    return "";
  }
  const projectPath = encodeGerritProjectPath(project);
  return projectPath
    ? `${root}/c/${projectPath}/+/${changeNumber}`
    : `${root}/q/${encodeURIComponent(changeNumber)}`;
}

function changeConfirmsHead(change = {}, head = "") {
  const commit = String(head || "").trim();
  if (!commit || !change || typeof change !== "object") {
    return false;
  }
  if (String(change.current_revision || "") === commit) {
    return true;
  }
  if (change.revisions && typeof change.revisions === "object" && change.revisions[commit]) {
    return true;
  }
  for (const revision of Object.values(change.revisions || {})) {
    if (String(revision?.commit?.commit || "") === commit) {
      return true;
    }
  }
  return false;
}

function publicChangeReceipt(change = {}, { baseUrl = "", head = "", query = "", attempts = 0 } = {}) {
  const project = String(change.project || "");
  const number = String(change._number || change.number || "");
  return {
    confirmed: true,
    confirmationMethod: "gerrit_rest_change_query",
    query,
    attempts,
    changeId: String(change.id || ""),
    changeNumber: number,
    project,
    branch: String(change.branch || ""),
    status: String(change.status || ""),
    currentRevision: String(change.current_revision || head || ""),
    revisionNumber: change.revisions?.[change.current_revision]?._number || "",
    reviewUrl: reviewUrlForChange({ baseUrl, project, number })
  };
}

function extractChangeNumbersFromPushOutput(output = "") {
  const numbers = new Set();
  const text = String(output || "");
  for (const match of text.matchAll(/\/\+\/(\d+)(?:[\s/]|$)/g)) {
    numbers.add(match[1]);
  }
  return [...numbers];
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runGit(args, { cwd }) {
  return await new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
    child.on("error", (error) => {
      resolve({ code: 1, stdout: "", stderr: error.message });
    });
  });
}

async function resolveRemoteUrl({ worktreePath, remote }) {
  const result = await runGit(["remote", "get-url", remote], { cwd: worktreePath });
  return result.code === 0 ? result.stdout.trim() : "";
}

async function queryConfirmedChange({ input, head, baseUrl, project, branch, pushOutput, attempts }) {
  const baseInput = { ...input, baseUrl: input.baseUrl || baseUrl };
  const queries = [
    `commit:${head}`,
    project && branch ? `project:${project} branch:${branch} commit:${head}` : "",
    project && branch && input.topic ? `project:${project} branch:${branch} topic:${input.topic} status:open` : ""
  ].filter(Boolean);
  for (const query of queries) {
    const result = await gerritRequest({
      input: baseInput,
      method: "GET",
      path: "/changes/",
      query: { q: query, n: 10, o: ["CURRENT_REVISION", "CURRENT_COMMIT"] }
    });
    if (!result.ok) {
      continue;
    }
    const changes = Array.isArray(result.payload) ? result.payload : [];
    const exact = changes.find((change) => changeConfirmsHead(change, head));
    if (exact) {
      return publicChangeReceipt(exact, { baseUrl, head, query, attempts });
    }
  }
  for (const number of extractChangeNumbersFromPushOutput(pushOutput)) {
    const result = await gerritRequest({
      input: baseInput,
      method: "GET",
      path: `/changes/${enc(number)}/detail`,
      query: { o: ["CURRENT_REVISION", "CURRENT_COMMIT"] }
    });
    if (result.ok && changeConfirmsHead(result.payload, head)) {
      return publicChangeReceipt(result.payload, {
        baseUrl,
        head,
        query: `change:${number}`,
        attempts
      });
    }
  }
  return null;
}

async function confirmGerritUploadCompletion({ input, head, targetRef, remoteUrl, push }) {
  const baseUrl = String(input.baseUrl || baseUrlFromRemoteUrl(remoteUrl) || normalizeBaseUrl(input)).replace(/\/+$/, "");
  const project = String(input.project || projectFromRemoteUrl(remoteUrl) || "").trim();
  const branch = branchFromReviewRef(input, targetRef);
  const pushOutput = `${push.stdout || ""}\n${push.stderr || ""}`;
  const timeoutMs = Math.max(0, Number(input.confirmationTimeoutMs || input.confirmTimeoutMs || 30_000) || 30_000);
  const intervalMs = Math.max(100, Number(input.confirmationIntervalMs || 1000) || 1000);
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (true) {
    attempts += 1;
    const receipt = await queryConfirmedChange({
      input,
      head,
      baseUrl,
      project,
      branch,
      pushOutput,
      attempts
    });
    if (receipt) {
      return {
        ...receipt,
        targetProvider: "gerrit",
        targetKind: "codespace",
        targetRef: receipt.changeId || receipt.changeNumber,
        repositoryRef: receipt.project || project,
        branch: receipt.branch || branch
      };
    }
    if (Date.now() >= deadline) {
      return {
        confirmed: false,
        confirmationMethod: "gerrit_rest_change_query",
        attempts,
        project,
        branch,
        head,
        baseUrl,
        error: "Gerrit accepted git push, but the uploaded commit was not visible through Gerrit REST before the confirmation timeout."
      };
    }
    await sleep(intervalMs);
  }
}

export async function uploadGerritGitChange(input = {}) {
  const worktreePath = path.resolve(requireString(input, "worktreePath"));
  const remote = String(input.remote || "origin").trim();
  const targetRef = input.targetRef ? String(input.targetRef) : gitRefForReview(input);
  const remoteUrl = await resolveRemoteUrl({ worktreePath, remote });
  const status = await runGit(["status", "--short"], { cwd: worktreePath });
  if (status.code !== 0) {
    return {
      ok: false,
      status: 400,
      error: status.stderr || "Unable to read git status.",
      worktreePath
    };
  }
  if (status.stdout.trim() && input.allowDirty !== true) {
    return {
      ok: false,
      status: 409,
      error: "Worktree has uncommitted changes. Commit first or pass allowDirty=true.",
      worktreePath,
      gitStatus: status.stdout
    };
  }
  const head = await runGit(["rev-parse", "HEAD"], { cwd: worktreePath });
  if (head.code !== 0) {
    return {
      ok: false,
      status: 400,
      error: head.stderr || "Unable to resolve HEAD.",
      worktreePath
    };
  }
  if (input.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      worktreePath,
      remote,
      remoteUrl: redactUrlCredentials(remoteUrl),
      targetRef,
      head: head.stdout.trim(),
      gitStatus: status.stdout
    };
  }
  const push = await runGit(["push", remote, targetRef], { cwd: worktreePath });
  const pushOk = push.code === 0;
  if (!pushOk) {
    return {
      ok: false,
      status: 502,
      uploadId: randomId("gerrit_git_upload"),
      worktreePath,
      remote,
      remoteUrl: redactUrlCredentials(remoteUrl),
      targetRef,
      head: head.stdout.trim(),
      stdout: push.stdout,
      stderr: push.stderr,
      completion: { confirmed: false, error: push.stderr || "git push failed" },
      error: push.stderr || "git push failed"
    };
  }
  const completion = await confirmGerritUploadCompletion({
    input,
    head: head.stdout.trim(),
    targetRef,
    remoteUrl,
    push
  });
  if (!completion.confirmed) {
    return {
      ok: false,
      status: 502,
      uploadId: randomId("gerrit_git_upload"),
      worktreePath,
      remote,
      remoteUrl: redactUrlCredentials(remoteUrl),
      targetRef,
      head: head.stdout.trim(),
      stdout: push.stdout,
      stderr: push.stderr,
      completion,
      error: completion.error
    };
  }
  return {
    ok: true,
    status: 200,
    uploadId: randomId("gerrit_git_upload"),
    worktreePath,
    remote,
    remoteUrl: redactUrlCredentials(remoteUrl),
    targetRef,
    head: head.stdout.trim(),
    stdout: push.stdout,
    stderr: push.stderr,
    completion,
    provider: "gerrit",
    targetProvider: "gerrit",
    targetKind: "codespace",
    targetRef: completion.changeId || completion.changeNumber,
    repositoryRef: completion.project,
    changeRef: completion.changeId || completion.changeNumber,
    status: "completed",
    changeId: completion.changeId,
    changeNumber: completion.changeNumber,
    reviewUrl: completion.reviewUrl,
    project: completion.project,
    branch: completion.branch
  };
}
