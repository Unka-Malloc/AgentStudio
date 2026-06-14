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
  { accent: "#7a4f0e", fill: "rgba(122, 79, 14, 0.09)" },    // brass (brand)
  { accent: "#3a5a7a", fill: "rgba(58, 90, 122, 0.10)" },    // blued steel
  { accent: "#9e2b2b", fill: "rgba(158, 43, 43, 0.09)" },    // industrial rose
  { accent: "#3d7a66", fill: "rgba(61, 122, 102, 0.10)" },   // verdigris
  { accent: "#6e4a0a", fill: "rgba(110, 74, 10, 0.10)" },    // dark bronze
  { accent: "#2c4660", fill: "rgba(44, 70, 96, 0.10)" },     // deep iron-blue
  { accent: "#2e5c4d", fill: "rgba(46, 92, 77, 0.10)" },     // dark patina
  { accent: "#7a2020", fill: "rgba(122, 32, 32, 0.08)" },    // deep crimson
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
