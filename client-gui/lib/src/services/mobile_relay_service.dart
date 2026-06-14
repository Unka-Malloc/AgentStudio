import 'dart:io' show Platform;

import 'agent_service.dart';

const String pactDefaultMobileRelayGatewayUrl = 'https://relay.pact.run';

String _normalizeGatewayUrl(String value) {
  return value.trim().replaceAll(RegExp(r'/+$'), '');
}

String _nonEmptyGatewayUrl(String? value, String fallback) {
  final normalized = _normalizeGatewayUrl(value ?? '');
  return normalized.isEmpty ? fallback : normalized;
}

class MobileRelayConfig {
  const MobileRelayConfig({
    required this.schemaVersion,
    required this.defaultGatewayUrl,
    required this.useCustomGateway,
    required this.customGatewayUrl,
    required this.pcClientId,
    required this.pcClientName,
    required this.pairingId,
    required this.pcToken,
    required this.lastPairingCode,
    required this.lastPairingExpiresAt,
    required this.paired,
    required this.relayEnabled,
    required this.pollIntervalSeconds,
  });

  static const currentSchemaVersion = 1;

  final int schemaVersion;
  final String defaultGatewayUrl;
  final bool useCustomGateway;
  final String customGatewayUrl;
  final String pcClientId;
  final String pcClientName;
  final String pairingId;
  final String pcToken;
  final String lastPairingCode;
  final String lastPairingExpiresAt;
  final bool paired;
  final bool relayEnabled;
  final int pollIntervalSeconds;

  String get effectiveGatewayUrl {
    final custom = _normalizeGatewayUrl(customGatewayUrl);
    final fallback = _nonEmptyGatewayUrl(
      defaultGatewayUrl,
      pactDefaultMobileRelayGatewayUrl,
    );
    return useCustomGateway && custom.isNotEmpty ? custom : fallback;
  }

  bool get hasPairing =>
      pairingId.trim().isNotEmpty && pcToken.trim().isNotEmpty;

  factory MobileRelayConfig.defaults() {
    final now = DateTime.now().toUtc().microsecondsSinceEpoch;
    return MobileRelayConfig(
      schemaVersion: currentSchemaVersion,
      defaultGatewayUrl: _nonEmptyGatewayUrl(
        Platform.environment['PACT_MOBILE_RELAY_GATEWAY_URL'],
        pactDefaultMobileRelayGatewayUrl,
      ),
      useCustomGateway: false,
      customGatewayUrl: '',
      pcClientId: 'pc_$now',
      pcClientName: Platform.localHostname.isEmpty
          ? 'Pact PC Client'
          : Platform.localHostname,
      pairingId: '',
      pcToken: '',
      lastPairingCode: '',
      lastPairingExpiresAt: '',
      paired: false,
      relayEnabled: false,
      pollIntervalSeconds: 5,
    );
  }

  factory MobileRelayConfig.fromJson(Map<String, dynamic> json) {
    final defaults = MobileRelayConfig.defaults();
    return MobileRelayConfig(
      schemaVersion:
          (json['schemaVersion'] as num?)?.toInt() ?? currentSchemaVersion,
      defaultGatewayUrl: _nonEmptyGatewayUrl(
        json['defaultGatewayUrl']?.toString(),
        defaults.defaultGatewayUrl,
      ),
      useCustomGateway: json['useCustomGateway'] == true,
      customGatewayUrl: (json['customGatewayUrl'] ?? '').toString(),
      pcClientId: (json['pcClientId'] ?? defaults.pcClientId).toString(),
      pcClientName: (json['pcClientName'] ?? defaults.pcClientName).toString(),
      pairingId: (json['pairingId'] ?? '').toString(),
      pcToken: (json['pcToken'] ?? '').toString(),
      lastPairingCode: (json['lastPairingCode'] ?? '').toString(),
      lastPairingExpiresAt: (json['lastPairingExpiresAt'] ?? '').toString(),
      paired: json['paired'] == true,
      relayEnabled: json['relayEnabled'] == true,
      pollIntervalSeconds:
          (json['pollIntervalSeconds'] as num?)?.toInt().clamp(3, 60) ?? 5,
    );
  }

