/* global clearTimeout, setTimeout, getSelection, document, innerWidth, innerHeight, window */
(() => {
  if (globalThis.huanSelection) return;
  const state = globalThis.huanSelection = { token: 0, pending: null, action: '', host: null };
  let timer;
  const close = () => { clearTimeout(timer); state.token++; state.pending = null; state.host?.remove(); state.host = null; };
  const english = text => /[a-zA-Z]/.test(text) && !/[\u3400-\u9fff]/.test(text) && !/https?:|@|[{}<>]/.test(text);
  function capture(event) {
    if (!event.isTrusted) return;
    if (event.composedPath().includes(state.host) || event.target.closest('input,textarea,[contenteditable="true"],button,select')) return;
    clearTimeout(timer);
    const auto = event.type === 'dblclick';
    timer = setTimeout(() => {
      const selection = getSelection(), text = selection?.toString().trim();
      if (!text || text.length > 2000 || !selection.rangeCount || (auto && !english(text))) { close(); return; }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      close(); let token = state.token;
      const host = state.host = document.createElement('div');
      host.style.cssText = `position:fixed;z-index:2147483647;left:${Math.max(8,Math.min(rect.left,innerWidth-336))}px;top:${Math.max(8,Math.min(rect.bottom+8,innerHeight-260))}px;`;
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style'); style.textContent = ':host{all:initial}section{font:14px system-ui;color:#24302b;background:white;border:1px solid #e4e7e5;border-radius:10px;padding:5px;box-shadow:0 4px 20px #0002;max-width:calc(100vw - 20px)}nav{display:flex;gap:4px}button{font:inherit;border:0;border-radius:6px;background:#f4f6f4;padding:6px 10px;cursor:pointer}p{white-space:pre-wrap;line-height:1.6;max-height:180px;overflow:auto;margin:10px 5px}';
      shadow.append(style); const section = document.createElement('section'), nav = document.createElement('nav'), phonetic = document.createElement('p'), output = document.createElement('p'), contextual = document.createElement('p');
      contextual.hidden = true; contextual.style.cssText='background:#f4f6f4;border-radius:6px;padding:8px 10px';
      phonetic.hidden = true; phonetic.setAttribute('aria-label','IPA'); phonetic.setAttribute('lang','en-fonipa'); phonetic.style.color='#61736a';
      output.hidden = true; section.append(nav,phonetic,output,contextual); shadow.append(section);
      function button(label, action) { const button = document.createElement('button'); button.textContent = label; button.onclick = action; nav.append(button); return button; }
      const submit = () => { if (state.token !== token) return; closeButton.hidden=false; stopButton.hidden=false; section.style.width='320px'; output.hidden=false; phonetic.hidden=true; phonetic.textContent=''; contextual.hidden=true; output.textContent='翻译中…'; translate.disabled=true; state.pending = { token, text, context: selection.anchorNode?.parentElement?.textContent?.slice(0,2000) ?? text, trigger:auto?'double-click':'manual' }; };
      const translate = button('翻译',submit);
      const closeButton = button('关闭',close); closeButton.hidden=true;
      const stopButton = button('停止',() => { state.token++; token = state.token; state.pending=null; output.textContent='已停止，可重试。'; translate.disabled=false; stopButton.hidden=true; });
      stopButton.hidden=true;
      host.addEventListener('mousedown',e => e.preventDefault());
      document.documentElement.append(host);
      state.finish = (expected, result) => { if (state.token !== expected || !host.isConnected) return; translate.disabled=false; stopButton.hidden=true; output.hidden=false; phonetic.textContent=result.phonetic || ''; phonetic.hidden=!result.phonetic; contextual.textContent=result.contextualText || ''; contextual.hidden=!result.contextualText; output.textContent = result.text || result.error || '翻译未完成，可重试。'; if(result.warning) output.textContent+='\n'+result.warning; };
      if(auto) submit();
    },auto?0:220);
  }
  document.addEventListener('mouseup',capture); document.addEventListener('dblclick',capture);
  document.addEventListener('pointerdown',e => { if (!e.composedPath().includes(state.host)) close(); });
  document.addEventListener('keydown',e => { if(e.key==='Escape') close(); });
  document.addEventListener('scroll',e => { if(!e.composedPath().includes(state.host)) close(); },true);
  window.addEventListener('resize',close);
  state.close=close;
})()
