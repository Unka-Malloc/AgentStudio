part of 'agent_service.dart';

mixin AgentServiceActions {
  Future<Map<String, dynamic>> mcpPluginStatus({
    required String target,
    String configPath = '',
  }) async {
    final args = ['mcp', 'plugin', 'status', '--target', target];
    _appendOptionalArg(args, '--config-path', configPath);
    return (this as AgentService)._runCli(args);
  }

  Future<Map<String, dynamic>> updateMcpPlugin({
    required String target,
    String configPath = '',
  }) async {
    final args = ['mcp', 'plugin', 'update', '--target', target];
    _appendOptionalArg(args, '--config-path', configPath);
    return (this as AgentService)._runCli(args);
  }

  Future<Map<String, dynamic>> rollbackMcpPlugin({
    required String target,
    required String snapshotId,
    String configPath = '',
  }) async {
    final args = [
      'mcp',
      'plugin',
      'rollback',
      '--target',
      target,
      '--snapshot-id',
      snapshotId,
    ];
    _appendOptionalArg(args, '--config-path', configPath);
    return (this as AgentService)._runCli(args);
  }

  Future<List<Map<String, dynamic>>> listSnapshots({String target = ''}) async {
    final args = ['snapshots', 'list'];
    _appendOptionalArg(args, '--target', target);
    final output = await (this as AgentService)._runCli(args);
    return _listFromOutput(output, 'snapshots');
  }

  Future<List<Map<String, dynamic>>> listPairings({String agent = ''}) async {
    final args = ['pair', 'list'];
    _appendOptionalArg(args, '--agent', agent);
    final output = await (this as AgentService)._runCli(args);
    return _listFromOutput(output, 'pairings');
  }

  Future<Map<String, dynamic>> requestPairing({
    required String agent,
    String target = '',
  }) async {
    final args = ['pair', 'request', '--agent', agent];
    _appendOptionalArg(args, '--target', target);
    return (this as AgentService)._runCli(args);
  }

  Future<Map<String, dynamic>> approvePairing({required String agent}) async {
    return (this as AgentService)._runCli(['pair', 'approve', '--agent', agent]);
  }

  Future<Map<String, dynamic>> revokePairing({required String agent}) async {
    return (this as AgentService)._runCli(['pair', 'revoke', '--agent', agent]);
  }

  Future<List<Map<String, dynamic>>> listSkills({required String agent}) async {
    final output = await (this as AgentService)._runCli([
      'skill',
      'list',
      '--agent',
      agent,
    ]);
    return _listFromOutput(output, 'skills');
  }

  Future<List<Map<String, dynamic>>> listModelProfiles() async {
    final output = await (this as AgentService)._runCli([
      'model',
      'profiles',
      'list',
    ]);
    return _listFromOutput(output, 'profiles');
  }

  Future<Map<String, dynamic>> saveCommandModelProfile({
    required String profileId,
    required String command,
  }) async {
    return (this as AgentService)._runCli([
      'model',
      'profiles',
      'set',
      profileId,
      '--command',
      command,
    ]);
  }

  Future<Map<String, dynamic>> forwardText({
    required String profileId,
    required String text,
  }) async {
    return (this as AgentService)._runCli([
      'forward',
      '--profile',
      profileId,
      '--text',
      text,
    ]);
  }

  void _appendOptionalArg(List<String> args, String flag, String value) {
    final trimmed = value.trim();
    if (trimmed.isNotEmpty) {
      args.addAll([flag, trimmed]);
    }
  }

  List<Map<String, dynamic>> _listFromOutput(
    Map<String, dynamic> output,
    String key,
  ) {
    if (output['ok'] == true && output[key] is List) {
      return (output[key] as List).whereType<Map<String, dynamic>>().toList();
    }
    return [];
  }
}
