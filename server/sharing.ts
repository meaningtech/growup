import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IrrigationEstimate, SharedIrrigationEstimate, ProjectState, SharedProjectState } from '../src/types.js';
import type { AuthConfig } from './auth.js';

type ShareTokenPayload = {
  projectId: string;
  tokenVersion: string;
  expiresAt: number;
};

export function sharingStatus(config: AuthConfig = {}) {
  return { configured: Boolean(sharingSecret(config)) };
}

export function createProjectShareToken(projectId: string, tokenVersion: string, expiresAt: string | null, config: AuthConfig = {}) {
  const expiry = expiresAt ? Date.parse(expiresAt) : (config.now?.() ?? new Date()).getTime() + 90 * 24 * 60 * 60_000;
  const payload: ShareTokenPayload = {
    projectId,
    tokenVersion,
    expiresAt: Math.floor(expiry / 1_000),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(encoded, config)}`;
}

export function verifyProjectShareToken(token: string, config: AuthConfig = {}): ShareTokenPayload | null {
  if (!sharingStatus(config).configured || token.length > 4_096) return null;
  const [encoded, suppliedSignature] = token.split('.');
  if (!encoded || !suppliedSignature) return null;
  const expected = Buffer.from(signature(encoded, config));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ShareTokenPayload;
    const now = Math.floor((config.now?.() ?? new Date()).getTime() / 1_000);
    return typeof payload.projectId === 'string'
      && payload.projectId.length > 0
      && typeof payload.tokenVersion === 'string'
      && payload.tokenVersion.length > 0
      && Number.isFinite(payload.expiresAt)
      && payload.expiresAt > now
      ? payload
      : null;
  } catch {
    return null;
  }
}

export function publicProject(project: ProjectState): SharedProjectState {
  const includeCosts = project.collaboration.share.includeCosts;
  const { analysis: _analysis, ...sharedProject } = project;
  return {
    ...sharedProject,
    economicConfiguration: includeCosts ? project.economicConfiguration : null,
    irrigation: includeCosts ? project.irrigation : publicIrrigation(project.irrigation),
    costs: includeCosts ? project.costs : null,
    collaboration: {
      ...project.collaboration,
      share: {
        enabled: project.collaboration.share.enabled,
        mode: project.collaboration.share.mode,
        includeCosts,
        createdAt: project.collaboration.share.createdAt,
        expiresAt: project.collaboration.share.expiresAt,
      },
    },
  };
}

function publicIrrigation(irrigation: IrrigationEstimate | null): SharedIrrigationEstimate | null {
  if (!irrigation) return null;
  const {
    economics: _economics,
    installation,
    annualOperation,
    systemMaintenance,
    network,
    monthly,
    assumptions,
    ...shared
  } = irrigation;
  const { materialsCost: _materialsCost, laborCost: _laborCost, totalCost: _installationTotalCost, ...sharedInstallation } = installation;
  const {
    waterCost: _waterCost,
    energyCost: _energyCost,
    maintenanceCost: _maintenanceCost,
    managementLaborCost: _managementLaborCost,
    totalCost: _annualTotalCost,
    ...sharedAnnualOperation
  } = annualOperation;
  const { laborCostPerHour: _laborCostPerHour, totalCost: _maintenanceTotalCost, tasks, ...sharedMaintenance } = systemMaintenance;
  const sharedTasks = tasks.map(({ cost: _cost, ...task }) => task);
  const sharedComponents = network.components.map(({ unitCost: _unitCost, totalCost: _componentTotalCost, ...component }) => component);
  const sharedMonthly = monthly.map(({ cost: _cost, ...month }) => month);
  return {
    ...shared,
    network: { ...network, components: sharedComponents },
    installation: sharedInstallation,
    annualOperation: sharedAnnualOperation,
    systemMaintenance: { ...sharedMaintenance, tasks: sharedTasks },
    assumptions: assumptions.filter((assumption) => !/(cost|price|tariff|rate|currency|labour|labor)/i.test(`${assumption.label} ${assumption.value}`)),
    monthly: sharedMonthly,
  };
}

function signature(value: string, config: AuthConfig) {
  return createHmac('sha256', sharingSecret(config)).update(`growup-share:${value}`).digest('base64url');
}

function sharingSecret(config: AuthConfig) {
  return config.authSessionSecret ?? process.env.AUTH_SESSION_SECRET ?? '';
}
