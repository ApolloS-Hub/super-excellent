import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme, DEFAULT_THEME } from "@mantine/core";
import "@mantine/core/styles.css";
import "./i18n";
import App from "./App";
import "./styles.css";

// Modern theme — indigo primary, refined typography, better defaults
const theme = createTheme({
  primaryColor: "indigo",
  primaryShade: { light: 6, dark: 5 },
  // Typography — use variable font stack with modern system fonts
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif",
  fontFamilyMonospace:
    "'SF Mono', 'Menlo', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
  headings: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif",
    fontWeight: "600",
  },
  defaultRadius: "md",
  radius: {
    xs: "4px",
    sm: "6px",
    md: "10px",
    lg: "14px",
    xl: "20px",
  },
  // More refined spacing scale
  spacing: {
    xs: "8px",
    sm: "12px",
    md: "16px",
    lg: "24px",
    xl: "32px",
  },
  // Accent colors for worker states
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
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
