// Tiny keyboard shortcut registration. Returns a teardown function.
// Skips events that originate from editable elements so typing inside
// form inputs doesn't trigger app shortcuts.

type Handler = (event: KeyboardEvent) => void;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function onKey(key: string, handler: Handler): () => void {
  const listener = (event: KeyboardEvent) => {
    if (isEditable(event.target)) return;
    if (event.key !== key) return;
    handler(event);
  };
  window.addEventListener('keydown', listener, true);
  return () => window.removeEventListener('keydown', listener, true);
}
