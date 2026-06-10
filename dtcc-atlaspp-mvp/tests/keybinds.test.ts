import { describe, it, expect, vi, afterEach } from 'vitest';
import { onKey, stepFromEvent } from '../src/lib/keybinds';

afterEach(() => {
  document.body.innerHTML = '';
});

function dispatchKey(key: string, target?: EventTarget, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init });
  (target ?? window).dispatchEvent(event);
}

describe('onKey', () => {
  it('fires the handler for the matching key', () => {
    const handler = vi.fn();
    const off = onKey('c', handler);
    dispatchKey('c');
    expect(handler).toHaveBeenCalledTimes(1);
    off();
  });

  it('does not fire for a non-matching key', () => {
    const handler = vi.fn();
    const off = onKey('c', handler);
    dispatchKey('x');
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('does not fire when the event target is an <input>', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const handler = vi.fn();
    const off = onKey('c', handler);
    dispatchKey('c', input);
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('does not fire when the event target is a <textarea>', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const handler = vi.fn();
    const off = onKey('c', handler);
    dispatchKey('c', ta);
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('does not fire when the event target is a <select>', () => {
    const sel = document.createElement('select');
    document.body.appendChild(sel);
    const handler = vi.fn();
    const off = onKey('c', handler);
    dispatchKey('c', sel);
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('does not fire when the event target is contentEditable', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    const handler = vi.fn();
    const off = onKey('c', handler);
    dispatchKey('c', div);
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('preserves modifier state for arrow-key handlers', () => {
    const handler = vi.fn();
    const off = onKey('ArrowRight', handler);
    dispatchKey('ArrowRight', window, { altKey: true, shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as KeyboardEvent;
    expect(event.altKey).toBe(true);
    expect(event.shiftKey).toBe(true);
    off();
  });

  it('returned teardown removes the listener', () => {
    const handler = vi.fn();
    const off = onKey('c', handler);
    off();
    dispatchKey('c');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('stepFromEvent', () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

  it('returns the 10px default step without modifiers', () => {
    expect(stepFromEvent(key({}))).toBe(10);
  });

  it('returns the 1px fine step with Alt or Meta', () => {
    expect(stepFromEvent(key({ altKey: true }))).toBe(1);
    expect(stepFromEvent(key({ metaKey: true }))).toBe(1);
  });

  it('returns the 50px coarse step with Shift', () => {
    expect(stepFromEvent(key({ shiftKey: true }))).toBe(50);
  });

  it('fine wins when combined with Shift', () => {
    expect(stepFromEvent(key({ altKey: true, shiftKey: true }))).toBe(1);
  });
});
