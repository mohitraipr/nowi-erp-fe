import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Search,
  BarChart3,
  TrendingUp,
  LineChart,
  HeartPulse,
  Factory,
  LogOut,
  FlaskConical,
  Inbox,
  Boxes,
  Scissors,
  Sparkles,
  Shirt,
  Container,
  Layers,
  PanelLeftClose,
  PanelLeft,
  Database,
  Menu,
  MoreHorizontal,
  X,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/context/auth';
import { useLogoutConfirm } from '@/components/auth/useLogoutConfirm';
import { useToast } from '@/components/ui/toast';
import LanguageToggle from '@/components/LanguageToggle';
import Logo from '@/components/Logo';
import { cn } from '@/lib/utils';
import {
  userAllRoles,
  DISPATCH_VIEW_ROLES,
  PRODUCTION_BOARD_READ_ROLES,
  PRODUCTION_READ_ROLES,
} from '@/lib/userRoles';
import type { UserRole } from '@/api/types';
import { RailTooltip, SectionFlyout } from '@/components/ui/sidebar-tooltip';

interface NavItem {
  to: string;
  end?: boolean;
  icon: React.ReactNode;
  labelKey: string;
  roles: UserRole[];
}

interface NavSection {
  /** Stable id — used as the i18n key and the collapse-state key. */
  id: string;
  /** i18n key for the small uppercase section header. */
  titleKey: string;
  items: NavItem[];
}

/* Nav follows the simplified post-redesign IA (docs/DASHBOARD_REDESIGN.md):
   Dashboard · Sampling · Production · Users · Master Data, plus China Import +
   Fabric Library, plus the floor/stage drop-in surfaces for admins. Dispatch
   is its own top-level item again — it now hosts the production challans tab
   alongside the floor dispatch ledger. Role-gating is unchanged: an item only
   renders for roles its route's ProtectedRoute permits. */

// Office roles that see the unified Home (`/`). Mirrors OFFICE_HOME_ROLES in
// App.tsx and the Home allow-list in docs/DASHBOARD_REDESIGN.md.
const OFFICE_ROLES: UserRole[] = [
  'admin',
  'viewer',
  'sampling_editor',
  'sampling_lead',
  'production_lead',
  'cataloguer',
  'fabric_manager',
];

const PD_ROLES: UserRole[] = [
  'admin',
  'sampling_editor',
  'sampling_lead',
  'production_lead',
];

