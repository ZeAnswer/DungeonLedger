import { useEffect, useRef } from 'react';
import { useStore } from '../store/store';

const HOLD_MS = 500;
/** A pointer that has moved this far since press-start is scrolling/dragging, not holding. */
const MOVE_CANCEL_PX = 10;

/**
 * Hold any number for half a second to see the path a script would read it with. Spread the returned
 * props on the element. When the hold fires it swallows that press's next click (capture + preventDefault
 * + stopPropagation, once) so the element's own onClick does not also run; a plain tap — release before
 * 500ms, or move/scroll away — is untouched and still fires onClick as usual.
 */
export function usePathLongPress(path: string, label?: string) {
  const showPath = useStore((s) => s.showPath);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
    origin.current = undefined;
  };
  useEffect(() => cancel, []);

  return {
    'data-path': path,
    onPointerDown: (e: { clientX: number; clientY: number }) => {
      cancel();
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => { fired.current = true; showPath(path, label); }, HOLD_MS);
    },
    onPointerMove: (e: { clientX: number; clientY: number }) => {
      if (!origin.current) return;
      const dx = e.clientX - origin.current.x;
      const dy = e.clientY - origin.current.y;
      if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    // Runs before the element's own onClick (React dispatches the whole capture list first); swallow
    // exactly the click that followed a fired long-press, then rearm for the next press.
    onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (fired.current) { fired.current = false; e.preventDefault(); e.stopPropagation(); }
    },
  };
}
