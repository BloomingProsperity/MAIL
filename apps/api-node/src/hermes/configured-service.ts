import { randomUUID } from "node:crypto";

import {
  createHermesActionItemExtractService,
  type HermesActionItemExtractService,
} from "./action-items.js";
import {
  createHermesFollowupTrackerService,
  type HermesFollowupTrackerService,
} from "./followup-tracker.js";
import {
  createHermesLabelSuggestService,
  type HermesLabelSuggestService,
} from "./label-suggest.js";
import {
  createHermesNewsletterCleanupService,
  type HermesNewsletterCleanupService,
} from "./newsletter-cleanup.js";
import {
  createHermesPriorityTriageService,
  type HermesPriorityTriageService,
} from "./priority-triage.js";
import {
  createHermesQuickReplyService,
  createHermesReplyDraftService,
  createHermesRewritePolishService,
  type HermesQuickReplyService,
  type HermesReplyDraftService,
  type HermesRewritePolishService,
} from "./drafts.js";
import {
  createHermesEmailSearchQaService,
  type HermesEmailSearchQaService,
} from "./search-qa.js";
import {
  createHermesThreadSummaryService,
  type HermesThreadSummaryService,
} from "./summaries.js";
import {
  createHermesRuntimeTextProvider,
  type HermesRuntimeConfigService,
} from "./runtime-config.js";
import {
  createHermesTranslationService,
  type HermesRunStore,
  type HermesTranslationService,
} from "./translation.js";
import type { HermesMemoryStore } from "./memory-store.js";
import type { MailReadStore } from "../mail-read/mail-read-store.js";

export interface ConfiguredHermesTranslationServiceOptions {
  env?: NodeJS.ProcessEnv;
  runStore?: HermesRunStore;
  memoryStore?: HermesMemoryStore;
  mailReadStore?: Pick<MailReadStore, "listMessages">;
  runtimeConfigService?: Pick<
    HermesRuntimeConfigService,
    "getConnectionSettings"
  >;
  createId?: () => string;
  fetchImpl?: typeof fetch;
}

export function createConfiguredHermesTranslationService(
  options: ConfiguredHermesTranslationServiceOptions = {},
):
  | (HermesTranslationService &
      HermesReplyDraftService &
      HermesQuickReplyService &
      HermesRewritePolishService &
      HermesThreadSummaryService &
      HermesActionItemExtractService &
      HermesLabelSuggestService &
      HermesNewsletterCleanupService &
      HermesPriorityTriageService &
      HermesFollowupTrackerService &
      Partial<HermesEmailSearchQaService>)
  | undefined {
  const textProvider = options.runtimeConfigService
    ? createHermesRuntimeTextProvider({
        runtimeConfigService: options.runtimeConfigService,
        fetchImpl: options.fetchImpl,
      })
    : undefined;
  if (!textProvider) {
    return undefined;
  }

  const serviceOptions = {
    textProvider,
    createId: options.createId ?? randomUUID,
    runStore: options.runStore,
    memoryStore: options.memoryStore,
  };

  return {
    ...createHermesActionItemExtractService(serviceOptions),
    ...createHermesFollowupTrackerService(serviceOptions),
    ...createHermesLabelSuggestService(serviceOptions),
    ...createHermesNewsletterCleanupService(serviceOptions),
    ...createHermesPriorityTriageService(serviceOptions),
    ...createHermesTranslationService(serviceOptions),
    ...createHermesReplyDraftService(serviceOptions),
    ...createHermesQuickReplyService(serviceOptions),
    ...createHermesRewritePolishService(serviceOptions),
    ...createHermesThreadSummaryService(serviceOptions),
    ...(options.mailReadStore
      ? createHermesEmailSearchQaService({
          ...serviceOptions,
          mailReadStore: options.mailReadStore,
        })
      : {}),
  };
}
