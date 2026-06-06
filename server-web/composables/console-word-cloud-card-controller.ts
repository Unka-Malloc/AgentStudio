import { computed, type Ref } from "vue";
import type {
  KnowledgeWordCloud,
  KnowledgeWordCloudSet,
  KnowledgeWordCloudTerm,
} from "../lib/types";
import {
  findWordCloudInTree,
  flattenWordCloudCards as flattenWordCloudCardsCore,
  isWordCloudTailCard,
  type WordCloudCardRow,
} from "./console-word-cloud-utils";

type ConsoleWordCloudCardControllerOptions = {
  collapsedWordBagIds: Ref<Set<string>>;
  pinnedWordBagIds: Ref<Set<string>>;
  selectedWordBagId: Ref<string>;
  wordBagActionMenuId: Ref<string>;
  wordCloudDraft: Ref<KnowledgeWordCloudSet | null>;
};

const wordCloudPalette = [
  { accent: "#2563eb", fill: "rgba(37, 99, 235, 0.09)" },
  { accent: "#059669", fill: "rgba(5, 150, 105, 0.1)" },
  { accent: "#b45309", fill: "rgba(180, 83, 9, 0.1)" },
  { accent: "#7c3aed", fill: "rgba(124, 58, 237, 0.09)" },
  { accent: "#dc2626", fill: "rgba(220, 38, 38, 0.08)" },
  { accent: "#0891b2", fill: "rgba(8, 145, 178, 0.1)" },
  { accent: "#4d7c0f", fill: "rgba(77, 124, 15, 0.1)" },
  { accent: "#be185d", fill: "rgba(190, 24, 93, 0.08)" },
];

export function createConsoleWordCloudCardController(
  options: ConsoleWordCloudCardControllerOptions,
) {
  function flattenWordCloudCards(
    wordBags: KnowledgeWordCloud[] = [],
    depth = 0,
    parent: KnowledgeWordCloud | null = null,
  ): WordCloudCardRow[] {
    return flattenWordCloudCardsCore(
      wordBags,
      { collapsedWordBagIds: options.collapsedWordBagIds.value },
      depth,
      parent,
    );
  }

  const wordCloudCanvasClouds = computed(() => options.wordCloudDraft.value?.wordBags || []);
  const wordCloudCardRows = computed(() => {
    const clouds = wordCloudCanvasClouds.value;
    const pinned = clouds.filter(
      (wordBag) => options.pinnedWordBagIds.value.has(wordBag.wordBagId) && !isWordCloudTailCard(wordBag),
    );
    const normal = clouds.filter(
      (wordBag) => !options.pinnedWordBagIds.value.has(wordBag.wordBagId) && !isWordCloudTailCard(wordBag),
    );
    const tail = clouds.filter((wordBag) => isWordCloudTailCard(wordBag));
    return flattenWordCloudCards([...pinned, ...normal, ...tail]);
  });
  const selectedWordCloud = computed(() =>
    findWordCloudInTree(wordCloudCanvasClouds.value, options.selectedWordBagId.value)?.cloud || null,
  );

  function selectWordCloud(cloud: KnowledgeWordCloud) {
    options.selectedWordBagId.value = cloud.wordBagId;
  }

  function wordCloudVisibleTerms(cloud: KnowledgeWordCloud): Array<KnowledgeWordCloudTerm & { removed: boolean }> {
    return [
      ...(cloud.terms || []).map((term) => ({ ...term, removed: false })),
      ...(cloud.removedTerms || []).map((term) => ({ ...term, removed: true })),
    ];
  }

  function wordCloudCardStyle(row: WordCloudCardRow, index: number) {
    const palette = wordCloudPalette[index % wordCloudPalette.length];
    return {
      "--word-cloud-accent": palette.accent,
      "--word-cloud-fill": palette.fill,
      marginLeft: `${Math.min(row.depth * 22, 132)}px`,
    };
  }

  function toggleWordCloudCollapsed(wordBagId: string) {
    const next = new Set(options.collapsedWordBagIds.value);
    if (next.has(wordBagId)) {
      next.delete(wordBagId);
    } else {
      next.add(wordBagId);
    }
    options.collapsedWordBagIds.value = next;
  }

  function pinWordCloud(wordBagId: string) {
    const next = new Set(options.pinnedWordBagIds.value);
    if (next.has(wordBagId)) {
      next.delete(wordBagId);
    } else {
      next.add(wordBagId);
    }
    options.pinnedWordBagIds.value = next;
  }

  function toggleWordCloudActionMenu(wordBagId: string) {
    options.wordBagActionMenuId.value = options.wordBagActionMenuId.value === wordBagId
      ? ""
      : wordBagId;
  }

  return {
    flattenWordCloudCards,
    pinWordCloud,
    selectWordCloud,
    selectedWordCloud,
    toggleWordCloudActionMenu,
    toggleWordCloudCollapsed,
    wordCloudCanvasClouds,
    wordCloudCardRows,
    wordCloudCardStyle,
    wordCloudPalette,
    wordCloudVisibleTerms,
  };
}
