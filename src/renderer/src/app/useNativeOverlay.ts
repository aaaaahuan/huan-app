import { useEffect } from 'react';

/** 浏览器 top layer 无法压住原生 WebContentsView；所有 popover/dialog 统一协调。 */
export function useNativeOverlay() {
  useEffect(() => {
    const opened = new Set<HTMLElement>();
    let disposed = false;
    function sync() {
      for (const element of opened) if (!element.isConnected) opened.delete(element);
      return window.huanApp.browser.overlay(opened.size > 0);
    }
    function beforeToggle(event: Event) {
      const element = event.target;
      if (!(event instanceof ToggleEvent) || !(element instanceof HTMLElement)) return;
      if (!element.hasAttribute('popover') && !(element instanceof HTMLDialogElement)) return;
      if (event.newState !== 'open') return;
      opened.add(element);
      // 等待原生视图确认隐藏后再显示弹层，避免首帧被遮挡。
      const previous = element.style.visibility;
      element.style.visibility = 'hidden';
      void sync().then(() => {
        if (!disposed) element.style.visibility = previous;
      }).catch(error => {
        element.style.visibility = previous;
        console.error('无法协调弹层与网页视图', error);
      });
    }
    function toggle(event: Event) {
      if (event instanceof ToggleEvent && event.target instanceof HTMLElement && event.newState === 'closed') {
        opened.delete(event.target);
        void sync().catch(error => console.error('无法恢复网页视图', error));
      }
    }
    document.addEventListener('beforetoggle', beforeToggle, true);
    document.addEventListener('toggle', toggle, true);
    const observer = new MutationObserver(() => {
      if ([...opened].some(element => !element.isConnected)) void sync().catch(error => console.error('无法恢复网页视图', error));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      disposed = true; observer.disconnect();
      document.removeEventListener('beforetoggle', beforeToggle, true);
      document.removeEventListener('toggle', toggle, true);
      void window.huanApp.browser.overlay(false).catch(error => console.error('无法恢复网页视图', error));
    };
  }, []);
}