  MobileRelayConfig copyWith({
    String? defaultGatewayUrl,
    bool? useCustomGateway,
    String? customGatewayUrl,
    String? pcClientName,
    String? pairingId,
    String? pcToken,
    String? lastPairingCode,
    String? lastPairingExpiresAt,
    bool? paired,
    bool? relayEnabled,
    int? pollIntervalSeconds,
  }) {
    return MobileRelayConfig(
      schemaVersion: schemaVersion,
      defaultGatewayUrl: _nonEmptyGatewayUrl(
        defaultGatewayUrl ?? this.defaultGatewayUrl,
        pactDefaultMobileRelayGatewayUrl,
      ),
      useCustomGateway: useCustomGateway ?? this.useCustomGateway,
      customGatewayUrl: customGatewayUrl ?? this.customGatewayUrl,
      pcClientId: pcClientId,
      pcClientName: pcClientName ?? this.pcClientName,
      pairingId: pairingId ?? this.pairingId,
      pcToken: pcToken ?? this.pcToken,
      lastPairingCode: lastPairingCode ?? this.lastPairingCode,
      lastPairingExpiresAt: lastPairingExpiresAt ?? this.lastPairingExpiresAt,
      paired: paired ?? this.paired,
      relayEnabled: relayEnabled ?? this.relayEnabled,
      pollIntervalSeconds: (pollIntervalSeconds ?? this.pollIntervalSeconds)
          .clamp(3, 60),
    );
  }
}

class MobileRelayCommand {
  const MobileRelayCommand({
    required this.commandId,
    required this.type,
    required this.payload,
    required this.status,
    required this.createdAt,
  });

  final String commandId;
  final String type;
  final Map<String, dynamic> payload;
  final String status;
  final String createdAt;

  factory MobileRelayCommand.fromJson(Map<String, dynamic> json) {
    return MobileRelayCommand(
      commandId: (json['commandId'] ?? '').toString(),
      type: (json['type'] ?? '').toString(),
      payload: json['payload'] is Map<String, dynamic>
          ? Map<String, dynamic>.from(json['payload'] as Map)
          : const {},
      status: (json['status'] ?? '').toString(),
      createdAt: (json['createdAt'] ?? '').toString(),
    );
  }
}

class MobileRelayService {
  const MobileRelayService();

  Future<MobileRelayConfig> loadConfig({
    required AgentService agentService,
  }) async {
    final output = await agentService.runCli([
      'mobile',
      'relay',
      'config',
      'get',
    ]);
    return _configFromOutput(output);
  }

  Future<void> saveConfig({
    required AgentService agentService,
    required MobileRelayConfig config,
  }) async {
    await agentService.runCli([
      'mobile',
      'relay',
      'config',
      'set',
      '--use-custom-gateway',
      config.useCustomGateway.toString(),
      '--custom-gateway-url',
      config.customGatewayUrl,
      '--relay-enabled',
      config.relayEnabled.toString(),
    ]);
  }

  Future<MobileRelayConfig> configureGateway({
    required AgentService agentService,
    required bool useCustomGateway,
    required String customGatewayUrl,
  }) async {
    final output = await agentService.runCli([
      'mobile',
      'relay',
      'config',
      'set',
      '--use-custom-gateway',
      useCustomGateway.toString(),
      '--custom-gateway-url',
      customGatewayUrl.trim(),
    ]);
    return _configFromOutput(output);
  }

  Future<Map<String, dynamic>> createPairing({
    required AgentService agentService,
  }) {
    return agentService.runCli(['mobile', 'relay', 'pairing', 'create']);
  }

  Future<Map<String, dynamic>> refreshPairingStatus({
    required AgentService agentService,
  }) {
    return agentService.runCli(['mobile', 'relay', 'pairing', 'status']);
  }

  Future<Map<String, dynamic>> syncCommands({
    required AgentService agentService,
  }) {
    return agentService.runCli(['mobile', 'relay', 'commands', 'sync']);
  }

  MobileRelayConfig _configFromOutput(Map<String, dynamic> output) {
    final config = output['config'];
    if (config is Map<String, dynamic>) {
      return MobileRelayConfig.fromJson(config);
    }
    return MobileRelayConfig.fromJson(output);
  }
}
