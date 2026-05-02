import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'
import { scopedQueryKey } from '../lib/queryAuth'
import { useAuthStore } from '../store/authStore'

const SETTINGS_SECTIONS = [
  {
    id: 'general',
    label: 'Datos del negocio',
    description: 'Informacion base del restaurante para operacion y documentos.',
  },
  {
    id: 'printers',
    label: 'Impresora de cocina',
    description: 'Salida de comandas por LAN o USB y comportamiento de impresion.',
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
    printers: {
      kitchenEnabled: true,
      autoPrintOnSend: true,
      connectionType: 'USB',
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
      toast.success('Configuracion actualizada')
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
            <h2 className="section-title">Configuracion</h2>
            <p className="section-subtitle">
              Esta pantalla queda solo para negocio e impresora. El perfil personal ahora vive aparte en tu usuario.
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
            <div className="form-grid-2 restaurant-settings-grid">
              <div className="restaurant-settings-field">
                <label className="form-label">Nombre comercial</label>
                <input onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} value={form.name} />
              </div>

              <div className="restaurant-settings-field">
                <label className="form-label">Razon social</label>
                <input onChange={(event) => setForm((prev) => ({ ...prev, legalName: event.target.value }))} value={form.legalName} />
              </div>

              <div className="restaurant-settings-field">
                <label className="form-label">RUC / NIT</label>
                <input onChange={(event) => setForm((prev) => ({ ...prev, taxId: event.target.value }))} value={form.taxId} />
              </div>

              <div className="restaurant-settings-field">
                <label className="form-label">Moneda</label>
                <input onChange={(event) => setForm((prev) => ({ ...prev, currency: event.target.value }))} value={form.currency} />
              </div>

              <div className="restaurant-settings-field">
                <label className="form-label">Zona horaria</label>
                <input
                  onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
                  value={form.timezone}
                />
              </div>

              <div className="restaurant-settings-field">
                <label className="form-label">Telefono</label>
                <input onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} value={form.phone} />
              </div>

              <div className="restaurant-settings-field restaurant-settings-field-span">
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
                  Define si la comanda se imprime al enviarse a cocina y si la salida se hace por LAN o USB.
                </p>

                <div className="restaurant-settings-printer-meta">
                  <span className="badge">{printerStatus}</span>
                  <span className="badge">Respaldo PDF {form.printers.fallbackToPdf ? 'activo' : 'apagado'}</span>
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
                      <small>Habilita la salida de comandas para cocina.</small>
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
                      <small>Si se apaga, la cola queda lista pero el disparo es manual.</small>
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
                      <small>Guarda una salida alternativa si la impresion principal no se usa.</small>
                    </span>
                  </label>
                </div>

                <div className="form-grid-3 restaurant-settings-grid">
                  <div className="restaurant-settings-field">
                    <label className="form-label">Tipo de conexion</label>
                    <select
                      onChange={(event) => setPrinterField('connectionType', event.target.value)}
                      value={form.printers.connectionType}
                    >
                      <option value="USB">USB</option>
                      <option value="LAN">LAN</option>
                    </select>
                  </div>

                  <div className="restaurant-settings-field">
                    <label className="form-label">Nombre de impresora</label>
                    <input
                      onChange={(event) => setPrinterField('printerName', event.target.value)}
                      placeholder="Ej: EPSON TM-T20III Receipt"
                      value={form.printers.printerName}
                    />
                    <p className="small muted">En USB usa el nombre exacto de Windows o dejalo vacio para la predeterminada.</p>
                  </div>

                  <div className="restaurant-settings-field">
                    <label className="form-label">Ancho de papel</label>
                    <select
                      onChange={(event) => setPrinterField('paperWidth', event.target.value)}
                      value={form.printers.paperWidth}
                    >
                      <option value="80mm">80mm</option>
                      <option value="58mm">58mm</option>
                    </select>
                  </div>

                  {form.printers.connectionType === 'LAN' && (
                    <>
                      <div className="restaurant-settings-field">
                        <label className="form-label">Equipo / IP</label>
                        <input
                          onChange={(event) => setPrinterField('host', event.target.value)}
                          placeholder="192.168.1.50"
                          value={form.printers.host}
                        />
                      </div>

                      <div className="restaurant-settings-field">
                        <label className="form-label">Puerto</label>
                        <input onChange={(event) => setPrinterField('port', event.target.value)} value={form.printers.port} />
                      </div>
                    </>
                  )}
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
