
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { GoogleAuthProvider } from './contexts/GoogleAuthContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <GoogleAuthProvider autoRefresh={true} refreshCheckInterval={60000}>
      <App />
    </GoogleAuthProvider>
  </React.StrictMode>
);
