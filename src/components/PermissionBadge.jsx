import React from 'react';
import { getPermissionInfo } from '../utils/permissions';

/**
 * Small colored badge with the friendly name of an Airtable permission level.
 * Never shrinks or truncates; renders nothing for a missing or unrecognized level.
 */
export function PermissionBadge({ level, className = 'text-[10px] px-1.5 py-0.5' }) {
  const info = getPermissionInfo(level);
  if (!info) return null;

  return (
    <span className={`font-medium rounded shrink-0 whitespace-nowrap ${info.classes} ${className}`}>
      {info.label}
    </span>
  );
}

export default PermissionBadge;
