import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'

export default function LoginPage() {
  const [username, setUsername] = useState('mesero')
  const [password, setPassword] = useState('123456')
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

  const onSubmit = (event) => {
    event.preventDefault()
    mutation.mutate({ username, password })
  }

  return (
    <div className="auth-shell px-4">
      <form className="auth-card" onSubmit={onSubmit}>
        <span className="auth-brand">TAKI OPERATIONS</span>
        <h1 className="auth-title">TAKI POS</h1>
        <p className="auth-subtitle">Inicia sesion para operar el restaurante</p>

        <label className="mt-5 block text-sm font-semibold">Usuario</label>
        <input className="mt-1" onChange={(event) => setUsername(event.target.value)} value={username} />

        <label className="mt-3 block text-sm font-semibold">Contrasena</label>
        <input className="mt-1" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />

        <button className="btn-primary mt-5 w-full" disabled={mutation.isPending} type="submit">
          {mutation.isPending ? 'Ingresando...' : 'Ingresar'}
        </button>

        <div className="auth-hint mt-4 text-xs">
          <p>Usuarios demo:</p>
          <p>`superadmin`, `admin`, `cocinero`, `mesero`</p>
          <p>Contrasena: `123456`</p>
        </div>
      </form>
    </div>
  )
}
