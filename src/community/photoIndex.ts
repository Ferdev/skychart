import type { Cover } from "./api.ts";
/** Atomic subject replacement removes old aliases and takedown covers. */
export class PhotoIndex {
  private readonly subjects = new Map<string, Cover>();
  private readonly aliases = new Map<string, Cover>();
  private readonly seed: number;
  constructor(seed = crypto.getRandomValues(new Uint32Array(1))[0]) { this.seed = seed; }
  version = 0;
  apply(items: Cover[], version: number) {
    if (!Number.isSafeInteger(version) || version < this.version) return;
    for (const item of items) {
      const previous = this.subjects.get(item.subject_id);
      for (const key of previous?.keys ?? []) this.aliases.delete(key);
      this.subjects.delete(item.subject_id);
      if (item.cover && item.count > 0 && this.subjects.size < 10_000) {
        this.subjects.set(item.subject_id, item);
        const choice = this.choose(item);
        for (const key of item.keys.slice(0, 30)) this.aliases.set(key, choice);
      }
    }
    this.version = version;
  }
  get(key: string) {
    const item = this.aliases.get(key);
    if (item?.new_photo_until && Date.parse(item.new_photo_until) <= Date.now()) {
      return this.subjects.get(item.subject_id);
    }
    return item;
  }
  private choose(item: Cover): Cover {
    if (!item.new_photo || !item.new_photo_until || Date.parse(item.new_photo_until) <= Date.now()) return item;
    let hash = this.seed;
    for (const char of item.subject_id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return hash % 100 < 15 ? { ...item, cover: item.new_photo } : item;
  }
  clear() {
    this.subjects.clear();
    this.aliases.clear();
    this.version = 0;
  }
}
