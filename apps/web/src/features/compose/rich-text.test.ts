import { describe, expect, it } from "vitest";
import {
  composeBodyHtmlForPayload,
  composePlainTextToHtml,
  formatComposeSelection,
} from "./rich-text";

describe("compose rich text helpers", () => {
  it("omits bodyHtml until rich formatting is enabled", () => {
    expect(composeBodyHtmlForPayload("Hello", false)).toBeUndefined();
    expect(composeBodyHtmlForPayload("   ", true)).toBeUndefined();
    expect(composeBodyHtmlForPayload("Hello", true)).toBe("<p>Hello</p>");
  });

  it("renders paragraphs, inline markup, links, lists, and escaped text", () => {
    expect(
      composePlainTextToHtml(
        "Hello **Lina**\nSee [plan](https://example.com?a=1&b=2)\n\n- one <draft>\n- *two*",
      ),
    ).toBe(
      '<p>Hello <strong>Lina</strong><br>See <a href="https://example.com?a=1&amp;b=2">plan</a></p><ul><li>one &lt;draft&gt;</li><li><em>two</em></li></ul>',
    );
  });

  it("renders quoted blocks without leaking raw html", () => {
    expect(composePlainTextToHtml("> Please review\n> <script>alert(1)</script>")).toBe(
      "<blockquote><p>Please review<br>&lt;script&gt;alert(1)&lt;/script&gt;</p></blockquote>",
    );
  });

  it("wraps selected text with stable cursor ranges", () => {
    expect(formatComposeSelection("bold", "Launch")).toEqual({
      text: "**Launch**",
      selectionStart: 2,
      selectionEnd: 8,
    });
    expect(formatComposeSelection("link", "Spec")).toEqual({
      text: "[Spec](https://example.com)",
      selectionStart: 7,
      selectionEnd: 26,
    });
    expect(formatComposeSelection("quote", "Line one\nLine two")).toEqual({
      text: "> Line one\n> Line two",
      selectionStart: 21,
      selectionEnd: 21,
    });
  });
});
