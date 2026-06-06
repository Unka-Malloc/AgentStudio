import 'dart:async';

import 'package:flutter/material.dart';

import '../controllers/future_client_controller.dart';
import '../services/agent_service.dart';
import 'agents_empty_state.dart';
import 'agents_toolbar.dart';
import 'manual_target_dialog.dart';
import 'target_card.dart';
import 'theme.dart';

class AgentsCanvas extends StatefulWidget {
  const AgentsCanvas({
    super.key,
    required this.controller,
    required this.width,
  });

  final FutureClientController controller;
  final double width;

  @override
  State<AgentsCanvas> createState() => _AgentsCanvasState();
}

class _AgentsCanvasState extends State<AgentsCanvas> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      widget.controller.scanTargets();
    });
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final scanning = widget.controller.isScanningTargets;
        final adding = widget.controller.isAddingTarget;
        final targets = widget.controller.scannedTargets;

        return Scaffold(
          backgroundColor: PactColors.background,
          body: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AgentsToolbar(
                  scanning: scanning,
                  adding: adding,
                  onRescan: widget.controller.scanTargets,
                  onAddTarget: _showAddTargetDialog,
                ),
                const SizedBox(height: 8),
                const Text(
                  'Manage target adapters and MCP configuration plans for local IDEs and AI tools.',
                  style: TextStyle(color: PactColors.textMuted, fontSize: 14),
                ),
                const SizedBox(height: 32),
                Expanded(
                  child: targets.isEmpty && !scanning
                      ? AgentsEmptyState(onAddTarget: _showAddTargetDialog)
                      : _TargetsGrid(
                          targets: targets,
                          onInspect: widget.controller.inspectTarget,
                          onPlan: widget.controller.planTargetConfig,
                        ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _showAddTargetDialog() async {
    final draft = await showDialog<ManualTargetDraft>(
      context: context,
      builder: (context) => const ManualTargetDialog(),
    );
    if (draft == null) {
      return;
    }
    unawaited(widget.controller.addManualTarget(
      target: draft.target,
      configPath: draft.configPath,
      binaryPath: draft.binaryPath,
    ));
  }
}

class _TargetsGrid extends StatelessWidget {
  const _TargetsGrid({
    required this.targets,
    required this.onInspect,
    required this.onPlan,
  });

  final List<TargetCandidate> targets;
  final ValueChanged<String> onInspect;
  final ValueChanged<String> onPlan;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 400,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
        childAspectRatio: 2.2,
      ),
      itemCount: targets.length,
      itemBuilder: (context, index) {
        return TargetCard(
          target: targets[index],
          onInspect: onInspect,
          onPlan: onPlan,
        );
      },
    );
  }
}
