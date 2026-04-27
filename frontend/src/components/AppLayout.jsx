import { ThemeProvider } from '@mui/material/styles'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { AppShellThemeProvider, useAppShellTheme } from './header/AppShellThemeContext'
import HeaderBar from './header/HeaderBar'

const ICONS = {
  dashboard: 'fi-rr-apps',
  finance: 'fi-rr-chart-histogram',
  orders: 'fi-rr-clipboard-list-check',
  kitchen: 'fi-rr-utensils',
  list: 'fi-rr-list-check',
  bill: 'fi-rr-receipt',
  menu: 'fi-rr-book-alt',
  table: 'fi-rr-table-layout',
  users: 'fi-rr-users',
  settings: 'fi-rr-settings',
}

const NAV_GROUPS = [
  {
    label: 'GENERAL',
    items: [
      {
        type: 'link',
        to: '/dashboard',
        label: 'Dashboard',
        icon: 'dashboard',
        roles: ['ADMIN', 'ACCOUNTANT', 'SUPER_ADMIN'],
      },
      {
        type: 'submenu',
        id: 'finanzas',
        label: 'Finanzas',
        icon: 'finance',
        roles: ['ACCOUNTANT', 'CASHIER', 'SUPER_ADMIN'],
        children: [
          { to: '/finanzas/transacciones', label: 'Transacciones', roles: ['ACCOUNTANT', 'SUPER_ADMIN'] },
          { to: '/finanzas/caja', label: 'Caja', roles: ['CASHIER', 'SUPER_ADMIN'] },
          { to: '/finanzas/cuentas', label: 'Cuentas', roles: ['ACCOUNTANT', 'SUPER_ADMIN'] },
        ],
      },
    ],
  },
  {
    label: 'PEDIDOS',
    items: [
      { type: 'link', to: '/pedidos', label: 'Pedidos', icon: 'orders', roles: ['WAITER', 'ADMIN', 'SUPER_ADMIN'] },
      {
        type: 'link',
        to: '/pedidos/preparacion',
        label: 'Preparacion de pedidos',
        icon: 'kitchen',
        roles: ['COOK', 'ADMIN', 'SUPER_ADMIN'],
      },
      {
        type: 'link',
        to: '/pedidos/lista',
        label: 'Lista de pedidos',
        icon: 'list',
        roles: ['WAITER', 'ADMIN', 'SUPER_ADMIN'],
      },
      {
        type: 'link',
        to: '/pedidos/cuentas',
        label: 'Cuentas',
        icon: 'bill',
        roles: ['WAITER', 'CASHIER', 'ADMIN', 'SUPER_ADMIN'],
      },
    ],
  },
  {
    label: 'ADMINISTRACION',
    items: [
      {
        type: 'submenu',
        id: 'menu-restaurante',
        label: 'Menu del restaurante',
        icon: 'menu',
        roles: ['ADMIN', 'SUPER_ADMIN'],
        children: [
          { to: '/administracion/menu/secciones', label: 'Secciones', roles: ['ADMIN', 'SUPER_ADMIN'] },
          { to: '/administracion/menu/categorias', label: 'Categorias', roles: ['ADMIN', 'SUPER_ADMIN'] },
          { to: '/administracion/menu/productos', label: 'Productos', roles: ['ADMIN', 'SUPER_ADMIN'] },
        ],
      },
      {
        type: 'link',
        to: '/administracion/mesas',
        label: 'Gestion de mesas',
        icon: 'table',
        roles: ['ADMIN', 'SUPER_ADMIN'],
      },
      {
        type: 'link',
        to: '/administracion/clientes',
        label: 'Gestion de clientes',
        icon: 'users',
        roles: ['ADMIN', 'SUPER_ADMIN'],
      },
    ],
  },
  {
    label: 'ADMINISTRACION AVANZADA',
    items: [
      {
        type: 'link',
        to: '/admin-avanzada/usuarios',
        label: 'Gestion de usuarios',
        icon: 'users',
        roles: ['ADMIN', 'SUPER_ADMIN'],
      },
      {
        type: 'link',
        to: '/admin-avanzada/restaurante',
        label: 'Configuracion',
        icon: 'settings',
        roles: ['ADMIN', 'SUPER_ADMIN'],
      },
    ],
  },
]

