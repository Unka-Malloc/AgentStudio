import 'dart:convert';
import 'dart:io';

import 'package:flutter_client/src/services/local_runtime_preferences_service.dart';
import 'package:flutter_client/src/services/portable_data_root.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

void main() {
  test('discovers source root and derives preset config', () async {
    final repo = await Directory.systemTemp.createTemp('pact-runtime-repo-');
    final data = await Directory.systemTemp.createTemp('pact-runtime-data-');
    addTearDown(() => repo.delete(recursive: true));
    addTearDown(() => data.delete(recursive: true));
    final presetFile = File(
      p.join(
        repo.path,
        'server',
        'platform',
        'common',
        'composition-management',
        'client-local-runtime.preset.json',
      ),
    );
    await presetFile.parent.create(recursive: true);
    await presetFile.writeAsString('{}', flush: true);
    final nested = Directory(p.join(repo.path, 'client-gui'));
    await nested.create();

    final service = LocalRuntimePreferencesService(
      currentDirectoryOverride: nested.path,
    );
    final preferences = await service.load(
      PortableDataRoot(dataDirectoryOverride: data),
    );

    expect(preferences.sourceRoot, repo.path);
    expect(preferences.presetConfig, presetFile.path);
    expect(preferences.port, LocalRuntimePreferences.defaultPort);
  });

  test('saves and reloads explicit local runtime preferences', () async {
    final data = await Directory.systemTemp.createTemp('pact-runtime-prefs-');
    addTearDown(() => data.delete(recursive: true));
    final portableData = PortableDataRoot(dataDirectoryOverride: data);
    const service = LocalRuntimePreferencesService();

    await service.save(
      portableData,
      const LocalRuntimePreferences(
        sourceRoot: '/repo',
        presetConfig: '/repo/preset.json',
        port: 17329,
      ),
    );

    final loaded = await service.load(portableData);
    expect(loaded.sourceRoot, '/repo');
    expect(loaded.presetConfig, '/repo/preset.json');
    expect(loaded.port, 17329);

    final raw =
        jsonDecode(
              await File(
                p.join(
                  data.path,
                  'future-client',
                  'local-runtime-preferences.json',
                ),
              ).readAsString(),
            )
            as Map<String, dynamic>;
    expect(raw['schemaVersion'], LocalRuntimePreferences.currentSchemaVersion);
  });
}
