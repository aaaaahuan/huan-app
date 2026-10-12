import type { AgentConfig, AgentHandle, AgentDependencies } from '../agent/agent';
import { createAgentHandle } from '../agent/agent';

export interface AIService {
  createAgent<C extends object>(config: AgentConfig<C>): AgentHandle<C>;
  close(): Promise<void>;
}

export function createAIService(dependencies: AgentDependencies): AIService {
  const handles = new Map<string, { close(): Promise<void> }>();
  let closed = false;
  return {
    createAgent<C extends object>(config: AgentConfig<C>) {
      if (closed) throw new Error('AI_SERVICE_CLOSED');
      if (!config.key || handles.has(config.key)) throw new Error('AGENT_KEY_EXISTS');
      const handle = createAgentHandle(config, dependencies);
      handles.set(config.key, handle);
      return handle;
    },
    async close() {
      if (closed) return;
      closed = true;
      const results = await Promise.allSettled([...handles.values()].map(handle => handle.close()));
      let adapterError: unknown;
      try { await dependencies.piAdapter.close(); }
      catch (error) { adapterError = error; }
      const handleErrors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (handleErrors.length || adapterError)
        throw new AggregateError([...handleErrors, ...(adapterError ? [adapterError] : [])], 'AI service shutdown failed');
    }
  };
}
