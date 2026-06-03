import { Toaster } from 'sonner'
import { useTheme } from '../context/ThemeContext'

// Sonner toaster wired to the app's light/dark theme (it uses prefers-color-scheme otherwise,
// which wouldn't follow our manual theme toggle).
export default function AppToaster() {
  const { theme } = useTheme()
  return (
    <Toaster
      theme={theme}
      richColors
      closeButton
      position="bottom-right"
      toastOptions={{ className: 'text-sm' }}
    />
  )
}
