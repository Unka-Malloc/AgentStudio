import 'package:flutter/material.dart';

import 'theme.dart';

class AgentsToolbar extends StatelessWidget {
  const AgentsToolbar({
    super.key,
    required this.scanning,
    required this.adding,
    required this.onRescan,
    required this.onAddTarget,
  });

  final bool scanning;
  final bool adding;
  final VoidCallback onRescan;
  final VoidCallback onAddTarget;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          'Agents',
          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.bold,
                color: PactColors.text,
              ),
        ),
        Wrap(
          spacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: adding ? null : onAddTarget,
              icon: const Icon(Icons.add, size: 18),
              label: Text(adding ? 'Adding...' : 'Add target'),
            ),
            FilledButton.icon(
              onPressed: scanning ? null : onRescan,
              icon: scanning
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.refresh, size: 18),
              label: Text(scanning ? 'Scanning...' : 'Rescan'),
              style: FilledButton.styleFrom(
                backgroundColor: PactColors.primary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
