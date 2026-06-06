import type { ConsolePhrasePair } from './console-phrase-types';
import { debugPhrasePairs } from './console-phrases/debug';
import { governanceWorkspacesFeedPhrasePairs } from './console-phrases/governance-workspaces-feed';
import { knowledgePhrasePairs } from './console-phrases/knowledge';
import { opsProductionPhrasePairs } from './console-phrases/ops-production';
import { shellCorePhrasePairs } from './console-phrases/shell-core';
export type { ConsolePhrasePair } from './console-phrase-types';
export { consoleSegmentPairs } from './console-phrases/segments';

export const consolePhrasePairs: ConsolePhrasePair[] = [
  ...shellCorePhrasePairs,
  ...debugPhrasePairs,
  ...knowledgePhrasePairs,
  ...governanceWorkspacesFeedPhrasePairs,
  ...opsProductionPhrasePairs,
];
