import 'dart:async';
import 'dart:io';

import 'package:flutter_client/src/controllers/future_client_controller.dart';
import 'package:flutter_client/src/models/future_client_models.dart';
import 'package:flutter_client/src/services/agent_service.dart';
import 'package:flutter_client/src/services/portable_data_root.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('initializes against portable data without legacy runtime services', () async {
    final directory = await Directory.systemTemp.createTemp('pact-future-client-');
    addTearDown(() async {
      if (await directory.exists()) {
        await directory.delete(recursive: true);
      }
    });

    final controller = FutureClientController(
      portableData: PortableDataRoot(dataDirectoryOverride: directory),
      agentService: _FakeAgentService(),
    );
    addTearDown(controller.dispose);

    await controller.initialize();

    expect(controller.initialized, isTrue);
    expect(controller.portableDataPath, directory.path);
    expect(await File('${directory.path}/.pact-workspace.json').exists(), isTrue);
  });

  test('keeps error state when portable data initialization fails', () async {
    final controller = FutureClientController(
      portableData: _ThrowingPortableDataRoot(),
      agentService: _FakeAgentService(),
    );
    addTearDown(controller.dispose);

    await controller.initialize();

    expect(controller.initialized, isFalse);
    expect(controller.lastError, contains('boot error'));
    expect(controller.statusMessage, '初始化失败。');
    expect(controller.statusCaption, 'Error');
  });

  test('selecting same section keeps state, selecting agents auto scans only once', () async {
    final service = _FakeAgentService();
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    controller.selectSection(FutureClientSection.settings);
    controller.selectSection(FutureClientSection.settings);
    expect(controller.currentSection, FutureClientSection.settings);

    controller.selectSection(FutureClientSection.agents);
    await Future<void>.delayed(Duration.zero);

    controller.selectSection(FutureClientSection.agents);
    await Future<void>.delayed(Duration.zero);

    expect(controller.currentSection, FutureClientSection.agents);
    expect(service.scanTargetsCalls, 1);
  });

  test('scanTargets captures failed scans and clears busy flag', () async {
    final service = _FakeAgentService()..throwScanTargets = true;
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.scanTargets();

    expect(controller.isScanningTargets, isFalse);
    expect(controller.scannedTargets, isEmpty);
    expect(controller.lastError, contains('scan failed'));
    expect(controller.statusMessage, '目标适配器扫描失败。');
    expect(controller.statusCaption, 'Targets');
  });

  test('inspect target captures failures', () async {
    final service = _FakeAgentService()..throwInspectTarget = true;
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.inspectTarget('codex');

    expect(controller.lastError, contains('inspect failed'));
    expect(controller.statusMessage, 'codex 目标适配器读取失败。');
  });

  test('inspect target success updates status and result', () async {
    final service = _FakeAgentService();
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.inspectTarget('codex');

    expect(controller.targetInspection, {'target': 'codex'});
    expect(controller.statusMessage, '已读取 codex 目标适配器。');
    expect(controller.statusCaption, 'Target inspect');
  });

  test('adds manual target using trimmed input and ignores empty names', () async {
    final service = _FakeAgentService();
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.addManualTarget(target: '  openclaw  ', configPath: ' /tmp/openclaw.json ');
    expect(service.addedTarget, 'openclaw');
    expect(service.addedConfigPath, '/tmp/openclaw.json');
    expect(service.scanTargetsCalls, 2);
    expect(controller.statusMessage, contains('已添加 openclaw 手动目标。'));

    service.scanTargetsCalls = 0;
    await controller.addManualTarget(target: '   ');
    expect(service.scanTargetsCalls, 0);
    expect(controller.lastError, isEmpty);
  });

  test('adds manual target failure keeps error state', () async {
    final service = _FakeAgentService()..throwAddTarget = true;
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.addManualTarget(target: 'openclaw', configPath: ' /tmp/openclaw.json ');

    expect(controller.lastError, contains('add failed'));
    expect(controller.statusMessage, 'openclaw 手动目标添加失败。');
    expect(controller.statusCaption, 'Targets');
  });

  test('constructs with default dependencies', () {
    final controller = FutureClientController();
    addTearDown(controller.dispose);

    expect(controller.agentService, isA<AgentService>());
    expect(controller.portableData, isA<PortableDataRoot>());
  });

  test('restores snapshots successfully and ignores blank snapshot ids', () async {
    final service = _FakeAgentService();
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.restoreSnapshot('snapshot-codex-1');
    expect(service.restoredSnapshotId, 'snapshot-codex-1');
    expect(controller.snapshotRestoreResult?['ok'], isTrue);

    await controller.restoreSnapshot('   ');
    expect(service.restoreSnapshotCount, 1);
  });

  test('restores snapshot handles client failure', () async {
    final service = _FakeAgentService()..throwRestoreSnapshot = true;
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.restoreSnapshot('snapshot-codex-1');

    expect(controller.lastError, contains('restore failed'));
    expect(controller.statusMessage, '配置快照恢复失败。');
  });

  test('plans target config and propagates client failure', () async {
    final service = _FakeAgentService();
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.planTargetConfig('codex');
    expect(controller.targetConfigPlan, isNotNull);
    expect(controller.statusMessage, contains('已生成 codex MCP 配置计划。'));

    service.throwPlanTargetConfig = true;
    await controller.planTargetConfig('codex');
    expect(controller.lastError, contains('plan failed'));
    expect(controller.statusMessage, 'codex MCP 配置计划生成失败。');
  });

  test('supports MCP plugin status, update, and rollback', () async {
    final service = _FakeAgentService();
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.scanTargets();
    final target = controller.scannedTargets.single;

    await controller.refreshMcpPluginStatus(target);
    expect(controller.mcpPluginStatuses[target.target], isNotNull);

    await controller.updateMcpPlugin(target);
    expect(service.updatedPluginTarget, 'codex');
    expect(controller.mcpPluginActionResult?['status'], 'updated');

    await controller.rollbackLatestMcpPlugin(target);
    expect(service.rolledBackSnapshotId, 'snapshot-codex-1');
    expect(controller.mcpPluginActionResult?['status'], 'rolled_back');
  });

  test('MCP rollback fails when no snapshot is available', () async {
    final service = _FakeAgentService()..snapshots = const [];
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.scanTargets();
    final target = controller.scannedTargets.single;

    await controller.rollbackLatestMcpPlugin(target);
    expect(controller.lastError, contains('No snapshot found'));
    expect(controller.mcpPluginActionResult, isNull);
    expect(controller.statusMessage, '${target.label} Pact MCP 插件回滚失败。');
  });

  test('blocks duplicated MCP action calls while one is running', () async {
    final service = _FakeAgentService()..mcpUpdateGate = Completer<void>();
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.scanTargets();
    final target = controller.scannedTargets.single;

    unawaited(controller.updateMcpPlugin(target));
    await Future<void>.delayed(Duration.zero);

    await controller.updateMcpPlugin(target);
    expect(service.updateMcpCalls, 1);

    service.mcpUpdateGate!.complete();
    await Future<void>.delayed(Duration.zero);
    expect(controller.isMcpPluginBusy(target.target), isFalse);
  });

  test('supports skill hub state machine and busy lock', () async {
    final service = _FakeAgentService();
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.requestSkillHubPairing('codex', target: 'manual');
    await controller.approveSkillHubPairing('codex');
    await controller.refreshSkillHub('codex');

    expect(controller.skillHubPairings, hasLength(1));
    expect(controller.skillHubSkills, hasLength(1));
    expect(controller.skillHubActionResult?['agent'], 'codex');

    await controller.revokeSkillHubPairing('codex');
    expect(controller.skillHubSkills, isEmpty);

    service.skillBusyGate = Completer<void>();
    unawaited(controller.refreshSkillHub('codex'));
    await Future<void>.delayed(const Duration(milliseconds: 10));
    await controller.refreshSkillHub('codex');
    expect(service.listPairingsCalls, greaterThanOrEqualTo(5));
    expect(service.listSkillsCalls, greaterThanOrEqualTo(3));
    service.skillBusyGate!.complete();
    await Future<void>.delayed(Duration.zero);
  });

  test('reports skill hub action failures', () async {
    final service = _FakeAgentService()..throwListPairings = true;
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.refreshSkillHub('codex');

    expect(controller.lastError, contains('listPairings failed'));
    expect(controller.statusMessage, 'Skill Hub 操作失败。');
    expect(controller.isSkillHubBusy, isFalse);
  });

  test('handles model forwarding success and busy guard', () async {
    final service = _FakeAgentService();
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.refreshModelProfiles();
    expect(controller.modelProfiles, isNotEmpty);

    await controller.saveCommandModelProfile(profileId: 'local-echo', command: 'cat');
    expect(controller.modelProfiles.single['id'], 'local-echo');

    await controller.forwardModelText(profileId: 'local-echo', text: 'hello');
    expect(controller.modelForwardingResult?['output'], 'hello');

    service.modelBusyGate = Completer<void>();
    unawaited(controller.saveCommandModelProfile(profileId: 'local-echo', command: 'cat'));
    await Future<void>.delayed(Duration.zero);
    await controller.forwardModelText(profileId: 'local-echo', text: 'skip');
    expect(service.saveCommandCount, 2);

    service.modelBusyGate!.complete();
    await Future<void>.delayed(Duration.zero);
  });

  test('reports model forwarding failure', () async {
    final service = _FakeAgentService()..throwForwardText = true;
    final controller = FutureClientController(agentService: service);
    addTearDown(controller.dispose);

    await controller.forwardModelText(profileId: 'local-echo', text: 'hello');
    expect(controller.lastError, contains('forward failed'));
    expect(controller.statusMessage, 'Model Forwarding 操作失败。');
  });
}

