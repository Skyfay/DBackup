export type RetentionMode = "NONE" | "SIMPLE" | "SMART";

export interface SimpleRetentionPolicy {
  keepCount: number;
}

export interface SmartRetentionPolicy {
  daily: number; // Keep one per day for X days
  weekly: number; // Keep one per week for X weeks
  monthly: number; // Keep one per month for X months
  yearly: number; // Keep one per year for X years
}

export interface RetentionConfiguration {
  mode: RetentionMode;
  simple?: SimpleRetentionPolicy;
  smart?: SmartRetentionPolicy;
}

export const DEFAULT_RETENTION_CONFIG: RetentionConfiguration = {
  mode: "NONE",
};
