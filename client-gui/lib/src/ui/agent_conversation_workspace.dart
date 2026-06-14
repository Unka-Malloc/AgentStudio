import 'dart:async';

import 'package:flutter/material.dart';

import '../controllers/future_client_controller.dart';
import '../services/agent_conversation_service.dart';
import '../services/agent_service.dart';
import 'history_session_panel.dart';
import 'panel_frame.dart';
import 'theme.dart';

class AgentConversationWorkspace extends StatefulWidget {
  const AgentConversationWorkspace({
    super.key,
    required this.controller,
    required this.targets,
    required this.scanning,
    required this.adding,
    required this.onRescan,
    required this.onAddTarget,
    required this.onInspect,
    required this.onPlan,
  });

  final FutureClientController controller;
  final List<TargetCandidate> targets;
  final bool scanning;
  final bool adding;
  final VoidCallback onRescan;
  final VoidCallback onAddTarget;
  final ValueChanged<String> onInspect;
  final ValueChanged<String> onPlan;

  @override
  State<AgentConversationWorkspace> createState() =>
      _AgentConversationWorkspaceState();
}

class _AgentConversationWorkspaceState
    extends State<AgentConversationWorkspace> {
  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          width: 300,
          child: _AgentListPane(
            targets: widget.targets,
            selectedTargetId: widget.controller.selectedConversationAgentId,
            scanning: widget.scanning,
            adding: widget.adding,
            onSelect: (targetId) =>
                unawaited(widget.controller.selectConversationAgent(targetId)),
            onRescan: widget.onRescan,
            onAddTarget: widget.onAddTarget,
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: _ConversationPane(
            controller: widget.controller,
            onInspect: widget.onInspect,
            onPlan: widget.onPlan,
          ),
        ),
      ],
    );
  }
}

class _AgentListPane extends StatelessWidget {
  const _AgentListPane({
    required this.targets,
    required this.selectedTargetId,
    required this.scanning,
    required this.adding,
    required this.onSelect,
    required this.onRescan,
    required this.onAddTarget,
  });

  final List<TargetCandidate> targets;
  final String selectedTargetId;
  final bool scanning;
  final bool adding;
  final ValueChanged<String> onSelect;
  final VoidCallback onRescan;
  final VoidCallback onAddTarget;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    return PanelFrame(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Local agents',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                      color: colors.text,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Add target',
                  onPressed: adding ? null : onAddTarget,
                  icon: const Icon(Icons.add, size: 18),
                ),
                IconButton(
                  tooltip: 'Rescan',
                  onPressed: scanning ? null : onRescan,
                  icon: scanning
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh, size: 18),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: targets.isEmpty
                ? _AgentListEmpty(onAddTarget: onAddTarget)
                : ListView.separated(
                    padding: const EdgeInsets.all(10),
                    itemBuilder: (context, index) {
                      final target = targets[index];
                      return _AgentRow(
                        target: target,
                        selected: target.target == selectedTargetId,
                        onSelect: onSelect,
                      );
                    },
                    separatorBuilder: (context, index) =>
                        const SizedBox(height: 8),
                    itemCount: targets.length,
                  ),
          ),
        ],
      ),
    );
  }
}

class _AgentListEmpty extends StatelessWidget {
  const _AgentListEmpty({required this.onAddTarget});

  final VoidCallback onAddTarget;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: OutlinedButton.icon(
        onPressed: onAddTarget,
        icon: const Icon(Icons.add, size: 18),
        label: const Text('Add target'),
      ),
    );
  }
}

class _AgentRow extends StatelessWidget {
  const _AgentRow({
    required this.target,
    required this.selected,
    required this.onSelect,
  });

