import type { LabChart } from './types';
import { durabilityChart, fitnessChart, powerChart, recordsChart } from './chartsA';
import { recoveryChart, weightChart, yearChart, zonesChart } from './chartsB';
import { breathChart, compareChart, heartChart, pedalChart } from './chartsC';

export type { LabChart, Ready } from './types';

/** The Lab's designed charts, in the order their tiles are shown. */
export const LAB_CHARTS: LabChart[] = [fitnessChart, powerChart, recordsChart, zonesChart, heartChart, compareChart, breathChart, durabilityChart, yearChart, recoveryChart, weightChart, pedalChart];

export const chartById = (id: string) => LAB_CHARTS.find((c) => c.id === id);
