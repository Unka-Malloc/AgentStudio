part of 'future_client_controller.dart';

extension FutureClientMobileRelayActions on FutureClientController {
  Future<void> configureMobileRelayGateway({
    required bool useCustomGateway,
    required String customGatewayUrl,
  }) async {
    if (isMobileRelayBusy) {
      return;
    }
    isMobileRelayBusy = true;
    lastError = '';
    statusMessage = '正在保存移动中转网关配置。';
    statusCaption = 'Mobile relay';
    _notifyStateChanged();
    try {
      mobileRelayConfig = await mobileRelayService.configureGateway(
        agentService: agentService,
        useCustomGateway: useCustomGateway,
        customGatewayUrl: customGatewayUrl,
      );
      statusMessage = '已保存移动中转网关配置。';
      statusCaption = 'Mobile relay';
    } catch (error) {
      debugPrint('Failed to configure mobile relay gateway: $error');
      lastError = error.toString();
      statusMessage = '移动中转网关配置失败。';
      statusCaption = 'Mobile relay';
    } finally {
      isMobileRelayBusy = false;
      _notifyStateChanged();
    }
  }

  Future<void> createMobilePairing() async {
    if (isMobileRelayBusy) {
      return;
    }
    isMobileRelayBusy = true;
    lastError = '';
    statusMessage = '正在创建手机配对码。';
    statusCaption = 'Mobile relay';
    _notifyStateChanged();
    try {
      mobileRelayActionResult = await mobileRelayService.createPairing(
        agentService: agentService,
      );
      mobileRelayConfig = await mobileRelayService.loadConfig(
        agentService: agentService,
      );
      if (scannedTargets.isEmpty) {
        scannedTargets = await agentService.scanTargets();
        _selectDefaultConversationAgent();
      }
      startMobileRelayPolling();
      statusMessage = '已创建手机配对码 ${mobileRelayConfig.lastPairingCode}。';
      statusCaption = 'Mobile relay';
    } catch (error) {
      debugPrint('Failed to create mobile pairing: $error');
      lastError = error.toString();
      statusMessage = '手机配对码创建失败。';
      statusCaption = 'Mobile relay';
    } finally {
      isMobileRelayBusy = false;
      _notifyStateChanged();
    }
  }

  Future<void> refreshMobilePairingStatus() async {
    if (isMobileRelayBusy || !mobileRelayConfig.hasPairing) {
      return;
    }
    isMobileRelayBusy = true;
    lastError = '';
    statusMessage = '正在刷新手机配对状态。';
    statusCaption = 'Mobile relay';
    _notifyStateChanged();
    try {
      mobileRelayActionResult = await mobileRelayService.refreshPairingStatus(
        agentService: agentService,
      );
      mobileRelayConfig = await mobileRelayService.loadConfig(
        agentService: agentService,
      );
      statusMessage = mobileRelayConfig.paired ? '手机已配对。' : '等待手机配对。';
      statusCaption = 'Mobile relay';
    } catch (error) {
      debugPrint('Failed to refresh mobile pairing status: $error');
      lastError = error.toString();
      statusMessage = '手机配对状态刷新失败。';
      statusCaption = 'Mobile relay';
    } finally {
      isMobileRelayBusy = false;
      _notifyStateChanged();
    }
  }

  void startMobileRelayPolling() {
    if (!mobileRelayConfig.hasPairing) {
      return;
    }
    _mobileRelayTimer?.cancel();
    final interval = Duration(
      seconds: mobileRelayConfig.pollIntervalSeconds.clamp(3, 60),
    );
    _mobileRelayTimer = Timer.periodic(interval, (_) {
      unawaited(pollMobileRelayOnce());
    });
    mobileRelayConfig = mobileRelayConfig.copyWith(relayEnabled: true);
    unawaited(
      mobileRelayService.saveConfig(
        agentService: agentService,
        config: mobileRelayConfig,
      ),
    );
    _notifyStateChanged();
  }

