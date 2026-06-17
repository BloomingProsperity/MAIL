import { Sparkles } from "lucide-react";
import type { HermesMessageTranslationResult } from "../../lib/emailHubApi";
import {
  HERMES_SOURCE_LANGUAGES,
  HERMES_TRANSLATION_LANGUAGES,
  hermesTranslationLanguageLabel,
} from "./hermesTranslation";

export function HermesReaderTranslationControls(props: {
  sourceLanguage: string;
  targetLanguage: string;
  busy: boolean;
  onSourceLanguageChange: (value: string) => void;
  onTargetLanguageChange: (value: string) => void;
  onTranslate: () => void;
}) {
  return (
    <div className="reader-translation-control">
      <select
        aria-label="Hermes translation source language"
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
        aria-label="Hermes translation target language"
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
        className="toolbar-button"
        type="button"
        aria-label="Ask Hermes to translate selected message"
        disabled={props.busy}
        onClick={props.onTranslate}
      >
        翻译
      </button>
    </div>
  );
}

export function HermesReaderTranslationResult(props: {
  translation: HermesMessageTranslationResult;
  preferenceBusy: boolean;
  refreshBusy: boolean;
  canRememberPreference: boolean;
  onRememberPreference: () => void;
  onRefresh: () => void;
}) {
  return (
    <div
      className="reason-box hermes-reader-result hermes-translation-result"
      role="status"
      aria-label="Hermes 邮件翻译"
    >
      <div>
        <Sparkles size={18} />
        <strong>
          Hermes 翻译 ·{" "}
          {hermesTranslationLanguageLabel(props.translation.targetLanguage)}
        </strong>
      </div>
      <small>
        {props.translation.cached ? "缓存命中" : "新翻译"} · 运行{" "}
        {props.translation.skillRunId}
        {props.translation.auditEventId
          ? ` · 审计 ${props.translation.auditEventId}`
          : ""}
      </small>
      <p>{props.translation.translatedText}</p>
      <div className="hermes-apply-actions">
        {props.translation.cached ? (
          <button
            className="tiny-button"
            type="button"
            aria-label="Refresh Hermes translation"
            disabled={props.refreshBusy}
            onClick={props.onRefresh}
          >
            {props.refreshBusy ? "重新翻译中" : "重新翻译"}
          </button>
        ) : null}
        <button
          className="tiny-button"
          type="button"
          aria-label="Remember Hermes translation preference"
          disabled={props.preferenceBusy || !props.canRememberPreference}
          title={
            props.canRememberPreference
              ? undefined
              : "请选择明确源语言后再保存翻译习惯"
          }
          onClick={props.onRememberPreference}
        >
          {props.preferenceBusy ? "保存中" : "记住这个翻译习惯"}
        </button>
      </div>
    </div>
  );
}
