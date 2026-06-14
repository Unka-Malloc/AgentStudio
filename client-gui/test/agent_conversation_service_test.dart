import 'dart:convert';
import 'dart:io';

import 'package:flutter_client/src/services/agent_conversation_service.dart';
import 'package:flutter_client/src/services/agent_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'loads native agent histories through pact-client conversations list',
    () async {
      final captured = <List<String>>[];
      final agentService = AgentService(
        runCliExecutable: (executable, args, env) async {
          captured.add(List<String>.from(args));
          if (args[1] == 'list') {
            return ProcessResult(
              0,
              0,
              jsonEncode({
                'ok': true,
                'sessions': [
                  _sessionJson('session-1', 'Summarize this local repo.'),
                ],
              }),
              '',
            );
          }
          return ProcessResult(0, 0, jsonEncode({'ok': true}), '');
        },
      );
      const service = AgentConversationService();

      final sessions = await service.loadSessions(
        agentService: agentService,
        agentId: 'codex',
      );

      expect(sessions, hasLength(1));
      expect(sessions.single.agentId, 'codex');
      expect(sessions.single.native, isTrue);
      expect(sessions.single.readOnly, isTrue);
      expect(sessions.single.adapterId, 'codex');
      expect(sessions.single.nativeSessionId, 'codex-session-1');
      expect(sessions.single.sourceKind, 'codex-session-store');
      expect(sessions.single.importMode, 'precise-adapter');
      expect(sessions.single.sourceTool, 'codex');
      expect(sessions.single.sourcePath, '/tmp/codex/history.jsonl');
      expect(sessions.single.messageCount, 2);
      expect(captured.single, ['conversations', 'list', '--agent', 'codex']);
    },
  );

  test('sends messages through pact-client runtime adapter command', () async {
    final captured = <List<String>>[];
    final agentService = AgentService(
      runCliExecutable: (executable, args, env) async {
        captured.add(List<String>.from(args));
        return ProcessResult(
          0,
          0,
          jsonEncode({
            'ok': true,
            'mode': 'runtime-adapter',
            'adapterId': 'codex',
            'runtimeProtocol': 'codex-cli-exec',
          }),
          '',
        );
      },
    );
    const service = AgentConversationService();

    final result = await service.sendRuntimeMessage(
      agentService: agentService,
      agentId: 'codex',
      text: 'Hello Codex',
      sessionId: 'native-session-1',
    );

    expect(result['ok'], isTrue);
    expect(result['mode'], 'runtime-adapter');
    expect(captured.single, [
      'agent',
      'message',
      'send',
      '--agent',
      'codex',
      '--text',
      'Hello Codex',
      '--session-id',
      'native-session-1',
    ]);
  });
}

Map<String, dynamic> _sessionJson(String id, String text) {
  return {
    'id': id,
    'agentId': 'codex',
    'title': text,
    'createdAt': '2026-06-12T00:00:00Z',
    'updatedAt': '2026-06-12T00:00:01Z',
    'adapterId': 'codex',
    'nativeSessionId': 'codex-session-1',
    'sourceKind': 'codex-session-store',
    'importMode': 'precise-adapter',
    'sourceTool': 'codex',
    'sourcePath': '/tmp/codex/history.jsonl',
    'native': true,
    'readOnly': true,
    'messageCount': 2,
    'messages': [
      {
        'id': 'msg-1',
        'role': 'user',
        'text': text,
        'createdAt': '2026-06-12T00:00:00Z',
      },
      {
        'id': 'msg-2',
        'role': 'agent',
        'text': '本机展示',
        'createdAt': '2026-06-12T00:00:01Z',
      },
    ],
  };
}
