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

// Arrow-nudge granularity shared by the calibration steps. Held modifiers
// shift the step: Alt or Cmd (⌥/⌘) for sub-cm fine-tune at 4K, Shift for fast
// coarse moves. Fine takes priority if combined with Shift. Cmd+Arrow on
// macOS is the browser back/forward shortcut; callers preventDefault in
// their handlers to suppress that.
const NUDGE_STEP_DEFAULT = 10;
const NUDGE_STEP_FINE = 1;
const NUDGE_STEP_COARSE = 50;

export function stepFromEvent(e: KeyboardEvent): number {
  if (e.altKey || e.metaKey) return NUDGE_STEP_FINE;
  if (e.shiftKey) return NUDGE_STEP_COARSE;
  return NUDGE_STEP_DEFAULT;
}

export function onKey(key: string, handler: Handler): () => void {
  const listener = (event: KeyboardEvent) => {
    if (isEditable(event.target)) return;
    if (event.key !== key) return;
    handler(event);
  };
  window.addEventListener('keydown', listener);
  return () => window.removeEventListener('keydown', listener);
}
