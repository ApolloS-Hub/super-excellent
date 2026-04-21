import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme, DEFAULT_THEME } from "@mantine/core";
import "@mantine/core/styles.css";
import "./i18n";
import App from "./App";
import "./styles.css";

// Refined minimal theme — Linear / Claude.ai / Raycast direction.
// System font stack everywhere, calibrated spacing scale, 2025-era radii.
const theme = createTheme({
  primaryColor: "indigo",
  primaryShade: { light: 6, dark: 4 },
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif",
  fontFamilyMonospace:
    "'SF Mono', 'JetBrains Mono', 'Menlo', 'Fira Code', Consolas, monospace",
  headings: {
    // Keep the same sans stack as body — dated serifs don't belong in app chrome.
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif",
    fontWeight: "600",
    sizes: {
      h1: { fontSize: "1.75rem", lineHeight: "1.25", fontWeight: "650" },
      h2: { fontSize: "1.375rem", lineHeight: "1.3", fontWeight: "640" },
      h3: { fontSize: "1.125rem", lineHeight: "1.35", fontWeight: "630" },
      h4: { fontSize: "1rem", lineHeight: "1.4", fontWeight: "620" },
    },
  },
  defaultRadius: "md",
  radius: {
    xs: "4px",
    sm: "6px",
    md: "8px",
    lg: "12px",
    xl: "18px",
  },
  spacing: {
    xs: "6px",
    sm: "10px",
    md: "14px",
    lg: "20px",
    xl: "28px",
  },
  colors: {
    ...DEFAULT_THEME.colors,
    brand: [
      "#eef2ff",
      "#e0e7ff",
      "#c7d2fe",
      "#a5b4fc",
      "#818cf8",
      "#6366f1",
      "#4f46e5",
      "#4338ca",
      "#3730a3",
      "#312e81",
    ],
  },
  components: {
    Button: {
      defaultProps: { radius: "md" },
    },
    ActionIcon: {
      defaultProps: { radius: "md" },
    },
    Paper: {
      defaultProps: { radius: "md" },
    },
    Card: {
      defaultProps: { radius: "lg" },
    },
    TextInput: {
      defaultProps: { radius: "md" },
    },
    Notification: {
      defaultProps: { radius: "md" },
    },
    Tabs: {
      defaultProps: { radius: "md" },
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
