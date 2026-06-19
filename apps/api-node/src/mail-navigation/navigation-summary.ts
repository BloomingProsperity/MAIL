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

export interface FolderCount {
  id: string;
  count: number;
}

export interface QuickCategoryDefinition {
  id: string;
  label: string;
  tone: MailNavigationTone;
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

export interface FolderSummary {
  id: string;
  label: string;
  count: number;
}

export interface MailNavigationSummary {
  folders: FolderSummary[];
  providerGroups: ProviderGroupSummary[];
  quickCategories: QuickCategorySummary[];
}

export interface MailNavigationStore {
  listProviderCounts(): Promise<ProviderCount[]>;
  listFolderCounts(): Promise<FolderCount[]>;
  listQuickCategoryCounts(): Promise<QuickCategoryCount[]>;
  listQuickCategories?(): Promise<QuickCategoryDefinition[]>;
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

const FOLDERS: Array<{ id: string; label: string }> = [
  { id: "inbox", label: "收件箱" },
  { id: "drafts", label: "草稿" },
  { id: "sent", label: "已发送" },
  { id: "trash", label: "已删除" },
  { id: "junk", label: "垃圾邮件" },
  { id: "archive", label: "归档" },
  { id: "all", label: "所有邮件" },
  { id: "flagged", label: "已标记" },
  { id: "snoozed", label: "稍后提醒" },
  { id: "attachments", label: "附件" },
];

export function createMailNavigationSummaryService(
  store: MailNavigationStore,
): MailNavigationSummaryService {
  return {
    async getSummary() {
      const [providerCounts, folderCounts, quickCategoryCounts, dynamicCategories] =
        await Promise.all([
          store.listProviderCounts(),
          store.listFolderCounts(),
          store.listQuickCategoryCounts(),
          store.listQuickCategories
            ? store.listQuickCategories()
            : Promise.resolve([]),
        ]);
      const quickCountsById = new Map(
        quickCategoryCounts.map((item) => [item.id, item.count]),
      );
      const folderCountsById = new Map(
        folderCounts.map((item) => [item.id, item.count]),
      );
      const quickCategories = mergeQuickCategories(dynamicCategories);

      return {
        folders: FOLDERS.map((folder) => ({
          id: folder.id,
          label: folder.label,
          count: folderCountsById.get(folder.id) ?? 0,
        })),
        providerGroups: groupProviderCounts(providerCounts),
        quickCategories: quickCategories.map((category) => ({
          id: category.id,
          label: category.label,
          tone: category.tone,
          count: quickCountsById.get(category.id) ?? 0,
        })),
      };
    },
  };
}

function mergeQuickCategories(
  dynamicCategories: QuickCategoryDefinition[],
): QuickCategoryDefinition[] {
  const categories = new Map<string, QuickCategoryDefinition>();
  for (const view of getBuiltInSavedViews()) {
    categories.set(view.id, {
      id: view.id,
      label: view.label,
      tone: view.tone,
    });
  }
  for (const category of dynamicCategories) {
    if (!categories.has(category.id)) {
      categories.set(category.id, category);
    }
  }
  return [...categories.values()];
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
