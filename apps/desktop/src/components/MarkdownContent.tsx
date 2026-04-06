/**
 * MarkdownContent — based on Hive's implementation
 * Uses react-markdown + remark-gfm for reliable rendering
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { ReactNode } from "react";
import { useMantineColorScheme } from "@mantine/core";

const MarkdownComponents: Components = {
  h1: ({ children }) => <h1 style={{ fontWeight: 700, margin: "0.6em 0 0.3em", fontSize: "1.4em" }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontWeight: 700, margin: "0.5em 0 0.3em", fontSize: "1.2em" }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontWeight: 600, margin: "0.4em 0 0.2em", fontSize: "1.1em" }}>{children}</h3>,

  p: ({ children }) => <p style={{ margin: "0.4em 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{children}</p>,

  ul: ({ children }) => <ul style={{ margin: "0.4em 0", paddingLeft: "1.5em" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "0.4em 0", paddingLeft: "1.5em" }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: "0.15em 0" }}>{children}</li>,

  code: ({ className, children, ...props }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return <code className={className} style={{ fontSize: 13 }} {...props}>{children}</code>;
    }
    return (
      <code style={{
        padding: "1px 5px",
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "0.9em",
      }} className="md-inline-code">{children}</code>
    );
  },

  pre: ({ children }) => (
    <pre className="md-code-block" style={{
      margin: "0.5em 0",
      borderRadius: 8,
      overflow: "hidden",
    }}>
      <div style={{ padding: "12px 16px", overflowX: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.5 }}>
        {children}
      </div>
    </pre>
  ),

  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="md-link"
       style={{ textDecoration: "none" }}
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
  th: ({ children }: { children?: ReactNode }) => <th className="md-table-th" style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600 }}>{children}</th>,
  td: ({ children }: { children?: ReactNode }) => <td className="md-table-td" style={{ padding: "6px 10px" }}>{children}</td>,

  blockquote: ({ children }) => (
    <blockquote className="md-blockquote" style={{ margin: "0.5em 0", padding: "0.3em 0.8em", borderRadius: "0 4px 4px 0" }}>
      {children}
    </blockquote>
  ),

  hr: () => <hr className="md-hr" style={{ border: "none", margin: "0.8em 0" }} />,
};

const remarkPlugins = [remarkGfm];

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const { colorScheme } = useMantineColorScheme();
  return (
    <div className={`md-content ${className || ""}`} data-theme={colorScheme}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={MarkdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
