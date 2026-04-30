import { describe, it, expect } from 'vitest';
import { scaleFactor } from '../src/lib/scaleFactor';

describe('scaleFactor', () => {
  it('returns current/saved when saved is positive', () => {
    expect(scaleFactor(1000, 2000)).toBe(2);
    expect(scaleFactor(1920, 960)).toBe(0.5);
    expect(scaleFactor(800, 800)).toBe(1);
  });

  it('returns 1 when saved is zero (corrupt or uninitialized)', () => {
    expect(scaleFactor(0, 1000)).toBe(1);
  });

  it('returns 1 when saved is negative', () => {
    expect(scaleFactor(-100, 1000)).toBe(1);
  });
});
