import React, { useState, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { useOutsideClick } from '../hooks/useOutsideClick';
import { parseTimestamp } from '../utils/format';

export function Header({ onSettingsClick, onRefresh, onExport, onSearch, onHealth, onInsights }) {
  const { isLoading, lastSync, activeAccount, accounts, switchAccount, isSwitchingAccount } = useAppContext();
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const menuRef = useRef(null);

  const formatLastSync = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = parseTimestamp(timestamp);
    return date ? date.toLocaleString() : 'Never';
  };

  // Close menu on outside click
  useOutsideClick(menuRef, () => setShowAccountMenu(false), showAccountMenu);

  const handleSwitchAccount = async (accountId) => {
    setShowAccountMenu(false);
    if (accountId !== activeAccount?.id) {
      await switchAccount(accountId);
    }
  };

  return (
    <header className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-textPrimary">Workspace Manager</h1>

        {/* Account Switcher */}
        {accounts && accounts.length > 0 && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowAccountMenu(!showAccountMenu)}
              disabled={isSwitchingAccount}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surfaceLight hover:bg-border text-sm text-textSecondary transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              <span className="max-w-[120px] truncate">{activeAccount?.name || 'Account'}</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showAccountMenu && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-surface border border-border rounded-lg shadow-xl z-50">
                <div className="py-1">
                  {accounts.map((account) => (
                    <button
                      key={account.id}
                      onClick={() => handleSwitchAccount(account.id)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-surfaceLight transition-colors ${
                        account.id === activeAccount?.id ? 'text-accent' : 'text-textSecondary'
                      }`}
                    >
                      <span className="truncate">{account.name}</span>
                      {account.id === activeAccount?.id && (
                        <svg
                          className="w-4 h-4 shrink-0 ml-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </button>
                  ))}
                  <div className="border-t border-border mt-1 pt-1">
                    <button
                      onClick={() => {
                        setShowAccountMenu(false);
                        onSettingsClick();
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-textMuted hover:bg-surfaceLight transition-colors"
                    >
                      Manage Accounts...
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        {lastSync && <span className="text-sm text-textMuted">Last sync: {formatLastSync(lastSync)}</span>}

        <button
          onClick={onSearch}
          className="p-2 rounded-lg hover:bg-surfaceLight transition-colors"
          title="Search schemas"
          aria-label="Search schemas"
        >
          <svg className="w-5 h-5 text-textSecondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-2 rounded-lg hover:bg-surfaceLight transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Refresh bases"
          aria-label="Refresh bases"
        >
          <svg
            className={`w-5 h-5 text-textSecondary ${isLoading ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>

        <button
          onClick={onExport}
          className="p-2 rounded-lg hover:bg-surfaceLight transition-colors"
          title="Export"
          aria-label="Export data"
        >
          <svg className="w-5 h-5 text-textSecondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
        </button>

        <button
          onClick={onHealth}
          className="p-2 rounded-lg hover:bg-surfaceLight transition-colors"
          title="Workspace Health"
          aria-label="Workspace health dashboard"
        >
          <svg className="w-5 h-5 text-textSecondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        </button>

        {onInsights && (
          <button
            onClick={onInsights}
            className="p-2 rounded-lg hover:bg-surfaceLight transition-colors"
            title="AI Insights"
            aria-label="AI schema insights"
          >
            <svg className="w-5 h-5 text-textSecondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
          </button>
        )}

        <button
          onClick={onSettingsClick}
          className="p-2 rounded-lg hover:bg-surfaceLight transition-colors"
          title="Settings"
          aria-label="Open settings"
        >
          <svg className="w-5 h-5 text-textSecondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}

export default Header;
