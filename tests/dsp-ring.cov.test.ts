import { describe, it, expect } from 'vitest';
import { Ring } from '../src/dsp/ring.ts';

/** Oldest-to-newest contents, read through the public accessor. */
function contents(r: Ring): number[] {
  const out: number[] = [];
  for (let i = 0; i < r.length; i++) out.push(r.at(i));
  return out;
}

describe('Ring', () => {
  it('starts empty and exposes its capacity', () => {
    const r = new Ring(4);
    expect(r.capacity).toBe(4);
    expect(r.length).toBe(0);
    expect(contents(r)).toEqual([]);
  });

  it('grows one sample at a time until it is full', () => {
    const r = new Ring(3);
    r.push(10);
    expect(r.length).toBe(1);
    r.push(20);
    r.push(30);
    expect(r.length).toBe(3);
    expect(contents(r)).toEqual([10, 20, 30]);
  });

  it('holds length at capacity once full and drops the oldest sample', () => {
    const r = new Ring(3);
    for (const v of [1, 2, 3, 4, 5]) r.push(v);
    expect(r.length).toBe(3);
    expect(contents(r)).toEqual([3, 4, 5]);
  });

  it('keeps the newest `capacity` samples after many wraps', () => {
    const r = new Ring(5);
    for (let i = 0; i < 5 * 7 + 2; i++) r.push(i);
    expect(r.length).toBe(5);
    expect(contents(r)).toEqual([32, 33, 34, 35, 36]);
  });

  it('at() returns NaN below zero and at or above length', () => {
    const r = new Ring(3);
    r.push(1);
    r.push(2);
    expect(Number.isNaN(r.at(-1))).toBe(true);
    expect(Number.isNaN(r.at(-100))).toBe(true);
    expect(r.at(0)).toBe(1);
    expect(r.at(1)).toBe(2);
    expect(Number.isNaN(r.at(2))).toBe(true);
    expect(Number.isNaN(r.at(99))).toBe(true);
  });

  it('at() on an empty ring is NaN for index 0', () => {
    expect(Number.isNaN(new Ring(4).at(0))).toBe(true);
  });

  it('last() defaults to the newest sample and counts backwards', () => {
    const r = new Ring(4);
    for (const v of [7, 8, 9]) r.push(v);
    expect(r.last()).toBe(9);
    expect(r.last(0)).toBe(9);
    expect(r.last(1)).toBe(8);
    expect(r.last(2)).toBe(7);
    expect(Number.isNaN(r.last(3))).toBe(true);
  });

  it('last() stays correct across a wrap', () => {
    const r = new Ring(3);
    for (const v of [1, 2, 3, 4]) r.push(v);
    expect(r.last()).toBe(4);
    expect(r.last(2)).toBe(2);
    expect(Number.isNaN(r.last(3))).toBe(true);
  });

  it('toArray() allocates a fresh window when no buffer is supplied', () => {
    const r = new Ring(3);
    for (const v of [1, 2, 3, 4]) r.push(v);
    const a = r.toArray();
    expect(a).toBeInstanceOf(Float64Array);
    expect(Array.from(a)).toEqual([2, 3, 4]);
    // A fresh allocation each call: mutating the copy cannot reach the ring.
    a[0] = -1;
    expect(r.at(0)).toBe(2);
    expect(Array.from(r.toArray())).toEqual([2, 3, 4]);
  });

  it('toArray() of an empty ring is empty', () => {
    expect(Array.from(new Ring(4).toArray())).toEqual([]);
  });

  it('toArray() reuses a supplied buffer that is large enough', () => {
    const r = new Ring(4);
    for (const v of [1, 2, 3]) r.push(v);
    const out = new Float64Array(8).fill(-9);
    const got = r.toArray(out);
    expect(got.length).toBe(3);
    expect(Array.from(got)).toEqual([1, 2, 3]);
    // The result is a view onto the caller's buffer, not a copy of it.
    expect(got.buffer).toBe(out.buffer);
    expect(Array.from(out)).toEqual([1, 2, 3, -9, -9, -9, -9, -9]);
  });

  it('toArray() reuses a supplied buffer of exactly the retained length', () => {
    const r = new Ring(3);
    for (const v of [5, 6, 7, 8]) r.push(v);
    const out = new Float64Array(3);
    const got = r.toArray(out);
    expect(got.buffer).toBe(out.buffer);
    expect(Array.from(got)).toEqual([6, 7, 8]);
  });

  it('toArray() ignores a supplied buffer that is too small', () => {
    const r = new Ring(4);
    for (const v of [1, 2, 3, 4]) r.push(v);
    const out = new Float64Array(3).fill(-9);
    const got = r.toArray(out);
    expect(got.length).toBe(4);
    expect(Array.from(got)).toEqual([1, 2, 3, 4]);
    expect(got.buffer).not.toBe(out.buffer);
    expect(Array.from(out)).toEqual([-9, -9, -9]);
  });

  it('clear() empties the ring and restarts writing from the head', () => {
    const r = new Ring(3);
    for (const v of [1, 2, 3, 4, 5]) r.push(v);
    r.clear();
    expect(r.length).toBe(0);
    expect(Number.isNaN(r.at(0))).toBe(true);
    expect(Number.isNaN(r.last())).toBe(true);
    expect(Array.from(r.toArray())).toEqual([]);
    r.push(42);
    expect(r.length).toBe(1);
    expect(r.at(0)).toBe(42);
    expect(r.last()).toBe(42);
  });

  it('stores values at Float64 precision', () => {
    const r = new Ring(2);
    r.push(Math.PI);
    r.push(-1e-12);
    expect(r.at(0)).toBe(Math.PI);
    expect(r.at(1)).toBe(-1e-12);
  });
});
