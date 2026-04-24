import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

const SETTINGS_SECTIONS = [
  {
    id: 'general',
    label: 'Configuracion general',
    shortLabel: 'General',
    description: 'Datos base del restaurante, contacto y zona horaria.',
  },
  {
    id: 'printers',
    label: 'Configuracion de impresoras',
    shortLabel: 'Impresoras',
    description: 'Conexion de cocina, cola automatica y respaldo PDF.',
  },
  {
    id: 'profile',
    label: 'Configuracion de perfil',
    shortLabel: 'Perfil',
    description: 'Logo, color y datos publicos del negocio.',
  },
]

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
    profileEmail: '',
    profileWebsite: '',
    profileDescription: '',
    printers: {
      kitchenEnabled: true,
      autoPrintOnSend: true,
      connectionType: 'LOCAL',
      printerName: '',
      host: '',
      port: '9100',
      paperWidth: '80mm',
      fallbackToPdf: false,
    },
  }
}

function mergeSettingsIntoForm(data) {
  const empty = createEmptyForm()
  return {
    ...empty,
    ...data,
    printers: {
      ...empty.printers,
      ...(data?.printers || {}),
    },
  }
}

export default function RestaurantSettingsPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const settingsQueryKey = scopedQueryKey('restaurant-settings', user)
  const [activeSection, setActiveSection] = useState('general')
  const [form, setForm] = useState(createEmptyForm())

  const settingsQuery = useQuery({
    queryKey: settingsQueryKey,
    queryFn: api.getRestaurantSettings,
  })

  useEffect(() => {
    if (!settingsQuery.data) return
    setForm(mergeSettingsIntoForm(settingsQuery.data))
  }, [settingsQuery.data])

  const updateMutation = useMutation({
    mutationFn: api.updateRestaurantSettings,
    onSuccess: async () => {
      toast.success('Configuracion de restaurante actualizada')
      await queryClient.invalidateQueries({ queryKey: settingsQueryKey })
    },
    onError: (error) => toast.error(error.message),
  })

  const printerStatus = useMemo(() => {
    if (!form.printers.kitchenEnabled) return 'Impresora de cocina desactivada'
    if (!form.printers.autoPrintOnSend) return 'Cola creada, impresion manual'
    return 'Impresion automatica al enviar a cocina'
  }, [form.printers.autoPrintOnSend, form.printers.kitchenEnabled])

  const activeSectionMeta = SETTINGS_SECTIONS.find((section) => section.id === activeSection) || SETTINGS_SECTIONS[0]

  function setPrinterField(field, value) {
    setForm((prev) => ({
      ...prev,
      printers: {
        ...prev.printers,
        [field]: value,
      },
    }))
  }

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
      profileEmail: String(form.profileEmail || '').trim(),
      profileWebsite: String(form.profileWebsite || '').trim(),
      profileDescription: String(form.profileDescription || '').trim(),
      printers: {
        kitchenEnabled: Boolean(form.printers.kitchenEnabled),
        autoPrintOnSend: Boolean(form.printers.autoPrintOnSend),
        connectionType: String(form.printers.connectionType || '').trim().toUpperCase(),
        printerName: String(form.printers.printerName || '').trim(),
        host: String(form.printers.host || '').trim(),
        port: String(form.printers.port || '').trim(),
        paperWidth: String(form.printers.paperWidth || '').trim(),
        fallbackToPdf: Boolean(form.printers.fallbackToPdf),
      },
    })
  }

  return (
    <div className="page-stack">
      <section className="panel restaurant-settings-hero">
        <div className="section-head">
          <div>
            <h2 className="section-title">Restaurante</h2>
            <p className="section-subtitle">
              Separo la configuracion por bloques para que la impresora de cocina quede en su propio apartado.
            </p>
          </div>
          <div className="restaurant-settings-hero-badges">
            <span className="badge">{printerStatus}</span>
            <span className="badge">{form.printers.connectionType}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-head restaurant-settings-head">
          <div>
            <h3 className="section-title">{activeSectionMeta.label}</h3>
            <p className="section-subtitle">{activeSectionMeta.description}</p>
          </div>
        </div>

        <div className="pos-orders-salon-filters restaurant-settings-tabs" role="tablist">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              aria-pressed={activeSection === section.id}
              className={`pos-orders-salon-chip ${activeSection === section.id ? 'active' : ''}`}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </div>

        {settingsQuery.isLoading && <p className="alert alert-info">Cargando configuracion...</p>}

        <form className="restaurant-settings-form" onSubmit={submitUpdate}>
          {activeSection === 'general' && (
            <div className="form-grid-3 restaurant-settings-grid">
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
            </div>
          )}

          {activeSection === 'printers' && (
            <div className="restaurant-settings-printer-layout">
              <aside className="restaurant-settings-printer-summary">
                <p className="restaurant-settings-kicker">Destino</p>
                <h4>Cocina</h4>
                <p className="small muted">
                  Cuando el pedido llega a cocina, aqui defines si se manda a la cola de impresion o si se deja respaldo PDF.
                </p>

                <div className="restaurant-settings-printer-meta">
                  <span className="badge">{printerStatus}</span>
                  <span className="badge">
                    Respaldo PDF {form.printers.fallbackToPdf ? 'activo' : 'apagado'}
                  </span>
                </div>
              </aside>

              <div className="restaurant-settings-printer-fields">
                <div className="restaurant-settings-toggle-grid">
                  <label className="restaurant-settings-toggle-card">
                    <input
                      checked={form.printers.kitchenEnabled}
                      onChange={(event) => setPrinterField('kitchenEnabled', event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <strong>Impresora de cocina activa</strong>
                      <small>Habilita la configuracion de salida para comandas.</small>
                    </span>
                  </label>

                  <label className="restaurant-settings-toggle-card">
                    <input
                      checked={form.printers.autoPrintOnSend}
                      onChange={(event) => setPrinterField('autoPrintOnSend', event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <strong>Imprimir al enviar a cocina</strong>
                      <small>Evita que cada usuario descargue la comanda manualmente.</small>
                    </span>
                  </label>

                  <label className="restaurant-settings-toggle-card">
                    <input
                      checked={form.printers.fallbackToPdf}
                      onChange={(event) => setPrinterField('fallbackToPdf', event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <strong>Usar PDF como respaldo</strong>
                      <small>Solo descarga PDF si la impresion automatica esta apagada.</small>
                    </span>
                  </label>
                </div>

                <div className="form-grid-3 restaurant-settings-grid">
                  <div>
                    <label className="form-label">Tipo de conexion</label>
                    <select
                      onChange={(event) => setPrinterField('connectionType', event.target.value)}
                      value={form.printers.connectionType}
                    >
                      <option value="LOCAL">Local USB / driver</option>
                      <option value="NETWORK">Red TCP/IP</option>
                      <option value="SYSTEM">Cola del sistema</option>
                    </select>
                  </div>

                  <div>
                    <label className="form-label">Nombre de impresora</label>
                    <input
                      onChange={(event) => setPrinterField('printerName', event.target.value)}
                      placeholder="Ej: Cocina principal"
                      value={form.printers.printerName}
                    />
                  </div>

                  <div>
                    <label className="form-label">Ancho de papel</label>
                    <select
                      onChange={(event) => setPrinterField('paperWidth', event.target.value)}
                      value={form.printers.paperWidth}
                    >
                      <option value="80mm">80mm</option>
                      <option value="58mm">58mm</option>
                    </select>
                  </div>

                  <div>
                    <label className="form-label">Host / IP</label>
                    <input
                      onChange={(event) => setPrinterField('host', event.target.value)}
                      placeholder="192.168.1.50"
                      value={form.printers.host}
                    />
                  </div>

                  <div>
                    <label className="form-label">Puerto</label>
                    <input onChange={(event) => setPrinterField('port', event.target.value)} value={form.printers.port} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'profile' && (
            <div className="restaurant-settings-profile-layout">
              <div className="restaurant-settings-profile-preview">
                <p className="restaurant-settings-kicker">Vista previa</p>
                <div className="restaurant-settings-profile-card">
                  <div
                    className="restaurant-settings-profile-swatch"
                    style={{ background: form.primaryColor || '#1b4332' }}
                  />
                  <div>
                    <strong>{form.name || 'Nombre del restaurante'}</strong>
                    <p>{form.profileDescription || 'Tu perfil publico y branding apareceran aqui.'}</p>
                  </div>
                </div>
              </div>

              <div className="form-grid-3 restaurant-settings-grid">
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

                <div>
                  <label className="form-label">Correo publico</label>
                  <input
                    onChange={(event) => setForm((prev) => ({ ...prev, profileEmail: event.target.value }))}
                    type="email"
                    value={form.profileEmail}
                  />
                </div>

                <div style={{ gridColumn: '1 / span 2' }}>
                  <label className="form-label">Sitio web</label>
                  <input
                    onChange={(event) => setForm((prev) => ({ ...prev, profileWebsite: event.target.value }))}
                    placeholder="https://..."
                    type="url"
                    value={form.profileWebsite}
                  />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Descripcion corta</label>
                  <textarea
                    onChange={(event) => setForm((prev) => ({ ...prev, profileDescription: event.target.value }))}
                    rows={4}
                    value={form.profileDescription}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="restaurant-settings-actions">
            <button className="btn btn-main" disabled={updateMutation.isPending} type="submit">
              {updateMutation.isPending ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
