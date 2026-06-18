import { Sparkles } from "lucide-react";
import type { FormEvent } from "react";

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
