import { getBuiltInSavedViews } from "./saved-views.js";

export type MailNavigationTone = "coral" | "blue" | "green" | "yellow" | "purple";

export interface ProviderCount {
  provider: string;
  count: number;
}

export interface QuickCategoryCount {
  id: string;
  count: number;
}

export interface ProviderGroupSummary {
  id: string;
  label: string;
  count: number;
}

export interface QuickCategorySummary {
  id: string;
  label: string;
  count: number;
  tone: MailNavigationTone;
}

export interface MailNavigationSummary {
  providerGroups: ProviderGroupSummary[];
  quickCategories: QuickCategorySummary[];
}

export interface MailNavigationStore {
  listProviderCounts(): Promise<ProviderCount[]>;
  listQuickCategoryCounts(): Promise<QuickCategoryCount[]>;
}

export interface MailNavigationSummaryService {
  getSummary(): Promise<MailNavigationSummary>;
}

const PROVIDER_GROUPS: Array<{
  id: string;
  label: string;
  providers: string[];
}> = [
  { id: "gmail", label: "Gmail", providers: ["gmail", "google"] },
  {
    id: "outlook",
    label: "Outlook",
    providers: ["outlook", "microsoft", "office365", "m365"],
  },
  { id: "icloud", label: "iCloud", providers: ["icloud", "apple"] },
  {
    id: "domestic",
    label: "163 / QQ",
    providers: ["163", "netease", "qq", "qqmail", "tencent_exmail", "exmail"],
  },
  {
    id: "proton",
    label: "Proton",
    providers: ["proton", "protonmail", "proton_bridge"],
  },
  {
    id: "domain",
    label: "个人域名",
    providers: [
      "custom",
      "custom_domain",
      "domain",
      "personal_domain",
      "imap",
      "imap_smtp",
    ],
  },
];

export function createMailNavigationSummaryService(
  store: MailNavigationStore,
): MailNavigationSummaryService {
  return {
    async getSummary() {
      const [providerCounts, quickCategoryCounts] = await Promise.all([
        store.listProviderCounts(),
        store.listQuickCategoryCounts(),
      ]);
      const quickCountsById = new Map(
        quickCategoryCounts.map((item) => [item.id, item.count]),
      );

      return {
        providerGroups: groupProviderCounts(providerCounts),
        quickCategories: getBuiltInSavedViews().map((view) => ({
          id: view.id,
          label: view.label,
          tone: view.tone,
          count: quickCountsById.get(view.id) ?? 0,
        })),
      };
    },
  };
}

function groupProviderCounts(counts: ProviderCount[]): ProviderGroupSummary[] {
  const countsByProvider = new Map(
    counts.map((item) => [normalizeProvider(item.provider), item.count]),
  );

  return PROVIDER_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    count: group.providers.reduce(
      (total, provider) => total + (countsByProvider.get(provider) ?? 0),
      0,
    ),
  }));
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase().replace(/[\s.-]/g, "_");
}
