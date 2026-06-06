part of 'future_client_controller.dart';

extension FutureClientSkillHubActions on FutureClientController {
  Future<void> refreshSkillHub(String agent) async {
    await _runSkillHubAction('正在刷新 Skill Hub。', () async {
      final pairings = await agentService.listPairings(agent: agent);
      final skills = await agentService.listSkills(agent: agent);
      skillHubPairings = pairings;
      skillHubSkills = skills;
      skillHubActionResult = {
        'ok': true,
        'agent': agent,
        'pairings': pairings.length,
        'skills': skills.length,
      };
      statusMessage = '已刷新 $agent 的 Skill Hub 状态。';
    });
  }

  Future<void> requestSkillHubPairing(
    String agent, {
    String target = '',
  }) async {
    await _runSkillHubAction('正在请求 Skill Hub 配对。', () async {
      skillHubActionResult = await agentService.requestPairing(
        agent: agent,
        target: target,
      );
      skillHubPairings = await agentService.listPairings(agent: agent);
      statusMessage = '已请求 $agent 配对。';
    });
  }

  Future<void> approveSkillHubPairing(String agent) async {
    await _runSkillHubAction('正在批准 Skill Hub 配对。', () async {
      skillHubActionResult = await agentService.approvePairing(agent: agent);
      skillHubPairings = await agentService.listPairings(agent: agent);
      skillHubSkills = await agentService.listSkills(agent: agent);
      statusMessage = '已批准 $agent 配对。';
    });
  }

  Future<void> revokeSkillHubPairing(String agent) async {
    await _runSkillHubAction('正在撤销 Skill Hub 配对。', () async {
      skillHubActionResult = await agentService.revokePairing(agent: agent);
      skillHubPairings = await agentService.listPairings(agent: agent);
      skillHubSkills = const [];
      statusMessage = '已撤销 $agent 配对。';
    });
  }

  Future<void> _runSkillHubAction(
    String busyMessage,
    Future<void> Function() action,
  ) async {
    if (isSkillHubBusy) {
      return;
    }
    isSkillHubBusy = true;
    lastError = '';
    statusMessage = busyMessage;
    statusCaption = 'Skill Hub';
    _notifyStateChanged();
    try {
      await action();
      statusCaption = 'Skill Hub';
    } catch (error) {
      debugPrint('Failed to run Skill Hub action: $error');
      lastError = error.toString();
      statusMessage = 'Skill Hub 操作失败。';
      statusCaption = 'Skill Hub';
    } finally {
      isSkillHubBusy = false;
      _notifyStateChanged();
    }
  }
}