class _ThrowingPortableDataRoot extends PortableDataRoot {
  @override
  Future<Directory> dataDirectory() async {
    throw Exception('boot error');
  }
}

class _FakeAgentService extends AgentService {
  int scanTargetsCalls = 0;
  int inspectTargetCalls = 0;
  int addTargetCalls = 0;
  int planTargetCalls = 0;
  int restoreSnapshotCount = 0;
  int listSnapshotsCalls = 0;
  int listPairingsCalls = 0;
  int requestPairingCalls = 0;
  int approvePairingCalls = 0;
  int revokePairingCalls = 0;
  int listSkillsCalls = 0;
  int listModelProfilesCalls = 0;
  int saveCommandCount = 0;
  int forwardTextCount = 0;
  int refreshMcpStatusCalls = 0;
  int updateMcpCalls = 0;
  int rollbackMcpCalls = 0;
  int requestSkillHubCalls = 0;
  int refreshSkillHubCalls = 0;

  bool throwScanTargets = false;
  bool throwInspectTarget = false;
  bool throwAddTarget = false;
  bool throwPlanTargetConfig = false;
  bool throwRestoreSnapshot = false;
  bool throwRollbackMcp = false;
  bool throwUpdateMcp = false;
  bool throwForwardText = false;
  bool throwRefreshMcpStatus = false;
  bool throwListPairings = false;
  bool throwListSkills = false;

