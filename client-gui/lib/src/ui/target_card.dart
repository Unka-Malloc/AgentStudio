import 'package:flutter/material.dart';

import '../services/agent_service.dart';
import 'theme.dart';

class TargetCard extends StatelessWidget {
  const TargetCard({
    super.key,
    required this.target,
    required this.onInspect,
    required this.onPlan,
  });

  final TargetCandidate target;
  final ValueChanged<String> onInspect;
  final ValueChanged<String> onPlan;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    return Card(
      elevation: 0,
      color: colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: colors.line),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _TargetIcon(manual: target.manual),
                const SizedBox(width: 12),
                Expanded(child: _TargetTitle(target: target)),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 12,
              runSpacing: 10,
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 220),
                  child: Text(
                    _targetStatusLabel(target),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: colors.textMuted, fontSize: 12),
                  ),
                ),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    TextButton(
                      onPressed: () => onInspect(target.target),
                      child: const Text('Inspect'),
                    ),
                    FilledButton(
                      onPressed: () => onPlan(target.target),
                      style: FilledButton.styleFrom(
                        backgroundColor: colors.primary,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(6),
                        ),
                        minimumSize: const Size(80, 32),
                      ),
                      child: const Text('Plan', style: TextStyle(fontSize: 13)),
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _targetStatusLabel(TargetCandidate target) {
    return switch (target.status) {
      'configured' => 'Configured',
      'detected' => 'Detected',
      'manual' => 'Manual',
      _ => 'Not detected',
    };
  }
}

class _TargetIcon extends StatelessWidget {
  const _TargetIcon({required this.manual});

  final bool manual;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: colors.surfaceLow,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Icon(
        manual ? Icons.edit_location_alt_outlined : Icons.smart_toy_outlined,
        color: colors.primary,
      ),
    );
  }
}

class _TargetTitle extends StatelessWidget {
  const _TargetTitle({required this.target});

  final TargetCandidate target;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    final configured = target.configured;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          target.label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
        ),
        Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: configured ? colors.success : colors.textMuted,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              configured ? 'Configured' : 'Not configured',
              style: TextStyle(
                color: configured ? colors.success : colors.textMuted,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ],
    );
  }
}
