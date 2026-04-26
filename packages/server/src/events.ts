import type { BrowserEvent } from '@crewden/shared';

type Listener = (event: BrowserEvent) => void;

class EventBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: BrowserEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const eventBus = new EventBus();
