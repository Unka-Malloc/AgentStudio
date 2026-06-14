import 'dart:async';

import 'package:flutter/material.dart';

import '../controllers/future_client_controller.dart';
import 'panel_frame.dart';
import 'theme.dart';

class MobileRelayPanel extends StatefulWidget {
  const MobileRelayPanel({super.key, required this.controller});

  final FutureClientController controller;

  @override
  State<MobileRelayPanel> createState() => _MobileRelayPanelState();
}

class _MobileRelayPanelState extends State<MobileRelayPanel> {
  late final TextEditingController _customUrlController;

  FutureClientController get controller => widget.controller;

  @override
  void initState() {
    super.initState();
    _customUrlController = TextEditingController(
      text: controller.mobileRelayConfig.customGatewayUrl,
    );
  }

  @override
  void didUpdateWidget(covariant MobileRelayPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    final next = controller.mobileRelayConfig.customGatewayUrl;
    if (_customUrlController.text != next) {
      _customUrlController.text = next;
    }
  }

  @override
  void dispose() {
    _customUrlController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    final config = controller.mobileRelayConfig;
    final paired = config.paired;
    final hasPairing = config.hasPairing;
    return PanelFrame(
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _SectionTitle(
            icon: Icons.router_outlined,
            title: 'Gateway',
            trailing: SegmentedButton<bool>(
              segments: const [
                ButtonSegment(
                  value: false,
                  label: Text('Pact'),
                  icon: Icon(Icons.public_outlined),
                ),
                ButtonSegment(
                  value: true,
                  label: Text('Private'),
                  icon: Icon(Icons.cloud_outlined),
                ),
              ],
              selected: {config.useCustomGateway},
              onSelectionChanged: controller.isMobileRelayBusy
                  ? null
                  : (selection) {
                      unawaited(
                        controller.configureMobileRelayGateway(
                          useCustomGateway: selection.first,
                          customGatewayUrl: _customUrlController.text,
                        ),
                      );
                    },
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _customUrlController,
            enabled: config.useCustomGateway && !controller.isMobileRelayBusy,
            decoration: InputDecoration(
              labelText: 'Private cloud gateway URL',
              prefixIcon: const Icon(Icons.link_outlined),
              suffixIcon: IconButton(
                tooltip: 'Save gateway',
                icon: const Icon(Icons.save_outlined),
                onPressed: controller.isMobileRelayBusy
                    ? null
                    : () {
                        unawaited(
                          controller.configureMobileRelayGateway(
                            useCustomGateway: config.useCustomGateway,
                            customGatewayUrl: _customUrlController.text,
                          ),
                        );
                      },
              ),
            ),
            onSubmitted: (_) {
              unawaited(
                controller.configureMobileRelayGateway(
                  useCustomGateway: config.useCustomGateway,
                  customGatewayUrl: _customUrlController.text,
                ),
              );
            },
          ),
          const SizedBox(height: 12),
          _InfoRow(label: 'Default', value: config.defaultGatewayUrl),
          _InfoRow(label: 'Active', value: config.effectiveGatewayUrl),
          const _Divider(),
          _SectionTitle(
            icon: Icons.qr_code_2_outlined,
            title: 'Pairing',
            trailing: Wrap(
              spacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: controller.isMobileRelayBusy
                      ? null
                      : () =>
                            unawaited(controller.refreshMobilePairingStatus()),
                  icon: const Icon(Icons.sync_outlined),
                  label: const Text('Refresh'),
                ),
                FilledButton.icon(
                  onPressed: controller.isMobileRelayBusy
                      ? null
                      : () => unawaited(controller.createMobilePairing()),
                  icon: const Icon(Icons.add_link_outlined),
                  label: const Text('Create Code'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (config.lastPairingCode.isNotEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: colors.surfaceHigh,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: colors.line),
              ),
              child: SelectableText(
                config.lastPairingCode,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  color: colors.primary,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          const SizedBox(height: 12),
          _InfoRow(label: 'Status', value: paired ? 'Paired' : 'Waiting'),
          _InfoRow(label: 'Pairing ID', value: config.pairingId),
          _InfoRow(label: 'Expires', value: config.lastPairingExpiresAt),
          const _Divider(),
          _SectionTitle(
            icon: Icons.phonelink_outlined,
            title: 'Relay',
            trailing: Wrap(
              spacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: hasPairing && !controller.isMobileRelayPolling
                      ? () => unawaited(controller.pollMobileRelayOnce())
                      : null,
                  icon: const Icon(Icons.downloading_outlined),
                  label: const Text('Poll'),
                ),
                FilledButton.icon(
                  onPressed: hasPairing
                      ? () {
                          if (config.relayEnabled) {
                            controller.stopMobileRelayPolling();
                          } else {
                            controller.startMobileRelayPolling();
                          }
                        }
                      : null,
                  icon: Icon(
                    config.relayEnabled
                        ? Icons.pause_outlined
                        : Icons.play_arrow_outlined,
                  ),
                  label: Text(config.relayEnabled ? 'Stop' : 'Start'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _InfoRow(
            label: 'Polling',
            value: config.relayEnabled ? 'Enabled' : 'Stopped',
          ),
          _InfoRow(
            label: 'Last Commands',
            value: controller.lastMobileRelayCommands.length.toString(),
          ),
          if (controller.mobileRelayActionResult != null)
            _InfoRow(
              label: 'Last Result',
              value: controller.mobileRelayActionResult.toString(),
            ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({
    required this.icon,
    required this.title,
    required this.trailing,
  });

  final IconData icon;
  final String title;
  final Widget trailing;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    return Row(
      children: [
        Icon(icon, color: colors.primary),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
        ),
        trailing,
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    final display = value.trim().isEmpty ? '-' : value.trim();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 112,
            child: Text(
              label,
              style: TextStyle(color: colors.textMuted),
            ),
          ),
          Expanded(
            child: SelectableText(
              display,
              style: TextStyle(color: colors.text),
            ),
          ),
        ],
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Divider(height: 1, color: colors.line),
    );
  }
}
