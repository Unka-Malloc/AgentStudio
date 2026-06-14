import 'dart:async';

import 'package:flutter/material.dart';

import 'src/controllers/future_client_controller.dart';
import 'src/ui/client_shell.dart';
import 'src/ui/appearance_preset_config.dart';
import 'src/ui/theme.dart';

class PactApp extends StatefulWidget {
  const PactApp({super.key});

  @override
  State<PactApp> createState() => _PactAppState();
}

class _PactAppState extends State<PactApp> {
  late final FutureClientController _controller;

  @override
  void initState() {
    super.initState();
    _controller = FutureClientController();
    unawaited(_controller.initialize());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final presetId = _controller.appearancePresetId;
        final presets = _controller.appearancePresetConfigs;
        return MaterialApp(
          title: 'Pact 便携客户端',
          debugShowCheckedModeBanner: false,
          themeMode: themeModeForAppearance(presetId, presets),
          theme: buildPactTheme(
            presetId: presetId,
            presets: presets,
            platformBrightness: Brightness.light,
          ),
          darkTheme: buildPactTheme(
            presetId: presetId,
            presets: presets,
            platformBrightness: Brightness.dark,
          ),
          home: ClientShell(controller: _controller),
        );
      },
    );
  }
}
