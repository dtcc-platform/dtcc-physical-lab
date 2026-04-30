// Resolution scale for one axis: ratio of current to saved viewport size,
// clamped to identity when the saved dimension is non-positive (corrupt save
// or uninitialized). Window dimensions are never legitimately 0, so the
// <= 0 guard only fires on bad data.
export function scaleFactor(saved: number, current: number): number {
  return saved > 0 ? current / saved : 1;
}
