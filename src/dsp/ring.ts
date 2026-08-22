/**
 * Pre-allocated ring buffer. There is no allocation inside the 30 Hz loop —
 * a GC pause shows up as a dropped frame, and a dropped frame is visible to the
 * cadence term of the quality score, which can refuse a cycle. The architecture
 * converts that risk into a refusal instead of into a wrong number.
 */
export class Ring {
  private readonly buf: Float64Array;
  private head = 0;
  private filled = 0;

  constructor(public readonly capacity: number) {
    this.buf = new Float64Array(capacity);
  }

  push(v: number): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled += 1;
  }

  get length(): number {
    return this.filled;
  }

  /** `at(0)` is the oldest retained sample; `at(length - 1)` is the newest. */
  at(i: number): number {
    if (i < 0 || i >= this.filled) return NaN;
    const start = (this.head - this.filled + this.capacity) % this.capacity;
    return this.buf[(start + i) % this.capacity] as number;
  }

  /** `last(0)` is the newest sample, `last(1)` the one before it. */
  last(back = 0): number {
    return this.at(this.filled - 1 - back);
  }

  /** Copies the retained window out in oldest-to-newest order. */
  toArray(out?: Float64Array): Float64Array {
    const dst = out && out.length >= this.filled ? out : new Float64Array(this.filled);
    for (let i = 0; i < this.filled; i++) dst[i] = this.at(i);
    return dst.subarray(0, this.filled);
  }

  clear(): void {
    this.head = 0;
    this.filled = 0;
  }
}
