/**
 * Device Frames — pixel-accurate hardware bezels for prototype previews.
 *
 * Inspired by huashu-design's ios_frame.jsx / macos_window.jsx / browser_window.jsx.
 * Each frame wraps arbitrary children in a realistic device chrome.
 * Use with the design-deliverables skill to present prototypes professionally.
 */
import type { ReactNode, CSSProperties } from "react";

interface FrameProps {
  children: ReactNode;
  width?: number;
  style?: CSSProperties;
}

// ═══════════ iPhone Frame ═══════════

export function IPhoneFrame({ children, width = 375, style }: FrameProps) {
  const scale = width / 375;
  return (
    <div style={{
      width: width + 24,
      background: "#1a1a1a",
      borderRadius: 44 * scale,
      padding: `${12 * scale}px`,
      boxShadow: "0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1) inset",
      ...style,
    }}>
      {/* Dynamic Island */}
      <div style={{
        width: 126 * scale,
        height: 36 * scale,
        background: "#000",
        borderRadius: 18 * scale,
        margin: `0 auto ${8 * scale}px`,
      }} />
      {/* Screen */}
      <div style={{
        width,
        height: width * (812 / 375),
        borderRadius: 32 * scale,
        overflow: "hidden",
        background: "#fff",
      }}>
        {children}
      </div>
      {/* Home indicator */}
      <div style={{
        width: 134 * scale,
        height: 5 * scale,
        background: "rgba(255,255,255,0.3)",
        borderRadius: 3 * scale,
        margin: `${8 * scale}px auto 0`,
      }} />
    </div>
  );
}

// ═══════════ macOS Window ═══════════

export function MacWindowFrame({ children, width = 800, style }: FrameProps & { title?: string }) {
  const title = (style as any)?.["data-title"] || "Untitled";
  return (
    <div style={{
      width,
      background: "var(--color-bg, #fff)",
      borderRadius: 10,
      boxShadow: "0 10px 40px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.1)",
      overflow: "hidden",
      ...style,
    }}>
      {/* Title bar */}
      <div style={{
        height: 38,
        background: "linear-gradient(180deg, #e8e8e8 0%, #d4d4d4 100%)",
        borderBottom: "1px solid #bbb",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 8,
      }}>
        {/* Traffic lights */}
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
        <div style={{
          flex: 1,
          textAlign: "center",
          fontSize: 13,
          fontWeight: 500,
          color: "#4d4d4d",
          fontFamily: "-apple-system, sans-serif",
        }}>
          {title}
        </div>
        <div style={{ width: 52 }} /> {/* Balance */}
      </div>
      {/* Content */}
      <div style={{ overflow: "auto" }}>
        {children}
      </div>
    </div>
  );
}

// ═══════════ Browser Window ═══════════

export function BrowserFrame({ children, width = 800, style }: FrameProps & { url?: string }) {
  const url = (style as any)?.["data-url"] || "https://example.com";
  return (
    <div style={{
      width,
      background: "var(--color-bg, #fff)",
      borderRadius: 8,
      boxShadow: "0 8px 30px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.08)",
      overflow: "hidden",
      ...style,
    }}>
      {/* Chrome */}
      <div style={{
        height: 42,
        background: "#f0f0f0",
        borderBottom: "1px solid #ddd",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 8,
      }}>
        {/* Nav buttons */}
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ccc" }} />
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ccc" }} />
        </div>
        {/* URL bar */}
        <div style={{
          flex: 1,
          height: 28,
          background: "#fff",
          borderRadius: 6,
          border: "1px solid #ddd",
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          fontSize: 12,
          color: "#666",
          fontFamily: "var(--font-mono, monospace)",
        }}>
          🔒 {url}
        </div>
      </div>
      {/* Content */}
      <div style={{ overflow: "auto" }}>
        {children}
      </div>
    </div>
  );
}

// ═══════════ Design Canvas (side-by-side variants) ═══════════

interface DesignCanvasProps {
  variants: Array<{
    label: string;
    description?: string;
    children: ReactNode;
  }>;
  columns?: 2 | 3;
}

export function DesignCanvas({ variants, columns = 3 }: DesignCanvasProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${Math.min(columns, variants.length)}, 1fr)`,
      gap: 24,
      padding: 16,
    }}>
      {variants.map((v, i) => (
        <div key={i} style={{
          border: "1px solid var(--color-border, #eee)",
          borderRadius: 12,
          overflow: "hidden",
        }}>
          <div style={{
            padding: "8px 12px",
            background: "var(--color-primary-light, #f5f5ff)",
            borderBottom: "1px solid var(--color-border, #eee)",
          }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{v.label}</div>
            {v.description && (
              <div style={{ fontSize: 11, color: "var(--color-text-secondary, #888)", marginTop: 2 }}>
                {v.description}
              </div>
            )}
          </div>
          <div style={{ padding: 12 }}>
            {v.children}
          </div>
        </div>
      ))}
    </div>
  );
}
