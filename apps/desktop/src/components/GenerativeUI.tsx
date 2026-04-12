/**
 * Generative UI — AI generates interactive visual components
 * Parses special markdown blocks: ```widget-chart / ```widget-form / ```widget-table
 * Renders inline charts (SVG), forms (Mantine), and data tables (Mantine)
 *
 * Inspired by CodePilot's WidgetRenderer.tsx
 */
import { useState, useMemo, useCallback } from "react";
import {
  Paper, Text, Group, Badge, Stack, Button, TextInput,
  Select, Textarea, Table, ScrollArea, Box,
  useMantineColorScheme,
} from "@mantine/core";
import { useTranslation } from "react-i18next";

// ═══════════ Types ═══════════

export type WidgetType = "chart" | "form" | "table";

export interface WidgetBlock {
  type: WidgetType;
  rawContent: string;
  parsed: unknown;
}

// ═══════════ Parser ═══════════

const WIDGET_REGEX = /```widget-(chart|form|table)\n([\s\S]*?)```/g;

/** Extract widget blocks from markdown content */
export function extractWidgets(content: string): { cleanContent: string; widgets: WidgetBlock[] } {
  const widgets: WidgetBlock[] = [];
  const cleanContent = content.replace(WIDGET_REGEX, (_match, type: string, raw: string) => {
    try {
      const parsed = JSON.parse(raw.trim());
      widgets.push({ type: type as WidgetType, rawContent: raw.trim(), parsed });
    } catch {
      widgets.push({ type: type as WidgetType, rawContent: raw.trim(), parsed: null });
    }
    return ""; // Remove from markdown
  });
  return { cleanContent: cleanContent.trim(), widgets };
}

/** Check if content has widget blocks */
export function hasWidgets(content: string): boolean {
  return WIDGET_REGEX.test(content);
}

// ═══════════ Chart Widget (SVG) ═══════════

interface ChartData {
  type: "bar" | "pie" | "line";
  title?: string;
  labels: string[];
  values: number[];
  colors?: string[];
}

const DEFAULT_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#f97316", "#14b8a6", "#6366f1",
];

function ChartWidget({ data, isDark }: { data: ChartData; isDark: boolean }) {
  const colors = data.colors || DEFAULT_COLORS;
  const textColor = isDark ? "#e5e7eb" : "#1f2937";
  const dimColor = isDark ? "#9ca3af" : "#6b7280";

  if (data.type === "bar") return <BarChart data={data} colors={colors} textColor={textColor} dimColor={dimColor} />;
  if (data.type === "pie") return <PieChart data={data} colors={colors} textColor={textColor} dimColor={dimColor} />;
  if (data.type === "line") return <LineChart data={data} colors={colors} textColor={textColor} dimColor={dimColor} />;
  return <Text size="xs" c="dimmed">Unsupported chart type: {data.type}</Text>;
}