  void stopMobileRelayPolling() {
    _mobileRelayTimer?.cancel();
    _mobileRelayTimer = null;
    mobileRelayConfig = mobileRelayConfig.copyWith(relayEnabled: false);
    unawaited(
      mobileRelayService.saveConfig(
        agentService: agentService,
        config: mobileRelayConfig,
      ),
    );
    _notifyStateChanged();
  }

  Future<void> pollMobileRelayOnce() async {
    if (isMobileRelayPolling || !mobileRelayConfig.hasPairing) {
      return;
    }
    isMobileRelayPolling = true;
    lastError = '';
    statusMessage = '正在同步手机中转命令。';
    statusCaption = 'Mobile relay';
    _notifyStateChanged();
    try {
      mobileRelayActionResult = await mobileRelayService.syncCommands(
        agentService: agentService,
      );
      final commandMaps = (mobileRelayActionResult?['commands'] as List? ?? [])
          .whereType<Map<String, dynamic>>()
          .toList();
      final commands = commandMaps.map(MobileRelayCommand.fromJson).toList();
      lastMobileRelayCommands = commands;
      if (commands.any((command) => command.type == 'targets.scan')) {
        scannedTargets = await agentService.scanTargets();
        _selectDefaultConversationAgent();
      }
      final completedSessionAgents = _applyCompletedRelaySessions(
        mobileRelayActionResult,
      );
      for (final agentId in _agentIdsFromRelayCommands(
        commandMaps,
      ).difference(completedSessionAgents)) {
        final sessions = await conversationService.loadSessions(
          agentService: agentService,
          agentId: agentId,
        );
        conversationSessionsByAgent = {
          ...conversationSessionsByAgent,
          agentId: sessions,
        };
        if (selectedConversationAgentId.isEmpty ||
            selectedConversationAgentId == agentId) {
          selectedConversationAgentId = agentId;
          selectedConversationSessionId = sessions.isEmpty
              ? ''
              : sessions.first.id;
        }
      }
      statusMessage = commands.isEmpty
          ? '手机中转已同步，暂无新命令。'
          : '已处理 ${commands.length} 条手机中转命令。';
      statusCaption = 'Mobile relay';
    } catch (error) {
      debugPrint('Failed to poll mobile relay: $error');
      lastError = error.toString();
      statusMessage = '手机中转同步失败。';
      statusCaption = 'Mobile relay';
    } finally {
      isMobileRelayPolling = false;
      _notifyStateChanged();
    }
  }

  Set<String> _applyCompletedRelaySessions(Map<String, dynamic>? result) {
    final agentIds = <String>{};
    final completed = (result?['completed'] as List? ?? [])
        .whereType<Map<String, dynamic>>();
    for (final item in completed) {
      final completion = item['completion'];
      final command = completion is Map ? completion['command'] : null;
      final commandResult = command is Map ? command['result'] : null;
      if (commandResult is! Map) {
        continue;
      }
      final sessionsJson = commandResult['sessions'];
      if (sessionsJson is List) {
        final sessions = sessionsJson
            .whereType<Map<String, dynamic>>()
            .map(AgentConversationSession.fromJson)
            .where((session) => session.agentId.isNotEmpty)
            .toList();
        if (sessions.isEmpty) {
          continue;
        }
        final agentId = sessions.first.agentId;
        conversationSessionsByAgent = {
          ...conversationSessionsByAgent,
          agentId: sessions,
        };
        selectedConversationAgentId = agentId;
        selectedConversationSessionId = sessions.first.id;
        agentIds.add(agentId);
      }
    }
    return agentIds;
  }

  Set<String> _agentIdsFromRelayCommands(List<Map<String, dynamic>> commands) {
    final agentIds = <String>{};
    for (final command in commands) {
      final type = (command['type'] ?? '').toString();
      if (type != 'agent.sessions.list' && type != 'agent.message.send') {
        continue;
      }
      final payload = command['payload'];
      if (payload is! Map) {
        continue;
      }
      final agentId = (payload['agentId'] ?? payload['target'] ?? '')
          .toString()
          .trim();
      if (agentId.isNotEmpty) {
        agentIds.add(agentId);
      }
    }
    return agentIds;
  }
}
