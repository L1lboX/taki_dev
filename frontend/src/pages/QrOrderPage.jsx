const RESTAURANT_NAME = 'TAKI'

export default function QrOrderPage() {
  return (
    <div className="qr-customer-page">
      <div className="qr-customer-shell qr-empty-shell">
        <header className="qr-simple-header">
          <h1 className="qr-simple-brand">{RESTAURANT_NAME}</h1>
        </header>
      </div>
    </div>
  )
}
