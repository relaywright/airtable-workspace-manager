import { useEffect, useRef } from 'react';

/**
 * Call `onOutside` when the user presses the mouse outside `ref`'s element
 * while `isActive` is true. Used to close dropdowns and menus.
 * @param {React.RefObject<HTMLElement>} ref
 * @param {() => void} onOutside
 * @param {boolean} [isActive=true]
 */
export function useOutsideClick(ref, onOutside, isActive = true) {
  const handlerRef = useRef(onOutside);

  useEffect(() => {
    handlerRef.current = onOutside;
  }, [onOutside]);

  useEffect(() => {
    if (!isActive) return undefined;
    const handleMouseDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) handlerRef.current();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [ref, isActive]);
}

export default useOutsideClick;