const NAV_SECTIONS: NavSection[] = [
  {
    id: 'overview',
    titleKey: 'admin.nav.sections.overview',
    items: [
      // Unified office Home — every office role lands here.
      { to: '/', end: true, icon: <LayoutDashboard size={18} />, labelKey: 'admin.nav.dashboard', roles: OFFICE_ROLES },
      // Sits directly under Sampling: production work starts from the
      // forecast, so it belongs in the main flow, not buried in Analytics.
      { to: '/admin/production', icon: <Factory size={18} />, labelKey: 'admin.nav.productionPipeline', roles: [...PRODUCTION_BOARD_READ_ROLES] },
      // Old Sampling registry (the legacy Styles page). RETIRED from the nav —
      // the Dashboard ("Sampling") is now the single sampling surface. The
      // /styles ROUTE stays (the dashboard drill-down + intake still use it),
      // only the nav entry is hidden via empty roles. No further development is
      // needed on this page; leave it as-is until it's removed for good.
      // ponytail: empty roles = hidden from all (roles.some(...) is false).
      { to: '/styles', end: true, icon: <Shirt size={18} />, labelKey: 'admin.nav.styles', roles: [] },
      // Locator (labelled "Production") is RETIRED from the nav — it collided
      // with the Production pipeline board above, which is the surface
      // production work actually starts from. The /admin/locator ROUTE stays
      // live (SKU drill-down still links to it); only the entry is hidden.
      // ponytail: empty roles = hidden from all (roles.some(...) is false).
      { to: '/admin/locator', icon: <Search size={18} />, labelKey: 'admin.nav.production', roles: [] },
    ],
  },
  {
    id: 'analytics',
    titleKey: 'admin.nav.sections.analytics',
    items: [
      // Inventory Health leads the section (the priority screen). Note the mobile
      // bottom nav shows only the first 4 role-visible items across ALL sections,
      // so everything from Production KPIs down already lives in "More".
      { to: '/admin/analytics/inventory-health', icon: <HeartPulse size={18} />, labelKey: 'admin.nav.inventoryHealth', roles: [...PRODUCTION_READ_ROLES] },
      // Sits directly under Inventory Health: a dispatch is the last step of the
      // forecast → produce → ship flow, so it reads next to the forecast rather
      // than back up in Overview (where hiding Locator had orphaned it).
      { to: '/admin/dispatches', icon: <Container size={18} />, labelKey: 'admin.nav.dispatches', roles: [...DISPATCH_VIEW_ROLES] },
      { to: '/admin/production-kpis', icon: <BarChart3 size={18} />, labelKey: 'admin.nav.productionKpis', roles: ['admin', 'viewer', 'production_lead'] },
      { to: '/admin/sales-kpis', icon: <TrendingUp size={18} />, labelKey: 'admin.nav.salesKpis', roles: ['admin', 'viewer'] },
      { to: '/admin/analytics/fulfilment', icon: <LineChart size={18} />, labelKey: 'admin.nav.analyticsFulfilment', roles: ['admin', 'viewer'] },
    ],
  },
  {
    id: 'productDevelopment',
    titleKey: 'admin.nav.sections.productDevelopment',
    items: [
      // China Import is a simple, separate flow for NW- prefixed imported
      // styles. HIDDEN from the nav (empty roles) alongside the retired Styles
      // registry — but the /china-import ROUTE stays live (unlike sampling, it
      // has no Dashboard replacement: it's the only place to list AND create
      // china_import styles). Reachable by direct URL; restore roles to unhide.
      // ponytail: empty roles = hidden from all (roles.some(...) is false).
      { to: '/china-import', icon: <Container size={18} />, labelKey: 'admin.nav.chinaImport', roles: [] },
      // Fabric Library = the master fabric catalogue used across styles.
      // fabric_manager is added inline (not via PD_ROLES) so the fabric desk
      // sees the fabric library without gaining the other PD_ROLES nav links.
      { to: '/fabric-library', icon: <Layers size={18} />, labelKey: 'admin.nav.fabricLibrary', roles: [...PD_ROLES, 'fabric_manager'] },
    ],
  },
  {
    id: 'production',
    titleKey: 'admin.nav.sections.production',
    items: [
      // Floor surfaces — admins drop in to triage / receive / forward when
      // a floor user is unavailable. Each route already permits 'admin' in
      // ProtectedRoute.
      { to: '/floor', icon: <Boxes size={18} />, labelKey: 'admin.nav.floor', roles: ['admin', 'production_lead'] },
      { to: '/stitching', icon: <Scissors size={18} />, labelKey: 'admin.nav.stitching', roles: ['admin', 'production_lead'] },
      { to: '/finishing', icon: <Sparkles size={18} />, labelKey: 'admin.nav.finishing', roles: ['admin', 'production_lead'] },
    ],
  },
  {
    id: 'administration',
    titleKey: 'admin.nav.sections.administration',
    items: [
      { to: '/admin/edit-requests', icon: <Inbox size={18} />, labelKey: 'admin.nav.editRequests', roles: ['admin'] },
      { to: '/admin/users', icon: <Users size={18} />, labelKey: 'admin.nav.users', roles: ['admin'] },
      // Master-data hub for production_lead (+ admin). Hosts future master-data
      // tables (vendors / skus / settings).
      { to: '/data', icon: <Database size={18} />, labelKey: 'admin.nav.masterData', roles: ['admin', 'production_lead'] },
    ],
  },
];

const TEST_DATA_KEY = 'nowi.showTestData';
const SIDEBAR_KEY = 'nowi.sidebarCollapsed';
const GROUPS_KEY = 'nowi.sidebarGroups';

