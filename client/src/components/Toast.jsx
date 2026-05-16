import { createContext, useContext, useState, useCallback } from 'react'

// Tiny toast system. Usage:
//   const toast = useToast()
//   toast.success('Saved'); toast.error('Could not save'); toast.info('Working…')
const ToastCtx = createContext(null)
export const useToast = () => useContext(ToastCtx)

let nextId = 1

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])

  const remove = useCallback((id) => setItems(arr => arr.filter(t => t.id !== id)), [])

  const push = useCallback((message, type = 'info', ms = 3500) => {
    const id = nextId++
    setItems(arr => [...arr, { id, message, type }])
    setTimeout(() => remove(id), ms)
  }, [remove])

  const api = {
    success: (m, ms) => push(m, 'success', ms),
    error:   (m, ms) => push(m, 'error', ms ?? 5000),
    info:    (m, ms) => push(m, 'info', ms)
  }

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`} onClick={() => remove(t.id)}>
            <span className="toast-icon">{t.type === 'success' ? '✓' : t.type === 'error' ? '!' : 'ℹ'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
