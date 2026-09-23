// React 渲染入口：将应用挂载到 HTML 的 root 节点，StrictMode 辅助发现开发期副作用问题。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
