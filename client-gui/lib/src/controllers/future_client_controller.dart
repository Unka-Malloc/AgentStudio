import 'dart:async';

import 'package:flutter/widgets.dart';

import '../models/future_client_models.dart';
import '../services/appearance_preferences_service.dart';
import '../services/agent_conversation_service.dart';
import '../services/agent_service.dart';
import '../services/mobile_relay_service.dart';
import '../services/portable_data_root.dart';
import '../ui/appearance_preset_config.dart';

part 'mcp_plugin_actions.dart';
part 'model_forwarding_actions.dart';
part 'skill_hub_actions.dart';
part 'target_actions.dart';
part 'agent_conversation_actions.dart';
part 'mobile_relay_actions.dart';

class FutureClientController extends ChangeNotifier {
  FutureClientController({
    PortableDataRoot? portableData,
    AgentService? agentService,
    AgentConversationService? conversationService,
    MobileRelayService? mobileRelayService,
    AppearancePreferencesService? appearancePreferencesService,
  }) : portableData = portableData ?? PortableDataRoot(),
       agentService =
           agentService ??
           AgentService(
             dataDirectory: () async => (portableData ?? PortableDataRoot())
                 .dataDirectory()
                 .then((d) => d.path),
           ),
       conversationService =
           conversationService ?? const AgentConversationService(),
       mobileRelayService = mobileRelayService ?? const MobileRelayService(),
       appearancePreferencesService =
           appearancePreferencesService ??
           const AppearancePreferencesService() {
    bootstrapController.addListener(_notifyStateChanged);
  }

  final PortableDataRoot portableData;
  final AgentService agentService;
  final AgentConversationService conversationService;
  final MobileRelayService mobileRelayService;
  final AppearancePreferencesService appearancePreferencesService;
  final TextEditingController bootstrapController = TextEditingController();

  FutureClientSection currentSection = FutureClientSection.agents;
  String appearancePresetId = AppearancePresetIds.defaultSystem;
  List<AppearancePresetConfig> appearancePresetConfigs =
      builtInAppearancePresetConfigs;
  String appearancePresetDirectoryPath = '';
  List<String> appearancePresetLoadErrors = const [];
  List<TargetCandidate> scannedTargets = const [];
  Map<String, dynamic>? targetInspection;
  Map<String, dynamic>? targetConfigPlan;
  Map<String, Map<String, dynamic>> mcpPluginStatuses = const {};
  Map<String, dynamic>? mcpPluginActionResult;
  List<Map<String, dynamic>> modelProfiles = const [];
  Map<String, dynamic>? modelForwardingResult;
  List<Map<String, dynamic>> skillHubPairings = const [];
  List<Map<String, dynamic>> skillHubSkills = const [];
  Map<String, dynamic>? skillHubActionResult;
  MobileRelayConfig mobileRelayConfig = MobileRelayConfig.defaults();
  Map<String, dynamic>? mobileRelayActionResult;
  List<MobileRelayCommand> lastMobileRelayCommands = const [];
  Map<String, dynamic>? snapshotRestoreResult;
  Map<String, List<AgentConversationSession>> conversationSessionsByAgent =
      const {};
  String selectedConversationAgentId = '';
  String selectedConversationSessionId = '';
  bool initialized = false;
  bool isScanningTargets = false;
  bool isAddingTarget = false;
  bool isModelForwardingBusy = false;
  bool isSkillHubBusy = false;
  bool isMobileRelayBusy = false;
  bool isMobileRelayPolling = false;
  bool isLoadingConversations = false;
  bool isSendingConversationMessage = false;
  bool _disposed = false;
  Timer? _mobileRelayTimer;
  final Set<String> _mcpPluginBusyTargets = <String>{};
  String portableDataPath = '';
  String statusMessage = '等待扫描目标适配器。';
  String statusCaption = 'Future client';
  String lastError = '';

  String get appearancePresetLabel {
    return findAppearancePresetConfig(
      appearancePresetId,
      appearancePresetConfigs,
    ).labelFor();
  }

  bool isMcpPluginBusy(String target) {
    return _mcpPluginBusyTargets.contains(target);
  }

  void _notifyStateChanged() {
    if (_disposed) {
      return;
    }
    notifyListeners();
  }

  Future<void> initialize() async {
    try {
      final dataDir = await portableData.dataDirectory();
      portableDataPath = dataDir.path;
      final catalog = await appearancePreferencesService.loadCatalog(
        portableData,
      );
      _applyAppearancePresetCatalog(catalog);
      appearancePresetId = await appearancePreferencesService
          .loadSelectedPresetId(portableData, appearancePresetConfigs);
      mobileRelayConfig = await mobileRelayService.loadConfig(
        agentService: agentService,
      );
      initialized = true;
      statusMessage = appearancePresetLoadErrors.isEmpty
          ? 'Future client 已就绪。'
          : 'Future client 已就绪，部分外观方案配置无效。';
      statusCaption = 'Ready';
      if (mobileRelayConfig.relayEnabled && mobileRelayConfig.hasPairing) {
        startMobileRelayPolling();
      }
    } catch (error) {
      lastError = error.toString();
      statusMessage = '初始化失败。';
      statusCaption = 'Error';
    } finally {
      _notifyStateChanged();
    }
  }

  Future<void> setAppearancePreset(String presetId) async {
    if (!hasAppearancePresetConfig(presetId, appearancePresetConfigs)) {
      presetId = AppearancePresetIds.defaultSystem;
    }
    appearancePresetId = presetId;
    _notifyStateChanged();
    await appearancePreferencesService.save(portableData, presetId);
  }

  Future<void> cycleAppearancePreset() {
    return setAppearancePreset(
      nextAppearancePresetId(appearancePresetId, appearancePresetConfigs),
    );
  }

  Future<void> reloadAppearancePresets() async {
    try {
      final catalog = await appearancePreferencesService.loadCatalog(
        portableData,
      );
      _applyAppearancePresetCatalog(catalog);
      if (!hasAppearancePresetConfig(
        appearancePresetId,
        appearancePresetConfigs,
      )) {
        appearancePresetId = AppearancePresetIds.defaultSystem;
        await appearancePreferencesService.save(
          portableData,
          appearancePresetId,
        );
      }
      statusMessage = appearancePresetLoadErrors.isEmpty
          ? '外观方案已重新加载。'
          : '外观方案已重新加载，部分配置无效。';
      statusCaption = 'Appearance';
    } catch (error) {
      lastError = error.toString();
      statusMessage = '外观方案重新加载失败。';
      statusCaption = 'Error';
    } finally {
      _notifyStateChanged();
    }
  }

  void selectSection(FutureClientSection section) {
    if (currentSection == section) {
      return;
    }
    currentSection = section;
    _notifyStateChanged();
    if (section == FutureClientSection.agents && scannedTargets.isEmpty) {
      unawaited(scanTargets());
    }
  }

  void _applyAppearancePresetCatalog(
    AppearancePresetCatalogLoadResult catalog,
  ) {
    appearancePresetConfigs = catalog.configs;
    appearancePresetDirectoryPath = catalog.directory.path;
    appearancePresetLoadErrors = catalog.errors;
  }

  @override
  void dispose() {
    _disposed = true;
    _mobileRelayTimer?.cancel();
    bootstrapController.dispose();
    super.dispose();
  }
}
