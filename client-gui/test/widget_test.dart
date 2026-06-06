import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_client/src/models/future_client_models.dart';

void main() {
  test('app sections are the future client modules', () {
    expect(FutureClientSection.values, [
      FutureClientSection.agents,
      FutureClientSection.mcpPlugins,
      FutureClientSection.skillHub,
      FutureClientSection.modelForwarding,
      FutureClientSection.activity,
      FutureClientSection.settings,
    ]);
  });
}
