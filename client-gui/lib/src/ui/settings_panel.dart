import 'package:flutter/material.dart';

import '../controllers/future_client_controller.dart';
import 'panel_frame.dart';

class SettingsPanel extends StatelessWidget {
  const SettingsPanel({super.key, required this.controller});

  final FutureClientController controller;

  @override
  Widget build(BuildContext context) {
    return PanelFrame(
      child: ListView(
        children: [
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
