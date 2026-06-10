import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_client/src/services/agent_service.dart';

void main() {
  group('PortableDataCliContract', () {
    late List<String> capturedArgs;
    late Map<String, String>? capturedEnv;
    late AgentService service;

    setUp(() {
      capturedArgs = [];
      capturedEnv = null;
      service = AgentService(
        dataDirectory: () async => '/fake/portable/data',
        resolveCliBinary: () async => File('/fake/pact-client'),
        runCliExecutable: (executable, args, env) async {
          capturedArgs = args;
          capturedEnv = env;
          return ProcessResult(0, 0, '{"ok":true, "candidates":[]}', '');
        },
      );
    });

    test('scanTargets passes PACT_PORTABLE_DIR', () async {
      await service.scanTargets();
      expect(capturedArgs, ['targets', 'scan']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('addTarget passes PACT_PORTABLE_DIR', () async {
      await service.addTarget(target: 'opencode');
      expect(capturedArgs, ['targets', 'add', '--target', 'opencode']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('inspectTarget passes PACT_PORTABLE_DIR', () async {
      await service.inspectTarget('opencode');
      expect(capturedArgs, ['targets', 'inspect', 'opencode']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('planTargetConfig passes PACT_PORTABLE_DIR', () async {
      await service.planTargetConfig('opencode');
      expect(capturedArgs, ['mcp', 'config', 'plan', '--target', 'opencode']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('restoreSnapshot passes PACT_PORTABLE_DIR', () async {
      await service.restoreSnapshot('snap-1');
      expect(capturedArgs, ['snapshots', 'restore', 'snap-1']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('mcpPluginStatus passes PACT_PORTABLE_DIR', () async {
      await service.mcpPluginStatus(target: 'opencode');
      expect(capturedArgs, ['mcp', 'plugin', 'status', '--target', 'opencode']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('updateMcpPlugin passes PACT_PORTABLE_DIR', () async {
      await service.updateMcpPlugin(target: 'opencode');
      expect(capturedArgs, ['mcp', 'plugin', 'update', '--target', 'opencode']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('rollbackMcpPlugin passes PACT_PORTABLE_DIR', () async {
      await service.rollbackMcpPlugin(target: 'opencode', snapshotId: 'snap-1');
      expect(capturedArgs, ['mcp', 'plugin', 'rollback', '--target', 'opencode', '--snapshot-id', 'snap-1']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('listSnapshots passes PACT_PORTABLE_DIR', () async {
      await service.listSnapshots(target: 'opencode');
      expect(capturedArgs, ['snapshots', 'list', '--target', 'opencode']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('listPairings passes PACT_PORTABLE_DIR', () async {
      await service.listPairings(agent: 'codex');
      expect(capturedArgs, ['agents', 'pair', 'list', '--agent', 'codex']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('listSkills passes PACT_PORTABLE_DIR', () async {
      await service.listSkills(agent: 'codex');
      expect(capturedArgs, ['skill', 'list', '--agent', 'codex']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('listModelProfiles passes PACT_PORTABLE_DIR', () async {
      await service.listModelProfiles();
      expect(capturedArgs, ['model', 'profiles', 'list']);
      expect(capturedEnv?['PACT_PORTABLE_DIR'], '/fake/portable/data');
    });

    test('without dataDirectory, env does not contain PACT_PORTABLE_DIR', () async {
      final noDataService = AgentService(
        resolveCliBinary: () async => File('/fake/pact-client'),
        runCliExecutable: (executable, args, env) async {
          capturedArgs = args;
          capturedEnv = env;
          return ProcessResult(0, 0, '{"ok":true}', '');
        },
      );
      await noDataService.scanTargets();
      expect(capturedEnv, isNull);
    });
  });
}
