import 'package:flutter/material.dart';

import '../controllers/future_client_controller.dart';
import 'panel_frame.dart';

class SkillHubPanel extends StatefulWidget {
  const SkillHubPanel({super.key, required this.controller});

  final FutureClientController controller;

  @override
  State<SkillHubPanel> createState() => _SkillHubPanelState();
}

class _SkillHubPanelState extends State<SkillHubPanel> {
  final TextEditingController _agentController = TextEditingController(text: 'codex');
  final TextEditingController _targetController = TextEditingController(text: 'manual');

  @override
  void dispose() {
    _agentController.dispose();
    _targetController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return PanelFrame(
      child: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.library_books_outlined),
            title: const Text('Skill Hub'),
            subtitle: const Text('Pair agents and inspect visible skills from portable state.'),
            trailing: IconButton(
              tooltip: 'Refresh Skill Hub',
              onPressed: controller.isSkillHubBusy ? null : _refresh,
              icon: controller.isSkillHubBusy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.refresh),
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 12,
              runSpacing: 12,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                _PanelTextField(
                  controller: _agentController,
                  label: 'Agent',
                  width: 180,
                ),
                _PanelTextField(
                  controller: _targetController,
                  label: 'Target',
                  width: 180,
                ),
                OutlinedButton.icon(
                  onPressed: controller.isSkillHubBusy ? null : _request,
                  icon: const Icon(Icons.link_outlined, size: 18),
                  label: const Text('Request'),
                ),
                FilledButton.icon(
                  onPressed: controller.isSkillHubBusy ? null : _approve,
                  icon: const Icon(Icons.verified_user_outlined, size: 18),
                  label: const Text('Approve'),
                ),
                OutlinedButton.icon(
                  onPressed: controller.isSkillHubBusy ? null : _revoke,
                  icon: const Icon(Icons.link_off_outlined, size: 18),
                  label: const Text('Revoke'),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          _SectionHeader(
            title: 'Pairings',
            count: controller.skillHubPairings.length,
          ),
          for (final pairing in controller.skillHubPairings)
            ListTile(
              dense: true,
              title: Text((pairing['agentId'] ?? '').toString()),
              subtitle: Text((pairing['target'] ?? '').toString()),
              trailing: Text((pairing['status'] ?? '').toString()),
            ),
          _SectionHeader(
            title: 'Visible Skills',
            count: controller.skillHubSkills.length,
          ),
          for (final skill in controller.skillHubSkills)
            ListTile(
              dense: true,
              title: Text((skill['skillId'] ?? '').toString()),
              subtitle: Text((skill['version'] ?? skill['path'] ?? '').toString()),
              trailing: Text((skill['protocolStatus'] ?? 'visible').toString()),
            ),
        ],
      ),
    );
  }

  String get _agent => _agentController.text.trim();
  String get _target => _targetController.text.trim();

  void _refresh() => widget.controller.refreshSkillHub(_agent);
  void _request() => widget.controller.requestSkillHubPairing(_agent, target: _target);
  void _approve() => widget.controller.approveSkillHubPairing(_agent);
  void _revoke() => widget.controller.revokeSkillHubPairing(_agent);
}

class _PanelTextField extends StatelessWidget {
  const _PanelTextField({
    required this.controller,
    required this.label,
    required this.width,
  });

  final TextEditingController controller;
  final String label;
  final double width;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: TextField(
        controller: controller,
        decoration: InputDecoration(
          isDense: true,
          labelText: label,
          border: const OutlineInputBorder(),
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.count});

  final String title;
  final int count;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      title: Text(title),
      trailing: Text('$count'),
    );
  }
}