function canAccess(item, role) {
  if (!item.roles?.length) return true
  if (!role) return false
  return item.roles.includes(role)
}

function isPathActive(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`)
}

function resolveVisibleGroups(role) {
  return NAV_GROUPS
    .map((group) => {
      const visibleItems = group.items
        .map((item) => {
          if (item.type === 'submenu') {
            if (!canAccess(item, role)) return null
            const children = (item.children || []).filter((child) => canAccess(child, role))
            if (!children.length) return null
            return {
              ...item,
              children,
            }
          }

          return canAccess(item, role) ? item : null
        })
        .filter(Boolean)

      return {
        ...group,
        items: visibleItems,
      }
    })
    .filter((group) => group.items.length > 0)
}

function getInitialViewportMatch() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 980px)').matches
}

function AppLayoutShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const { muiTheme, themeMode } = useAppShellTheme()

  const navGroups = useMemo(() => resolveVisibleGroups(user?.role), [user?.role])
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(getInitialViewportMatch)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [openSubmenus, setOpenSubmenus] = useState({
    finanzas: true,
    'menu-restaurante': false,
  })

  const isCompactDesktopSidebar = isSidebarCollapsed && !isMobileViewport

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const mediaQuery = window.matchMedia('(max-width: 980px)')
    const syncViewport = (event) => {
      setIsMobileViewport(event.matches)
    }

    setIsMobileViewport(mediaQuery.matches)

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncViewport)
      return () => mediaQuery.removeEventListener('change', syncViewport)
    }

    mediaQuery.addListener(syncViewport)
    return () => mediaQuery.removeListener(syncViewport)
  }, [])

  useEffect(() => {
    setIsMobileSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileSidebarOpen(false)
    }
  }, [isMobileViewport])

  useEffect(() => {
    if (!isMobileViewport || !isMobileSidebarOpen) {
      document.body.style.overflow = ''
      return undefined
    }

    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMobileSidebarOpen, isMobileViewport])

  useEffect(() => {
    if (!isMobileViewport || !isMobileSidebarOpen) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMobileSidebarOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMobileSidebarOpen, isMobileViewport])

  const toggleSubmenu = (submenuId) => {
    setOpenSubmenus((prev) => ({
      ...prev,
      [submenuId]: !prev[submenuId],
    }))
  }

  const closeMobileSidebar = () => {
    setIsMobileSidebarOpen(false)
  }

  const toggleMobileSidebar = () => {
    setIsMobileSidebarOpen((prev) => !prev)
  }

  return (
    <ThemeProvider theme={muiTheme}>
      <div
        className={`app-shell ${isCompactDesktopSidebar ? 'sidebar-collapsed' : ''} ${isMobileViewport ? 'mobile-viewport' : ''} ${
          isMobileSidebarOpen ? 'mobile-nav-open' : ''
        }`}
        data-app-theme={themeMode}
      >
        <button
          aria-hidden={!isMobileSidebarOpen}
          className={`mobile-sidebar-backdrop ${isMobileSidebarOpen ? 'open' : ''}`}
          onClick={closeMobileSidebar}
          tabIndex={isMobileSidebarOpen ? 0 : -1}
          type="button"
        />

        <aside className={`side-panel ${isCompactDesktopSidebar ? 'collapsed' : ''} ${isMobileSidebarOpen ? 'mobile-open' : ''}`}>
          <div className="sidebar-top-row">
            {!isMobileViewport && (
              <button
                aria-label={isSidebarCollapsed ? 'Expandir sidebar' : 'Minimizar sidebar'}
                className="sidebar-toggle-btn"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                type="button"
              >
                {isSidebarCollapsed ? '>' : '<'}
              </button>
            )}

            {isMobileViewport && (
              <button
                aria-label="Cerrar menu lateral"
                className="sidebar-mobile-close"
                onClick={closeMobileSidebar}
                type="button"
              >
                <i className="fi fi-rr-cross-small" />
              </button>
            )}
          </div>

          <div className="sidebar-brand">
            <div aria-hidden="true" className="sidebar-logo-placeholder">
              <i className="fi fi-rr-restaurant" />
            </div>
            {!isCompactDesktopSidebar && (
              <div className="sidebar-brand-copy">
                <p className="sidebar-brand-kicker">Restaurante</p>
                <p className="sidebar-brand-name">Taki</p>
              </div>
            )}
          </div>

          <nav className="nav-list">
            {navGroups.map((group) => (
              <section className="sidebar-group" key={group.label}>
                {!isCompactDesktopSidebar && <p className="sidebar-group-title">{group.label}</p>}

                <div className="sidebar-group-list">
                  {group.items.map((item) => {
                    if (item.type === 'submenu') {
                      const childActive = item.children.some((child) => isPathActive(location.pathname, child.to))
                      const isOpen = childActive || Boolean(openSubmenus[item.id])

                      if (isCompactDesktopSidebar) {
                        return (
                          <button
                            className={`nav-item nav-parent icon-only ${childActive ? 'active' : ''}`}
                            key={item.id}
                            onClick={() => navigate(item.children[0].to)}
                            title={item.label}
                            type="button"
                          >
                            <span className="nav-icon"><i className={`fi ${ICONS[item.icon]}`} /></span>
                          </button>
                        )
                      }

                      return (
                        <div className="nav-submenu" key={item.id}>
                          <button
                            className={`nav-item nav-parent ${childActive ? 'active' : ''}`}
                            onClick={() => toggleSubmenu(item.id)}
                            type="button"
                          >
                            <span className="nav-icon"><i className={`fi ${ICONS[item.icon]}`} /></span>
                            <span className="nav-label">{item.label}</span>
                            <span className={`nav-caret ${isOpen ? 'open' : ''}`}>
                              <i className="fi fi-rr-angle-small-right" />
                            </span>
                          </button>

                          {isOpen && (
                            <div className="nav-sublist">
                              {item.children.map((child) => (
                                <NavLink
                                  className={({ isActive }) => `nav-subitem ${isActive ? 'active' : ''}`}
                                  key={child.to}
                                  onClick={closeMobileSidebar}
                                  to={child.to}
                                >
                                  <span aria-hidden="true" className="nav-bullet">•</span>
                                  <span>{child.label}</span>
                                </NavLink>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    }

                    return (
                      <NavLink
                        className={({ isActive }) => `nav-item ${isCompactDesktopSidebar ? 'icon-only' : ''} ${isActive ? 'active' : ''}`}
                        key={item.to}
                        onClick={closeMobileSidebar}
                        title={isCompactDesktopSidebar ? item.label : undefined}
                        to={item.to}
                      >
                        <span className="nav-icon"><i className={`fi ${ICONS[item.icon]}`} /></span>
                        {!isCompactDesktopSidebar && <span className="nav-label">{item.label}</span>}
                      </NavLink>
                    )
                  })}
                </div>
              </section>
            ))}
          </nav>
        </aside>

        <main className="main-content">
          <HeaderBar
            isMobileMenuOpen={isMobileSidebarOpen}
            onToggleMobileMenu={toggleMobileSidebar}
            showMobileMenuButton={isMobileViewport}
          />
          <div className="main-content-body">
            <Outlet />
          </div>
        </main>
      </div>
    </ThemeProvider>
  )
}

export default function AppLayout() {
  return (
    <AppShellThemeProvider>
      <AppLayoutShell />
    </AppShellThemeProvider>
  )
}

