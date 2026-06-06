import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class ClientWorkspaceManifest {
  const ClientWorkspaceManifest({
    required this.schemaVersion,
    required this.appId,
    required this.workspaceId,
    required this.createdAt,
    required this.updatedAt,
  });

  static const currentSchemaVersion = 1;
  static const pactClientAppId = 'pact-client';

  final int schemaVersion;
  final String appId;
  final String workspaceId;
  final String createdAt;
  final String updatedAt;

  factory ClientWorkspaceManifest.create() {
    final now = DateTime.now().toUtc().toIso8601String();
    final seed = '$now:$pid:${Directory.current.path}';
    final workspaceId = sha256.convert(utf8.encode(seed)).toString();
    return ClientWorkspaceManifest(
      schemaVersion: currentSchemaVersion,
      appId: pactClientAppId,
      workspaceId: workspaceId,
      createdAt: now,
      updatedAt: now,
    );
  }

  factory ClientWorkspaceManifest.fromJson(Map<String, dynamic> json) {
    return ClientWorkspaceManifest(
      schemaVersion: (json['schemaVersion'] as num?)?.toInt() ?? 0,
      appId: (json['appId'] ?? '').toString(),
      workspaceId: (json['workspaceId'] ?? '').toString(),
      createdAt: (json['createdAt'] ?? '').toString(),
      updatedAt: (json['updatedAt'] ?? '').toString(),
    );
  }

  ClientWorkspaceManifest touch() {
    return ClientWorkspaceManifest(
      schemaVersion: schemaVersion,
      appId: appId,
      workspaceId: workspaceId,
      createdAt: createdAt,
      updatedAt: DateTime.now().toUtc().toIso8601String(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'schemaVersion': schemaVersion,
      'appId': appId,
      'workspaceId': workspaceId,
      'createdAt': createdAt,
      'updatedAt': updatedAt,
    };
  }
}

class PortableDataRoot {
  PortableDataRoot({Directory? dataDirectoryOverride})
    : _dataDirectoryOverride = dataDirectoryOverride;

  static const String _workspaceManifestFileName = '.pact-workspace.json';

  final Directory? _dataDirectoryOverride;
  Directory? _cachedDataDir;

  Future<Directory> dataDirectory() async {
    if (_cachedDataDir != null) {
      return _cachedDataDir!;
    }

    if (_dataDirectoryOverride != null) {
      _cachedDataDir = await _prepareDataDirectory(_dataDirectoryOverride);
      return _cachedDataDir!;
    }

    final override = Platform.environment['PACT_PORTABLE_DIR'];
    if (override != null && override.trim().isNotEmpty) {
      _cachedDataDir = await _prepareDataDirectory(Directory(override.trim()));
      return _cachedDataDir!;
    }

    final executableDirectory = File(Platform.resolvedExecutable).parent;
    final portableDirectory = _portableDirectoryForExecutable(executableDirectory);
    if (await _tryUseDirectory(portableDirectory)) {
      _cachedDataDir = await _prepareDataDirectory(portableDirectory);
      return _cachedDataDir!;
    }

    final appSupport = await getApplicationSupportDirectory();
    final fallback = Directory(p.join(appSupport.path, 'portable-data'));
    _cachedDataDir = await _prepareDataDirectory(fallback);
    return _cachedDataDir!;
  }

  Future<Directory> futureClientDirectory() async {
    final dataDir = await dataDirectory();
    final directory = Directory(p.join(dataDir.path, 'future-client'));
    await directory.create(recursive: true);
    return directory;
  }

  Future<File> activityLogFile() async {
    final root = await futureClientDirectory();
    return File(p.join(root.path, 'activity', 'activity.jsonl'));
  }

  Future<Directory> snapshotDirectory() async {
    final root = await futureClientDirectory();
    return Directory(p.join(root.path, 'snapshots'));
  }

  Future<ClientWorkspaceManifest> loadWorkspaceManifest() async {
    final directory = await dataDirectory();
    return _loadOrCreateWorkspaceManifest(directory);
  }

  Future<Directory> _prepareDataDirectory(Directory directory) async {
    await directory.create(recursive: true);
    await _loadOrCreateWorkspaceManifest(directory);
    return directory;
  }

  Future<ClientWorkspaceManifest> _loadOrCreateWorkspaceManifest(
    Directory directory,
  ) async {
    final file = File(p.join(directory.path, _workspaceManifestFileName));
    if (await file.exists()) {
      ClientWorkspaceManifest? manifest;
      try {
        final raw = await file.readAsString();
        manifest = ClientWorkspaceManifest.fromJson(
          jsonDecode(raw) as Map<String, dynamic>,
        );
      } catch (_) {
        final corruptFile = File(
          '${file.path}.corrupt.${DateTime.now().toUtc().microsecondsSinceEpoch}',
        );
        await file.rename(corruptFile.path);
      }
      if (manifest != null) {
        if (manifest.appId != ClientWorkspaceManifest.pactClientAppId ||
            manifest.schemaVersion >
                ClientWorkspaceManifest.currentSchemaVersion ||
            manifest.workspaceId.isEmpty) {
          throw StateError('不是 Pact 客户端工作空间：${directory.path}');
        }
        final touched = manifest.touch();
        await _writeJsonAtomically(file, touched.toJson());
        return touched;
      }
    }

    final manifest = ClientWorkspaceManifest.create();
    await _writeJsonAtomically(file, manifest.toJson());
    return manifest;
  }

  Directory _portableDirectoryForExecutable(Directory executableDirectory) {
    final contentsDirectory = executableDirectory.parent;
    final appBundleDirectory = contentsDirectory.parent;
    final isBundledMacExecutable =
        p.basename(executableDirectory.path) == 'MacOS' &&
        p.basename(contentsDirectory.path) == 'Contents' &&
        p.extension(appBundleDirectory.path) == '.app';

    if (isBundledMacExecutable) {
      return Directory(p.join(appBundleDirectory.parent.path, 'portable-data'));
    }

    return Directory(p.join(executableDirectory.path, 'portable-data'));
  }

  Future<bool> _tryUseDirectory(Directory directory) async {
    try {
      await directory.create(recursive: true);
      final probe = File(p.join(directory.path, '.pact-probe'));
      await probe.writeAsString('ok');
      await probe.delete();
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> _writeJsonAtomically(File file, Object? value) {
    return _writeTextAtomically(
      file,
      const JsonEncoder.withIndent('  ').convert(value),
    );
  }

  Future<void> _writeTextAtomically(File file, String contents) async {
    await file.parent.create(recursive: true);
    final lock = File(p.join(file.parent.path, '${p.basename(file.path)}.lock'));
    final lockHandle = await lock.open(mode: FileMode.write);
    try {
      await lockHandle.lock(FileLock.exclusive);
      final temp = File(
        p.join(
          file.parent.path,
          '.${p.basename(file.path)}.$pid.${DateTime.now().toUtc().microsecondsSinceEpoch}.tmp',
        ),
      );
      await temp.writeAsString(contents, flush: true);
      await temp.rename(file.path);
    } finally {
      try {
        await lockHandle.unlock();
      } finally {
        await lockHandle.close();
      }
    }
  }
}
