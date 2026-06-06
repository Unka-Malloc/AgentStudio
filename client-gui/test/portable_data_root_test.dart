import 'dart:convert';
import 'dart:io';

import 'package:flutter_client/src/services/portable_data_root.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('creates and updates workspace manifest in override directory', () async {
    final directory = await Directory.systemTemp.createTemp('pact-workspace-override-');
    addTearDown(() => directory.delete(recursive: true));

    final portableData = PortableDataRoot(dataDirectoryOverride: directory);
    final manifest = await portableData.loadWorkspaceManifest();

    final manifestFile = File('${directory.path}/.pact-workspace.json');
    expect(manifestFile.exists(), completion(isTrue));
    expect(manifest.schemaVersion, ClientWorkspaceManifest.currentSchemaVersion);
    expect(manifest.appId, ClientWorkspaceManifest.pactClientAppId);
    expect(manifest.workspaceId, isNotEmpty);

    final refreshed = await portableData.loadWorkspaceManifest();
    expect(refreshed.schemaVersion, manifest.schemaVersion);
    expect(refreshed.appId, manifest.appId);
    expect(refreshed.workspaceId, manifest.workspaceId);
    expect(refreshed.updatedAt.compareTo(manifest.updatedAt), greaterThan(0));
  });

  test('renames malformed manifest and recreates a valid one', () async {
    final directory = await Directory.systemTemp.createTemp('pact-workspace-corrupt-');
    addTearDown(() => directory.delete(recursive: true));
    final manifestFile = File('${directory.path}/.pact-workspace.json');
    await manifestFile.writeAsString('{not-json', flush: true);

    final portableData = PortableDataRoot(dataDirectoryOverride: directory);
    final manifest = await portableData.loadWorkspaceManifest();

    expect(manifest.workspaceId, isNotEmpty);
    final entries = await directory.list().map((e) => e.path).toList();
    expect(entries.any((entry) => entry.contains('.corrupt.')), isTrue);
    expect(manifestFile.exists(), completion(isTrue));
  });

  test('throws when workspace manifest app id is incompatible', () async {
    final directory = await Directory.systemTemp.createTemp('pact-workspace-bad-app-id-');
    addTearDown(() => directory.delete(recursive: true));
    final manifestFile = File('${directory.path}/.pact-workspace.json');
    await manifestFile.writeAsString(jsonEncode({
      'schemaVersion': 1,
      'appId': 'wrong-client',
      'workspaceId': 'workspace-id',
      'createdAt': DateTime(2020).toUtc().toIso8601String(),
      'updatedAt': DateTime(2020).toUtc().toIso8601String(),
    }));

    final portableData = PortableDataRoot(dataDirectoryOverride: directory);
    await expectLater(portableData.loadWorkspaceManifest(), throwsA(isA<StateError>()));
  });

  test('throws when workspace schema version is incompatible', () async {
    final directory = await Directory.systemTemp.createTemp('pact-workspace-bad-schema-');
    addTearDown(() => directory.delete(recursive: true));
    final manifestFile = File('${directory.path}/.pact-workspace.json');
    await manifestFile.writeAsString(jsonEncode({
      'schemaVersion': 999,
      'appId': ClientWorkspaceManifest.pactClientAppId,
      'workspaceId': 'workspace-id',
      'createdAt': DateTime(2020).toUtc().toIso8601String(),
      'updatedAt': DateTime(2020).toUtc().toIso8601String(),
    }));

    final portableData = PortableDataRoot(dataDirectoryOverride: directory);
    await expectLater(portableData.loadWorkspaceManifest(), throwsA(isA<StateError>()));
  });

  test('throws when workspace id is empty', () async {
    final directory = await Directory.systemTemp.createTemp('pact-workspace-empty-id-');
    addTearDown(() => directory.delete(recursive: true));
    final manifestFile = File('${directory.path}/.pact-workspace.json');
    await manifestFile.writeAsString(jsonEncode({
      'schemaVersion': 1,
      'appId': ClientWorkspaceManifest.pactClientAppId,
      'workspaceId': '',
      'createdAt': DateTime(2020).toUtc().toIso8601String(),
      'updatedAt': DateTime(2020).toUtc().toIso8601String(),
    }));

    final portableData = PortableDataRoot(dataDirectoryOverride: directory);
    await expectLater(portableData.loadWorkspaceManifest(), throwsA(isA<StateError>()));
  });

  test('resolves default directory with cache and fallback flow', () async {
    final portableData = PortableDataRoot();
    final first = await portableData.dataDirectory();
    final second = await portableData.dataDirectory();

    expect(first.path, second.path);
    expect(await File('${first.path}/.pact-workspace.json').exists(), isTrue);
  });
}
