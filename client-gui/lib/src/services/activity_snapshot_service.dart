import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'portable_data_root.dart';

class ActivitySnapshotState {
  const ActivitySnapshotState({
    required this.activityPath,
    required this.events,
    required this.snapshots,
  });

  final String activityPath;
  final List<Map<String, dynamic>> events;
  final List<Map<String, dynamic>> snapshots;

  factory ActivitySnapshotState.empty() {
    return const ActivitySnapshotState(
      activityPath: '',
      events: [],
      snapshots: [],
    );
  }
}

class ActivitySnapshotService {
  const ActivitySnapshotService();

  Future<ActivitySnapshotState> load(PortableDataRoot portableData) async {
    final activityFile = await portableData.activityLogFile();
    final events = await _readActivityEvents(activityFile);
    final snapshotDir = await portableData.snapshotDirectory();
    final snapshots = await _readSnapshots(snapshotDir);
    return ActivitySnapshotState(
      activityPath: activityFile.path,
      events: events,
      snapshots: snapshots,
    );
  }

  Future<List<Map<String, dynamic>>> _readActivityEvents(File file) async {
    if (!await file.exists()) {
      return const [];
    }

    final events = <Map<String, dynamic>>[];
    final lines = await file.readAsLines();
    for (final line in lines.reversed.take(80)) {
      final decoded = _tryDecodeMap(line);
      if (decoded != null) {
        events.add(decoded);
      }
    }
    return events;
  }

  Future<List<Map<String, dynamic>>> _readSnapshots(Directory directory) async {
    if (!await directory.exists()) {
      return const [];
    }

    final snapshots = <Map<String, dynamic>>[];
    await for (final entity in directory.list()) {
      if (entity is! File || p.extension(entity.path) != '.json') {
        continue;
      }
      final decoded = _tryDecodeMap(await entity.readAsString());
      if (decoded != null) {
        snapshots.add(decoded);
      }
    }
    snapshots.sort((left, right) {
      return (right['capturedAt'] ?? '')
          .toString()
          .compareTo((left['capturedAt'] ?? '').toString());
    });
    return snapshots;
  }

  Map<String, dynamic>? _tryDecodeMap(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) {
      return null;
    }
    try {
      final decoded = jsonDecode(trimmed);
      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }
    } catch (_) {
      return null;
    }
    return null;
  }
}