function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Read the persisted set of collapsed section ids. */
function loadCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function TrainingModeToggle() {
  const { t } = useTranslation();
  const toast = useToast();
  const [on, setOn] = useState<boolean>(
    () => localStorage.getItem(TEST_DATA_KEY) === '1',
  );

  useEffect(() => {
    if (on) localStorage.setItem(TEST_DATA_KEY, '1');
    else localStorage.removeItem(TEST_DATA_KEY);
  }, [on]);

  const onToggle = () => {
    const next = !on;
    setOn(next);
    toast.show(
      next ? t('admin.testData.toastOn') : t('admin.testData.toastOff'),
      'info',
    );
  };

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded-[var(--radius-sm)] text-xs border transition-colors',
        on
          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
          : 'border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]',
      )}
      aria-pressed={on}
    >
      <FlaskConical size={14} />
      <span className="hidden sm:inline">{t('admin.testData.label')}</span>
      <span
        aria-hidden
        className={cn(
          'inline-block w-7 h-3.5 rounded-full relative transition-colors',
          on ? 'bg-white/40' : 'bg-[var(--color-muted)]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all',
            on ? 'left-4' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}

/** A single nav row. Shared by the desktop rail and the mobile drawer. */
function NavRow({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const label = t(item.labelKey);

  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center rounded-[var(--radius-md)] text-sm h-9 transition-colors',
          collapsed ? 'justify-center px-0 mx-1' : 'gap-3 pl-3 pr-3',
          // accent bar on the left edge of the active row
          'before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-[var(--color-primary)] before:transition-opacity',
          collapsed && 'before:hidden',
          isActive
            ? 'bg-[var(--color-nav-active-bg)] text-[var(--color-nav-active-ink)] font-medium before:opacity-100'
            : 'text-[var(--color-foreground-2)] hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-foreground)] before:opacity-0',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'shrink-0 transition-colors',
              isActive
                ? 'text-[var(--color-primary)]'
                : 'text-[var(--color-muted-foreground)] group-hover:text-[var(--color-foreground)]',
            )}
          >
            {item.icon}
          </span>
          {!collapsed && <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );

  // In collapsed (icon-rail) mode, wrap in a tooltip so the label is still
  // discoverable without expanding the sidebar.
  if (collapsed) {
    return <RailTooltip label={label}>{link}</RailTooltip>;
  }

  return link;
}