  final TargetCandidate target;
  final bool selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    final detected = target.status != 'not-detected';
    return Material(
      color: selected ? colors.surfaceHigh : colors.surface,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => onSelect(target.target),
        child: Container(
          height: 72,
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            border: Border.all(
              color: selected ? colors.primary : colors.line,
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: detected
                      ? colors.primaryFixed
                      : colors.surfaceLow,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  target.manual
                      ? Icons.edit_location_alt_outlined
                      : Icons.smart_toy_outlined,
                  size: 18,
                  color: detected ? colors.primary : colors.textMuted,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      target.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: colors.text,
                      ),
                    ),
                    Row(
                      children: [
                        Container(
                          width: 7,
                          height: 7,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: _statusColor(target, colors),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            _statusLabel(target),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: colors.textMuted,
                              fontSize: 12,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ConversationPane extends StatelessWidget {
  const _ConversationPane({
    required this.controller,
    required this.onInspect,
    required this.onPlan,
  });

  final FutureClientController controller;
  final ValueChanged<String> onInspect;
  final ValueChanged<String> onPlan;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    final target = controller.selectedConversationAgent;
    if (target == null) {
      return PanelFrame(
        child: Center(
          child: Text(
            'No agent selected',
            style: TextStyle(color: colors.textMuted),
          ),
        ),
      );
    }

    final sessions = controller.selectedConversationSessions;
    final selectedSession = controller.selectedConversationSession;
    return PanelFrame(
      child: Column(
        children: [
          _ConversationHeader(
            target: target,
            onInspect: onInspect,
            onPlan: onPlan,
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(12),
            child: HistorySessionPanel(
              title: '原生智能体历史',
              subtitle: '${sessions.length} 条原生智能体历史',
              items: [
                for (final session in sessions)
                  HistorySessionPanelItem(
                    id: session.id,
                    title: session.title,
                    meta: _sessionMeta(session),
                    preview: session.preview,
                    active:
                        session.id == controller.selectedConversationSessionId,
                    canDelete: false,
                    deleteLabel: 'Read-only native agent history',
                  ),
              ],
              onSelect: controller.selectConversationSession,
              onDelete: (_) {},
            ),
          ),
          Expanded(
            child: _MessageList(
              loading: controller.isLoadingConversations,
              session: selectedSession,
            ),
          ),
          const Divider(height: 1),
          _RuntimeMessageComposer(
            targetLabel: target.label,
            busy: controller.isSendingConversationMessage,
            onSend: (text) =>
                unawaited(controller.sendConversationMessage(text)),
          ),
        ],
      ),
    );
  }
}

class _ConversationHeader extends StatelessWidget {
  const _ConversationHeader({
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
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: colors.primaryFixed,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(Icons.forum_outlined, color: colors.primary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  target.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: colors.text,
                    fontWeight: FontWeight.w800,
                    fontSize: 16,
                  ),
                ),
                Text(
                  '${_statusLabel(target)} · ${target.kind}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: colors.textMuted,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: () => onInspect(target.target),
            child: const Text('Inspect'),
          ),
          const SizedBox(width: 8),
          FilledButton(
            onPressed: () => onPlan(target.target),
            style: FilledButton.styleFrom(
              backgroundColor: colors.primary,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(6),
              ),
            ),
            child: const Text('Plan'),
          ),
        ],
      ),
    );
  }
}

class _MessageList extends StatelessWidget {
  const _MessageList({required this.loading, required this.session});

  final bool loading;
  final AgentConversationSession? session;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    if (loading) {
      return const Center(child: CircularProgressIndicator());
    }
    final messages = session?.messages ?? const <AgentConversationMessage>[];
    if (messages.isEmpty) {
      return Center(
        child: Text(
          'No messages in this native agent history',
          style: TextStyle(color: colors.textMuted),
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemBuilder: (context, index) {
        return _MessageBubble(message: messages[index]);
      },
      separatorBuilder: (context, index) => const SizedBox(height: 10),
      itemCount: messages.length,
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final AgentConversationMessage message;

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    final isUser = message.role == 'user';
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: isUser ? colors.primary : colors.surfaceLow,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isUser ? 'You' : 'Agent',
                  style: TextStyle(
                    color: isUser
                        ? Color.lerp(colors.primary, colors.textOnPrimary, 0.72)
                        : colors.textMuted,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  message.text,
                  style: TextStyle(
                    color: isUser ? colors.textOnPrimary : colors.text,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RuntimeMessageComposer extends StatefulWidget {
  const _RuntimeMessageComposer({
    required this.targetLabel,
    required this.busy,
    required this.onSend,
  });

  final String targetLabel;
  final bool busy;
  final ValueChanged<String> onSend;

  @override
  State<_RuntimeMessageComposer> createState() =>
      _RuntimeMessageComposerState();
}

class _RuntimeMessageComposerState extends State<_RuntimeMessageComposer> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final text = _controller.text.trim();
    if (text.isEmpty || widget.busy) {
      return;
    }
    _controller.clear();
    widget.onSend(text);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.pactColors;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              minLines: 1,
              maxLines: 4,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _submit(),
              enabled: !widget.busy,
              decoration: InputDecoration(
                hintText: 'Message ${widget.targetLabel}',
                isDense: true,
                filled: true,
                fillColor: colors.surfaceLow,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: colors.line),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: colors.line),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: colors.primary),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 44,
            height: 44,
            child: IconButton.filled(
              tooltip: 'Send',
              onPressed: widget.busy ? null : _submit,
              icon: widget.busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send, size: 18),
            ),
          ),
        ],
      ),
    );
  }
}

String _sessionMeta(AgentConversationSession session) {
  final parts = [
    if (session.adapterId.isNotEmpty) session.adapterId,
    if (session.sourceKind.isNotEmpty) session.sourceKind,
    if (session.nativeSessionId.isNotEmpty) session.nativeSessionId,
  ];
  if (parts.isNotEmpty) {
    return parts.join(' · ');
  }
  return session.sourcePath.isEmpty ? session.updatedAt : session.sourcePath;
}

String _statusLabel(TargetCandidate target) {
  return switch (target.status) {
    'configured' => 'Configured',
    'detected' => 'Detected',
    'manual' => 'Manual',
    _ => 'Not detected',
  };
}

Color _statusColor(TargetCandidate target, PactThemeColors colors) {
  return switch (target.status) {
    'configured' => colors.success,
    'detected' => colors.primary,
    'manual' => colors.warning,
    _ => colors.textMuted,
  };
}
