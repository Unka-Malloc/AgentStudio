import 'package:flutter/material.dart';

import 'theme.dart';

class AgentsToolbar extends StatelessWidget {
  const AgentsToolbar({
    super.key,
    required this.scanning,
    required this.adding,
    required this.compact,
    required this.onRescan,
    required this.onAddTarget,
  });

  final bool scanning;
  final bool adding;
  final bool compact;
  final VoidCallback onRescan;
  final VoidCallback onAddTarget;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    return Wrap(
      spacing: 12,
      runSpacing: 10,
      alignment: WrapAlignment.spaceBetween,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        ConstrainedBox(
          constraints: BoxConstraints(maxWidth: compact ? 360 : 520),
          child: Text(
            'Agents',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
              color: colors.text,
            ),
          ),
        ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: adding ? null : onAddTarget,
              icon: const Icon(Icons.add, size: 18),
              label: Text(adding ? 'Adding...' : 'Add target'),
            ),
            FilledButton.icon(
              onPressed: scanning ? null : onRescan,
              icon: scanning
                  ? SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: colors.textOnPrimary,
                      ),
                    )
                  : const Icon(Icons.refresh, size: 18),
              label: Text(scanning ? 'Scanning...' : 'Rescan'),
              style: FilledButton.styleFrom(
                backgroundColor: colors.primary,
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
