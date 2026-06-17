import { FileText, Sparkles } from "lucide-react";
import type { HermesQuickReplyScenario } from "../../lib/emailHubApi";
import {
  HERMES_SOURCE_LANGUAGES,
  HERMES_TRANSLATION_LANGUAGES,
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
  return (
    <div className="composer-tool-row">
      <div className="compose-translate-controls" aria-label="Compose translation controls">
        <select
          aria-label="Compose translation source language"
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
          aria-label="Compose translation target language"
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
          aria-label="Translate composed draft with Hermes"
          disabled={props.busy}
          onClick={props.onTranslate}
        >
          <Sparkles size={14} />
          翻译
        </button>
      </div>
      <button
        className="tiny-button"
        type="button"
        aria-label="Polish composed draft with Hermes"
        disabled={props.busy}
        onClick={props.onPolish}
      >
        <Sparkles size={14} />
        润色
      </button>
      <button
        className="tiny-button"
        type="button"
        aria-label="Preview composed draft"
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
          aria-label="Ask Hermes to draft reply"
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
            aria-label={`Ask Hermes quick reply ${action.scenario}`}
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