function BarChart({ data, colors, textColor, dimColor }: {
  data: ChartData; colors: string[]; textColor: string; dimColor: string;
}) {
  const maxVal = Math.max(...data.values, 1);
  const barW = Math.max(20, Math.min(50, 360 / data.values.length - 8));
  const chartH = 140;
  const svgW = data.values.length * (barW + 8) + 60;

  return (
    <svg width="100%" viewBox={`0 0 ${svgW} ${chartH + 40}`} style={{ display: "block", maxWidth: svgW }}>
      {data.title && (
        <text x={svgW / 2} y={14} textAnchor="middle" fontSize={12} fontWeight={600} fill={textColor}>
          {data.title}
        </text>
      )}
      {data.values.map((v, i) => {
        const barH = (v / maxVal) * chartH;
        const x = 40 + i * (barW + 8);
        const y = (data.title ? 24 : 4) + chartH - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx={3} fill={colors[i % colors.length]} opacity={0.85}>
              <title>{`${data.labels[i]}: ${v}`}</title>
            </rect>
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={9} fill={textColor}>{v}</text>
            <text x={x + barW / 2} y={(data.title ? 24 : 4) + chartH + 14} textAnchor="middle" fontSize={8} fill={dimColor}>
              {data.labels[i]?.length > 8 ? data.labels[i].slice(0, 7) + "…" : data.labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PieChart({ data, colors, textColor, dimColor }: {
  data: ChartData; colors: string[]; textColor: string; dimColor: string;
}) {
  const total = data.values.reduce((s, v) => s + v, 0) || 1;
  const cx = 100, cy = 100, r = 80;
  let angle = -Math.PI / 2;

  const slices = data.values.map((v, i) => {
    const sliceAngle = (v / total) * 2 * Math.PI;
    const startAngle = angle;
    angle += sliceAngle;
    const endAngle = angle;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = sliceAngle > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    // Label position
    const midAngle = startAngle + sliceAngle / 2;
    const lx = cx + (r * 0.65) * Math.cos(midAngle);
    const ly = cy + (r * 0.65) * Math.sin(midAngle);
    return { d, color: colors[i % colors.length], label: data.labels[i], value: v, pct: ((v / total) * 100).toFixed(1), lx, ly };
  });

  return (
    <svg width="100%" viewBox="0 0 280 210" style={{ display: "block", maxWidth: 280 }}>
      {data.title && (
        <text x={140} y={14} textAnchor="middle" fontSize={12} fontWeight={600} fill={textColor}>
          {data.title}
        </text>
      )}
      <g transform={data.title ? "translate(40, 20)" : "translate(40, 0)"}>
        {slices.map((s, i) => (
          <g key={i}>
            <path d={s.d} fill={s.color} opacity={0.85} stroke={textColor} strokeWidth={0.5}>
              <title>{`${s.label}: ${s.value} (${s.pct}%)`}</title>
            </path>
            {parseFloat(s.pct) > 8 && (
              <text x={s.lx} y={s.ly + 4} textAnchor="middle" fontSize={8} fill="white" fontWeight={600}>
                {s.pct}%
              </text>
            )}
          </g>
        ))}
      </g>
      {/* Legend */}
      {slices.map((s, i) => (
        <g key={`legend-${i}`} transform={`translate(210, ${(data.title ? 30 : 10) + i * 16})`}>
          <rect width={8} height={8} rx={2} fill={s.color} />
          <text x={12} y={8} fontSize={8} fill={dimColor}>{s.label}</text>
        </g>
      ))}
    </svg>
  );
}

function LineChart({ data, colors, textColor, dimColor }: {
  data: ChartData; colors: string[]; textColor: string; dimColor: string;
}) {
  const maxVal = Math.max(...data.values, 1);
  const chartW = 360, chartH = 140;
  const padX = 40, padY = data.title ? 24 : 8;
  const stepX = data.values.length > 1 ? (chartW - 20) / (data.values.length - 1) : 0;

  const points = data.values.map((v, i) => ({
    x: padX + i * stepX,
    y: padY + chartH - (v / maxVal) * chartH,
    v,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${chartW + 20} ${chartH + padY + 30}`} style={{ display: "block", maxWidth: chartW + 20 }}>
      {data.title && (
        <text x={(chartW + 20) / 2} y={14} textAnchor="middle" fontSize={12} fontWeight={600} fill={textColor}>
          {data.title}
        </text>
      )}
      {/* Grid */}
      <line x1={padX} y1={padY} x2={padX} y2={padY + chartH} stroke={dimColor} strokeWidth={0.5} opacity={0.3} />
      <line x1={padX} y1={padY + chartH} x2={padX + chartW - 20} y2={padY + chartH} stroke={dimColor} strokeWidth={0.5} opacity={0.3} />
      {/* Line */}
      <path d={pathD} fill="none" stroke={colors[0]} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* Points + labels */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3.5} fill={colors[0]} stroke="white" strokeWidth={1.5}>
            <title>{`${data.labels[i]}: ${p.v}`}</title>
          </circle>
          <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={8} fill={textColor}>{p.v}</text>
          <text x={p.x} y={padY + chartH + 14} textAnchor="middle" fontSize={8} fill={dimColor}>
            {data.labels[i]?.length > 6 ? data.labels[i].slice(0, 5) + "…" : data.labels[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ═══════════ Form Widget ═══════════

interface FormField {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "textarea";
  placeholder?: string;
  options?: string[];
  required?: boolean;
  defaultValue?: string;
}

interface FormData {
  title?: string;
  fields: FormField[];
  submitLabel?: string;
}

function FormWidget({ data, isDark, t }: { data: FormData; isDark: boolean; t: (key: string) => string }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of data.fields) {
      init[f.name] = f.defaultValue || "";
    }
    return init;
  });
  const [submitted, setSubmitted] = useState(false);

  const handleChange = useCallback((name: string, value: string) => {
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    setSubmitted(true);
  }, []);

  if (submitted) {
    return (
      <Paper p="sm" radius="md" withBorder bg={isDark ? "dark.7" : "green.0"}>
        <Text size="sm" fw={600} mb="xs">✅ {t("common.formSubmitted")}</Text>
        <Stack gap={2}>
          {data.fields.map(f => (
            <Group key={f.name} gap="xs">
              <Text size="xs" fw={500}>{f.label}:</Text>
              <Text size="xs" c="dimmed">{values[f.name] || `(${t("common.empty")})`}</Text>
            </Group>
          ))}
        </Stack>
        <Button size="xs" variant="subtle" mt="xs" onClick={() => setSubmitted(false)}>
          {t("common.refill")}
        </Button>
      </Paper>
    );
  }

  return (
    <Paper p="sm" radius="md" withBorder>
      {data.title && <Text size="sm" fw={600} mb="xs">{data.title}</Text>}
      <Stack gap="xs">
        {data.fields.map(f => {
          switch (f.type) {
            case "select":
              return (
                <Select
                  key={f.name}
                  label={f.label}
                  size="xs"
                  data={(f.options || []).map(o => ({ value: o, label: o }))}
                  value={values[f.name]}
                  onChange={(v) => handleChange(f.name, v || "")}
                  placeholder={f.placeholder}
                />
              );
            case "textarea":
              return (
                <Textarea
                  key={f.name}
                  label={f.label}
                  size="xs"
                  minRows={2}
                  maxRows={4}
                  autosize
                  value={values[f.name]}
                  onChange={(e) => handleChange(f.name, e.currentTarget.value)}
                  placeholder={f.placeholder}
                />
              );
            default:
              return (
                <TextInput
                  key={f.name}
                  label={f.label}
                  size="xs"
                  type={f.type === "number" ? "number" : "text"}
                  value={values[f.name]}
                  onChange={(e) => handleChange(f.name, e.currentTarget.value)}
                  placeholder={f.placeholder}
                />
              );
          }
        })}
        <Button size="xs" onClick={handleSubmit}>{data.submitLabel || t("common.submit")}</Button>
      </Stack>
    </Paper>
  );
}

// ═══════════ Table Widget ═══════════

interface TableData {
  title?: string;
  headers: string[];
  rows: string[][];
  sortable?: boolean;
  filterable?: boolean;
}

function TableWidget({ data, t }: { data: TableData; isDark: boolean; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState("");

  const filteredRows = useMemo(() => {
    let rows = data.rows;
    if (filter && data.filterable !== false) {
      const q = filter.toLowerCase();
      rows = rows.filter(row => row.some(cell => cell.toLowerCase().includes(q)));
    }
    if (sortCol !== null && data.sortable !== false) {
      rows = [...rows].sort((a, b) => {
        const va = a[sortCol] || "";
        const vb = b[sortCol] || "";
        const na = parseFloat(va);
        const nb = parseFloat(vb);
        const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : va.localeCompare(vb);
        return sortAsc ? cmp : -cmp;
      });
    }
    return rows;
  }, [data.rows, sortCol, sortAsc, filter, data.filterable, data.sortable]);

  const handleSort = (col: number) => {
    if (sortCol === col) {
      setSortAsc(prev => !prev);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  return (
    <Paper p="sm" radius="md" withBorder>
      {data.title && <Text size="sm" fw={600} mb="xs">{data.title}</Text>}
      {data.filterable !== false && (
        <TextInput
          size="xs"
          placeholder={t("common.filter")}
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
          mb="xs"
        />
      )}
      <ScrollArea>
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              {data.headers.map((h, i) => (
                <Table.Th
                  key={i}
                  style={{ cursor: data.sortable !== false ? "pointer" : undefined, fontSize: 12 }}
                  onClick={() => data.sortable !== false && handleSort(i)}
                >
                  {h} {sortCol === i ? (sortAsc ? "▲" : "▼") : ""}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filteredRows.map((row, ri) => (
              <Table.Tr key={ri}>
                {row.map((cell, ci) => (
                  <Table.Td key={ci} style={{ fontSize: 12 }}>{cell}</Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      <Text size="xs" c="dimmed" mt="xs">{t("common.rowCount", { count: filteredRows.length })}</Text>
    </Paper>
  );
}

// ═══════════ Widget Renderer ═══════════

export function WidgetRenderer({ widget }: { widget: WidgetBlock }) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const { t } = useTranslation();

  if (!widget.parsed) {
    return (
      <Paper p="sm" radius="md" withBorder>
        <Text size="xs" c="red">Widget parse error</Text>
        <Box style={{ fontSize: 11, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
          {widget.rawContent.slice(0, 500)}
        </Box>
      </Paper>
    );
  }

  switch (widget.type) {
    case "chart":
      return (
        <Paper p="sm" radius="md" withBorder>
          <Badge size="xs" variant="light" color="blue" mb="xs">Chart</Badge>
          <ChartWidget data={widget.parsed as ChartData} isDark={isDark} />
        </Paper>
      );
    case "form":
      return (
        <Box>
          <Badge size="xs" variant="light" color="violet" mb="xs">Form</Badge>
          <FormWidget data={widget.parsed as FormData} isDark={isDark} t={t} />
        </Box>
      );
    case "table":
      return (
        <Box>
          <Badge size="xs" variant="light" color="green" mb="xs">Table</Badge>
          <TableWidget data={widget.parsed as TableData} isDark={isDark} t={t} />
        </Box>
      );
    default:
      return <Text size="xs" c="dimmed">Unknown widget type: {widget.type}</Text>;
  }
}
