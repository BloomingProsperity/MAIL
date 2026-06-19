import { FileText, Sparkles } from "lucide-react";
import type { HermesQuickReplyScenario } from "../../lib/emailHubApi";
import {
  HERMES_SOURCE_LANGUAGES,
  HERMES_TRANSLATION_LANGUAGES,
  isHermesNoopTranslation,
} from "./hermesTranslation";

export type HermesQuickReplyAction = {
  scenario: HermesQuickReplyScenario;
  label: string;
  instruction: string;
};

export const HERMES_QUICK_REPLY_ACTIONS: HermesQuickReplyAction[] = [
  {
    scenario: "confirm",
    label: "确认",
    instruction: "Confirm politely and keep it concise.",
  },
  {
    scenario: "thanks",
    label: "感谢",
    instruction: "Thank them warmly and keep the reply short.",
  },
  {
    scenario: "follow_up",
    label: "推进",
    instruction: "Follow up with a clear next step.",
  },
  {
    scenario: "decline",
    label: "婉拒",
    instruction: "Decline politely without over-explaining.",
  },
];

export function HermesComposeDraftTools(props: {
  sourceLanguage: string;
  targetLanguage: string;
  busy: boolean;
  onSourceLanguageChange: (value: string) => void;
  onTargetLanguageChange: (value: string) => void;
  onTranslate: () => void;
  onPolish: () => void;
  onPreview: () => void;
}) {
  const sameExplicitLanguage = isHermesNoopTranslation(
    props.sourceLanguage,
    props.targetLanguage,
  );

  return (
    <div className="composer-tool-row">
      <div className="compose-translate-controls" aria-label="Hermes 草稿翻译">
        <select
          aria-label="草稿源语言"
          value={props.sourceLanguage}
          disabled={props.busy}
          onChange={(event) => props.onSourceLanguageChange(event.target.value)}
        >
          {HERMES_SOURCE_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
        <select
          aria-label="草稿目标语言"
          value={props.targetLanguage}
          disabled={props.busy}
          onChange={(event) => props.onTargetLanguageChange(event.target.value)}
        >
          {HERMES_TRANSLATION_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
        <button
          className="tiny-button"
          type="button"
          aria-label="让 Hermes 翻译草稿"
          disabled={props.busy || sameExplicitLanguage}
          title={
            sameExplicitLanguage ? "源语言和目标语言相同，无需翻译" : undefined
          }
          onClick={props.onTranslate}
        >
          <Sparkles size={14} />
          翻译
        </button>
      </div>
      <button
        className="tiny-button"
        type="button"
        aria-label="让 Hermes 润色草稿"
        disabled={props.busy}
        onClick={props.onPolish}
      >
        <Sparkles size={14} />
        润色
      </button>
      <button
        className="tiny-button"
        type="button"
        aria-label="预览草稿"
        disabled={props.busy}
        onClick={props.onPreview}
      >
        <FileText size={14} />
        预览
      </button>
    </div>
  );
}

export function HermesReplyAssistantPanel(props: {
  fromLabel: string;
  busy: boolean;
  onDraftReply: () => void;
  onQuickReply: (action: HermesQuickReplyAction) => void;
}) {
  return (
    <div className="reply-toolbox">
      <div className="composer-top">
        <span>From: {props.fromLabel}</span>
        <button
          type="button"
          aria-label="让 Hermes 写回复"
          disabled={props.busy}
          onClick={props.onDraftReply}
        >
          Hermes 写回复
        </button>
      </div>
      <div className="quick-reply-row" aria-label="Hermes 快速回复">
        {HERMES_QUICK_REPLY_ACTIONS.map((action) => (
          <button
            key={action.scenario}
            type="button"
            aria-label={`让 Hermes 快速回复 ${action.label}`}
            disabled={props.busy}
            onClick={() => props.onQuickReply(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
