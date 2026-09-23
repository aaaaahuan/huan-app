import { useEffect, useState } from 'react';
import { appStatusSchema, type AppStatus } from '../../../shared/contracts/app';

export function App() {
  const [status, setStatus] = useState<AppStatus>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.huanApp.app.getStatus().then((value) => {
      const parsed = appStatusSchema.safeParse(value);
      if (cancelled) return;
      if (parsed.success) setStatus(parsed.data);
      else setError('应用状态格式异常。');
    }, () => { if (!cancelled) setError('无法连接应用主进程。'); });
    return () => { cancelled = true; };
  }, []);

  async function check() {
    setChecking(true);
    setError('');
    try { setStatus(appStatusSchema.parse(await window.huanApp.app.getStatus())); }
    catch { setStatus(undefined); setError('无法验证应用连接。'); }
    finally { setChecking(false); }
  }
  
  return (
    <div className="shell">
      <header className="titlebar"><span>huan-app</span><span className="stage">A0 · 工程基础调整</span></header>
      <main>
        <div className="eyebrow">HUAN-APP</div>
        <section className="intro">
          <div className="book" aria-hidden="true"><span /><span /></div>
          <p className="kicker">从阅读开始，不止于阅读</p>
          <h1>你的桌面工作空间。</h1>
          <p className="description">基础阅读与 AI 能力独立建设。<br />先验证应用连接，再接入你的本地收藏。</p>
        </section>
        <section className="status-panel" aria-label="运行检查">
          <div className="status-heading"><span className={status ? 'dot ready' : 'dot'} /><h2 aria-live="polite">{error ? '应用连接异常' : status ? '应用连接正常' : '正在检查应用连接…'}</h2><span className="local">仅在本机运行</span></div>
          {error ? <p role="alert">{error}</p> : null}
          <dl>
            <div><dt>独立桌面窗口</dt><dd>已启动</dd></div>
            <div><dt>安全通信</dt><dd>{status ? '验证通过' : '等待检查'}</dd></div>
            <div><dt>Obsidian 收藏读取</dt><dd>尚未接入</dd></div>
            <div><dt>AI 对话能力</dt><dd>尚未接入</dd></div>
          </dl>
          <div className="panel-footer"><span>{status ? 'huan-app ' + status.version : '本步不读取收藏，也不创建数据库'}</span><button disabled={checking} onClick={() => void check()}>{checking ? '检查中…' : '重新检查连接'}</button></div>
        </section>
        <footer><span>设置、收藏、原页与 AI 将分步实现，每步单独 Review。</span><span className="review">等待 A0 REVIEW</span></footer>
      </main>
    </div>
  );
}
