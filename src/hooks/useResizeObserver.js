import { useEffect, useRef } from 'react';

/**
 * Call `onResize` (at most once per animation frame) whenever the element in `ref`
 * changes size after its first measurement.
 * @param {import('react').RefObject<Element>} ref
 * @param {() => void} onResize
 */
export function useResizeObserver(ref, onResize) {
  const callbackRef = useRef(onResize);

  useEffect(() => {
    callbackRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;

    let lastSize = null;
    let frame = null;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const isFirstMeasurement = lastSize === null;
      if (!isFirstMeasurement && lastSize.width === width && lastSize.height === height) return;
      lastSize = { width, height };
      if (isFirstMeasurement) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => callbackRef.current?.());
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [ref]);
}

export default useResizeObserver;