/** The grouped nav body — reused by desktop rail and mobile drawer. */
function NavBody({
  sections,
  collapsed,
  collapsedGroups,
  onToggleGroup,
  onNavigate,
}: {
  sections: NavSection[];
  collapsed: boolean;
  collapsedGroups: Set<string>;
  onToggleGroup: (id: string) => void;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('common.navigation')}
      className="flex-1 min-h-0 overflow-y-auto px-2 py-3 space-y-1"
    >
      {sections.map((section) => {
        const isGroupCollapsed = !collapsed && collapsedGroups.has(section.id);
        const sectionLabel = t(section.titleKey);
        return (
          <div key={section.id} className="pb-1">
            {/* Section header — a toggle-button in expanded mode; a hover
                flyout trigger in icon-rail mode (collapsed). */}
            {!collapsed ? (
              <button
                type="button"
                onClick={() => onToggleGroup(section.id)}
                aria-expanded={!isGroupCollapsed}
                className="group flex w-full items-center justify-between gap-2 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-nav-section)] hover:text-[var(--color-foreground-2)] transition-colors"
              >
                <span>{sectionLabel}</span>
                <ChevronDown
                  size={13}
                  className={cn(
                    'shrink-0 transition-transform duration-200',
                    isGroupCollapsed && '-rotate-90',
                  )}
                />
              </button>
            ) : (
              /* In icon-rail mode the section header degrades to a thin
                 divider. Wrap it in SectionFlyout so hovering the divider
                 pops out all items in that group. */
              <SectionFlyout
                sectionLabel={sectionLabel}
                items={section.items.map((item) => ({
                  to: item.to,
                  end: item.end,
                  icon: item.icon,
                  label: t(item.labelKey),
                }))}
                onNavigate={onNavigate}
              >
                <div
                  aria-hidden
                  className="mx-auto my-1.5 h-px w-6 bg-[var(--color-border)] hover:bg-[var(--color-primary)] transition-colors first:hidden"
                />
              </SectionFlyout>
            )}
            {!isGroupCollapsed && (
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavRow
                    key={item.to}
                    item={item}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Resolve the current route to a { sectionKey, labelKey } pair for the header
 * breadcrumb. The header shows page *context* — the sidebar owns the links —
 * so this is a read-only lookup over the same NAV_SECTIONS source of truth.
 */
function usePageContext(): { sectionKey: string; labelKey: string } | null {
  const location = useLocation();
  return useMemo(() => {
    const path = location.pathname;
    let best: { sectionKey: string; labelKey: string; len: number } | null =
      null;
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        const itemPath = item.to.split('?')[0];
        // For ?source= variants, only treat as a match when the query matches.
        const itemQuery = item.to.includes('?')
          ? item.to.slice(item.to.indexOf('?'))
          : '';
        if (itemQuery && location.search !== itemQuery) continue;
        const isMatch = item.end
          ? path === itemPath
          : path === itemPath || path.startsWith(itemPath + '/');
        if (isMatch && (!best || itemPath.length > best.len)) {
          best = {
            sectionKey: section.titleKey,
            labelKey: item.labelKey,
            len: itemPath.length,
          };
        }
      }
    }
    return best ? { sectionKey: best.sectionKey, labelKey: best.labelKey } : null;
  }, [location.pathname, location.search]);
}

/** Header breadcrumb — "Section / Page". The header's contextual half. */
function PageContext() {
  const { t } = useTranslation();
  const ctx = usePageContext();
  return (
    <nav
      aria-label={t('common.navigation')}
      className="flex items-center gap-1.5 min-w-0 text-sm"
    >
      {ctx ? (
        <>
          <span className="text-[var(--color-header-crumb)] truncate hidden sm:inline">
            {t(ctx.sectionKey)}
          </span>
          <span
            aria-hidden
            className="text-[var(--color-header-crumb)] hidden sm:inline"
          >
            /
          </span>
          <span className="font-medium text-[var(--color-foreground)] truncate">
            {t(ctx.labelKey)}
          </span>
        </>
      ) : (
        // No page context (e.g. the dashboard) — show the NOWI logo as the
        // header brand, linking home, instead of the plain "NOWI ERP" text.
        <Link
          to="/"
          aria-label={t('common.appName')}
          className="rounded-[var(--radius-sm)] hover:opacity-80"
        >
          <Logo size="sm" />
        </Link>
      )}
    </nav>
  );
}

/**
 * Account menu — the single home for user identity + the logout action.
 * Sits in the header. Avatar + name + role caption open a dropdown that
 * restates the role and exposes Logout. Identity lives here only — the
 * sidebar no longer repeats it.
 */
function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { requestLogout, dialog: logoutDialog } = useLogoutConfirm();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const roleLabel = t(`roles.${user.role}` as const);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('admin.header.accountMenu')}
        className={cn(
          'flex items-center gap-2 rounded-[var(--radius-md)] transition-colors',
          'hover:bg-[var(--color-muted)]',
          compact ? 'p-0.5' : 'pl-1 pr-1.5 py-1',
        )}
      >
        <span
          className="shrink-0 grid place-items-center h-8 w-8 rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold"
          title={user.name}
        >
          {initials(user.name)}
        </span>
        {!compact && (
          <span className="min-w-0 hidden md:block text-left">
            <span className="block text-sm font-medium text-[var(--color-foreground)] truncate max-w-[14ch]">
              {user.name}
            </span>
            <span className="block text-[11px] text-[var(--color-muted-foreground)] truncate max-w-[14ch]">
              {roleLabel}
            </span>
          </span>
        )}
        {!compact && (
          <ChevronDown
            size={14}
            className={cn(
              'shrink-0 text-[var(--color-muted-foreground)] transition-transform hidden md:block',
              open && 'rotate-180',
            )}
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('admin.header.accountMenu')}
          className={cn(
            'absolute right-0 top-full mt-1.5 z-50 min-w-[13rem]',
            'rounded-[var(--radius-lg)] border border-[var(--color-border)]',
            'bg-[var(--color-header-menu-bg)] shadow-[var(--shadow-pop)]',
            'py-1 animate-in fade-in zoom-in-95 duration-100',
          )}
        >
          <div className="px-3 py-2 border-b border-[var(--color-border)]">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-nav-section)]">
              {t('admin.header.signedInAs')}
            </span>
            <span className="block text-sm font-medium text-[var(--color-foreground)] truncate">
              {user.name}
            </span>
            <span className="block text-xs text-[var(--color-muted-foreground)] truncate">
              {roleLabel}
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              requestLogout();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[var(--color-foreground-2)] hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-foreground)] transition-colors"
          >
            <LogOut size={15} className="shrink-0" />
            <span>{t('common.logout')}</span>
          </button>
        </div>
      )}
      {logoutDialog}
    </div>
  );
}

