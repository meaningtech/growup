<p align="center">
  <a href="https://growup.earth">
    <img src="public/growup-social-card-v2.jpg" alt="GrowUp — data driven agroforestry planning" width="100%" />
  </a>
</p>

<h1 align="center">GrowUp</h1>

<p align="center">
  Evidence-driven agroforestry planning from real field boundaries to explainable planting systems, irrigation networks, fire planning and long-term costs.
</p>

<p align="center">
  <a href="https://growup.earth"><strong>Open GrowUp</strong></a>
  ·
  <a href="https://meaningtech.io/growup">Case study</a>
  ·
  <a href="https://github.com/meaningtech/growup/issues">Issues</a>
  ·
  <a href="https://github.com/meaningtech/growup/discussions">Discussions</a>
</p>

<p align="center">
  <a href="https://github.com/meaningtech/growup/actions/workflows/verify.yml"><img src="https://github.com/meaningtech/growup/actions/workflows/verify.yml/badge.svg" alt="Verify workflow" /></a>
  <a href="https://growup.earth"><img src="https://img.shields.io/badge/live-growup.earth-c7eb61?style=flat" alt="Live at growup.earth" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat&logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/Node.js-20-5fa04e?style=flat&logo=nodedotjs&logoColor=white" alt="Node.js 20" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f4f4f4?style=flat" alt="MIT license" /></a>
</p>

GrowUp is a map-first decision-support environment for agroforestry. It combines field geometry, environmental evidence, species knowledge and operational constraints in one inspectable workflow. Every generated plan remains editable and traceable to its inputs, assumptions and model version.

GrowUp supports planning decisions; it does not replace field surveys, laboratory soil analysis, water-source verification, permits or local professional review.

## See it in action

![GrowUp planning workspace with a real imported field boundary](docs/images/workspace-overview.png)

The workspace starts from an explicit user-defined boundary. It validates the geometry, clips evidence to the field and keeps the map beside the current planning decision.

![GrowUp product information panel](docs/images/product-information.png)

The public application is available in English and Italian. Anonymous users can analyse and design without creating an account; authentication adds private projects, immutable revisions and controlled sharing.

## From field to implementable plan

1. **Define the field** — draw or import a boundary, exclusions, access paths, water points and protected vegetation.
2. **Read the evidence** — combine terrain, historical climate, soil, subsurface, satellite and surrounding-context signals.
3. **Plan the system** — rank species against evidence, objectives, native-range information and invasive-species safeguards.
4. **Generate the design** — create deterministic planting alternatives with succession, spacing, crown growth and machinery constraints.
5. **Engineer water** — size zones, route editable pipes, check pressure and flow, and produce a bill of materials.
6. **Plan for fire** — add firebreak geometry, inspect official fire-weather context and maintain an operational checklist.
7. **Estimate costs** — calculate plants, labour, irrigation, water, energy and versioned long-term maintenance.
8. **Review and share** — run a formal coherence review, export GeoJSON/CSV and create revocable view or review links.

## What is inside

| Area | Capabilities |
| --- | --- |
| Field intelligence | Editable Google satellite geometry, PostGIS validation, Open-Meteo climate, SoilGrids, Sentinel-1/2, land cover, depth-to-bedrock and groundwater context |
| Agroforestry design | Evidence-ranked species, syntropic succession, six planting systems, full-field or perimeter modes, deterministic layouts and growth uncertainty |
| Operational planning | Irrigation hydraulics, firebreaks, machinery access, procurement quantities, planting schedules and maintenance workload |
| Explainability | Source register, confidence levels, model versions, assumptions, conflicts and reproducible calculation snapshots |
| Collaboration | Private projects, immutable revisions, expiring share links, map-pinned comments and approval/change requests |
| AI assistance | Provider-agnostic, OpenAI-compatible planning proposals and formal review; all project mutations are validated and require confirmation |

## Architecture

```mermaid
flowchart LR
  UI["React + Vite workspace"] --> API["Express API"]
  API --> GEO["PostGIS geometry"]
  API --> DOCS["Mongo-compatible project store"]
  API --> EVIDENCE["Climate, soil, satellite and map providers"]
  API --> AI["OpenAI-compatible assistant"]
  API --> EXPORTS["GeoJSON, CSV and printable schedules"]
```

The production application runs as a two-stage Node.js container on Google Cloud Run. PostGIS is authoritative for spatial validation and measurement; project documents and immutable revisions remain separate from the geometry database.

## Run locally

### Requirements

- Node.js 20+
- Docker with Compose
- A Google Maps browser key authorized for the local origin

### Core anonymous workspace

```bash
git clone https://github.com/meaningtech/growup.git
cd growup
npm ci
docker compose up -d
npm run db:migrate
```

Create `.env`:

```dotenv
GOOGLE_MAPS_BROWSER_API_KEY=your_browser_key
GROWUP_SKIP_DATABASE_MIGRATION=1
```

Then start the API and Vite development server:

```bash
npm run dev
```

Open `http://127.0.0.1:5174`. The default local PostGIS connection is `postgresql://growup:growup@127.0.0.1:55432/growup`.

The core workflow intentionally starts with an empty map. Import or draw a field; no localized demo parcel is bundled into the application.

### Optional integrations

| Variable | Enables |
| --- | --- |
| `GOOGLE_MAPS_SERVER_API_KEY` | Credential-protected geocoding fallback |
| `MONGODB_URI` + `AUTH_SESSION_SECRET` | Accounts, private projects, revisions and sharing |
| `GOOGLE_OAUTH_CLIENT_ID` | Google sign-in |
| `AI_PROVIDER_API_KEY` | Planning assistant and formal AI review |
| `AI_PROVIDER_BASE_URL` + `AI_PROVIDER_MODEL` | A different OpenAI-compatible provider or model |
| `ALLOWED_ORIGINS` | Explicit production CORS allowlist |

Credentials belong in local environment files or a secret manager. Never commit them or include them in screenshots, fixtures or exports.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Useful focused commands:

```bash
GROWUP_BASE_URL=https://your-deployed-origin.example npm run test:acceptance
GROWUP_SCREENSHOT_URL=https://growup.earth npm run docs:screenshots
```

Live evidence and assistant tests depend on their upstream providers and are opt-in. The credential-free CI gate runs type checking, unit and integration tests, a production build and a focused browser acceptance suite.

## Evidence and model boundaries

GrowUp distinguishes observed data, modelled data, deterministic outputs, assumptions and unknowns. Environmental, botanical and cost values shown to users must retain a source, observation date or version and confidence level. Unknown provider values remain unknown; they are never replaced by invented defaults.

The design-ready catalogue is a curated planning subset, not a claim of universal ecological authority. Jurisdiction-level nativeness and invasiveness are reported only where supporting evidence exists.

- [Data sources and provenance](data/SOURCES.md)
- [Product and implementation plan](docs/PROJECT_PLAN.md)
- [Design systems and solar model](docs/DESIGN_SYSTEMS_AND_SOLAR.md)
- [Maintenance model](docs/MAINTENANCE_MODEL.md)
- [Acceptance audit](docs/ACCEPTANCE_AUDIT.md)
- [Machine-readable product overview](public/llms.txt)

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), keep technical decisions evidence-backed and include tests for behavior changes. Security reports should follow [SECURITY.md](SECURITY.md) instead of being opened publicly.

GrowUp is developed by [meaningtech](https://meaningtech.io), where technology supports human judgment and creates measurable value for institutions, businesses and citizens.

## License

GrowUp is available under the [MIT License](LICENSE). Copyright © 2026 meaningtech.
