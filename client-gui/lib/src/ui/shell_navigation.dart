import 'package:flutter/material.dart';

import '../controllers/future_client_controller.dart';
import '../models/future_client_models.dart';
import 'theme.dart';

class ShellSidebar extends StatelessWidget {
  const ShellSidebar({super.key, required this.current, required this.onSelect});

  final FutureClientSection current;
  final ValueChanged<FutureClientSection> onSelect;

  @override
  Widget build(BuildContext context) {
    const items = [
      (FutureClientSection.agents, 'Agents', Icons.smart_toy_outlined),
      (FutureClientSection.mcpPlugins, 'MCP Plugins', Icons.extension_outlined),
      (FutureClientSection.skillHub, 'Skill Hub', Icons.library_books_outlined),
      (FutureClientSection.modelForwarding, 'Model Forwarding', Icons.send_outlined),
      (FutureClientSection.activity, 'Activity', Icons.history_outlined),
      (FutureClientSection.settings, 'Settings', Icons.settings_outlined),
    ];
    return Container(
      width: 220,
      decoration: const BoxDecoration(
        color: PactColors.surfaceLow,
        border: Border(right: BorderSide(color: PactColors.line)),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(8, 8, 8, 18),
            child: Text(
              'Pact',
              style: TextStyle(
                color: PactColors.primary,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          for (final item in items)
            _NavButton(
              selected: current == item.$1,
              icon: item.$3,
              label: item.$2,
              onPressed: () => onSelect(item.$1),
            ),
        ],
      ),
    );
  }
}

class ShellTopBar extends StatelessWidget {
  const ShellTopBar({super.key, required this.section});

  final FutureClientSection section;

  @override
  Widget build(BuildContext context) {
    final title = switch (section) {
      FutureClientSection.agents => 'Agents',
      FutureClientSection.mcpPlugins => 'MCP Plugins',
      FutureClientSection.skillHub => 'Skill Hub',
      FutureClientSection.modelForwarding => 'Model Forwarding',
      FutureClientSection.activity => 'Activity And Snapshots',
      FutureClientSection.settings => 'Settings',
    };
    return Container(
      height: 64,
      alignment: Alignment.centerLeft,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      decoration: const BoxDecoration(
        color: PactColors.background,
        border: Border(bottom: BorderSide(color: PactColors.line)),
      ),
      child: Text(
        title,
        style: Theme.of(
          context,
        ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
      ),
    );
  }
}

class ShellStatusBar extends StatelessWidget {
  const ShellStatusBar({super.key, required this.controller});

  final FutureClientController controller;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      alignment: Alignment.centerLeft,
      decoration: const BoxDecoration(
        color: PactColors.surfaceLow,
        border: Border(top: BorderSide(color: PactColors.line)),
      ),
      child: Text(
        controller.statusMessage.isEmpty
            ? controller.statusCaption
            : controller.statusMessage,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.bodySmall,
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.selected,
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  final bool selected;
  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: TextButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 18),
        label: Align(alignment: Alignment.centerLeft, child: Text(label)),
        style: TextButton.styleFrom(
          alignment: Alignment.centerLeft,
          foregroundColor: selected ? PactColors.primary : PactColors.text,
          backgroundColor: selected
              ? PactColors.primaryFixed
              : Colors.transparent,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          minimumSize: const Size.fromHeight(42),
        ),
      ),
    );
  }
}
