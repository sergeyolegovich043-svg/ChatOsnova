import { Fragment, useState, type ReactNode } from "react";

const inlineTokenPattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\|\|[^|\n]+\|\||@[A-Za-z0-9_]+)/g;

export function mentionsUsername(body: string, username: string) {
  return new RegExp(`(^|\\s)@${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|[.,!?;:]|$)`, "i").test(body);
}

function InlineText({ text, currentUsername }: { text: string; currentUsername: string }) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  inlineTokenPattern.lastIndex = 0;
  while ((match = inlineTokenPattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = index++;
    if (token.startsWith("**")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("__")) nodes.push(<em key={key}>{token.slice(2, -2)}</em>);
    else if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("||")) {
      nodes.push(
        <button
          className={`message-spoiler ${revealed.has(key) ? "revealed" : ""}`}
          type="button"
          key={key}
          onClick={() => setRevealed((current) => new Set(current).add(key))}
        >
          {token.slice(2, -2)}
        </button>
      );
    } else {
      const own = token.slice(1).toLowerCase() === currentUsername.toLowerCase();
      nodes.push(<span className={`message-mention ${own ? "mention-me" : ""}`} key={key}>{token}</span>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

export function FormattedMessage({ body, currentUsername }: { body: string; currentUsername: string }) {
  return (
    <p className="message-text">
      {body.split("\n").map((line, index, lines) => (
        <Fragment key={index}>
          {line.startsWith("> ") ? (
            <span className="message-quote"><InlineText text={line.slice(2)} currentUsername={currentUsername} /></span>
          ) : (
            <InlineText text={line} currentUsername={currentUsername} />
          )}
          {index < lines.length - 1 && <br />}
        </Fragment>
      ))}
    </p>
  );
}
