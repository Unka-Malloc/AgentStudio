import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'portable_data_root.dart';

class LocalRuntimePreferences {
  const LocalRuntimePreferences({
    required this.sourceRoot,
    required this.presetConfig,
    this.port = defaultPort,
  });

  static const currentSchemaVersion = 1;
  static const defaultPort = 17328;

  final String sourceRoot;
  final String presetConfig;
  final int port;

  factory LocalRuntimePreferences.defaults() {
    return const LocalRuntimePreferences(sourceRoot: '', presetConfig: '');
  }

  factory LocalRuntimePreferences.fromJson(Map<String, dynamic> json) {
    return LocalRuntimePreferences(
      sourceRoot: (json['sourceRoot'] ?? '').toString(),
      presetConfig: (json['presetConfig'] ?? '').toString(),
      port: _normalizePort(json['port']),
    );
  }

  LocalRuntimePreferences copyWith({
    String? sourceRoot,
    String? presetConfig,
    int? port,
  }) {
    return LocalRuntimePreferences(
      sourceRoot: sourceRoot ?? this.sourceRoot,
      presetConfig: presetConfig ?? this.presetConfig,
      port: port ?? this.port,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'schemaVersion': currentSchemaVersion,
      'sourceRoot': sourceRoot,
      'presetConfig': presetConfig,
      'port': port,
    };
  }

  static int _normalizePort(Object? value) {
    final number = value is num
        ? value.toInt()
        : int.tryParse((value ?? '').toString());
    if (number == null || number <= 0 || number > 65535) {
      return defaultPort;
    }
    return number;
  }
}

class LocalRuntimePreferencesService {
  const LocalRuntimePreferencesService({
    Map<String, String>? environmentOverride,
    String? currentDirectoryOverride,
  }) : _environmentOverride = environmentOverride,
       _currentDirectoryOverride = currentDirectoryOverride;

  static const _fileName = 'local-runtime-preferences.json';
  static const _presetRelativePath =
      'server/platform/common/composition-management/client-local-runtime.preset.json';

  final Map<String, String>? _environmentOverride;
  final String? _currentDirectoryOverride;

  Future<LocalRuntimePreferences> load(PortableDataRoot portableData) async {
    final file = await _preferencesFile(portableData);
    if (await file.exists()) {
      try {
        final json = jsonDecode(await file.readAsString());
        if (json is Map<String, dynamic>) {
          return _normalize(LocalRuntimePreferences.fromJson(json));
        }
      } catch (_) {
        return _defaultPreferences();
      }
    }
    return _defaultPreferences();
  }

  Future<void> save(
    PortableDataRoot portableData,
    LocalRuntimePreferences preferences,
  ) async {
    final file = await _preferencesFile(portableData);
    await file.parent.create(recursive: true);
    final temp = File(
      p.join(
        file.parent.path,
        '.${p.basename(file.path)}.${DateTime.now().toUtc().microsecondsSinceEpoch}.tmp',
      ),
    );
    await temp.writeAsString(
      const JsonEncoder.withIndent(
        '  ',
      ).convert(_normalize(preferences).toJson()),
      flush: true,
    );
    await temp.rename(file.path);
  }

  LocalRuntimePreferences _defaultPreferences() {
    final sourceRoot = _sourceRootFromEnvironment() ?? _discoverSourceRoot();
    return _normalize(
      LocalRuntimePreferences(sourceRoot: sourceRoot ?? '', presetConfig: ''),
    );
  }

  LocalRuntimePreferences _normalize(LocalRuntimePreferences preferences) {
    final sourceRoot = preferences.sourceRoot.trim();
    final presetConfig = preferences.presetConfig.trim().isNotEmpty
        ? preferences.presetConfig.trim()
        : _presetForSourceRoot(sourceRoot);
    return LocalRuntimePreferences(
      sourceRoot: sourceRoot,
      presetConfig: presetConfig,
      port: preferences.port,
    );
  }

  String? _sourceRootFromEnvironment() {
    final value =
        (_environmentOverride ?? Platform.environment)['PACT_SOURCE_ROOT'];
    if (value == null || value.trim().isEmpty) {
      return null;
    }
    return value.trim();
  }

  String? _discoverSourceRoot() {
    var directory = Directory(
      _currentDirectoryOverride ?? Directory.current.path,
    );
    while (true) {
      if (File(p.join(directory.path, _presetRelativePath)).existsSync()) {
        return directory.path;
      }
      final parent = directory.parent;
      if (parent.path == directory.path) {
        return null;
      }
      directory = parent;
    }
  }

  String _presetForSourceRoot(String sourceRoot) {
    if (sourceRoot.isEmpty) {
      return '';
    }
    return p.join(sourceRoot, _presetRelativePath);
  }

  Future<File> _preferencesFile(PortableDataRoot portableData) async {
    final root = await portableData.futureClientDirectory();
    return File(p.join(root.path, _fileName));
  }
}
