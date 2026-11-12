# Funnel automation — discussion, 2026-10-31

Status: documentation only; no new server orchestration, builder or deployment implemented.

Prompts centralizadas em ../agents/README.md. Seis etapas preparadas; construção/validação/Funnelish são rascunhos. A referência de tradução foi preservada byte por byte. Modelo, autenticação e execução continuam por decidir; nenhuma integração foi ativada. Prioridade do utilizador: aproveitar a subscrição e medir custos por etapa. Codex CLI com autenticação ChatGPT é uma opção documentada a validar, sem presumir disponibilidade das ferramentas de imagens desta sessão. Não depender da memória do chat nem automatizar o VS Code como primeira opção. Custo fixo da subscrição e despesas variáveis devem ser registados separadamente.

## User clarification: research queue and destination editor

An existing server connects to Google Sheets. A coach marks a research row yes to make the product eligible in the server's research list. Eligibility does not itself launch generation: the user selects the product and initiates testing with the two competitor URLs, locale, branding checkbox and optional product photo. Use a stable research/job identifier to avoid duplicate imports and duplicate builds on retries.

Only two content pages are in scope: advertorial and the supplied second sales/checkout-reference page. Actual transactional checkout remains manual and outside this automation. Confirm the page role from the source rather than adding payment or extra funnel pages automatically.

Product/brand cases: supplied photo + branding on = rebrand supplied product; no photo + on = rebrand competitor product; supplied photo + off = retain supplied product's own brand and replace competitor product where needed; no photo + off = retain competitor product/brand.

Final destination is the user's platform called Funnels. Exact platform URL/editor capabilities still need inspection. User reports no HTML/JavaScript page import. The template is a flexible guide, not an immutable layout.

Recommendation: prepare structured sections, translated text, assets and styling instructions, then populate a duplicate native template in the destination editor if supported. Avoid building an unrelated HTML page that must then be manually reconstructed. An optional local preview is secondary to validation of the actual destination page. First check supported API/import/template duplication; if unavailable, use Playwright for repeatable editor actions with AI for section decisions and exceptional cases. Persist destination page IDs and progress so a restart resumes rather than creating duplicates. Save and reopen to verify persistence; test actual mobile preview and CTA links. Start with a small draft proof of concept before promising full automation. No platform capabilities are confirmed yet.

## Confirmed workflow

Inputs: competitor advertorial and sales/checkout URLs, optional product photo, country/language, create-brand checkbox. Preserve ../BRAND_AND_MEDIA_AGENT.md and the existing translation prompt.

Sequence: extraction → optional brand and product master → media adaptation/localization and actual offer packs → full-content translation → template mapping → browser validation → reviewable delivery. Reuse completed work on resume.

The supplied template is the visual baseline. Relevant additional competitor sections must be represented with compatible components, not silently omitted. Keep source content mapping separate from placement decisions.

Mobile headings/subheadings: maximum four rendered lines. Product USP bullets: one rendered line and at most 24 words. These are independent conditions: 24 words do not guarantee one line. Measure actual font, component width and supported viewports. Do not hide overflow, make text unreadable or delete claims to pass.

Preserve translation fidelity. If fitting requires material shortening, retain the faithful version and flag the conflict. Policy for condensed display text remains undecided.

## Proposed architecture, not implemented

Use a small orchestrator with persisted stages. AI handles semantic mapping, branding and translation; deterministic tools handle downloads, files, rendering and validation. An agent can be a prompted stage rather than a separate service.

Playwright operates browsers for scrolling, inspection, interactions, screenshots and mobile checks; it does not supply AI reasoning or decide conversion strategy. Prefer controlled template components/data when source code is available, using browser automation for discovery and validation. Reference: https://playwright.dev/docs/intro

Suggested outputs: source inventory/content map, brand/media manifest, localized content map, section map, rendered preview and measured checks. Retry only failures. Tools available interactively must not be assumed available on a server; select and authorize an image-editing adapter and costs before implementation.

## Remaining decisions

- Exact template/version and source-code access versus hosted editor.
- Supported mobile widths, typography and allowed layout adjustments.
- Faithful but overlong headings/USPs: layout changes versus approved condensation.
- Funnel pages, production integrations, review/publishing boundary.
- Resource budget, retry limits and server media provider.

## Cleanup record

Root AGENTS.md now routes to the canonical media workflow and unchanged translation prompt. Other old funnel references are inactive by default and retained for compatibility/history. Snapshot: tmp/product-media-jobs/workflow-reset-20261031/. The translation path is preserved because backend/services/mediaJobService.ts reads it. No application code, product projects or ad strategies were removed or changed. Code cleanup/migration remains separate future work.
