import type { AgentMessage } from '@earendil-works/pi-agent-core';

export interface ModelIdentity {
  mode: 'online' | 'offline';
  provider: string;
  modelId: string;
}

export interface ExecutionFailure {
  kind: 'network' | 'http' | 'timeout' | 'model' | 'tool' | 'record' | 'unknown';
  code: string;
  httpStatus?: number;
}

// 沿用 Pi 的 token 分类；input 不含缓存，reasoning 已包含在 output 中。
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
}

export interface ExecutionMetrics {
  durationMs: number;
  modelRequests: number;
  usageStatus: 'complete' | 'partial' | 'unavailable';
  usage?: TokenUsage;
}

export interface ExecutionResult {
  runId: string;
  sessionId: string;
  status: 'completed' | 'declined' | 'aborted' | 'failed' | 'interrupted';
  messages: AgentMessage[];
  failure?: ExecutionFailure;
  warning?: string;
  metrics: ExecutionMetrics;
  record: {
    state: 'complete' | 'partial';
    warning?: string;
  };
}

export interface ExecutionEvent {
  type: 'accepted' | 'message_start' | 'message_delta' | 'tool_start'
    | 'tool_update' | 'tool_end' | 'settled';
  agentKey: string;
  sessionId: string;
  runId: string;
  seq: number;
  data: Record<string, unknown>;
}
