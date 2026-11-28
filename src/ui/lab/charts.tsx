import type { LabChart } from './types';
import { durabilityChart, fitnessChart, powerChart, recordsChart } from './chartsA';

export type { LabChart, Ready } from './types';

/** The Lab's designed charts, in the order their tiles are shown. */
export const LAB_CHARTS: LabChart[] = [fitnessChart, powerChart, recordsChart, durabilityChart];

export const chartById = (id: string) => LAB_CHARTS.find((c) => c.id === id);
