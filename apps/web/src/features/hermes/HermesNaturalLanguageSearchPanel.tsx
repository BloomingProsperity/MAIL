import { Sparkles } from "lucide-react";
import type { FormEvent } from "react";

import type { HermesEmailSearchQaResult } from "../../lib/emailHubApi";

export function HermesNaturalLanguageSearchPanel(props: {
  query: string;
  busy: boolean;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onSubmit();
  }

  return (
    <form
      className="search-form hermes-search-form"
      aria-label="Hermes 自然语言搜索"
      onSubmit={submit}
    >
      <label className="large-search">
        <Sparkles size={21} />
        <input
          aria-label="Hermes 搜索问题"
          placeholder="问 Hermes：上次客户提到的合同在哪里？"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
      </label>
      <button className="primary-button" type="submit" disabled={props.busy}>
        {props.busy ? "Hermes 搜索中" : "让 Hermes 搜索"}
      </button>
    </form>
  );
}

export function HermesSearchAnswerPanel(props: {
  result?: HermesEmailSearchQaResult;
  formatDate: (value: string) => string;
}) {
  if (!props.result) {
    return null;
  }

  const result = props.result;
  return (
    <section
      className="dock-result hermes-search-answer"
      aria-label="Hermes 搜索回答"
    >
      <div className="dock-result-head">
        <strong>Hermes 搜索回答</strong>
        <span>{result.searchQuery}</span>
      </div>
      {result.searchPlan.filters.length > 0 ? (
        <div className="dock-plan-steps" aria-label="Hermes 搜索条件">
          {result.searchPlan.filters.slice(0, 6).map((filter) => (
            <span key={`${filter.field}-${filter.label}`}>{filter.label}</span>
          ))}
        </div>
      ) : null}
      <p>{result.answerText}</p>
      {result.citations.length > 0 ? (
        <div className="dock-citations" aria-label="Hermes 引用邮件">
          {result.citations.slice(0, 5).map((citation) => (
            <article
              className="dock-citation"
              key={`${citation.messageId}-${citation.resultIndex}`}
            >
              <span>{citation.subject}</span>
              <small>
                {citation.from.name ?? citation.from.email} ·{" "}
                {props.formatDate(citation.receivedAt)} · {citation.bucket}
              </small>
              {citation.snippet || citation.searchPreview?.text ? (
                <small>{citation.searchPreview?.text ?? citation.snippet}</small>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
