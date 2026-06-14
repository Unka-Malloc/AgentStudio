import 'package:flutter/material.dart';
import 'package:flutter_client/src/ui/history_session_panel.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('history session panel uses native agent history empty copy', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HistorySessionPanel(
            title: '原生智能体历史',
            subtitle: '0 条原生智能体历史',
            items: const [],
            onSelect: (String _) {},
            onDelete: (String _) {},
          ),
        ),
      ),
    );

    expect(find.text('原生智能体历史'), findsOneWidget);
    expect(find.text('0 条原生智能体历史'), findsOneWidget);
    expect(find.text('No local sessions yet'), findsNothing);
    expect(find.text('No native agent histories yet'), findsOneWidget);
  });

  testWidgets(
    'history session panel row uses native agent history delete label',
    (WidgetTester tester) async {
      var selectedSession = '';
      var deletedSession = '';

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: HistorySessionPanel(
              title: '原生智能体历史',
              subtitle: '1 条原生智能体历史',
              items: const [
                HistorySessionPanelItem(
                  id: 'session-1',
                  title: '汇总会话',
                  preview: '最近一条消息',
                  deleteLabel: 'Delete native agent history',
                ),
              ],
              onSelect: (String sessionId) => selectedSession = sessionId,
              onDelete: (String sessionId) => deletedSession = sessionId,
            ),
          ),
        ),
      );

      await tester.tap(find.text('汇总会话'));
      expect(selectedSession, 'session-1');

      await tester.tap(find.byIcon(Icons.delete_outline));
      expect(deletedSession, 'session-1');
    },
  );

  testWidgets('history session panel can disable native history delete', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HistorySessionPanel(
            title: '原生智能体历史',
            subtitle: '1 条原生智能体历史',
            items: const [
              HistorySessionPanelItem(
                id: 'session-1',
                title: '汇总会话',
                canDelete: false,
                deleteLabel: 'Read-only native agent history',
              ),
            ],
            onSelect: (String _) {},
            onDelete: (String _) {},
          ),
        ),
      ),
    );

    final button = tester.widget<IconButton>(
      find.widgetWithIcon(IconButton, Icons.delete_outline),
    );
    expect(button.onPressed, isNull);
  });
}
