/**
 * A boolean that resets itself after a delay, cleaning up on unmount.
 *
 * Used for the transient "Copied" / "Replaced" confirmations. Each of those
 * previously called setTimeout without storing the handle, so the state update
 * fired after the component had gone away.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useTimedFlag(durationMs: number): [boolean, () => void] {
  const [isSet, setIsSet] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => clear, []);

  const trigger = useCallback(() => {
    clear();
    setIsSet(true);
    timer.current = setTimeout(() => setIsSet(false), durationMs);
  }, [durationMs]);

  return [isSet, trigger];
}