export default function AdminShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(SIDEBAR_KEY) === '1',
  );
  const [collapsedGroups, setCollapsedGroups] =
    useState<Set<string>>(loadCollapsedGroups);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (collapsed) localStorage.setItem(SIDEBAR_KEY, '1');
    else localStorage.removeItem(SIDEBAR_KEY);
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(GROUPS_KEY, JSON.stringify([...collapsedGroups]));
  }, [collapsedGroups]);

  const toggleGroup = useCallback((id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const location = useLocation();
  const role: UserRole | undefined = user?.role;
  // Multi-role: union of primary + UserRoleAssignment.role rows. The
  // sidebar shows an item if any of these intersects the item's roles.
  const allRoles = useMemo(() => userAllRoles(user), [user]);

  // Filter items by allRoles, then drop any section left with no items.
  const sections = useMemo<NavSection[]>(() => {
    if (allRoles.length === 0) return [];
    return NAV_SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter((it) =>
        it.roles.some((r) => allRoles.includes(r)),
      ),
    })).filter((s) => s.items.length > 0);
  }, [allRoles]);

  // Logo target = the unified office Home for every office role; floor/stage
  // roles never render AdminShell, so `/` (which HomeRoute bounces) is safe.
  const homePath = '/';

  // Close the mobile drawer on any navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen flex bg-[var(--color-background)] text-[var(--color-foreground)]">
      {/* ── Desktop sidebar (persistent rail) ── */}
      <aside
        className={cn(
          'hidden lg:flex lg:sticky lg:top-0 lg:h-screen shrink-0 border-r border-[var(--color-border)] flex-col bg-[var(--color-sidebar)] transition-[width] duration-200',
          collapsed ? 'w-[4.25rem]' : 'w-64',
        )}
      >
        <div
          className={cn(
            'border-b border-[var(--color-border)] bg-[var(--color-sidebar-header)] flex items-center h-14 shrink-0',
            collapsed ? 'justify-center px-2' : 'justify-between px-4',
          )}
        >
          {!collapsed && (
            <Link
              to={homePath}
              aria-label={t('common.appName')}
              className="rounded-[var(--radius-sm)] hover:opacity-80 transition-opacity"
            >
              <Logo size="md" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={
              collapsed
                ? t('common.expandSidebar')
                : t('common.collapseSidebar')
            }
            title={
              collapsed
                ? t('common.expandSidebar')
                : t('common.collapseSidebar')
            }
            className="p-2 rounded-[var(--radius-sm)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-foreground)] transition-colors"
          >
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        {/* The sidebar owns navigation only — user identity / logout live in
            the header's account menu, so there is no footer here. */}
        <NavBody
          sections={sections}
          collapsed={collapsed}
          collapsedGroups={collapsedGroups}
          onToggleGroup={toggleGroup}
        />
      </aside>

      {/* ── Mobile drawer (off-canvas, hamburger-triggered) ── */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-[var(--color-foreground)]/40 animate-in fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={t('common.appName')}
            className="absolute inset-y-0 left-0 w-72 max-w-[82vw] flex flex-col bg-[var(--color-sidebar)] shadow-[var(--shadow-pop)] animate-in slide-in-from-left"
          >
            <div className="border-b border-[var(--color-border)] bg-[var(--color-sidebar-header)] flex items-center justify-between h-14 px-4 shrink-0">
              <Link to={homePath} aria-label={t('common.appName')}>
                <Logo size="md" />
              </Link>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-2 rounded-[var(--radius-sm)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-nav-hover-bg)]"
                aria-label={t('common.close')}
              >
                <X size={18} />
              </button>
            </div>
            <NavBody
              sections={sections}
              collapsed={false}
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleGroup}
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Top header ──
            Global / contextual controls ONLY — no nav links (the sidebar
            owns navigation). Left: page-context breadcrumb (+ mobile menu
            trigger / logo). Right: test-data toggle, language toggle, and
            the account menu (the single home for identity + logout). */}
        <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur px-3 sm:px-5 h-14">
          <div className="flex items-center justify-between gap-3 h-full">
            {/* Left — context */}
            <div className="flex items-center gap-2 min-w-0">
              {/* Mobile-only: drawer trigger + logo (no desktop nav here) */}
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="lg:hidden p-2 -ml-1 rounded-[var(--radius-sm)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
                aria-label={t('common.openMenu')}
                aria-haspopup="dialog"
                aria-expanded={drawerOpen}
              >
                <Menu size={20} />
              </button>
              <Link
                to={homePath}
                aria-label={t('common.appName')}
                className="lg:hidden p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-muted)]"
              >
                <Logo size="md" />
              </Link>
              <PageContext />
            </div>

            {/* Right — global controls */}
            <div className="flex items-center gap-2 sm:gap-3">
              {role === 'admin' && <TrainingModeToggle />}
              <LanguageToggle />
              <span
                aria-hidden
                className="h-6 w-px bg-[var(--color-border)] hidden sm:block"
              />
              <AccountMenu />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-8 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>

        {/* Mobile bottom nav — restores the pre-redesign pattern: the
            first 4 role-visible items render as tabs, with a "More"
            button on the right that opens the same off-canvas drawer
            the hamburger uses. Hidden on lg+ where the sidebar handles
            navigation. */}
        <MobileBottomNav
          sections={sections}
          onMore={() => setDrawerOpen(true)}
        />
      </div>
    </div>
  );
}

