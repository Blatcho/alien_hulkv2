// Minimal synchronous event bus. The sim emits facts ("shot", "hit", "door-opened"...);
// rendering, audio and UI subscribe. Keeps the sim free of any presentation code.

export class EventBus {
  constructor() { this.map = new Map(); }

  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.map.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.map.get(type);
    if (set) for (const fn of set) fn(payload);
    const any = this.map.get('*');
    if (any) for (const fn of any) fn(type, payload);
  }

  clear() { this.map.clear(); }
}
