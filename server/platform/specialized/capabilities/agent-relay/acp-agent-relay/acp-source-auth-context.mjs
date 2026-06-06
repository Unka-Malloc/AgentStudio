function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function firstObject(...values) {
  for (const value of values) {
    const object = asObject(value, null);
    if (object && Object.keys(object).length > 0) {
      return object;
    }
  }
  return {};
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function uniqueStrings(...values) {
  const output = [];
  for (const value of values) {
    const items = Array.isArray(value) ? value : asText(value).split(/[,\s]+/);
    for (const item of items) {
      const text = asText(item);
      if (text && !output.includes(text)) {
        output.push(text);
      }
    }
  }
  return output;
}

function compactRecord(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => {
    if (value === undefined || value === null || value === "") {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === "object") {
      return Object.keys(value).length > 0;
    }
    return true;
  }));
}

function hasAnyValue(...values) {
  return values.some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (value && typeof value === "object") {
      return Object.keys(value).length > 0;
    }
    return Boolean(asText(value));
  });
}

function metadataOf(...objects) {
  return Object.assign({}, ...objects.map((object) => asObject(object?.metadata)));
}

export function sourcePublicIdentity(input = {}) {
  const raw = asObject(input);
  return compactRecord({
    sourceId: asText(raw.sourceId || raw.source_id),
    workspaceId: asText(raw.workspaceId || raw.workspace_id),
    sourceSessionId: asText(raw.sourceSessionId || raw.source_session_id),
    virtualAgentId: asText(raw.virtualAgentId || raw.virtual_agent_id || raw.agentId || raw.agent_id),
    sourceSubjectId: asText(raw.sourceSubjectId || raw.source_subject_id || raw.subjectId || raw.subject_id),
    agentProfileId: asText(raw.agentProfileId || raw.agent_profile_id || raw.profileId || raw.profile_id),
    sourceIdentityTrusted: raw.sourceIdentityTrusted === true || raw.authContextTrusted === true ? true : undefined
  });
}

