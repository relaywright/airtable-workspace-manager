import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { logger } from './utils/logger';
import './styles/globals.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    logger.error('ErrorBoundary', 'React crash:', error.message);
    logger.error('ErrorBoundary', 'Stack:', error.stack);
    logger.error('ErrorBoundary', 'Component stack:', info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return React.createElement(
        'div',
        {
          style: {
            padding: 40,
            color: '#e2e8f0',
            background: '#0f0f1a',
            fontFamily: 'monospace',
            height: '100vh',
          },
        },
        React.createElement('h1', { style: { color: '#ef4444', marginBottom: 16 } }, 'App Crashed'),
        React.createElement(
          'pre',
          { style: { whiteSpace: 'pre-wrap', fontSize: 14, color: '#f59e0b' } },
          String(this.state.error?.message || this.state.error),
        ),
        React.createElement(
          'pre',
          { style: { whiteSpace: 'pre-wrap', fontSize: 12, color: '#64748b', marginTop: 16 } },
          String(this.state.error?.stack || ''),
        ),
        React.createElement(
          'button',
          {
            onClick: () => window.location.reload(),
            style: {
              marginTop: 20,
              padding: '8px 16px',
              background: '#6366f1',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            },
          },
          'Reload',
        ),
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
