import {
  BarChart3,
  Boxes,
  ClipboardList,
  Home,
  Package,
  PackagePlus,
  Percent,
  ShoppingCart,
  Store,
  Tag,
  Trash2,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react';

import type { Role } from '@/server/auth/roles';

/**
 * Every destination in the product, in one place.
 *
 * Three surfaces render these: the bottom tab bar on a phone, the sidebar on a
 * desktop browser, and the More screen. They were separate lists for about an
 * hour, which is how long it took to notice that adding a screen meant
 * remembering three files.
 *
 * Labels are not here. `TABS` keys resolve against the `nav` namespace and
 * `SECTIONS` against `more`, matching what each surface already used.
 */

/**
 * The daily loop, always one tap away on a phone.
 *
 * Four destinations plus More, not nine: checkout, receiving and counting are
 * what a shop does every day, and the dashboard is where it starts. A launcher
 * with nine equal buttons makes the frequent things as hard to reach as the
 * rare ones.
 *
 * Write-off used to hold checkout's slot; a till gets used hundreds of times a
 * day and a write-off a handful.
 */
export const TABS = [
  { path: '', key: 'home', Icon: Home },
  { path: '/checkout', key: 'checkout', Icon: ShoppingCart },
  { path: '/receive', key: 'receive', Icon: PackagePlus },
  { path: '/count', key: 'count', Icon: ClipboardList },
  { path: '/more', key: 'more', Icon: Boxes },
] as const;

/** The daily loop without More — the sidebar lists everything, so More has nothing left to point at. */
export const PRIMARY = TABS.filter((t) => t.key !== 'more');

/** Everything outside the daily loop, grouped by what it is for. */
export const SECTIONS = [
  {
    key: 'stock',
    items: [{ path: 'waste', key: 'waste', Icon: Trash2, needs: 'staff' }],
  },
  {
    key: 'catalogue',
    items: [
      { path: 'products', key: 'products', Icon: Package, needs: 'staff' },
      { path: 'suppliers', key: 'suppliers', Icon: Truck, needs: 'staff' },
      { path: 'categories', key: 'categories', Icon: Tag, needs: 'manager' },
    ],
  },
  {
    key: 'buying',
    items: [
      { path: 'reorder', key: 'reorder', Icon: ShoppingCart, needs: 'manager' },
      { path: 'orders', key: 'orders', Icon: ShoppingCart, needs: 'staff' },
    ],
  },
  {
    key: 'insight',
    items: [
      { path: 'insights', key: 'insights', Icon: TrendingUp, needs: 'manager' },
      { path: 'reports', key: 'reports', Icon: BarChart3, needs: 'staff' },
    ],
  },
  {
    key: 'settings',
    items: [
      { path: 'settings/store', key: 'store', Icon: Store, needs: 'owner' },
      { path: 'settings/team', key: 'team', Icon: Users, needs: 'owner' },
      { path: 'settings/vat', key: 'vat', Icon: Percent, needs: 'owner' },
    ],
  },
] as const satisfies readonly {
  key: string;
  items: readonly { path: string; key: string; Icon: unknown; needs: Role }[];
}[];
