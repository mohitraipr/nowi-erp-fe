import type { User, UserRole } from '@/api/types';

/**
 * Multi-role helpers. The ERP keeps `User.role` as the primary role for
 * back-compat with the original single-role guards, and stacks
 * additional roles via `roleAssignments` (one row per grant). All FE
 * role checks should go through these helpers so a user with a
 * secondary `UserRoleAssignment` is treated identically to a user with
 * that role as primary.
 *
 * Mirrors `nowi-erp-api/src/common/roles/user-roles.ts` — keep both
 * sides in sync if the helper contract changes.
 */

/**
 * Classifies EVERY role as a PD editor (may create/edit PD data: styles,
 * variants, channels, inspections, categories, fabrics, colours) or not.
 *
 * This is a `Record<UserRole, boolean>` on purpose: `UserRole` is generated
 * from the backend (`gen:api`), so when a new role is added there and the
 * types are regenerated, THIS map fails to compile until the new role is
 * consciously classified — closing the gap where the FE write-gates could
 * silently fall out of sync with the BE `PD_WRITE_ROLES`. Keep the `true`
 * entries identical to the backend `PD_WRITE_ROLES`
 * (`nowi-erp-api/src/modules/auth/roles.constants.ts`).
 *
 * `false` = read-only `viewer` + the floor roles (they don't write PD data;
 * floor uploads are handled by the BE storage role set, not this gate).
 */
const IS_PD_WRITER: Record<UserRole, boolean> = {
  admin: true,
  sampling_editor: true,
  sampling_lead: true,
  production_lead: true,
  // `cataloguer` is NOT a general PD writer — it only creates designs + does
  // cataloguing, gated via CATALOGUER_WRITE_ROLES below, not this set.
  cataloguer: false,
  // `design_submitter` only files an intake (DESIGN_SUBMIT_ROLES below), not
  // general PD edits.
  design_submitter: false,
  // `fabric_manager` writes ONLY the fabric domain (FABRIC_WRITE_ROLES below),
  // never general PD data.
  fabric_manager: false,
  // `production_editor` runs the production desk only (PRODUCTION_WRITE_ROLES
  // below) — never styles, approvals, or master data.
  production_editor: false,
  // `warehouse_manager` only accepts inbound challans (DISPATCH_ACCEPT_ROLES
  // below) — never PD data.
  warehouse_manager: false,
  viewer: false,
  floor_manager: false,
  stitching_master: false,
  finishing_master: false,
};

/**
 * The PD "editor" write set — every role flagged a PD writer above. Use this
 * for FE write-gates so a button is never shown to a role the BE will 403,
 * and never hidden from one the BE allows.
 *
 * Deliberately EXCLUDES approve / withdraw-post-approval — those stay on
 * their own narrow arrays (`APPROVER_ROLES`, `POST_APPROVAL_PARK`).
 */
export const PD_WRITE_ROLES: readonly UserRole[] = (
  Object.keys(IS_PD_WRITER) as UserRole[]
).filter((role) => IS_PD_WRITER[role]);

/**
 * The approver / sign-off set — mirrors the BE `APPROVE_ROLES`
 * (`nowi-erp-api/src/modules/auth/roles.constants.ts`). Admin + the sampling lead, who
 * may sign off (Approval #1/#2, start-cataloguing). Use this to gate those
 * buttons so a writer never sees a control the BE will 403.
 * (Going live is NOT here — it moved to the cataloguing write set; see
 * {@link CATALOGUER_WRITE_ROLES}.)
 *
 * Deliberately NARROWER than {@link PD_WRITE_ROLES}: `sampling_editor`
 * authors data but never signs off.
 */
export const APPROVER_ROLES: readonly UserRole[] = ['admin', 'sampling_lead'];

/**
 * Admin-only gate. Used where admin gets a strictly wider capability than the
 * rest of the approver set — e.g. parking a style at any lifecycle stage
 * (non-admin approvers can park only during sampling — draft/in_sampling).
 * Use with `hasAnyRole`.
 */
export const ADMIN_ROLES: readonly UserRole[] = ['admin'];

/**
 * Roles allowed to CREATE a design + do the cataloguing step (EasyEcom
 * checkpoint, marketplace take-offline) — every PD editor plus the narrow
 * `cataloguer`. Mirrors the BE `CATALOGUER_WRITE_ROLES`. Use this for the
 * add-design CTA + the cataloguing write-gates so `cataloguer` sees exactly
 * those controls and nothing else (it's absent from {@link PD_WRITE_ROLES}).
 * Going live is cataloguer work too: listing a channel + marking EasyEcom done
 * (which auto-promotes listings to live) are both gated on THIS set.
 */
export const CATALOGUER_WRITE_ROLES: readonly UserRole[] = [
  ...PD_WRITE_ROLES,
  'cataloguer',
];

/**
 * Roles allowed to EDIT an existing style's own fields (core specs, BOM,
 * pattern CAD, reference images) — the PD editors plus `cataloguer`. Mirrors
 * the BE `STYLE_EDIT_ROLES` (`nowi-erp-api/src/modules/auth/roles.constants.ts`).
 *
 * Kept separate from {@link CATALOGUER_WRITE_ROLES} (identical members today)
 * so "create + catalogue" and "edit a style" can diverge without one silently
 * widening the other. Scope is the Style record ONLY — variants, inspections,
 * archive and park/revive stay on {@link PD_WRITE_ROLES}, sign-off on
 * {@link APPROVER_ROLES}.
 */
