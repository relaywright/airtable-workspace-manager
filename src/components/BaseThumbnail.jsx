import React, { useMemo } from 'react';
import { getColorForBase, getInitials } from '../utils/thumbnailGenerator';

/**
 * BaseThumbnail component - displays an Airtable-style gradient thumbnail with initials
 *
 * @param {string} baseId - The base ID (for deterministic color)
 * @param {string} baseName - The base name (for initials)
 * @param {string} size - Size preset: 'small' (24px), 'medium' (32px), 'large' (48px)
 * @param {string} className - Additional CSS classes
 */
export function BaseThumbnail({ baseId, baseName, size = 'medium', className = '' }) {
  const sizeMap = {
    small: { px: 24, font: 'text-[10px]' },
    medium: { px: 32, font: 'text-xs' },
    large: { px: 48, font: 'text-sm' },
  };

  const { px, font } = sizeMap[size] || sizeMap.medium;

  const { colors, initials } = useMemo(
    () => ({
      colors: getColorForBase(baseId),
      initials: getInitials(baseName),
    }),
    [baseId, baseName],
  );

  return (
    <div
      className={`flex items-center justify-center rounded-lg font-semibold text-white shrink-0 ${font} ${className}`}
      style={{
        width: px,
        height: px,
        background: `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`,
      }}
      title={baseName}
    >
      {initials}
    </div>
  );
}

export default BaseThumbnail;
