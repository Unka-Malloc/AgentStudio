import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;

part 'agent_service_actions.dart';

typedef _RunCliExecutable = Future<ProcessResult> Function(
  String executable,
  List<String> args,
  Map<String, String>? environment,
);
typedef _ResolveCliBinary = Future<File?> Function();

class TargetCandidate {
  final String target;
  final String label;
  final String kind;
  final String status;
  final bool configured;
  final double confidence;
  final String? detail;
  final String? configPath;
  final String? binaryPath;
  final bool manual;
  final String adapterStatus;

  TargetCandidate({
    required this.target,
    required this.label,
    required this.kind,
    required this.status,
    required this.configured,
    required this.confidence,
    this.detail,
    this.configPath,
    this.binaryPath,
    this.manual = false,
    required this.adapterStatus,
  });

  factory TargetCandidate.fromJson(Map<String, dynamic> json) {
    return TargetCandidate(
      target: (json['target'] ?? '').toString(),
      label: (json['label'] ?? '').toString(),
      kind: (json['kind'] ?? '').toString(),
      status: (json['status'] ?? '').toString(),
      configured: json['configured'] == true,
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
      detail: json['detail']?.toString(),
      configPath: json['configPath']?.toString(),
      binaryPath: json['binaryPath']?.toString(),
      manual: json['manual'] == true,
      adapterStatus: (json['adapterStatus'] ?? '').toString(),
    );
  }
}

class AgentService with AgentServiceActions {
  AgentService({
    Future<String> Function()? dataDirectory,
    Future<File?> Function()? resolveCliBinary,
    Future<ProcessResult> Function(String executable, List<String> args, Map<String, String>? environment)?
        runCliExecutable,
  }) : _dataDirectory = dataDirectory,
       _resolveCliBinaryOverride = resolveCliBinary,
       _runCliExecutable = runCliExecutable ?? _defaultRunCliExecutable;

  final Future<String> Function()? _dataDirectory;
  final _ResolveCliBinary? _resolveCliBinaryOverride;
  final _RunCliExecutable _runCliExecutable;

  static Future<ProcessResult> _defaultRunCliExecutable(
    String executable,
    List<String> args,
    Map<String, String>? environment,
  ) {
    return Process.run(executable, args, environment: environment);
  }

  Future<File?> _resolveCliBinary() async {
    final resolveCliBinaryOverride = _resolveCliBinaryOverride;
    if (resolveCliBinaryOverride != null) {
      return resolveCliBinaryOverride();
    }

    final suffix = Platform.isWindows ? '.exe' : '';
    final override = Platform.environment['PACT_CLIENT_PATH'];
    final candidates = <String>[
      if (override != null && override.trim().isNotEmpty) override.trim(),
      p.join(
        File(Platform.resolvedExecutable).parent.path,
        'pact-client$suffix',
      ),
      p.join(
        Directory.current.path,
        '..',
        'client-cli',
        'target',
        'debug',
        'pact-client$suffix',
      ),
      p.join(
        Directory.current.path,
        'client-cli',
        'target',
        'debug',
        'pact-client$suffix',
      ),
    ];
    for (final candidate in candidates) {
      final file = File(p.normalize(candidate));
      if (await file.exists()) {
        return file;
      }
    }
    return null;
  }

  Future<Map<String, dynamic>> _runCli(List<String> args) async {
    final cli = await _resolveCliBinary();
    
    Map<String, String>? env;
    if (_dataDirectory != null) {
      final dir = await _dataDirectory();
      env = {'PACT_PORTABLE_DIR': dir};
    }
    
    if (cli == null) {
      // Fallback to expecting pact-client in PATH
      try {
        final result = await _runCliExecutable('pact-client', args, env);
        if (result.exitCode != 0) {
          throw Exception('pact-client failed: ${result.stderr}');
        }
        return jsonDecode(result.stdout as String) as Map<String, dynamic>;
      } catch (e) {
        throw Exception('pact-client not found. Make sure it is compiled. $e');
      }
    }

    final result = await _runCliExecutable(cli.path, args, env);
    if (result.exitCode != 0) {
      throw Exception('pact-client failed: ${result.stderr}');
    }
    return jsonDecode(result.stdout as String) as Map<String, dynamic>;
  }

  Future<List<TargetCandidate>> scanTargets() async {
    final output = await _runCli(['targets', 'scan']);
    if (output['ok'] == true && output['candidates'] is List) {
      final list = output['candidates'] as List;
      return list
          .whereType<Map<String, dynamic>>()
          .map((json) => TargetCandidate.fromJson(json))
          .toList();
    }
    return [];
  }

  Future<Map<String, dynamic>> addTarget({
    required String target,
    String configPath = '',
    String binaryPath = '',
  }) async {
    final args = ['targets', 'add', '--target', target];
    if (configPath.trim().isNotEmpty) {
      args.addAll(['--config-path', configPath.trim()]);
    }
    if (binaryPath.trim().isNotEmpty) {
      args.addAll(['--binary-path', binaryPath.trim()]);
    }
    return _runCli(args);
  }

  Future<Map<String, dynamic>> inspectTarget(String target) async {
    return _runCli(['targets', 'inspect', target]);
  }

  Future<Map<String, dynamic>> planTargetConfig(String target) async {
    return _runCli(['mcp', 'config', 'plan', '--target', target]);
  }

  Future<Map<String, dynamic>> restoreSnapshot(String snapshotId) async {
    return _runCli(['snapshots', 'restore', snapshotId]);
  }
}
