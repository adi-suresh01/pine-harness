// In-process fan-out from the orchestrator to every open SSE connection.
export type BusMessage = { topic: string; data: unknown };
type Listener = (msg: BusMessage) => void;

const listeners = new Set<Listener>();

export function publish(topic: string, data: unknown): void {
  for (const l of listeners) {
    try {
      l({ topic, data });
    } catch {
      // one broken client must not stop the others
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
