/**
 * Shared types for the panel UI. These mirror the relay's wire format plus the
 * sidecar's envelope additions. Nothing here imports from server/.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RelayTestResult {
  ok: boolean;
  status: number;
  latency_ms: number;
  ts: number;
  error?: string;
}

export interface RelayModel {
  id: string;
  owned_by?: string;
  created?: number;
  enabled: boolean;
  available?: boolean;
  last_test?: RelayTestResult;
  [key: string]: unknown;
}

export type TestStatus = "idle" | "running" | "done";

export interface RowTestState {
  status: TestStatus;
  result?: RelayTestResult;
  error?: string;
}

export interface MetricsLatency {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
}

export interface MetricsSummary {
  startedAt: number;
  uptimeS: number;
  requests: number;
  errors: number;
  requestsPerMin: number;
  errorsPerMin: number;
  errorRate: number;
  activeStreams: number;
  bytes: number;
  tokensIn: number;
  tokensOut: number;
  latency: MetricsLatency;
  byStatus: Record<string, number>;
  lastError: { ts: number; status: number; message: string } | null;
  sampleCount: number;
}

export interface TimeseriesBucket {
  t: number;
  requests: number;
  errors: number;
  tokens: number;
  bytes: number;
  p95: number;
  avg: number;
}

export type RelayState = "stopped" | "starting" | "running" | "stopping" | "crashed";

export interface RelayStatus {
  state: RelayState;
  running: boolean;
  owned: boolean;
  pid: number | null;
  port: number;
  baseUrl: string;
  script: string;
  cwd: string;
  python: string;
  startedAt: number | null;
  stoppedAt: number | null;
  restartCount: number;
  lastTransition: { at: number; from: string; to: string; reason: string };
  lastHealth:
    | { ok: boolean; status: number; ms: number; at: number; data?: unknown; error?: string }
    | null;
  lastError: string | null;
  healthMisses: number;
}

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface ChatRole {
  role: "system" | "user" | "assistant";
}

export interface ChatMessage {
  id: string;
  role: ChatRole["role"];
  content: string;
}

export interface ChatParams {
  temperature: number;
  top_p: number;
  max_tokens: number;
  presence_penalty: number;
  frequency_penalty: number;
  seed: number | null;
  stop: string;
  stream: boolean;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ConfigSpec {
  key: string;
  label: string;
  type: "int" | "bool" | "url" | "path" | "string";
  min?: number;
  max?: number;
  def: string;
  hint: string;
  secret?: boolean;
}

export interface ConfigDiffRow {
  key: string;
  label: string;
  type: string;
  secret: boolean;
  source: "process" | "file" | "default";
  effective: string;
  running: string;
  changed: boolean;
}

export interface ConfigPayload {
  specs: ConfigSpec[];
  values: Record<string, string>;
  source: Record<string, string>;
  diff: { rows: ConfigDiffRow[]; changed: boolean };
  relayState: RelayState;
  file: string;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  lastUsedIp: string | null;
  useCount: number;
}

export interface Preset {
  id: string;
  name: string;
  model: string;
  messages: ChatMessage[];
  params: ChatParams;
  updatedAt: number;
}

export interface AdminInfo {
  panelVersion: string;
  nodeVersion: string;
  pythonVersion: string;
  relayScript: string;
  relaySha256: string | null;
  dataDir: string;
  logFile: string;
  logBytes: number;
  relay: RelayStatus;
  metrics: MetricsSummary;
  tokens: number;
  uptimeS: number;
}

export interface RelayEvent {
  ts: number;
  type: string;
  [key: string]: unknown;
}

export interface BackupEntry {
  name: string;
  bytes: number;
  createdAt: number;
}

export interface ModelMetricsRow {
  model: string;
  requests: number;
  errors: number;
  bytes: number;
  tokensIn: number;
  tokensOut: number;
  lastStatus: number;
  lastTs: number;
  p95: number;
  avg: number;
}

export interface ModelFilter {
  query: string;
  chip: "all" | "enabled" | "disabled" | "failing";
}
