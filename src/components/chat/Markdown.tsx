import type { ReactNode } from "react";

// A deliberately tiny markdown renderer: bold, italics, inline code, bullet and
// numbered lists, and headings-as-bold-lines. No library, no HTML injection —
// everything below builds React nodes from plain strings.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;

function inline(text: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter((part) => part !== "")
    .map((part, i) => {
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="font-semibold text-(--color-bright)">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return (
          <code
            key={i}
            className="rounded-md bg-(--color-ink-soft) px-1.5 py-0.5 text-[0.85em] text-(--color-sea)"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      return <span key={i}>{part}</span>;
    });
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { marker: string; text: string }[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p${blocks.length}`} className="whitespace-pre-wrap leading-relaxed">
        {inline(paragraph.join("\n"))}
      </p>,
    );
    paragraph = [];
  }

  function flushList() {
    if (list.length === 0) return;
    const items = list;
    blocks.push(
      <ul key={`l${blocks.length}`} className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 leading-relaxed">
            <span className="shrink-0 text-(--color-beacon)" aria-hidden>
              {item.marker}
            </span>
            <span className="min-w-0 flex-1">{inline(item.text)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  }

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      list.push({ marker: "•", text: bullet[1] });
      continue;
    }

    const numbered = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      list.push({ marker: `${numbered[1]}.`, text: numbered[2] });
      continue;
    }

    flushList();

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push(
        <p key={`h${blocks.length}`} className="font-semibold text-(--color-bright)">
          {inline(heading[1])}
        </p>,
      );
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    paragraph.push(line);
  }

  flushList();
  flushParagraph();

  return <div className="space-y-2.5 text-[15px] text-(--color-mist)">{blocks}</div>;
}
