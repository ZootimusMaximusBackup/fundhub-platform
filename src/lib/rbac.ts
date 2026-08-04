export type Role = 'admin' | 'staff' | 'partner' | 'affiliate' | 'client';

/* Route prefixes each role can access. Defines what's visible in sidebar AND
   what routes can be directly navigated to. Admin bypasses all checks. */
export const ROLE_ROUTES: Record<Role, string[]> = {
  admin: [
    'app/closer-dashboard.html',
    'app/pipeline.html',
    'app/client-control-panel.html',
    'app/messaging.html',
    'app/calendar.html',
    'app/documents.html',
    'app/campaign-manager.html',
    'app/social-studio.html',
    'app/creative-factory.html',
    'app/command-center.html',
    'app/ops-admin.html',
    'app/galaxy.html',
    'app/automations.html',
    'app/agent-editor.html',
    'app/hiring.html',
    'app/products-commissions.html',
    'app/staff-teams.html',
    'app/content-admin.html',
    'app/brand-studio.html',
    'app/inquiry-remover.html',
    'app/lenders.html',
    'app/sample-data.html',
    'app/client-portal.html',
    'app/partner-galaxy.html',
    'app/affiliate.html',
  ],
  // All internal ops screens, minus billing/admin settings (ops-admin, products-commissions).
  staff: [
    'app/closer-dashboard.html',
    'app/pipeline.html',
    'app/client-control-panel.html',
    'app/messaging.html',
    'app/calendar.html',
    'app/documents.html',
    'app/campaign-manager.html',
    'app/social-studio.html',
    'app/creative-factory.html',
    'app/command-center.html',
    'app/galaxy.html',
    'app/automations.html',
    'app/agent-editor.html',
    'app/hiring.html',
    'app/staff-teams.html',
    'app/content-admin.html',
    'app/brand-studio.html',
    'app/inquiry-remover.html',
    'app/lenders.html',
    'app/sample-data.html',
    'app/client-portal.html',
  ],
  // Partner Galaxy + Affiliate Portal + Client Portal + brand design + Facebook ads (campaign-manager).
  partner: [
    'app/partner-galaxy.html',
    'app/affiliate.html',
    'app/client-portal.html',
    'app/brand-studio.html',
    'app/campaign-manager.html',
  ],
  affiliate: [
    'app/affiliate.html',
    'app/client-portal.html',
  ],
  client: [
    'app/client-portal.html',
  ],
};

/* Nav item config: href + label. Built from ROLE_ROUTES, never hardcoded. */
export const NAV_ITEMS: Record<string, string> = {
  'app/closer-dashboard.html': 'Closer dashboard',
  'app/pipeline.html': 'Pipeline',
  'app/client-control-panel.html': 'Client control panel',
  'app/messaging.html': 'Messaging',
  'app/calendar.html': 'Calendar',
  'app/documents.html': 'Documents',
  'app/campaign-manager.html': 'Campaigns',
  'app/social-studio.html': 'Social Studio',
  'app/creative-factory.html': 'Creative Factory',
  'app/command-center.html': 'Command center',
  'app/ops-admin.html': 'Ops admin',
  'app/galaxy.html': 'Galaxy',
  'app/automations.html': 'Automations',
  'app/agent-editor.html': 'Agent editor',
  'app/hiring.html': 'Hiring',
  'app/products-commissions.html': 'Products & commissions',
  'app/staff-teams.html': 'Staff & teams',
  'app/content-admin.html': 'Content admin',
  'app/brand-studio.html': 'Brand studio',
  'app/inquiry-remover.html': 'Inquiry remover',
  'app/lenders.html': 'Lenders',
  'app/sample-data.html': 'Sample data',
  'app/client-portal.html': 'Client portal',
  'app/partner-galaxy.html': 'Partner galaxy',
  'app/affiliate.html': 'Affiliate portal',
};

/* Nav groups (for sidebar organization). Items grouped by department. */
export const NAV_GROUPS = [
  {
    name: 'Sales floor',
    items: [
      'app/closer-dashboard.html',
      'app/pipeline.html',
      'app/client-control-panel.html',
      'app/messaging.html',
      'app/calendar.html',
      'app/documents.html',
    ],
  },
  {
    name: 'Marketing',
    items: [
      'app/campaign-manager.html',
      'app/social-studio.html',
      'app/creative-factory.html',
    ],
  },
  {
    name: 'Funding',
    items: [
      'app/lenders.html',
    ],
  },
  {
    name: 'Operations',
    items: [
      'app/command-center.html',
      'app/ops-admin.html',
      'app/galaxy.html',
      'app/automations.html',
      'app/agent-editor.html',
      'app/hiring.html',
      'app/products-commissions.html',
      'app/staff-teams.html',
      'app/content-admin.html',
      'app/brand-studio.html',
      'app/inquiry-remover.html',
      'app/sample-data.html',
    ],
  },
  {
    name: 'External',
    items: [
      'app/client-portal.html',
      'app/partner-galaxy.html',
      'app/affiliate.html',
    ],
  },
];

/* Check if a role can access a route. Admin always can. */
export function can(role: Role, path: string): boolean {
  if (role === 'admin') return true;
  const allowed = ROLE_ROUTES[role] || [];
  return allowed.some(route => path.includes(route));
}

/* Get the nav items visible to a role. Respects group organization. */
export function getNavForRole(role: Role) {
  const allowedRoutes = ROLE_ROUTES[role] || [];
  return NAV_GROUPS.map(group => ({
    name: group.name,
    items: group.items.filter(route => allowedRoutes.includes(route)),
  })).filter(group => group.items.length > 0);
}

/* Default landing page for each role. */
export const ROLE_DEFAULTS: Record<Role, string> = {
  admin: 'app/command-center.html',
  staff: 'app/closer-dashboard.html',
  partner: 'app/partner-galaxy.html',
  affiliate: 'app/affiliate.html',
  client: 'app/client-portal.html',
};
