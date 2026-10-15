import type { ExecutionMetrics as ExecutionMetricsData, ModelRequestTiming } from '@shared/contracts/ai-execution';
import './execution-metrics.css';

function tokens(value: number) { return value.toLocaleString('en-US'); }
function elapsed(value: number | null, fallback = '未记录') {
  if (value === null) return fallback;
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

const requestStatus = { completed: '已完成', failed: '失败', aborted: '已取消' };

function RequestTiming({ timing }: { timing: ModelRequestTiming }) {
  const sent = timing.startedAt !== null;

  return <li className="execution-metrics-request">
    <div className="execution-metrics-request-heading">
      <span>模型请求 {timing.requestSeq}</span>
      <span>{requestStatus[timing.status]}{timing.httpStatus !== null ? ` · HTTP ${timing.httpStatus}` : ''}</span>
    </div>
    {sent ? <dl>
      <dt>HTTP 响应</dt><dd>{elapsed(timing.httpResponseMs, '未收到响应')}</dd>
      <dt>首内容</dt><dd>{elapsed(timing.firstContentMs, '未收到内容')}</dd>
      <dt>正文首字</dt><dd>{elapsed(timing.firstTextMs, '未收到正文')}</dd>
      <dt>正文输出区间</dt><dd>{elapsed(timing.generationMs, '未形成正文输出')}</dd>
      <dt>流收尾</dt><dd>{elapsed(timing.streamTailMs)}</dd>
      <dt>请求总耗时</dt><dd>{elapsed(timing.durationMs)}</dd>
    </dl> : <p>未发出请求。</p>}
  </li>;
}

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
      {metrics.requestTimings?.length ? <>
        <ol className="execution-metrics-requests" aria-label="逐次模型请求耗时">
          {metrics.requestTimings.map(timing => <RequestTiming key={timing.requestSeq} timing={timing} />)}
        </ol>
        <p>各请求独立计时；HTTP 响应、首内容和正文首字均从请求发出计时。首内容可包含思考、工具调用或正文；流收尾从最后正文到请求结束计时。</p>
        <p>阶段耗时为客户端观测值，包含网络传输，并非服务端纯计算耗时。</p>
      </> : null}
      <p>本轮耗时包含准备、模型加载、工具执行和确认等待。</p>
    </div>
  </details>;
}
