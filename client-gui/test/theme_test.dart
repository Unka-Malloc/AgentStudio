import 'package:flutter/material.dart';
import 'package:flutter_client/src/ui/appearance_preset_config.dart';
import 'package:flutter_client/src/ui/theme.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('buildPactTheme applies every appearance preset', () {
    for (final preset in builtInAppearancePresetConfigs) {
      final platformBrightness = preset.id == AppearancePresetIds.defaultSystem
          ? Brightness.dark
          : Brightness.light;
      final colors = pactColorsFor(
        preset.id,
        platformBrightness: platformBrightness,
      );
      final theme = buildPactTheme(
        presetId: preset.id,
        platformBrightness: platformBrightness,
      );

      expect(theme.scaffoldBackgroundColor, colors.background);
      expect(theme.textTheme.bodyLarge?.color, colors.text);
      expect(theme.textTheme.displayLarge?.color, colors.text);
      expect(theme.colorScheme.surface, colors.surface);
      expect(theme.colorScheme.primary, colors.primary);
      expect(theme.colorScheme.secondary, colors.primaryStrong);
      expect(theme.colorScheme.error, colors.error);
      expect(theme.colorScheme.onSurface, colors.text);
      expect(theme.colorScheme.surfaceContainerHighest, colors.surfaceHighest);
      final extension = theme.extension<PactThemeColors>();
      expect(extension?.background, colors.background);
      expect(extension?.primary, colors.primary);
      expect(extension?.textOnPrimary, colors.textOnPrimary);

      final cardTheme = theme.cardTheme;
      expect(cardTheme.shape, isA<RoundedRectangleBorder>());
      expect(cardTheme.elevation, 0);
      expect(cardTheme.color, colors.surface);

      final inputTheme = theme.inputDecorationTheme;
      expect(inputTheme.filled, isTrue);
      expect(inputTheme.fillColor, colors.surface);
    }
  });

  test('primary button contrast stays accessible across presets', () {
    for (final preset in builtInAppearancePresetConfigs) {
      for (final brightness in Brightness.values) {
        final colors = pactColorsFor(preset.id, platformBrightness: brightness);
        expect(
          _contrastRatio(colors.primary, colors.textOnPrimary),
          greaterThanOrEqualTo(4.5),
          reason: '${preset.id} $brightness primary contrast',
        );
      }
    }
  });

  test('default-system resolves to geek light blue or sunset ember', () {
    expect(
      pactColorsFor(
        AppearancePresetIds.defaultSystem,
        platformBrightness: Brightness.light,
      ).primary,
      pactColorsFor(AppearancePresetIds.geekLightBlue).primary,
    );
    expect(
      pactColorsFor(
        AppearancePresetIds.defaultSystem,
        platformBrightness: Brightness.dark,
      ).primary,
      pactColorsFor(AppearancePresetIds.sunsetEmber).primary,
    );
  });

  test('custom JSON preset can drive ThemeData without enum changes', () {
    final custom = AppearancePresetConfig.fromJson({
      'schemaVersion': 1,
      'id': 'agent-preview',
      'label': {'en': 'Agent Preview', 'zh-CN': '智能体预览'},
      'mode': 'light',
      'tokens': {
        'bg-base': '#fff7ed',
        'bg-surface': '#ffffff',
        'bg-subtle': '#ffedd5',
        'text-primary': '#1c1917',
        'text-muted': '#78716c',
        'text-on-brand': '#ffffff',
        'brand': '#7c3aed',
        'brand-strong': '#5b21b6',
        'brand-subtle': '#ede9fe',
        'success': '#15803d',
        'warning': '#b45309',
        'danger': '#b91c1c',
      },
    });
    final presets = mergeAppearancePresetConfigs([custom]);
    final colors = pactColorsFor('agent-preview', presets: presets);
    final theme = buildPactTheme(presetId: 'agent-preview', presets: presets);

    expect(themeModeForAppearance('agent-preview', presets), ThemeMode.light);
    expect(colors.background, const Color(0xFFFFF7ED));
    expect(colors.primary, const Color(0xFF7C3AED));
    expect(theme.colorScheme.primary, const Color(0xFF7C3AED));
  });
}

double _contrastRatio(Color a, Color b) {
  final aLum = a.computeLuminance();
  final bLum = b.computeLuminance();
  final lighter = aLum > bLum ? aLum : bLum;
  final darker = aLum > bLum ? bLum : aLum;
  return (lighter + 0.05) / (darker + 0.05);
}
