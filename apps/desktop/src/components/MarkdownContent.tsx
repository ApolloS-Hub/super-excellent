/**
 * MarkdownContent — enhanced rendering with language labels + copy buttons
 * Uses react-markdown + remark-gfm for reliable rendering
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useState, useCallback, useMemo, type ReactNode } from "react";
import { useMantineColorScheme } from "@mantine/core";
import { extractWidgets, hasWidgets, WidgetRenderer } from "./GenerativeUI";

/** Extracts language name from className like "language-typescript" */
function extractLang(className?: string): string | null {
  if (!className) return null;
  const match = className.match(/language-(\w+)/);
  return match ? match[1] : null;
}

/** Copy button for code blocks */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        border: "none",
        background: "rgba(255,255,255,0.1)",
        color: copied ? "#4ade80" : "#9ca3af",
        cursor: "pointer",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 11,
        fontFamily: "inherit",
        transition: "color 0.2s, background 0.2s",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.2)")}
      onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

const MarkdownComponents: Components = {
  h1: ({ children }) => <h1 style={{ fontWeight: 700, margin: "0.6em 0 0.3em", fontSize: "1.4em" }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontWeight: 700, margin: "0.5em 0 0.3em", fontSize: "1.2em" }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontWeight: 600, margin: "0.4em 0 0.2em", fontSize: "1.1em" }}>{children}</h3>,

  p: ({ children }) => <p style={{ margin: "0.4em 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{children}</p>,

  ul: ({ children }) => <ul style={{ margin: "0.4em 0", paddingLeft: "1.5em" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "0.4em 0", paddingLeft: "1.5em" }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: "0.15em 0" }}>{children}</li>,

  code: ({ className, children, ...props }) => {
    const lang = extractLang(className);
    const isBlock = !!lang;
    if (isBlock) {
      return <code className={className} style={{ fontSize: 13 }} {...props}>{children}</code>;
    }
    return (
      <code style={{
        padding: "1px 5px",
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "0.9em",
        backgroundColor: "rgba(127, 127, 127, 0.15)",
      }} className="md-inline-code">{children}</code>
    );
  },

  pre: ({ children }) => {
    // Extract text content and language from the <code> child
    let codeText = "";
    let lang: string | null = null;
    const codeChild = children as ReactNode;

    // Walk through children to find the code element
    if (codeChild && typeof codeChild === "object" && "props" in codeChild) {
      const codeProps = (codeChild as { props: { children?: ReactNode; className?: string } }).props;
      lang = extractLang(codeProps.className || "");
      if (typeof codeProps.children === "string") {
        codeText = codeProps.children;
      } else if (Array.isArray(codeProps.children)) {
        codeText = codeProps.children.map((c: unknown) => typeof c === "string" ? c : "").join("");
      }
    }

    return (
      <pre className="md-code-block" style={{
        margin: "0.5em 0",
        borderRadius: 8,
        overflow: "hidden",
        position: "relative",
      }}>
        {/* Language label + copy button header */}
        {(lang || codeText) && (
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "4px 12px",
            fontSize: 11,
            color: "#9ca3af",
            borderBottom: "1px solid rgba(127,127,127,0.15)",
          }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", textTransform: "lowercase" }}>
              {lang || "text"}
            </span>
          </div>
        )}
        <div style={{
          padding: "12px 16px",
          overflowX: "auto",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13,
          lineHeight: 1.5,
          position: "relative",
        }}>
          {codeText && <CopyButton text={codeText} />}
          {children}
        </div>
      </pre>
    );
  },

  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="md-link"
       style={{ textDecoration: "none", color: "var(--mantine-color-blue-5)" }}
       onMouseEnter={e => (e.target as HTMLElement).style.textDecoration = "underline"}
       onMouseLeave={e => (e.target as HTMLElement).style.textDecoration = "none"}>
      {children}
    </a>
  ),

  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "0.5em 0" }}>
      <table className="md-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>{children}</table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => <th className="md-table-th" style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, borderBottom: "2px solid rgba(127,127,127,0.3)" }}>{children}</th>,
  td: ({ children }: { children?: ReactNode }) => <td className="md-table-td" style={{ padding: "6px 10px", borderBottom: "1px solid rgba(127,127,127,0.15)" }}>{children}</td>,

  blockquote: ({ children }) => (
    <blockquote className="md-blockquote" style={{ margin: "0.5em 0", padding: "0.3em 0.8em", borderRadius: "0 4px 4px 0", borderLeft: "3px solid var(--mantine-color-blue-5)", opacity: 0.9 }}>
      {children}
    </blockquote>
  ),

  hr: () => <hr className="md-hr" style={{ border: "none", margin: "0.8em 0", borderTop: "1px solid rgba(127,127,127,0.2)" }} />,

  strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
};

const remarkPlugins = [remarkGfm];

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const { colorScheme } = useMantineColorScheme();

  const { cleanContent, widgets } = useMemo(() => {
    if (!hasWidgets(content)) return { cleanContent: content, widgets: [] };
    return extractWidgets(content);
  }, [content]);

  return (
    <div className={`md-content ${className || ""}`} data-theme={colorScheme}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={MarkdownComponents}>
        {cleanContent}
      </ReactMarkdown>
      {widgets.map((w, i) => (
        <div key={i} style={{ margin: "8px 0" }}>
          <WidgetRenderer widget={w} />
        </div>
      ))}
    </div>
  );
}
