import 'dart:convert';
import 'dart:io';

import 'package:flutter_client/src/services/activity_snapshot_service.dart';
import 'package:flutter_client/src/services/portable_data_root.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('returns empty snapshot state when history files are missing', () async {
    final directory = await Directory.systemTemp.createTemp('pact-activity-missing-');
    addTearDown(() async {
      if (await directory.exists()) {
        await directory.delete(recursive: true);
      }
    });
    final portableData = PortableDataRoot(dataDirectoryOverride: directory);

    final state = await const ActivitySnapshotService().load(portableData);

    expect(state.activityPath, contains('activity.jsonl'));
    expect(state.events, isEmpty);
    expect(state.snapshots, isEmpty);
    expect(ActivitySnapshotState.empty(), isNotNull);
  });

  test('sorts snapshots by capturedAt descending', () async {
    final directory = await Directory.systemTemp.createTemp('pact-activity-sort-');
    addTearDown(() async {
      if (await directory.exists()) {
        await directory.delete(recursive: true);
      }
    });
    final portableData = PortableDataRoot(dataDirectoryOverride: directory);
    final snapshotDir = await portableData.snapshotDirectory();
    await snapshotDir.create(recursive: true);

    await File('${snapshotDir.path}/one.json').writeAsString(
      jsonEncode({'snapshotId': 'older', 'capturedAt': '2026-01-01T00:00:00Z'}),
    );
    await File('${snapshotDir.path}/two.json').writeAsString(
      jsonEncode({'snapshotId': 'newest', 'capturedAt': '2026-05-31T00:00:00Z'}),
    );

    final state = await const ActivitySnapshotService().load(portableData);

    expect(state.snapshots, hasLength(2));
    expect(state.snapshots.first['snapshotId'], 'newest');
  });

  test('loads activity and snapshots from the future client state root', () async {
    final directory = await Directory.systemTemp.createTemp('pact-activity-');
    addTearDown(() async {
      if (await directory.exists()) {
        await directory.delete(recursive: true);
      }
    });
    final portableData = PortableDataRoot(dataDirectoryOverride: directory);
    final activityFile = await portableData.activityLogFile();
    await activityFile.parent.create(recursive: true);
    await activityFile.writeAsString(
      [
        jsonEncode({
          'type': 'mcp.config.applied',
          'target': 'opencode',
          'createdAt': '2026-05-31T00:00:00Z',
        }),
        '{not-json',
      ].join('\n'),
    );

    final snapshotDir = await portableData.snapshotDirectory();
    await snapshotDir.create(recursive: true);
    await File('${snapshotDir.path}/one.json').writeAsString(
      jsonEncode({
        'snapshotId': 'snapshot-opencode-1',
        'target': 'opencode',
        'sourcePath': '/tmp/opencode.jsonc',
        'capturedAt': '2026-05-31T00:00:00Z',
      }),
    );

    final state = await const ActivitySnapshotService().load(portableData);

    expect(state.activityPath, activityFile.path);
    expect(state.events, hasLength(1));
    expect(state.events.single['type'], 'mcp.config.applied');
    expect(state.snapshots, hasLength(1));
    expect(state.snapshots.single['snapshotId'], 'snapshot-opencode-1');
  });
}
