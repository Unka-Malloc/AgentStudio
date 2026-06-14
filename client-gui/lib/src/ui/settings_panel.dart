import 'dart:async';

import 'package:flutter/material.dart';

import '../controllers/future_client_controller.dart';
import 'panel_frame.dart';
import 'theme.dart';

class SettingsPanel extends StatelessWidget {
  const SettingsPanel({super.key, required this.controller});

  final FutureClientController controller;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    final selectedPresetId =
        controller.appearancePresetConfigs.any(
          (config) => config.id == controller.appearancePresetId,
        )
        ? controller.appearancePresetId
        : null;
    return PanelFrame(
      child: ListView(
        children: [
          ListTile(
            leading: Icon(Icons.palette_outlined, color: colors.primary),
            title: const Text('Appearance Preset'),
            subtitle: Text(controller.appearancePresetLabel),
            trailing: FilledButton.tonalIcon(
              onPressed: () {
                unawaited(controller.cycleAppearancePreset());
              },
              icon: const Icon(Icons.loop_outlined),
              label: const Text('Next'),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: DropdownButtonFormField<String>(
              initialValue: selectedPresetId,
              decoration: const InputDecoration(labelText: 'Choose appearance'),
              items: controller.appearancePresetConfigs
                  .map(
                    (config) => DropdownMenuItem(
                      value: config.id,
                      child: Text(config.labelFor()),
                    ),
                  )
                  .toList(),
              onChanged: (presetId) {
                if (presetId != null) {
                  unawaited(controller.setAppearancePreset(presetId));
                }
              },
            ),
          ),
          ListTile(
            leading: const Icon(Icons.folder_copy_outlined),
            title: const Text('Appearance Preset Directory'),
            subtitle: Text(controller.appearancePresetDirectoryPath),
            trailing: IconButton(
              tooltip: 'Reload presets',
              onPressed: () {
                unawaited(controller.reloadAppearancePresets());
              },
              icon: const Icon(Icons.refresh_outlined),
            ),
          ),
          if (controller.appearancePresetLoadErrors.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Text(
                'Invalid preset configs: ${controller.appearancePresetLoadErrors.length}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.error,
                ),
              ),
            ),
          ListTile(
            leading: const Icon(Icons.settings_outlined),
            title: const Text('Bootstrap URL'),
            subtitle: Text(controller.bootstrapController.text),
          ),
          ListTile(
            leading: const Icon(Icons.folder_outlined),
            title: const Text('Portable Data'),
            subtitle: Text(controller.portableDataPath),
          ),
        ],
      ),
    );
  }
}
