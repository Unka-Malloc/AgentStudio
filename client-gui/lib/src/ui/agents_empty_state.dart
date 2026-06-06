import 'package:flutter/material.dart';

import 'theme.dart';

class AgentsEmptyState extends StatelessWidget {
  const AgentsEmptyState({super.key, required this.onAddTarget});

  final VoidCallback onAddTarget;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.smart_toy_outlined,
            color: PactColors.textMuted,
            size: 32,
          ),
          const SizedBox(height: 10),
          const Text(
            'No supported targets detected.',
            style: TextStyle(color: PactColors.textMuted),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: onAddTarget,
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Add target'),
          ),
        ],
      ),
    );
  }
}
