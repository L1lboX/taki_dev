export default function HomePage() {
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2 className="section-title">Panel TAKI POS</h2>
          <p className="section-subtitle">Usa el menu lateral para operar POS, cocina, caja, inventario y KPIs.</p>
        </div>
      </div>

      <div className="home-kpi-grid" style={{ marginTop: 12 }}>
        <article className="kpi-card">
          <p className="kpi-label">Flujo</p>
          <p className="kpi-value" style={{ fontSize: 22 }}>Mesa</p>
          <p className="small">Pedido por mesero y QR con aprobacion.</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-label">Operacion</p>
          <p className="kpi-value" style={{ fontSize: 22 }}>Cocina</p>
          <p className="small">Kanban de estados y tickets de comanda.</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-label">Control</p>
          <p className="kpi-value" style={{ fontSize: 22 }}>Caja</p>
          <p className="small">Cierre diario con conciliacion por metodo.</p>
        </article>
      </div>
    </section>
  )
}
