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
    return Card(
      elevation: 0,
      color: PactColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: PactColors.line),
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
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  _targetStatusLabel(target),
                  style: const TextStyle(
                    color: PactColors.textMuted,
                    fontSize: 12,
                  ),
                ),
                Row(
                  children: [
                    TextButton(
                      onPressed: () => onInspect(target.target),
                      child: const Text('Inspect'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: () => onPlan(target.target),
                      style: FilledButton.styleFrom(
                        backgroundColor: PactColors.primary,
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
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: PactColors.surfaceLow,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Icon(
        manual ? Icons.edit_location_alt_outlined : Icons.smart_toy_outlined,
        color: PactColors.primary,
      ),
    );
  }
}

class _TargetTitle extends StatelessWidget {
  const _TargetTitle({required this.target});

  final TargetCandidate target;

  @override
  Widget build(BuildContext context) {
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
                color: configured ? PactColors.success : PactColors.textMuted,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              configured ? 'Configured' : 'Not configured',
              style: TextStyle(
                color: configured ? PactColors.success : PactColors.textMuted,
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
