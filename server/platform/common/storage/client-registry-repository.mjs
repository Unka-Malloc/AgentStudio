import { asBoolInt } from "./metadata-helpers.mjs";

export const MAX_PACT_CLIENT_REGISTRATIONS = 2000;

function normalizeClientMigrationState(currentState, lastSeenAt, offlineAfterSeconds) {
  const currentServiceUrl = String(currentState?.currentServiceUrl || "").trim();
  const desiredServiceUrl = String(currentState?.desiredServiceUrl || "").trim();
  const currentJobServiceUrl = String(currentState?.currentJobServiceUrl || "").trim();
  const ageSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(lastSeenAt || 0).getTime()) / 1000)
  );

  if (!lastSeenAt || !Number.isFinite(ageSeconds)) {
    return "unknown";
  }

  if (ageSeconds > Math.max(30, Number(offlineAfterSeconds) || 300)) {
    return "offline";
  }

  if (currentJobServiceUrl && currentJobServiceUrl !== desiredServiceUrl) {
    return "draining";
  }

  if (currentServiceUrl && desiredServiceUrl && currentServiceUrl === desiredServiceUrl) {
    return "aligned";
  }

  if (currentServiceUrl && desiredServiceUrl && currentServiceUrl !== desiredServiceUrl) {
    return "outdated";
  }

  if (desiredServiceUrl) {
    return "bootstrap-only";
  }

  return "unknown";
}

export function createClientRegistryService({
  db,
  maxClientRegistrations = MAX_PACT_CLIENT_REGISTRATIONS
}) {
  const maxRegistrations = Math.max(
    1,
    Math.floor(Number(maxClientRegistrations || MAX_PACT_CLIENT_REGISTRATIONS) || MAX_PACT_CLIENT_REGISTRATIONS)
  );
  const selectClientRegistrationStmt = db.prepare(`
    SELECT * FROM client_registrations WHERE client_id = ?
  `);
  const countClientRegistrationsStmt = db.prepare(`
    SELECT COUNT(*) AS count FROM client_registrations
  `);
  const pruneOfflineClientRegistrationsStmt = db.prepare(`
    DELETE FROM client_registrations
    WHERE last_seen_at < ?
  `);
  const upsertClientRegistrationStmt = db.prepare(`
    INSERT INTO client_registrations (
      client_id, client_label, app_version, platform, hostname, bootstrap_url,
      current_service_url, desired_service_url, current_job_service_url, config_version,
      migration_state, last_error, busy, last_job_id, first_seen_at, last_seen_at,
      last_seen_server_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      client_label = excluded.client_label,
      app_version = excluded.app_version,
      platform = excluded.platform,
      hostname = excluded.hostname,
      bootstrap_url = excluded.bootstrap_url,
      current_service_url = excluded.current_service_url,
      desired_service_url = excluded.desired_service_url,
      current_job_service_url = excluded.current_job_service_url,
      config_version = excluded.config_version,
      migration_state = excluded.migration_state,
      last_error = excluded.last_error,
      busy = excluded.busy,
      last_job_id = excluded.last_job_id,
      last_seen_at = excluded.last_seen_at,
      last_seen_server_id = excluded.last_seen_server_id,
      updated_at = excluded.updated_at
  `);
  const listClientRegistrationsStmt = db.prepare(`
    SELECT * FROM client_registrations
    ORDER BY last_seen_at DESC, client_id ASC
  `);

  return {
    recordClientCheckIn({
      clientId,
      clientLabel = "",
      appVersion = "",
      platform = "",
      hostname = "",
      bootstrapUrl = "",
      currentServiceUrl = "",
      desiredServiceUrl = "",
      currentJobServiceUrl = "",
      configVersion = "",
      busy = false,
      lastJobId = "",
      lastError = "",
      serverId = "",
      offlineAfterSeconds = 300
    }) {
      const existing = selectClientRegistrationStmt.get(clientId);
      const now = new Date().toISOString();
      const firstSeenAt = existing?.first_seen_at || now;
      if (!existing) {
        const offlineCutoff = new Date(
          Date.now() - Math.max(60, Number(offlineAfterSeconds) || 300) * 1000
        ).toISOString();
        pruneOfflineClientRegistrationsStmt.run(offlineCutoff);
        const count = Number(countClientRegistrationsStmt.get()?.count || 0);
        if (count >= maxRegistrations) {
          return {
            ok: false,
            statusCode: 429,
            code: "client_registration_capacity_exceeded",
            error: "客户端登记容量已满，请等待离线记录过期后重试。"
          };
        }
      }
      const migrationState = normalizeClientMigrationState(
        {
          currentServiceUrl,
          desiredServiceUrl,
          currentJobServiceUrl
        },
        now,
        offlineAfterSeconds
      );

      upsertClientRegistrationStmt.run(
        clientId,
        String(clientLabel || hostname || clientId),
        String(appVersion || ""),
        String(platform || ""),
        String(hostname || ""),
        String(bootstrapUrl || ""),
        String(currentServiceUrl || ""),
        String(desiredServiceUrl || ""),
        String(currentJobServiceUrl || ""),
        String(configVersion || ""),
        migrationState,
        String(lastError || ""),
        asBoolInt(busy),
        String(lastJobId || ""),
        firstSeenAt,
        now,
        String(serverId || ""),
        now
      );

      return {
        ok: true,
        clientId,
        migrationState,
        connectionKind: "pact-client",
        connectionMethod: "pact-client 封装",
        connectionState: migrationState === "offline" ? "offline" : "active",
        connectionStatusLabel: "",
        supportsMigration: true,
        firstSeenAt,
        lastSeenAt: now
      };
    },
    listClientRegistrations({ offlineAfterSeconds = 300 } = {}) {
      const items = listClientRegistrationsStmt.all().map((row) => {
        const migrationState = normalizeClientMigrationState(
          {
            currentServiceUrl: row.current_service_url,
            desiredServiceUrl: row.desired_service_url,
            currentJobServiceUrl: row.current_job_service_url
          },
          row.last_seen_at,
          offlineAfterSeconds
        );

        return {
          clientId: row.client_id,
          clientLabel: row.client_label || row.hostname || row.client_id,
          appVersion: row.app_version || "",
          platform: row.platform || "",
          hostname: row.hostname || "",
          bootstrapUrl: row.bootstrap_url || "",
          currentServiceUrl: row.current_service_url || "",
          desiredServiceUrl: row.desired_service_url || "",
          currentJobServiceUrl: row.current_job_service_url || "",
          configVersion: row.config_version || "",
          migrationState,
          connectionKind: "pact-client",
          connectionMethod: "pact-client 封装",
          connectionState: migrationState === "offline" ? "offline" : "active",
          connectionStatusLabel: "",
          supportsMigration: true,
          busy: Boolean(row.busy),
          lastJobId: row.last_job_id || "",
          lastError: row.last_error || "",
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
          lastSeenServerId: row.last_seen_server_id || ""
        };
      });

      const summary = {
        totalCount: items.length,
        alignedCount: items.filter((item) => item.migrationState === "aligned").length,
        outdatedCount: items.filter((item) => item.migrationState === "outdated").length,
        drainingCount: items.filter((item) => item.migrationState === "draining").length,
        bootstrapOnlyCount: items.filter((item) => item.migrationState === "bootstrap-only")
          .length,
        offlineCount: items.filter((item) => item.migrationState === "offline").length,
        unknownCount: items.filter((item) => item.migrationState === "unknown").length,
        pactClientCount: items.length,
        mcpPluginCount: 0,
        migratableCount: items.length
      };

      return {
        summary,
        items
      };
    }
  };
}
