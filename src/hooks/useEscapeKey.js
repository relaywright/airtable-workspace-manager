import { useEffect, useRef } from 'react';

// Handlers of the currently open overlays, innermost last. Escape only reaches the
// top one, so closing a nested dialog does not also close the modal underneath it.
const escapeStack = [];

function handleKeyDown(event) {
  // Inputs that give Escape their own meaning (e.g. cancelling an inline rename)
  // call preventDefault() so the surrounding modal stays open.
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const top = escapeStack[escapeStack.length - 1];
  top?.current?.();
}

/**
 * Call `onEscape` when the user presses Escape while `isActive` is true.
 * @param {() => void} onEscape
 * @param {boolean} [isActive=true]
 */
export function useEscapeKey(onEscape, isActive = true) {
  const handlerRef = useRef(onEscape);

  useEffect(() => {
    handlerRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!isActive) return undefined;
    if (escapeStack.length === 0) window.addEventListener('keydown', handleKeyDown);
    escapeStack.push(handlerRef);
    return () => {
      const index = escapeStack.lastIndexOf(handlerRef);
      if (index !== -1) escapeStack.splice(index, 1);
      if (escapeStack.length === 0) window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive]);
}

export default useEscapeKey;