  String restoredSnapshotId = '';
  String addedTarget = '';
  String addedConfigPath = '';
  String pairedAgent = '';
  String updatedPluginTarget = '';
  String rolledBackSnapshotId = '';

  List<TargetCandidate> scanTargetsResult = [
    TargetCandidate(
      target: 'codex',
      label: 'Codex',
      kind: 'cli',
      status: 'detected',
      configured: false,
      confidence: 0.82,
      detail: 'cli',
      manual: false,
      configPath: '/tmp/codex.toml',
      adapterStatus: 'implemented',
    ),
  ];
  Map<String, dynamic> pairingResult = {'ok': true, 'status': 'requested'};
  String pairingStatus = 'requested';
  List<Map<String, dynamic>> snapshots = const [
    {'snapshotId': 'snapshot-codex-1', 'target': 'codex'},
  ];
  List<Map<String, dynamic>> pairings = [
    {'agentId': 'codex', 'target': 'manual', 'status': 'requested'},
  ];
  List<Map<String, dynamic>> skills = [
    {'skillId': 'review', 'version': '1.0.0'},
  ];

  List<Map<String, dynamic>> modelProfiles = [
    {'id': 'local-echo', 'provider': 'command', 'command': 'cat'},
  ];

  Map<String, dynamic> mcpStatusResult = {
    'ok': true,
    'status': 'configured',
    'target': 'codex',
  };
  Map<String, dynamic> updateResult = {'ok': true, 'status': 'updated'};
  Map<String, dynamic> rollbackResult = {'ok': true, 'status': 'rolled_back'};

  Completer<void>? mcpUpdateGate;
  Completer<void>? modelBusyGate;
  Completer<void>? skillBusyGate;

  @override
  Future<List<TargetCandidate>> scanTargets() async {
    scanTargetsCalls++;
    if (throwScanTargets) {
      throw Exception('scan failed');
    }
    return scanTargetsResult;
  }

  @override
  Future<Map<String, dynamic>> inspectTarget(String target) async {
    inspectTargetCalls++;
    if (throwInspectTarget) {
      throw Exception('inspect failed');
    }
    return {'target': target};
  }

  @override
  Future<Map<String, dynamic>> addTarget({
    required String target,
    String configPath = '',
    String binaryPath = '',
  }) async {
    addTargetCalls++;
    if (throwAddTarget) {
      throw Exception('add failed');
    }
    addedTarget = target;
    addedConfigPath = configPath;
    scanTargetsCalls++;
    return {'ok': true, 'target': target};
  }