export function normalizeAcpSourceAuthenticationContext(context = {}) {
  const input = asObject(context);
  const sourceAuthContext = firstObject(input.sourceAuthContext, input.sourceAuthenticationContext);
  const authenticationContext = firstObject(input.authenticationContext, input.authContext, input.authentication, input.auth);
  const authenticatedSourceIdentity = firstObject(
    sourceAuthContext.sourceIdentity,
    sourceAuthContext,
    input.authenticatedSourceIdentity,
    authenticationContext.authenticatedSourceIdentity,
    authenticationContext.sourceIdentity
  );
  const sourceIdentity = firstObject(input.sourceIdentity);
  const authSession = firstObject(
    sourceAuthContext.authSession,
    input.authSession,
    authenticationContext.authSession,
    authenticationContext.session
  );
  const user = firstObject(
    sourceAuthContext.user,
    authSession.user,
    authenticationContext.user,
    input.user
  );
  const actor = firstObject(input.actor, authenticationContext.actor);
  const grant = firstObject(
    sourceAuthContext.grant,
    input.grant,
    input.authorizationGrant,
    authenticationContext.grant,
    authenticationContext.authorizationGrant
  );
  const profile = firstObject(
    sourceAuthContext.profile,
    input.profile,
    input.authorizationProfile,
    input.agentProfile,
    authenticationContext.profile,
    authenticationContext.authorizationProfile,
    authenticationContext.agentProfile
  );
  const subject = firstObject(
    sourceAuthContext.subject,
    input.authorizationSubject,
    input.sourceSubject,
    authenticationContext.authorizationSubject,
    authenticationContext.sourceSubject,
    authenticationContext.subject
  );
  const metadata = metadataOf(sourceAuthContext, authenticatedSourceIdentity, authenticationContext, authSession, grant, profile, subject);
  const authContextTrusted = sourceAuthContext.authContextTrusted === true ||
    hasAnyValue(
      authenticationContext,
      authSession,
      grant,
      profile,
      subject,
      sourceAuthContext.authSessionId,
      sourceAuthContext.grantId,
      sourceAuthContext.credentialRef,
      sourceAuthContext.sourceScopes,
      sourceAuthContext.scopes,
      sourceAuthContext.sourceCapabilities,
      sourceAuthContext.capabilities
    );
  const identityTrusted = authContextTrusted ||
    sourceAuthContext.sourceIdentityTrusted === true ||
    authenticatedSourceIdentity.sourceIdentityTrusted === true ||
    sourceIdentity.sourceIdentityTrusted === true ||
    sourceIdentity.authContextTrusted === true;
  const trustedObjects = [
    authenticationContext,
    authSession,
    grant,
    profile,
    subject
  ];
  const hasTrustedSource = identityTrusted || trustedObjects.some((object) => Object.keys(asObject(object)).length > 0);
  const sourceScopes = uniqueStrings(
    sourceAuthContext.sourceScopes,
    sourceAuthContext.scopes,
    authenticatedSourceIdentity.sourceScopes,
    authenticatedSourceIdentity.scopes,
    subject.scopes,
    user.scopes,
    authSession.scopes,
    grant.scopes,
    actor.scopes
  );
  const sourceCapabilities = uniqueStrings(
    sourceAuthContext.sourceCapabilities,
    sourceAuthContext.capabilities,
    authenticatedSourceIdentity.sourceCapabilities,
    authenticatedSourceIdentity.capabilities,
    subject.capabilities,
    user.capabilities,
    authSession.capabilities,
    grant.capabilities,
    actor.capabilities
  );

  return compactRecord({
    sourceId: firstText(
      sourceAuthContext.sourceId,
      sourceAuthContext.source_id,
      authenticatedSourceIdentity.sourceId,
      authenticatedSourceIdentity.source_id,
      authenticationContext.sourceId,
      authenticationContext.source_id,
      subject.sourceId,
      metadata.sourceId,
      grant.sourceId,
      grant.agentId,
      profile.sourceId,
      profile.agentId,
      sourceIdentity.sourceId,
      input.sourceId,
      input.source_id
    ),
    workspaceId: firstText(
      sourceAuthContext.workspaceId,
      sourceAuthContext.workspace_id,
      authenticatedSourceIdentity.workspaceId,
      authenticatedSourceIdentity.workspace_id,
      authenticationContext.workspaceId,
      authenticationContext.workspace_id,
      subject.workspaceId,
      metadata.workspaceId,
      grant.workspaceId,
      profile.workspaceId,
      sourceIdentity.workspaceId,
      input.workspaceId,
      input.workspace_id
    ),
    sourceSessionId: firstText(
      sourceAuthContext.sourceSessionId,
      sourceAuthContext.source_session_id,
      authenticatedSourceIdentity.sourceSessionId,
      authenticatedSourceIdentity.source_session_id,
      authenticationContext.sourceSessionId,
      authenticationContext.source_session_id,
      subject.sourceSessionId,
      subject.source_session_id,
      metadata.sourceSessionId,
      metadata.source_session_id,
      grant.sourceSessionId,
      grant.source_session_id,
      profile.sourceSessionId,
      profile.source_session_id,
      sourceIdentity.sourceSessionId,
      input.sourceSessionId,
      input.source_session_id
    ),
    virtualAgentId: firstText(
      sourceAuthContext.virtualAgentId,
      sourceAuthContext.virtual_agent_id,
      authenticatedSourceIdentity.virtualAgentId,
      authenticatedSourceIdentity.virtual_agent_id,
      authenticatedSourceIdentity.agentId,
      authenticationContext.virtualAgentId,
      authenticationContext.virtual_agent_id,
      metadata.virtualAgentId,
      sourceIdentity.virtualAgentId,
      sourceIdentity.agentId,
      input.virtualAgentId,
      input.virtual_agent_id,
      input.agentId,
      input.agent_id
    ),
    sourceSubjectId: firstText(
      sourceAuthContext.sourceSubjectId,
      sourceAuthContext.source_subject_id,
      sourceAuthContext.subjectId,
      authenticatedSourceIdentity.sourceSubjectId,
      authenticatedSourceIdentity.source_subject_id,
      authenticatedSourceIdentity.subjectId,
      authenticationContext.sourceSubjectId,
      authenticationContext.source_subject_id,
      authenticationContext.subjectId,
      subject.sourceSubjectId,
      subject.subjectId,
      subject.userId,
      user.userId,
      user.username,
      metadata.sourceSubjectId,
      metadata.subjectId,
      grant.subjectId,
      grant.id,
      sourceIdentity.sourceSubjectId,
      sourceIdentity.subjectId,
      input.sourceSubjectId,
      input.source_subject_id,
      input.subjectId,
      input.subject_id
    ),
    agentProfileId: firstText(
      sourceAuthContext.agentProfileId,
      sourceAuthContext.profileId,
      authenticatedSourceIdentity.agentProfileId,
      authenticatedSourceIdentity.profileId,
      authenticationContext.agentProfileId,
      authenticationContext.profileId,
      subject.agentProfileId,
      subject.profileId,
      metadata.agentProfileId,
      metadata.profileId,
      grant.agentProfileId,
      grant.profileId,
      profile.agentProfileId,
      profile.profileId,
      profile.id,
      sourceIdentity.agentProfileId,
      sourceIdentity.profileId,
      input.agentProfileId,
      input.profileId
    ),
    authSessionId: firstText(
      sourceAuthContext.authSessionId,
      authenticationContext.authSessionId,
      authSession.authSessionId,
      authSession.sessionId,
      authSession.id
    ),
    grantId: firstText(
      sourceAuthContext.grantId,
      authenticationContext.grantId,
      grant.grantId,
      grant.id
    ),
    credentialRef: firstText(
      sourceAuthContext.credentialRef,
      sourceAuthContext.secretRef,
      authenticationContext.credentialRef,
      authenticationContext.secretRef,
      grant.credentialRef,
      metadata.credentialRef,
      metadata.secretRef
    ),
    sourceScopes,
    sourceCapabilities,
    sourceIdentityTrusted: hasTrustedSource ? true : undefined,
    authContextTrusted: authContextTrusted ? true : undefined
  });
}

export function sourceAuthContextForOperation(input = {}) {
  const raw = asObject(input);
  const normalized = normalizeAcpSourceAuthenticationContext(input);
  return compactRecord({
    sourceId: normalized.sourceId || raw.sourceId,
    workspaceId: normalized.workspaceId || raw.workspaceId,
    sourceSessionId: normalized.sourceSessionId || raw.sourceSessionId,
    virtualAgentId: normalized.virtualAgentId || raw.virtualAgentId,
    sourceSubjectId: normalized.sourceSubjectId || raw.sourceSubjectId,
    agentProfileId: normalized.agentProfileId || raw.agentProfileId,
    authSessionId: normalized.authSessionId || raw.authSessionId,
    grantId: normalized.grantId || raw.grantId,
    credentialRef: normalized.credentialRef || raw.credentialRef,
    sourceScopes: normalized.sourceScopes?.length > 0 ? normalized.sourceScopes : raw.sourceScopes,
    sourceCapabilities: normalized.sourceCapabilities?.length > 0 ? normalized.sourceCapabilities : raw.sourceCapabilities,
    sourceIdentityTrusted: normalized.sourceIdentityTrusted || raw.sourceIdentityTrusted,
    authContextTrusted: normalized.authContextTrusted || raw.authContextTrusted
  });
}
