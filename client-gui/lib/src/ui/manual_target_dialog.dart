import 'package:flutter/material.dart';

class ManualTargetDraft {
  const ManualTargetDraft({
    required this.target,
    required this.configPath,
    required this.binaryPath,
  });

  final String target;
  final String configPath;
  final String binaryPath;
}

class ManualTargetDialog extends StatefulWidget {
  const ManualTargetDialog({super.key});

  @override
  State<ManualTargetDialog> createState() => _ManualTargetDialogState();
}

class _ManualTargetDialogState extends State<ManualTargetDialog> {
  static const _targets = [
    ('openclaw', 'OpenClaw'),
    ('claude-code', 'Claude Code'),
    ('codex', 'Codex'),
    ('gemini-cli', 'Gemini CLI'),
    ('antigravity', 'Antigravity'),
    ('opencode', 'OpenCode'),
    ('copilot', 'Copilot'),
    ('kilo-code', 'Kilo Code'),
    ('cursor', 'Cursor'),
    ('hermes', 'Hermes Agent'),
    ('windsurf', 'Windsurf'),
  ];

  final _configPathController = TextEditingController();
  final _binaryPathController = TextEditingController();
  String _target = _targets.first.$1;

  @override
  void dispose() {
    _configPathController.dispose();
    _binaryPathController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add target'),
      key: const Key('manual-target-dialog'),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _target,
              decoration: const InputDecoration(labelText: 'Target'),
              items: [
                for (final target in _targets)
                  DropdownMenuItem(value: target.$1, child: Text(target.$2)),
              ],
              onChanged: (value) {
                if (value == null) {
                  return;
                }
                setState(() {
                  _target = value;
                });
              },
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _configPathController,
              decoration: const InputDecoration(labelText: 'Config path'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _binaryPathController,
              decoration: const InputDecoration(labelText: 'Binary path'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          key: const Key('manual-target-cancel'),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('manual-target-submit'),
          onPressed: _submit,
          child: const Text('Add target'),
        ),
      ],
    );
  }

  void _submit() {
    Navigator.of(context).pop(
      ManualTargetDraft(
        target: _target,
        configPath: _configPathController.text.trim(),
        binaryPath: _binaryPathController.text.trim(),
      ),
    );
  }
}
