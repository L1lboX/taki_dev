import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'

const MAX_PHOTO_SIZE_BYTES = 1024 * 1024

function createEmptyForm() {
  return {
    name: '',
    photoUrl: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  }
}

export default function ProfilePage() {
  const currentUser = useAuthStore((state) => state.user)
  const updateUser = useAuthStore((state) => state.updateUser)
  const [form, setForm] = useState(createEmptyForm())

  const profileQuery = useQuery({
    queryKey: ['my-profile'],
    queryFn: api.getMyProfile,
  })

  useEffect(() => {
    if (!profileQuery.data) return
    setForm((prev) => ({
      ...prev,
      name: profileQuery.data.name || '',
      photoUrl: profileQuery.data.photoUrl || '',
    }))
  }, [profileQuery.data])

  const updateMutation = useMutation({
    mutationFn: api.updateMyProfile,
    onSuccess: (nextUser) => {
      updateUser(nextUser)
      setForm((prev) => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      }))
      toast.success('Perfil actualizado')
    },
    onError: (error) => toast.error(error.message),
  })

  function handlePhotoFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      toast.error('La foto debe pesar menos de 1 MB')
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setForm((prev) => ({
        ...prev,
        photoUrl: typeof reader.result === 'string' ? reader.result : '',
      }))
    }
    reader.onerror = () => toast.error('No se pudo leer la foto')
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  function handleSubmit(event) {
    event.preventDefault()
    const name = String(form.name || '').trim()
    const currentPassword = String(form.currentPassword || '').trim()
    const newPassword = String(form.newPassword || '').trim()
    const confirmPassword = String(form.confirmPassword || '').trim()

    if (!name) {
      toast.error('Ingresa tu nombre')
      return
    }

    if (newPassword || currentPassword || confirmPassword) {
      if (!currentPassword) {
        toast.error('Ingresa tu password actual')
        return
      }

      if (!newPassword) {
        toast.error('Ingresa el nuevo password')
        return
      }

      if (newPassword !== confirmPassword) {
        toast.error('La confirmacion del password no coincide')
        return
      }
    }

    updateMutation.mutate({
      name,
      photoUrl: String(form.photoUrl || '').trim(),
      ...(newPassword
        ? {
            currentPassword,
            newPassword,
          }
        : {}),
    })
  }

  const profile = profileQuery.data || currentUser || {}

  return (
    <div className="page-stack profile-settings-page">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Mi perfil</h2>
            <p className="section-subtitle">Edita tu foto, tu nombre visible y tu password.</p>
          </div>
          <span className="badge">{profile.role || 'USUARIO'}</span>
        </div>
      </section>

      <section className="panel">
        {profileQuery.isLoading && <p className="alert alert-info">Cargando perfil...</p>}

        <form className="profile-settings-layout" onSubmit={handleSubmit}>
          <aside className="profile-settings-summary">
            <div className="profile-settings-avatar-wrap">
              {form.photoUrl ? (
                <img alt={form.name || 'Perfil'} className="profile-settings-avatar-image" src={form.photoUrl} />
              ) : (
                <div className="profile-settings-avatar-fallback">
                  {String(form.name || profile.username || 'U').trim().charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <div className="profile-settings-summary-copy">
              <strong>{form.name || 'Usuario'}</strong>
              <span>@{profile.username || 'sin-usuario'}</span>
            </div>

            <label className="btn btn-soft profile-settings-upload-btn">
              Subir foto
              <input accept="image/*" hidden onChange={handlePhotoFileChange} type="file" />
            </label>

            <button
              className="btn btn-soft"
              onClick={() => setForm((prev) => ({ ...prev, photoUrl: '' }))}
              type="button"
            >
              Quitar foto
            </button>
          </aside>

          <div className="profile-settings-form">
            <div className="form-grid-2 profile-settings-grid">
              <div className="profile-settings-field">
                <label className="form-label">Nombre</label>
                <input onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} value={form.name} />
              </div>

              <div className="profile-settings-field">
                <label className="form-label">Usuario</label>
                <input disabled value={profile.username || ''} />
              </div>

              <div className="profile-settings-field">
                <label className="form-label">Password actual</label>
                <input
                  onChange={(event) => setForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
                  type="password"
                  value={form.currentPassword}
                />
              </div>

              <div className="profile-settings-field">
                <label className="form-label">Nuevo password</label>
                <input
                  onChange={(event) => setForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                  type="password"
                  value={form.newPassword}
                />
              </div>

              <div className="profile-settings-field profile-settings-field-span">
                <label className="form-label">Confirmar nuevo password</label>
                <input
                  onChange={(event) => setForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                  type="password"
                  value={form.confirmPassword}
                />
              </div>
            </div>

            <div className="profile-settings-actions">
              <button className="btn btn-main" disabled={updateMutation.isPending} type="submit">
                {updateMutation.isPending ? 'Guardando...' : 'Guardar perfil'}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