  @override
  Future<Map<String, dynamic>> planTargetConfig(String target) async {
    planTargetCalls++;
    if (throwPlanTargetConfig) {
      throw Exception('plan failed');
    }
    return {'ok': true, 'target': target, 'plan': 'noop'};
  }

  @override
  Future<Map<String, dynamic>> restoreSnapshot(String snapshotId) async {
    restoreSnapshotCount++;
    if (throwRestoreSnapshot) {
      throw Exception('restore failed');
    }
    restoredSnapshotId = snapshotId;
    return {'ok': true, 'snapshotId': snapshotId};
  }

  @override
  Future<Map<String, dynamic>> mcpPluginStatus({
    required String target,
    String configPath = '',
  }) async {
    refreshMcpStatusCalls++;
    if (throwRefreshMcpStatus) {
      throw Exception('status failed');
    }
    return mcpStatusResult;
  }

  @override
  Future<Map<String, dynamic>> updateMcpPlugin({
    required String target,
    String configPath = '',
  }) async {
    updateMcpCalls++;
    if (throwUpdateMcp) {
      throw Exception('update failed');
    }
    if (mcpUpdateGate != null) {
      await mcpUpdateGate!.future;
    }
    updatedPluginTarget = target;
    return updateResult;
  }

  @override
  Future<List<Map<String, dynamic>>> listSnapshots({String target = ''}) async {
    listSnapshotsCalls++;
    return snapshots;
  }

  @override
  Future<Map<String, dynamic>> rollbackMcpPlugin({
    required String target,
    required String snapshotId,
    String configPath = '',
  }) async {
    rollbackMcpCalls++;
    if (throwRollbackMcp) {
      throw Exception('rollback failed');
    }
    if (mcpUpdateGate != null) {
      await mcpUpdateGate!.future;
    }
    rolledBackSnapshotId = snapshotId;
    return rollbackResult;
  }

  @override
  Future<List<Map<String, dynamic>>> listPairings({String agent = ''}) async {
    listPairingsCalls++;
    if (throwListPairings) {
      throw Exception('listPairings failed');
    }
    if (agent.isNotEmpty && pairedAgent.isEmpty) {
      return pairings.map((pairing) {
        final updated = Map<String, dynamic>.from(pairing);
        updated['agentId'] = agent;
        return updated;
      }).toList();
    }
    return pairings;
  }

  @override
  Future<Map<String, dynamic>> requestPairing({
    required String agent,
    String target = '',
  }) async {
    requestPairingCalls++;
    pairedAgent = agent;
    requestSkillHubCalls++;
    if (modelBusyGate != null) {
      await modelBusyGate!.future;
    }
    pairingStatus = 'requested';
    return {...pairingResult, 'agent': agent};
  }

  @override
  Future<Map<String, dynamic>> approvePairing({required String agent}) async {
    approvePairingCalls++;
    pairedAgent = agent;
    pairingStatus = 'approved';
    if (modelBusyGate != null) {
      await modelBusyGate!.future;
    }
    return {...pairingResult, 'status': pairingStatus};
  }

  @override
  Future<Map<String, dynamic>> revokePairing({required String agent}) async {
    revokePairingCalls++;
    if (skillBusyGate != null) {
      await skillBusyGate!.future;
    }
    pairingStatus = 'revoked';
    return {...pairingResult, 'status': pairingStatus};
  }

  @override
  Future<List<Map<String, dynamic>>> listSkills({required String agent}) async {
    listSkillsCalls++;
    if (throwListSkills) {
      throw Exception('listSkills failed');
    }
    if (skillHubPairingsRequiresRefresh) {
      return [];
    }
    return skills;
  }

  bool skillHubPairingsRequiresRefresh = false;

  @override
  Future<List<Map<String, dynamic>>> listModelProfiles() async {
    listModelProfilesCalls++;
    return modelProfiles;
  }

  @override
  Future<Map<String, dynamic>> saveCommandModelProfile({
    required String profileId,
    required String command,
  }) async {
    saveCommandCount++;
    if (modelBusyGate != null) {
      await modelBusyGate!.future;
    }
    if (command == 'fail') {
      throw Exception('save failed');
    }
    modelProfiles = [
      {'id': profileId, 'provider': 'command', 'command': command},
    ];
    return {'ok': true, 'status': 'saved', 'profile': profileId};
  }

  @override
  Future<Map<String, dynamic>> forwardText({
    required String profileId,
    required String text,
  }) async {
    forwardTextCount++;
    if (throwForwardText) {
      throw Exception('forward failed');
    }
    if (modelBusyGate != null) {
      await modelBusyGate!.future;
    }
    return {'ok': true, 'mode': 'thin-forward', 'output': text};
  }
}
