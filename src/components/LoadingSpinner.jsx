import React from 'react';

export function LoadingSpinner({ size = 'medium', message = '' }) {
  const sizeClasses = {
    small: 'w-4 h-4',
    medium: 'w-8 h-8',
    large: 'w-12 h-12',
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`${sizeClasses[size]} animate-spin rounded-full border-2 border-textMuted border-t-accent`}
      />
      {message && <p className="text-sm text-textMuted">{message}</p>}
    </div>
  );
}

export default LoadingSpinner;
