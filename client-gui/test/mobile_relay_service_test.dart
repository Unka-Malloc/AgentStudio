import 'dart:convert';
import 'dart:io';

import 'package:flutter_client/src/services/agent_service.dart';
import 'package:flutter_client/src/services/mobile_relay_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('falls back to Pact relay when persisted default gateway is blank', () {
    final config = MobileRelayConfig.fromJson(const {
      'defaultGatewayUrl': '   ',
      'customGatewayUrl': '',
      'useCustomGateway': false,
    });

    expect(config.defaultGatewayUrl, pactDefaultMobileRelayGatewayUrl);
    expect(config.effectiveGatewayUrl, pactDefaultMobileRelayGatewayUrl);
  });

  test(
    'delegates gateway, pairing, and sync operations to pact-client',
    () async {
      final captured = <List<String>>[];
      final agentService = AgentService(
        runCliExecutable: (executable, args, env) async {
          captured.add(List<String>.from(args));
          if (args.contains('create')) {
            return ProcessResult(
              0,
              0,
              jsonEncode({
                'ok': true,
                'pairingId': 'pair-1',
                'pairingCode': '1234-5678',
                'config': _configJson(
                  useCustomGateway: true,
                  customGatewayUrl: 'https://relay.example.test',
                  pairingId: 'pair-1',
                  pcToken: 'pc-token',
                  lastPairingCode: '1234-5678',
                ),
              }),
              '',
            );
          }
          if (args.contains('sync')) {
            return ProcessResult(
              0,
              0,
              jsonEncode({
                'ok': true,
                'commands': [
                  {
                    'commandId': 'cmd-1',
                    'type': 'agent.sessions.list',
                    'payload': {'agentId': 'codex'},
                    'status': 'in_progress',
                    'createdAt': '2026-06-12T00:00:00Z',
                  },
                ],
              }),
              '',
            );
          }
          return ProcessResult(
            0,
            0,
            jsonEncode({
              'ok': true,
              'config': _configJson(
                useCustomGateway: args.contains('true'),
                customGatewayUrl: 'https://relay.example.test',
              ),
            }),
            '',
          );
        },
      );
      const service = MobileRelayService();

      final config = await service.configureGateway(
        agentService: agentService,
        useCustomGateway: true,
        customGatewayUrl: 'https://relay.example.test/',
      );
      final response = await service.createPairing(agentService: agentService);
      final sync = await service.syncCommands(agentService: agentService);

      expect(config.effectiveGatewayUrl, 'https://relay.example.test');
      expect(response['pairingId'], 'pair-1');
      expect((sync['commands'] as List).single['commandId'], 'cmd-1');
      expect(captured[0], [
        'mobile',
        'relay',
        'config',
        'set',
        '--use-custom-gateway',
        'true',
        '--custom-gateway-url',
        'https://relay.example.test/',
      ]);
      expect(captured[1], ['mobile', 'relay', 'pairing', 'create']);
      expect(captured[2], ['mobile', 'relay', 'commands', 'sync']);
    },
  );
}

Map<String, dynamic> _configJson({
  bool useCustomGateway = false,
  String customGatewayUrl = '',
  String pairingId = '',
  String pcToken = '',
  String lastPairingCode = '',
}) {
  return {
    'schemaVersion': 1,
    'defaultGatewayUrl': pactDefaultMobileRelayGatewayUrl,
    'useCustomGateway': useCustomGateway,
    'customGatewayUrl': customGatewayUrl,
    'pcClientId': 'pc-test',
    'pcClientName': 'Test PC',
    'pairingId': pairingId,
    'pcToken': pcToken,
    'lastPairingCode': lastPairingCode,
    'lastPairingExpiresAt': '2026-06-12T12:00:00Z',
    'paired': false,
    'relayEnabled': false,
    'pollIntervalSeconds': 5,
  };
}
