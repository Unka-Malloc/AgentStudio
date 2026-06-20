import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import { createId } from "../protocol/hashing.js";
import { asArray, safeText } from "../shared/records.js";

const CURSOR_SCOPES = new Set(["ledger", "workspace"]);

function normalizedScope(scope) {
  return CURSOR_SCOPES.has(scope) ? scope : "ledger";
}

function normalizedPosition(position) {
  const value = Number(position || 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function createTrackingCursor({
  scope = "ledger",
  workspaceId = "",
  position = 0,
  gaps = [],
  headRef = "",
  orderRoot = ""
} = {}) {
  const cursorScope = normalizedScope(scope);
  const cursorPosition = normalizedPosition(position);
  const payload = {
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    cursorType: "pactium.tracking-cursor",
    scope: cursorScope,
    workspaceId: cursorScope === "workspace" ? safeText(workspaceId, "default") : "",
    position: cursorPosition,
    gaps: [...new Set(asArray(gaps)
      .map(Number)
      .filter((gap) => Number.isInteger(gap) && gap >= 0 && gap < cursorPosition))]
      .sort((left, right) => left - right),
    headRef: safeText(headRef),
    orderRoot: safeText(orderRoot)
  };
  return {
    ...payload,
    cursorId: createId("tracking_cursor", payload)
  };
}

export function samePositionAs(left, right) {
  return left?.scope === right?.scope &&
    safeText(left?.workspaceId) === safeText(right?.workspaceId) &&
    Number(left?.position || 0) === Number(right?.position || 0);
}

export function covers(cursor, position) {
  const target = Number(position || 0);
  return Number.isInteger(target) &&
    target >= 0 &&
    Number(cursor?.position || 0) > target &&
    !asArray(cursor?.gaps).includes(target);
}

export function advanceTo(cursor, position, options = {}) {
  const target = Number(position || 0);
  const current = Number(cursor?.position || 0);
  const gaps = new Set(asArray(cursor?.gaps).map(Number));
  for (let index = current; index < target; index += 1) {
    if (options.gaps?.includes(index)) gaps.add(index);
  }
  gaps.delete(target);
  return createTrackingCursor({
    scope: cursor?.scope || "ledger",
    workspaceId: cursor?.workspaceId || "",
    position: Math.max(current, target),
    gaps: [...gaps],
    headRef: options.headRef || cursor?.headRef || "",
    orderRoot: options.orderRoot || cursor?.orderRoot || ""
  });
}

export function verifyTrackingCursor(cursor, { head = {}, orderRoot = "" } = {}) {
  if (!cursor || cursor.protocol !== PACTIUM_PROTOCOL || cursor.cursorType !== "pactium.tracking-cursor") return false;
  if (!CURSOR_SCOPES.has(cursor.scope)) return false;
  if (!Number.isInteger(Number(cursor.position)) || Number(cursor.position) < 0) return false;
  if (cursor.headRef && cursor.headRef !== head.headId && cursor.headRef !== head.root && cursor.headRef !== head.rootHash) return false;
  if (cursor.scope === "workspace" && cursor.orderRoot && orderRoot && cursor.orderRoot !== orderRoot) return false;
  const normalized = createTrackingCursor(cursor);
  return normalized.cursorId === cursor.cursorId &&
    normalized.scope === cursor.scope &&
    normalized.workspaceId === (cursor.workspaceId || "") &&
    normalized.position === Number(cursor.position) &&
    JSON.stringify(normalized.gaps) === JSON.stringify(asArray(cursor.gaps));
}
