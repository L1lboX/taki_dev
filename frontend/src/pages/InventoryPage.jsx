import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../api/client'

export default function InventoryPage() {
  const queryClient = useQueryClient()
  const [stockDraft, setStockDraft] = useState({})

  const inventoryQuery = useQuery({
    queryKey: ['inventory'],
    queryFn: api.getInventory,
    refetchInterval: 15000,
  })

  const updateMutation = useMutation({
    mutationFn: ({ productId, stock }) => api.updateInventory(productId, { stock: Number(stock) }),
    onSuccess: () => {
      toast.success('Inventario actualizado')
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const rows = inventoryQuery.data || []

  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2 className="section-title">Inventario basico</h2>
          <p className="section-subtitle">Stock manual por producto con alerta minima.</p>
        </div>
      </div>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="app-table" style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Stock actual</th>
              <th>Alerta</th>
              <th>Actualizar</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const value = stockDraft[row.productId] ?? row.stock
              const low = row.stock <= row.lowStockThreshold

              return (
                <tr key={row.id}>
                  <td>{row.productName}</td>
                  <td>
                    <span className={low ? 'status-pill status-pending' : 'status-pill status-ready'}>
                      {row.stock}
                    </span>
                  </td>
                  <td>{row.lowStockThreshold}</td>
                  <td>
                    <div className="inline-actions">
                      <input
                        onChange={(event) => setStockDraft((prev) => ({ ...prev, [row.productId]: event.target.value }))}
                        style={{ width: 90 }}
                        type="number"
                        value={value}
                      />
                      <button
                        className="btn btn-main"
                        onClick={() => updateMutation.mutate({ productId: row.productId, stock: value })}
                        type="button"
                      >
                        Guardar
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