const PRIMARY_BOTTOM_COUNT = 4;

function MobileBottomNav({
  sections,
  onMore,
}: {
  sections: NavSection[];
  onMore: () => void;
}) {
  const items = sections.flatMap((s) => s.items);
  const primary = items.slice(0, PRIMARY_BOTTOM_COUNT);
  if (primary.length === 0) return null;
  const overflow = items.slice(PRIMARY_BOTTOM_COUNT);
  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[var(--color-surface)]/95 backdrop-blur border-t border-[var(--color-border)] pb-[env(safe-area-inset-bottom)]"
      aria-label="primary"
    >
      <div className="flex items-stretch justify-around h-16">
        {primary.map((item) => (
          <BottomTab key={item.to} item={item} />
        ))}
        {overflow.length > 0 && (
          <button
            type="button"
            onClick={onMore}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] text-[var(--color-muted-foreground)]"
            aria-label="More"
          >
            <span className="flex items-center justify-center h-7 w-12 rounded-full">
              <MoreHorizontal size={20} />
            </span>
            <span className="leading-none">More</span>
          </button>
        )}
      </div>
    </nav>
  );
}

function BottomTab({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors',
          isActive
            ? 'text-[var(--color-primary)]'
            : 'text-[var(--color-muted-foreground)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'flex items-center justify-center h-7 w-12 rounded-full transition-colors',
              isActive && 'bg-[var(--color-primary)]/10',
            )}
          >
            {item.icon}
          </span>
          <span className="leading-none truncate max-w-[72px]">
            {t(item.labelKey)}
          </span>
        </>
      )}
    </NavLink>
  );
}
