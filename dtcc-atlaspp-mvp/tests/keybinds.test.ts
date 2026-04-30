import { describe, it, expect, vi, afterEach } from 'vitest';
import { onKey } from '../src/lib/keybinds';

afterEach(() => {
  document.body.innerHTML = '';
});

function dispatchKey(key: string, target?: EventTarget) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
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

  it('returned teardown removes the listener', () => {
    const handler = vi.fn();
    const off = onKey('c', handler);
    off();
    dispatchKey('c');
    expect(handler).not.toHaveBeenCalled();
  });
});
