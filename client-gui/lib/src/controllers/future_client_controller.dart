import 'dart:async';

import 'package:flutter/widgets.dart';

import '../models/future_client_models.dart';
import '../services/agent_service.dart';
import '../services/portable_data_root.dart';

part 'mcp_plugin_actions.dart';
part 'model_forwarding_actions.dart';
part 'skill_hub_actions.dart';

class FutureClientController extends ChangeNotifier {
  FutureClientController({
    PortableDataRoot? portableData,
    AgentService? agentService,
  }) : portableData = portableData ?? PortableDataRoot(),
       agentService = agentService ?? AgentService() {
    bootstrapController.addListener(notifyListeners);
  }

  final PortableDataRoot portableData;
  final AgentService agentService;
  final TextEditingController bootstrapController = TextEditingController();

  FutureClientSection currentSection = FutureClientSection.agents;
  List<TargetCandidate> scannedTargets = const [];
  Map<String, dynamic>? targetInspection;
  Map<String, dynamic>? targetConfigPlan;
  Map<String, Map<String, dynamic>> mcpPluginStatuses = const {};
  Map<String, dynamic>? mcpPluginActionResult;
  List<Map<String, dynamic>> modelProfiles = const [];
  Map<String, dynamic>? modelForwardingResult;
  List<Map<String, dynamic>> skillHubPairings = const [];
  List<Map<String, dynamic>> skillHubSkills = const [];
  Map<String, dynamic>? skillHubActionResult;
  Map<String, dynamic>? snapshotRestoreResult;
  bool initialized = false;
  bool isScanningTargets = false;
  bool isAddingTarget = false;
  bool isModelForwardingBusy = false;
  bool isSkillHubBusy = false;
  final Set<String> _mcpPluginBusyTargets = <String>{};
  String portableDataPath = '';
  String statusMessage = '等待扫描目标适配器。';
  String statusCaption = 'Future client';
  String lastError = '';

  bool isMcpPluginBusy(String target) {
    return _mcpPluginBusyTargets.contains(target);
  }

  void _notifyStateChanged() {
    notifyListeners();
  }

  Future<void> initialize() async {
    try {
      final dataDir = await portableData.dataDirectory();
      portableDataPath = dataDir.path;
      initialized = true;
      statusMessage = 'Future client 已就绪。';
      statusCaption = 'Ready';
    } catch (error) {
      lastError = error.toString();
      statusMessage = '初始化失败。';
      statusCaption = 'Error';
    } finally {
      notifyListeners();
    }
  }

  void selectSection(FutureClientSection section) {
    if (currentSection == section) {
      return;
    }
    currentSection = section;
    notifyListeners();
    if (section == FutureClientSection.agents && scannedTargets.isEmpty) {
      unawaited(scanTargets());
    }
  }

  Future<void> scanTargets() async {
    if (isScanningTargets) {
      return;
    }
    isScanningTargets = true;
    lastError = '';
    statusMessage = '正在扫描目标适配器。';
    statusCaption = 'Targets';
    notifyListeners();
    try {
      scannedTargets = await agentService.scanTargets();
      statusMessage = '已扫描 ${scannedTargets.length} 个目标适配器。';
      statusCaption = 'Targets';
    } catch (error) {
      debugPrint('Failed to scan targets: $error');
      lastError = error.toString();
      statusMessage = '目标适配器扫描失败。';
      statusCaption = 'Targets';
    } finally {
      isScanningTargets = false;
      notifyListeners();
    }
  }

  Future<void> inspectTarget(String target) async {
    lastError = '';
    try {
      targetInspection = await agentService.inspectTarget(target);
      statusMessage = '已读取 $target 目标适配器。';
      statusCaption = 'Target inspect';
    } catch (error) {
      debugPrint('Failed to inspect target: $error');
      lastError = error.toString();
      statusMessage = '$target 目标适配器读取失败。';
      statusCaption = 'Target inspect';
    } finally {
      notifyListeners();
    }
  }

  Future<void> addManualTarget({
    required String target,
    String configPath = '',
    String binaryPath = '',
  }) async {
    final trimmed = target.trim();
    if (trimmed.isEmpty || isAddingTarget) {
      return;
    }
    final trimmedConfigPath = configPath.trim();
    final trimmedBinaryPath = binaryPath.trim();
    isAddingTarget = true;
    lastError = '';
    statusMessage = '正在添加手动目标。';
    statusCaption = 'Targets';
    notifyListeners();
    try {
      await agentService.addTarget(
        target: trimmed,
        configPath: trimmedConfigPath,
        binaryPath: trimmedBinaryPath,
      );
      scannedTargets = await agentService.scanTargets();
      statusMessage = '已添加 $trimmed 手动目标。';
      statusCaption = 'Targets';
    } catch (error) {
      debugPrint('Failed to add manual target: $error');
      lastError = error.toString();
      statusMessage = '$trimmed 手动目标添加失败。';
      statusCaption = 'Targets';
    } finally {
      isAddingTarget = false;
      notifyListeners();
    }
  }

  Future<void> planTargetConfig(String target) async {
    lastError = '';
    try {
      targetConfigPlan = await agentService.planTargetConfig(target);
      statusMessage = '已生成 $target MCP 配置计划。';
      statusCaption = 'MCP config plan';
    } catch (error) {
      debugPrint('Failed to plan target config: $error');
      lastError = error.toString();
      statusMessage = '$target MCP 配置计划生成失败。';
      statusCaption = 'MCP config plan';
    } finally {
      notifyListeners();
    }
  }

  Future<void> restoreSnapshot(String snapshotId) async {
    final trimmed = snapshotId.trim();
    if (trimmed.isEmpty) {
      return;
    }
    lastError = '';
    statusMessage = '正在恢复配置快照。';
    statusCaption = 'Snapshots';
    notifyListeners();
    try {
      snapshotRestoreResult = await agentService.restoreSnapshot(trimmed);
      statusMessage = '已恢复配置快照 $trimmed。';
      statusCaption = 'Snapshots';
    } catch (error) {
      debugPrint('Failed to restore snapshot: $error');
      lastError = error.toString();
      statusMessage = '配置快照恢复失败。';
      statusCaption = 'Snapshots';
    } finally {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    bootstrapController.dispose();
    super.dispose();
  }
}
