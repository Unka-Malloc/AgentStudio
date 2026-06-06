import 'package:flutter/material.dart';

import 'theme.dart';

class PanelFrame extends StatelessWidget {
  const PanelFrame({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: PactColors.surface,
        border: Border.all(color: PactColors.line),
        borderRadius: BorderRadius.circular(8),
      ),
      child: child,
    );
  }
}
