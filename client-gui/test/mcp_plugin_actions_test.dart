import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_client/src/controllers/future_client_controller.dart';
import 'package:flutter_client/src/services/agent_service.dart';

// Create a mock AgentService that intercepts the CLI arguments
class MockAgentService extends AgentService {
  List<String> lastArgs = [];
  Map<String, dynamic> mockResponse = {'ok': true};
  List<Map<String, dynamic>> mockSnapshots = [];

  MockAgentService() : super(
    runCliExecutable: null, // we'll override the internal method instead
  );

  @override
  Future<List<Map<String, dynamic>>> listSnapshots({String target = ''}) async {
    return mockSnapshots;
  }

  @override
  Future<Map<String, dynamic>> rollbackMcpPlugin({
    required String target,
    required String snapshotId,
    String configPath = '',
  }) async {
    lastArgs = ['mcp', 'plugin', 'rollback', '--target', target, '--snapshot-id', snapshotId];
    return mockResponse;
  }
}

void main() {
  group('McpPluginActions Rollback Latest', () {
    late FutureClientController controller;
    late MockAgentService mockService;
    late TargetCandidate dummyTarget;

    setUp(() {
      mockService = MockAgentService();
      controller = FutureClientController(agentService: mockService);
      
      dummyTarget = TargetCandidate(
        target: 'opencode',
        label: 'OpenCode',
        kind: 'editor',
        status: 'found',
        configured: true,
        confidence: 1.0,
        adapterStatus: 'implemented'
      );
    });

    test('rollbackLatestMcpPlugin selects the most recent snapshot regardless of order', () async {
      mockService.mockSnapshots = [
        {'snapshotId': 'old-snap', 'capturedAt': '2020-01-01T10:00:00Z'},
        {'snapshotId': 'new-snap', 'capturedAt': '2026-06-08T12:00:00Z'},
        {'snapshotId': 'mid-snap', 'capturedAt': '2023-05-05T08:00:00Z'},
      ];

      await controller.rollbackLatestMcpPlugin(dummyTarget);
      
      expect(mockService.lastArgs.contains('new-snap'), isTrue);
    });

    test('rollbackLatestMcpPlugin handles missing capturedAt gracefully', () async {
      mockService.mockSnapshots = [
        {'snapshotId': 'no-date-1'},
        {'snapshotId': 'new-snap', 'capturedAt': '2026-06-08T12:00:00Z'},
        {'snapshotId': 'no-date-2', 'capturedAt': ''},
      ];

      await controller.rollbackLatestMcpPlugin(dummyTarget);
      
      expect(mockService.lastArgs.contains('new-snap'), isTrue);
    });

    test('rollbackLatestMcpPlugin throws clear error when no snapshots', () async {
      mockService.mockSnapshots = [];

      await controller.rollbackLatestMcpPlugin(dummyTarget);
      
      expect(
        controller.lastError,
        contains('No snapshot found for target: opencode'),
      );
    });
  });
}
