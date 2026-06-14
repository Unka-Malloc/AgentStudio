import 'dart:convert';
import 'dart:io';

import 'package:flutter_client/src/services/activity_snapshot_service.dart';
import 'package:flutter_client/src/services/agent_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('loads activity and snapshots through pact-client CLI', () async {
    final captured = <List<String>>[];
    final agentService = AgentService(
      runCliExecutable: (executable, args, env) async {
        captured.add(List<String>.from(args));
        if (args.first == 'activity') {
          return ProcessResult(
            0,
            0,
            jsonEncode({
              'ok': true,
              'path': '/tmp/activity.jsonl',
              'events': [
                {'type': 'mcp.config.applied', 'target': 'opencode'},
              ],
            }),
            '',
          );
        }
        return ProcessResult(
          0,
          0,
          jsonEncode({
            'ok': true,
            'snapshots': [
              {'snapshotId': 'snapshot-opencode-1', 'target': 'opencode'},
            ],
          }),
          '',
        );
      },
    );

    final state = await const ActivitySnapshotService().load(agentService);

    expect(state.activityPath, '/tmp/activity.jsonl');
    expect(state.events.single['type'], 'mcp.config.applied');
    expect(state.snapshots.single['snapshotId'], 'snapshot-opencode-1');
    expect(captured[0], ['activity', 'list', '--limit', '80']);
    expect(captured[1], ['snapshots', 'list']);
    expect(ActivitySnapshotState.empty(), isNotNull);
  });

  test('returns empty lists for malformed CLI payloads', () async {
    final agentService = AgentService(
      runCliExecutable: (executable, args, env) async {
        return ProcessResult(0, 0, jsonEncode({'ok': false}), '');
      },
    );

    final state = await const ActivitySnapshotService().load(agentService);

    expect(state.events, isEmpty);
    expect(state.snapshots, isEmpty);
  });
}
