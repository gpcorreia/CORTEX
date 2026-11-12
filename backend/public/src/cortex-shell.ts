const icons: Record<string, string> = {
  dashboard: '<path d="M4 20V10h4v10m4 0V4h4v16m4 0V7h2v13"/>',
  campaigns: '<path d="m4 10 15-6v16L4 14Zm0 0H2v4h2m3 1 2 7h4l-2-6"/>',
  expenses:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  research: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  competitors:
    '<circle cx="12" cy="7" r="3"/><path d="M6 21v-4a6 6 0 0 1 12 0v4M3 10a3 3 0 0 0 0 6m18-6a3 3 0 0 1 0 6"/>',
  workflow: '<path d="m12 3 10 6-10 6L2 9Zm-10 10 10 6 10-6M2 17l10 6 10-6"/>',
};
export const icon = (name: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${icons[name] || icons.dashboard}</svg>`;
const sidebar = document.querySelector("[data-sidebar]");
if (sidebar) {
  const link = (href: string, label: string, glyph: string) =>
    `<a href="${href}" ${location.pathname === href || ((href === "/workflows" || href === "/campaigns") && location.pathname.startsWith(href + "/")) ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${label}</span></a>`;
  sidebar.innerHTML = `<a class="cortex-brand" href="/dashboard"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M24 9c-6-9-15-1-12 5-9 0-10 13-5 16-3 9 9 15 17 9V9Zm0 0c6-9 15-1 12 5 9 0 10 13 5 16 3 9-9 15-17 9"/><path d="M16 12v8l-5 4m5 10 3-6m13-16v8l5 4m-5 10-3-6M24 18h-5m5 15h5"/></svg><span>Cortex VPL Server<small>The Brain</small></span></a><nav aria-label="Navegação principal"><p>E-commerce</p>${link("/dashboard", "Dashboard", "dashboard")}${link("/campaigns", "Campanhas", "campaigns")}${link("/expenses", "Despesas", "expenses")}<p>Workspace</p>${link("/", "Product Research", "research")}${link("/competitors", "Competitors", "competitors")}${link("/workflows", "Workflow", "workflow")}</nav><div class="sidebar-footer"><span class="online-dot"></span> O teu centro de operações</div>`;
}
