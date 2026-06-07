import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import '@fontsource-variable/hanken-grotesk'
import '@fontsource-variable/hanken-grotesk/wght-italic.css'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App'
import { queryClient } from './lib/queryClient'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider } from './context/AuthContext'
import { DialogProvider } from './context/DialogContext'
import { PermissionsDialogProvider } from './context/PermissionsDialogContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <ThemeProvider>
          <AuthProvider>
            <DialogProvider>
              <PermissionsDialogProvider>
                <App />
              </PermissionsDialogProvider>
            </DialogProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
