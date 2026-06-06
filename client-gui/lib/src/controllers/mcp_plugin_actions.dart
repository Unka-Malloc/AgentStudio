part of 'future_client_controller.dart';

extension FutureClientMcpPluginActions on FutureClientController {
  Future<void> refreshMcpPluginStatus(TargetCandidate target) async {
    await _runMcpPluginAction(
      target,
      statusCaptionWhenBusy: 'MCP plugin',
      statusMessageWhenBusy: '正在读取 ${target.label} MCP 插件状态。',
      action: () => agentService.mcpPluginStatus(
        target: target.target,
        configPath: target.configPath ?? '',
      ),
      onResult: (result) {
        mcpPluginStatuses = {...mcpPluginStatuses, target.target: result};
        statusMessage = '已读取 ${target.label} MCP 插件状态。';
        statusCaption = 'MCP plugin';
      },
      onErrorMessage: '${target.label} MCP 插件状态读取失败。',
    );
  }

  Future<void> updateMcpPlugin(TargetCandidate target) async {
    await _runMcpPluginAction(
      target,
      statusCaptionWhenBusy: 'MCP plugin',
      statusMessageWhenBusy: '正在更新 ${target.label} Pact MCP 插件。',
      action: () => agentService.updateMcpPlugin(
        target: target.target,
        configPath: target.configPath ?? '',
      ),
      onResult: (result) async {
        mcpPluginActionResult = result;
        mcpPluginStatuses = {...mcpPluginStatuses, target.target: result};
        scannedTargets = await agentService.scanTargets();
        statusMessage = '已更新 ${target.label} Pact MCP 插件。';
        statusCaption = 'MCP plugin';
      },
      onErrorMessage: '${target.label} Pact MCP 插件更新失败。',
    );
  }

  Future<void> rollbackLatestMcpPlugin(TargetCandidate target) async {
    await _runMcpPluginAction(
      target,
      statusCaptionWhenBusy: 'MCP plugin',
      statusMessageWhenBusy: '正在回滚 ${target.label} Pact MCP 插件。',
      action: () async {
        final snapshots = await agentService.listSnapshots(
          target: target.target,
        );
        final snapshotId = snapshots
            .map((snapshot) => (snapshot['snapshotId'] ?? '').toString())
            .firstWhere((value) => value.isNotEmpty, orElse: () => '');
        if (snapshotId.isEmpty) {
          throw Exception('No snapshot found for ${target.target}');
        }
        return agentService.rollbackMcpPlugin(
          target: target.target,
          snapshotId: snapshotId,
          configPath: target.configPath ?? '',
        );
      },
      onResult: (result) async {
        mcpPluginActionResult = result;
        mcpPluginStatuses = {...mcpPluginStatuses, target.target: result};
        scannedTargets = await agentService.scanTargets();
        statusMessage = '已回滚 ${target.label} Pact MCP 插件。';
        statusCaption = 'MCP plugin';
      },
      onErrorMessage: '${target.label} Pact MCP 插件回滚失败。',
    );
  }

  Future<void> _runMcpPluginAction(
    TargetCandidate target, {
    required String statusCaptionWhenBusy,
    required String statusMessageWhenBusy,
    required Future<Map<String, dynamic>> Function() action,
    required FutureOr<void> Function(Map<String, dynamic> result) onResult,
    required String onErrorMessage,
  }) async {
    if (_mcpPluginBusyTargets.contains(target.target)) {
      return;
    }
    _mcpPluginBusyTargets.add(target.target);
    lastError = '';
    statusMessage = statusMessageWhenBusy;
    statusCaption = statusCaptionWhenBusy;
    _notifyStateChanged();
    try {
      final result = await action();
      await onResult(result);
    } catch (error) {
      debugPrint('Failed to run MCP plugin action: $error');
      lastError = error.toString();
      statusMessage = onErrorMessage;
      statusCaption = statusCaptionWhenBusy;
    } finally {
      _mcpPluginBusyTargets.remove(target.target);
      _notifyStateChanged();
    }
  }
}
