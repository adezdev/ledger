import type { Evidence } from "./model.ts";

export type NewEvidence = Omit<Evidence, "id">;

/**
 * Collects evidence and assigns sequential identifiers (E1, E2, ...).
 * Identical evidence is recorded once, so IDs are deterministic for a given
 * repository state and insertion order.
 */
export class EvidenceLog {
  readonly #items: Evidence[] = [];
  readonly #idsByKey = new Map<string, string>();

  add(evidence: NewEvidence): string {
    const key = JSON.stringify(evidence);
    const existing = this.#idsByKey.get(key);
    if (existing) return existing;
    const id = `E${this.#items.length + 1}`;
    this.#items.push({ id, ...evidence });
    this.#idsByKey.set(key, id);
    return id;
  }

  get items(): readonly Evidence[] {
    return this.#items;
  }
}
