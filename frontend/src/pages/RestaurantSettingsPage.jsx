import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

function createEmptyForm() {
  return {
    name: '',
    legalName: '',
    taxId: '',
    currency: 'PEN',
    timezone: 'America/Lima',
    address: '',
    phone: '',
    logoUrl: '',
    primaryColor: '#1b4332',
  }
}

export default function RestaurantSettingsPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const [form, setForm] = useState(createEmptyForm())

  const settingsQuery = useQuery({
    queryKey: scopedQueryKey('restaurant-settings', user),
    queryFn: api.getRestaurantSettings,
  })

  useEffect(() => {
    if (!settingsQuery.data) return
    const data = settingsQuery.data
    setForm({
      name: data.name || '',
      legalName: data.legalName || '',
      taxId: data.taxId || '',
      currency: data.currency || 'PEN',
      timezone: data.timezone || 'America/Lima',
      address: data.address || '',
      phone: data.phone || '',
      logoUrl: data.logoUrl || '',
      primaryColor: data.primaryColor || '#1b4332',
    })
  }, [settingsQuery.data])

  const updateMutation = useMutation({
    mutationFn: api.updateRestaurantSettings,
    onSuccess: async () => {
      toast.success('Configuracion de restaurante actualizada')
      await queryClient.invalidateQueries({ queryKey: ['restaurant-settings'] })
    },
    onError: (error) => toast.error(error.message),
  })

  function submitUpdate(event) {
    event.preventDefault()
    const name = String(form.name || '').trim()
    if (!name) {
      toast.error('Ingresa nombre del restaurante')
      return
    }

    updateMutation.mutate({
      name,
      legalName: String(form.legalName || '').trim(),
      taxId: String(form.taxId || '').trim(),
      currency: String(form.currency || '').trim(),
      timezone: String(form.timezone || '').trim(),
      address: String(form.address || '').trim(),
      phone: String(form.phone || '').trim(),
      logoUrl: String(form.logoUrl || '').trim(),
      primaryColor: String(form.primaryColor || '').trim(),
    })
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2 className="section-title">Restaurante</h2>
            <p className="section-subtitle">Datos generales para facturacion, zona horaria y branding basico.</p>
          </div>
        </div>
      </section>

      <section className="panel">
        {settingsQuery.isLoading && <p className="alert alert-info">Cargando configuracion...</p>}

        <form className="form-grid-3" onSubmit={submitUpdate}>
          <div>
            <label className="form-label">Nombre comercial</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} value={form.name} />
          </div>
          <div>
            <label className="form-label">Razon social</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, legalName: event.target.value }))} value={form.legalName} />
          </div>
          <div>
            <label className="form-label">RUC / NIT</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, taxId: event.target.value }))} value={form.taxId} />
          </div>

          <div>
            <label className="form-label">Moneda</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, currency: event.target.value }))} value={form.currency} />
          </div>
          <div>
            <label className="form-label">Zona horaria</label>
            <input
              onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
              value={form.timezone}
            />
          </div>
          <div>
            <label className="form-label">Telefono</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} value={form.phone} />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Direccion</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))} value={form.address} />
          </div>

          <div>
            <label className="form-label">Logo URL</label>
            <input onChange={(event) => setForm((prev) => ({ ...prev, logoUrl: event.target.value }))} value={form.logoUrl} />
          </div>
          <div>
            <label className="form-label">Color primario</label>
            <input
              onChange={(event) => setForm((prev) => ({ ...prev, primaryColor: event.target.value }))}
              type="color"
              value={form.primaryColor}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn btn-main" disabled={updateMutation.isPending} type="submit">
              Guardar cambios
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
