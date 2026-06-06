import type {
  EmailMessage,
  EmailThread,
  EmailTransaction,
  KnowledgeNetwork,
  PersonProfile,
  SourceFile,
  TimeWeightedRetrieval,
  TimelineEvent,
  TransactionAssociationCollection,
} from "./entities";
import type { NormalizedDocumentsManifest } from "./documents";

export type SplitOverview = {
  emailCount: number;
  threadCount: number;
  transactionCount: number;
  peopleCount: number;
  timelineCount: number;
  currentCount: number;
  agingCount: number;
  historicalCount: number;
};

export type SplitLifecycleSummary = {
  newCount: number;
  matchedCount: number;
  recoveredCount: number;
  pulledEventCount: number;
  pulledBatchCount: number;
  pulledTransactionCount: number;
  activeLineageCount: number;
  interruptedLineageCount: number;
  archivedLineageCount: number;
};

export type SplitResult = {
  generatedAt: string;
  overview: SplitOverview;
  emails: EmailMessage[];
  threads: EmailThread[];
  transactions: EmailTransaction[];
  people: PersonProfile[];
  timeline: TimelineEvent[];
  network: KnowledgeNetwork;
  associations: TransactionAssociationCollection;
  lifecycle?: SplitLifecycleSummary;
  retrieval: TimeWeightedRetrieval;
  warnings: string[];
  normalizedDocuments?: NormalizedDocumentsManifest;
  sourceFiles: SourceFile[];
};
