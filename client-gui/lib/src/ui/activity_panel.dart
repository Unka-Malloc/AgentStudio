import 'package:flutter/material.dart';

import '../services/activity_snapshot_service.dart';
import 'panel_frame.dart';

class ActivityPanel extends StatelessWidget {
  const ActivityPanel({
    super.key,
    required this.state,
    required this.onRefresh,
    required this.onRestoreSnapshot,
  });

  final ActivitySnapshotState state;
  final VoidCallback onRefresh;
  final ValueChanged<String> onRestoreSnapshot;

  @override
  Widget build(BuildContext context) {
    return PanelFrame(
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.history_outlined),
            title: const Text('Activity'),
            subtitle: Text(state.activityPath),
            trailing: IconButton(
              tooltip: 'Refresh',
              onPressed: onRefresh,
              icon: const Icon(Icons.refresh),
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView(
              children: [
                for (final event in state.events)
                  ListTile(
                    dense: true,
                    title: Text((event['type'] ?? '').toString()),
                    subtitle: Text((event['createdAt'] ?? '').toString()),
                    trailing: Text((event['target'] ?? '').toString()),
                  ),
                const Divider(height: 1),
                for (final snapshot in state.snapshots)
                  _SnapshotTile(
                    snapshot: snapshot,
                    onRestoreSnapshot: onRestoreSnapshot,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SnapshotTile extends StatelessWidget {
  const _SnapshotTile({
    required this.snapshot,
    required this.onRestoreSnapshot,
  });

  final Map<String, dynamic> snapshot;
  final ValueChanged<String> onRestoreSnapshot;

  @override
  Widget build(BuildContext context) {
    final snapshotId = (snapshot['snapshotId'] ?? '').toString();
    final target = (snapshot['target'] ?? '').toString();
    return ListTile(
      dense: true,
      leading: const Icon(Icons.restore_outlined),
      title: Text(snapshotId),
      subtitle: Text((snapshot['sourcePath'] ?? '').toString()),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(target),
          const SizedBox(width: 8),
          IconButton(
            tooltip: 'Restore snapshot',
            onPressed: snapshotId.isEmpty
                ? null
                : () => onRestoreSnapshot(snapshotId),
            icon: const Icon(Icons.settings_backup_restore_outlined),
          ),
        ],
      ),
    );
  }
}
