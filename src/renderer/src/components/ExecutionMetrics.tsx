import type { ExecutionMetrics as ExecutionMetricsData } from '@shared/contracts/ai-execution';
import './execution-metrics.css';

function tokens(value: number) { return value.toLocaleString('en-US'); }

export function ExecutionMetrics({ metrics, label, className = '' }: {
  metrics: ExecutionMetricsData; label?: string; className?: string;
}) {
  const usage = metrics.usage;
  const duration = `${(metrics.durationMs / 1000).toFixed(1)} s`;
  const summary = metrics.modelRequests === 0 ? '未调用模型'
    : usage && metrics.usageStatus !== 'unavailable' ? `${tokens(usage.totalTokens)} tokens` : 'Token用量未知';

  return <details className={`execution-metrics ${className}`} aria-label={label || '本轮执行用量'}>
    <summary>
      {label ? <span>{label} · </span> : null}
      <span>{summary} · {duration}</span>
      {metrics.usageStatus === 'partial' ? <span> · 部分已知</span> : null}
    </summary>
    <div className="execution-metrics-content">
      <dl>
        {usage && metrics.usageStatus !== 'unavailable' ? <>
          <dt>输入（含缓存）</dt><dd>{tokens(usage.input + usage.cacheRead + usage.cacheWrite)}</dd>
          <dt>输出</dt><dd>{tokens(usage.output)}</dd>
          <dt>缓存读取</dt><dd>{tokens(usage.cacheRead)}</dd>
          <dt>缓存写入</dt><dd>{tokens(usage.cacheWrite)}</dd>
          {usage.reasoning !== undefined ? <><dt>推理输出（输出子集）</dt><dd>{tokens(usage.reasoning)}</dd></> : null}
        </> : null}
        <dt>模型请求次数</dt><dd>{tokens(metrics.modelRequests)}</dd>
        <dt>本轮耗时</dt><dd>{duration}</dd>
      </dl>
      {metrics.modelRequests === 0 ? <p>本轮未调用模型。</p>
        : metrics.usageStatus === 'unavailable' || !usage ? <p>模型未返回 Token 用量。</p>
          : metrics.usageStatus === 'partial' ? <p>Token 用量仅包含已返回用量的模型请求。</p> : null}
      {usage && metrics.usageStatus !== 'unavailable' ? <p>输入包含缓存读取与写入；推理输出已包含在输出中。</p> : null}
      <p>请求耗时包含准备、模型加载、工具执行和确认等待。</p>
    </div>
  </details>;
}
