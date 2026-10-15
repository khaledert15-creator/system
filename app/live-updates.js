(function(root) {
  "use strict";
  function create({fetch, headers, onRevision, onUnauthorized = () => {}, onState = () => {}, delay = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
    let stopped = true, controller, generation = 0;
    async function run(runId) {
      while (!stopped && runId === generation) {
        const streamController = new AbortController();
        controller = streamController;
        let watchdog = setTimeout(() => streamController.abort(), 25000);
        try {
          const response = await fetch('/api/events', {headers:headers(),cache:'no-store',signal:controller.signal});
          if (response.status === 401) { onUnauthorized(); break; }
          if (!response.ok || !response.body) throw new Error('Live connection unavailable');
          onState(true);
          const reader = response.body.getReader(), decoder = new TextDecoder();
          let buffer = '';
          while (!stopped && runId === generation) {
            const chunk = await reader.read();
            if (chunk.done) break;
            clearTimeout(watchdog); watchdog = setTimeout(() => streamController.abort(), 40000);
            buffer += decoder.decode(chunk.value, {stream:true}).replace(/\r/g,'');
            let end;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              const event = buffer.slice(0,end); buffer = buffer.slice(end+2);
              const line = event.split('\n').find(value => value.startsWith('data:'));
              if (line && !stopped && runId === generation) {
                const payload = JSON.parse(line.slice(5));
                if (Number.isFinite(Number(payload.revision))) onRevision(String(payload.revision));
              }
            }
          }
        } catch (_) { /* reconnect with a fresh revision after network interruptions */ }
        finally { clearTimeout(watchdog); }
        if (stopped || runId !== generation) break;
        onState(false);
        // Also works through proxies that do not support streaming.
        try {
          const response = await fetch('/api/live-revision', {headers:headers(),cache:'no-store',signal:AbortSignal.timeout(10000)});
          if (response.status === 401) { onUnauthorized(); break; }
          if (response.ok) onRevision(String((await response.json()).revision));
        } catch (_) {}
        await delay(2000);
      }
    }
    return {
      start() { this.stop(); stopped=false; void run(++generation); },
      stop() { stopped=true; generation++; controller?.abort(); }
    };
  }
  const api={create};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.LiveUpdates=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