export const STYLE_EDIT_ROLES: readonly UserRole[] = [
  ...PD_WRITE_ROLES,
  'cataloguer',
];

/**
 * Roles allowed to FILE a design intake (the "Submit design" CTA + the
 * `/styles/new` route) — everyone who can create a design plus the narrow
 * submit-only `design_submitter`. Mirrors the BE `styles.controller` CREATE
 * set (`CATALOGUER_WRITE_ROLES` + `design_submitter`). `design_submitter` can
 * reach ONLY this surface — never PD edit / approve / cataloguing.
 */
export const DESIGN_SUBMIT_ROLES: readonly UserRole[] = [
  ...CATALOGUER_WRITE_ROLES,
  'design_submitter',
];

/**
 * Roles allowed to WRITE the fabric domain (fabric master, stock ledger,
 * supplier challans) — every PD editor plus the dedicated `fabric_manager`
 * desk. Mirrors the BE `FABRIC_WRITE_ROLES`. Use this for the fabric-library
 * write-gates so `fabric_manager` sees those controls but not general PD edit
 * (it's absent from {@link PD_WRITE_ROLES}). `fabric_manager` additionally owns
 * fabric delete (gated server-side); admin/production_lead share that gate.
 */
export const FABRIC_WRITE_ROLES: readonly UserRole[] = [
  ...PD_WRITE_ROLES,
  'fabric_manager',
];

/**
 * Roles allowed to START a production batch and move it through the floor
 * stages. Mirrors the BE `PRODUCTION_WRITE_ROLES`. Gates the "Add to production
 * pipeline" buttons (Inventory Health rows + the dashboard live tab) and the
 * stage dropdown / record-output action on the Production board.
 *
 * Deliberately NOT the PD set: `production_editor` is absent from
 * {@link PD_WRITE_ROLES}, and the sampling roles are absent from here.
 * Cancelling a batch is narrower still — see {@link PRODUCTION_CANCEL_ROLES}.
 */
export const PRODUCTION_WRITE_ROLES: readonly UserRole[] = [
  'admin',
  'production_lead',
  'production_editor',
];

/**
 * Who may set a batch's fabric status on the Pipeline tab — the production desk
 * plus the fabric desk, which owns whether the cloth is actually there. Mirrors
 * the BE `FABRIC_STATUS_WRITE_ROLES`.
 *
 * Its own set because it is its own endpoint: the batch PATCH reaches planned
 * quantities, which the fabric desk must not gain.
 */
export const FABRIC_STATUS_WRITE_ROLES: readonly UserRole[] = [
  ...PRODUCTION_WRITE_ROLES,
  'fabric_manager',
];

/**
 * Cancelling destroys a plan, so it stays with admin + the production admin —
 * mirrors the BE `CANCEL` set on `production.controller.ts`.
 */
export const PRODUCTION_CANCEL_ROLES: readonly UserRole[] = [
  'admin',
  'production_lead',
];

/**
 * Who may READ the Production board + the Inventory Health forecast feeding it.
 * Mirrors the BE `PRODUCTION_READ_ROLES` — the write set plus the read-only
 * office role.
 */
export const PRODUCTION_READ_ROLES: readonly UserRole[] = [
  ...PRODUCTION_WRITE_ROLES,
  'viewer',
];

/**
 * Who may SEE the Dispatch/challan tab — the production readers plus the
 * receiving `warehouse_manager` desk. Mirrors the BE dispatch controller VIEW
 * set. Also the route guard for a warehouse-only user reaching the Production
 * page (where they see only the Dispatch tab).
 */
export const DISPATCH_VIEW_ROLES: readonly UserRole[] = [
  ...PRODUCTION_READ_ROLES,
  'warehouse_manager',
];

/**
 * Who may ACCEPT an inbound challan (record received-per-size). The receiving
 * warehouse desk plus admin. Mirrors the BE dispatch ACCEPT set. Creating a
 * challan stays on {@link PRODUCTION_WRITE_ROLES} (the production desk).
 */
export const DISPATCH_ACCEPT_ROLES: readonly UserRole[] = ['admin', 'warehouse_manager'];

type RoleSource = Pick<User, 'role'> & {
  roleAssignments?: Array<{ role: UserRole }>;
};

/** Union of primary role + every UserRoleAssignment.role row. */
export function userAllRoles(user: RoleSource | null | undefined): UserRole[] {
  if (!user) return [];
  const extras = user.roleAssignments?.map((r) => r.role) ?? [];
  // Use a Set to dedupe — primary may also appear as an extra if the
  // BE ever emits both (it shouldn't, but be defensive).
  return Array.from(new Set<UserRole>([user.role, ...extras]));
}

/** True if `user` has the given role (primary OR assignment). */
export function hasRole(
  user: RoleSource | null | undefined,
  role: UserRole,
): boolean {
  if (!user) return false;
  if (user.role === role) return true;
  return user.roleAssignments?.some((r) => r.role === role) ?? false;
}

/** True if `user` has any of the given roles. */
export function hasAnyRole(
  user: RoleSource | null | undefined,
  roles: readonly UserRole[],
): boolean {
  if (!user) return false;
  if (roles.includes(user.role)) return true;
  return user.roleAssignments?.some((r) => roles.includes(r.role)) ?? false;
}
