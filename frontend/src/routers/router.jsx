/* eslint-disable react-refresh/only-export-components */
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import AppLayout from '../components/AppLayout'
import CashHistoryPage from '../pages/CashHistoryPage'
import CustomersManagementPage from '../pages/CustomersManagementPage'
import FinanceAccountsPage from '../pages/FinanceAccountsPage'
import FinanceCashRegisterPage from '../pages/FinanceCashRegisterPage'
import FinanceTransactionsPage from '../pages/FinanceTransactionsPage'
import KitchenPage from '../pages/KitchenPage'
import KpiPage from '../pages/KpiPage'
import LoginPage from '../pages/LoginPage'
import MenuCategoriesPage from '../pages/MenuCategoriesPage'
import MenuProductsPage from '../pages/MenuProductsPage'
import MenuSectionsPage from '../pages/MenuSectionsPage'
import OrdersBillsPage from '../pages/OrdersBillsPage'
import PosPage from '../pages/PosPage'
import ProfilePage from '../pages/ProfilePage'
import QrOrderPage from '../pages/QrOrderPage'
import RestaurantSettingsPage from '../pages/RestaurantSettingsPage'
import TableManagementPage from '../pages/TableManagementPage'
import UsersManagementPage from '../pages/UsersManagementPage'
import { useAuthStore } from '../store/authStore'

const ROLE = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  ACCOUNTANT: 'ACCOUNTANT',
  CASHIER: 'CASHIER',
  COOK: 'COOK',
  WAITER: 'WAITER',
}

function landingPath(user) {
  const role = user?.role

  if (role === ROLE.COOK) return '/pedidos/preparacion'
  if (role === ROLE.CASHIER) return '/finanzas/caja'
  if (role === ROLE.ACCOUNTANT) return '/finanzas/transacciones'
  if (role === ROLE.WAITER) return '/pedidos'
  return '/dashboard'
}

function RequireAuth() {
  const token = useAuthStore((state) => state.token)
  if (!token) {
    return <Navigate replace to="/login" />
  }
  return <Outlet />
}

function AlreadyAuthedRedirect() {
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  if (token) {
    return <Navigate replace to={landingPath(user)} />
  }
  return <LoginPage />
}

function RequireRoles({ allowed }) {
  const user = useAuthStore((state) => state.user)
  if (!user || !allowed.includes(user.role)) {
    return <Navigate replace to={landingPath(user)} />
  }
  return <Outlet />
}

function RoleHomeRedirect() {
  const user = useAuthStore((state) => state.user)
  return <Navigate replace to={landingPath(user)} />
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <AlreadyAuthedRedirect />,
  },
  {
    path: '/qr/:tableId',
    element: <QrOrderPage />,
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: <RoleHomeRedirect />,
          },
          {
            path: '/mi-perfil',
            element: <ProfilePage />,
          },

          {
            element: <RequireRoles allowed={[ROLE.ADMIN, ROLE.ACCOUNTANT, ROLE.SUPER_ADMIN]} />,
            children: [
              {
                path: '/dashboard',
                element: <KpiPage />,
              },
            ],
          },

          {
            element: <RequireRoles allowed={[ROLE.ACCOUNTANT, ROLE.SUPER_ADMIN]} />,
            children: [
              {
                path: '/finanzas/transacciones',
                element: <FinanceTransactionsPage />,
              },
              {
                path: '/finanzas/cuentas',
                element: <FinanceAccountsPage />,
              },
            ],
          },

          {
            element: <RequireRoles allowed={[ROLE.CASHIER, ROLE.SUPER_ADMIN]} />,
            children: [
              {
                path: '/finanzas/caja',
                element: <FinanceCashRegisterPage />,
              },
            ],
          },

          {
            element: <RequireRoles allowed={[ROLE.WAITER, ROLE.ADMIN, ROLE.SUPER_ADMIN]} />,
            children: [
              {
                path: '/pedidos',
                element: <PosPage />,
              },
              {
                path: '/pedidos/lista',
                element: <CashHistoryPage />,
              },
            ],
          },

          {
            element: <RequireRoles allowed={[ROLE.COOK, ROLE.ADMIN, ROLE.SUPER_ADMIN]} />,
            children: [
              {
                path: '/pedidos/preparacion',
                element: <KitchenPage />,
              },
            ],
          },

          {
            element: <RequireRoles allowed={[ROLE.WAITER, ROLE.CASHIER, ROLE.ADMIN, ROLE.SUPER_ADMIN]} />,
            children: [
              {
                path: '/pedidos/cuentas',
                element: <OrdersBillsPage />,
              },
            ],
          },

          {
            element: <RequireRoles allowed={[ROLE.ADMIN, ROLE.SUPER_ADMIN]} />,
            children: [
              {
                path: '/administracion/menu/secciones',
                element: <MenuSectionsPage />,
              },
              {
                path: '/administracion/menu/categorias',
                element: <MenuCategoriesPage />,
              },
              {
                path: '/administracion/menu/productos',
                element: <MenuProductsPage />,
              },
              {
                path: '/administracion/mesas',
                element: <TableManagementPage />,
              },
              {
                path: '/administracion/clientes',
                element: <CustomersManagementPage />,
              },
              {
                path: '/admin-avanzada/usuarios',
                element: <UsersManagementPage />,
              },
              {
                path: '/admin-avanzada/restaurante',
                element: <RestaurantSettingsPage />,
              },
            ],
          },

          {
            path: '/pos',
            element: <Navigate replace to="/pedidos" />,
          },
          {
            path: '/kitchen',
            element: <Navigate replace to="/pedidos/preparacion" />,
          },
          {
            path: '/cash',
            element: <Navigate replace to="/pedidos/cuentas" />,
          },
          {
            path: '/cash/history',
            element: <Navigate replace to="/pedidos/lista" />,
          },
          {
            path: '/kpis',
            element: <Navigate replace to="/dashboard" />,
          },
          {
            path: '/catalog-management',
            element: <Navigate replace to="/administracion/menu/productos" />,
          },
          {
            path: '/table-management',
            element: <Navigate replace to="/administracion/mesas" />,
          },
          {
            path: '/inventory',
            element: <Navigate replace to="/administracion/menu/productos" />,
          },
          {
            path: '/home',
            element: <Navigate replace to="/dashboard" />,
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <Navigate replace to="/login" />,
  },
])
