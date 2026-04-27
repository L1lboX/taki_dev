import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const loginStore = useAuthStore((state) => state.login)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const mutation = useMutation({
    mutationFn: (payload) => api.login(payload),
    onSuccess: (result) => {
      queryClient.clear()
      loginStore(result)
      toast.success(`Bienvenido ${result.user.name}`)
      navigate('/pos')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
  const isDisabled = mutation.isPending || !username.trim() || !password.trim()

  const onSubmit = (event) => {
    event.preventDefault()
    const cleanUsername = username.trim()
    const cleanPassword = password.trim()
    if (!cleanUsername || !cleanPassword) {
      toast.error('Completa usuario y contrasena para continuar')
      return
    }
    mutation.mutate({ username: cleanUsername, password: cleanPassword })
  }

  return (
    <div className="auth-shell">
      <section className="auth-hero" aria-label="TAKI POS">
        <div className="auth-hero-copy">
          <p className="auth-kicker">Restaurante / Operacion</p>
          <h1 className="auth-title">TAKI POS</h1>
          <p className="auth-subtitle">Panel privado para sala, cocina y caja.</p>
        </div>
        <div className="auth-plate" aria-hidden="true">
          <span className="auth-plate-rule" />
          <span className="auth-plate-mark">T</span>
          <span className="auth-plate-meta">Heritage System</span>
        </div>
      </section>

      <form autoComplete="off" className="auth-card" onSubmit={onSubmit}>
        <div className="auth-copy">
          <span className="auth-brand">Acceso seguro</span>
          <h2 className="auth-form-title">Iniciar sesion</h2>
          <p className="auth-form-subtitle">Ingresa tus credenciales para continuar.</p>
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="login-username">
            Usuario
          </label>
          <input
            autoCapitalize="none"
            autoComplete="off"
            className="auth-input"
            id="login-username"
            name="taki-login-user"
            onChange={(event) => setUsername(event.target.value)}
            placeholder="usuario"
            spellCheck={false}
            type="text"
            value={username}
          />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="login-password">
            Contrasena
          </label>
          <input
            autoComplete="off"
            className="auth-input"
            id="login-password"
            name="taki-login-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="contrasena"
            type="password"
            value={password}
          />
        </div>

        <button className="btn-primary auth-submit" disabled={isDisabled} type="submit">
          {mutation.isPending ? 'Ingresando...' : 'Ingresar'}
        </button>

        <p className="auth-note">Acceso autorizado solo para personal registrado.</p>
      </form>
    </div>
  )
}
