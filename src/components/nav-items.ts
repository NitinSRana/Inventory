import {
  BarChart3,
  Boxes,
  CalendarClock,
  ClipboardList,
  Ellipsis,
  PackagePlus,
  Percent,
  Receipt,
  ShoppingCart,
  Store,
  Tag,
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
 * The phone's tab bar, as the redesign draws it: Today, the till, the catalogue
 * and More.
 *
 * Receiving and counting left the bar for the header Scan button, which is where
 * an aisle task actually starts — with a product in hand. The design's own More
 * screen then listed neither, which would have made counting unreachable on a
 * phone; the `stock` section below puts both back one tap from More, and the
 * sidebar lists them too.
 */
export const TABS = [
  { path: '', key: 'home', Icon: CalendarClock },
  { path: '/checkout', key: 'checkout', Icon: ShoppingCart },
  { path: '/products', key: 'products', Icon: Boxes },
  { path: '/more', key: 'more', Icon: Ellipsis },
] as const;

/** The tab bar without More — the sidebar lists everything, so More has nothing left to point at. */
export const PRIMARY = TABS.filter((t) => t.key !== 'more');

/** Everything outside the tab bar, grouped by what it is for. */
export const SECTIONS = [
  {
    key: 'stock',
    items: [
      { path: 'receive', key: 'receive', Icon: PackagePlus, needs: 'staff' },
      { path: 'count', key: 'count', Icon: ClipboardList, needs: 'staff' },
    ],
  },
  {
    key: 'catalogue',
    items: [
      { path: 'suppliers', key: 'suppliers', Icon: Truck, needs: 'staff' },
      { path: 'categories', key: 'categories', Icon: Tag, needs: 'manager' },
    ],
  },
  {
    key: 'insight',
    items: [
      { path: 'sales', key: 'sales', Icon: Receipt, needs: 'staff' },
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
