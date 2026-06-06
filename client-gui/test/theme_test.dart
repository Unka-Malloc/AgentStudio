import 'package:flutter/material.dart';
import 'package:flutter_client/src/ui/theme.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('buildPactTheme applies pact color system', () {
    final theme = buildPactTheme();

    expect(theme.scaffoldBackgroundColor, PactColors.background);
    expect(theme.textTheme.bodyLarge?.color, PactColors.text);
    expect(theme.textTheme.displayLarge?.color, PactColors.text);
    expect(theme.colorScheme.surface, PactColors.surface);
    expect(theme.colorScheme.primary, PactColors.primary);
    expect(theme.colorScheme.secondary, PactColors.primaryStrong);
    expect(theme.colorScheme.error, PactColors.error);
    expect(theme.colorScheme.onSurface, PactColors.text);
    expect(theme.colorScheme.surfaceContainerHighest, PactColors.surfaceHighest);

    final cardTheme = theme.cardTheme;
    expect(cardTheme.shape, isA<RoundedRectangleBorder>());
    expect(cardTheme.elevation, 0);
    expect(cardTheme.color, PactColors.surface);

    final inputTheme = theme.inputDecorationTheme;
    expect(inputTheme.filled, isTrue);
    expect(inputTheme.fillColor, PactColors.surface);
  });
}
