import type { PriceEntry, PriceFile } from '../lib/prices';

export declare const AWS_URL: string;
export declare const GCP_URL: string;
export declare const FLAG_THRESHOLD: number;

export declare function parseAwsLine(line: string, instance: string): number | null;
export declare function fetchAwsHourly(instance: string, fetchImpl?: typeof fetch): Promise<number>;
export declare function splitCsv(line: string): string[];
export declare function parseGcpCsv(text: string, instance: string, region: string): number;
export declare function fetchGcpHourly(
  instance: string,
  region: string,
  fetchImpl?: typeof fetch,
): Promise<number>;

export type FetchResult = { ok: true; hourlyUsd: number } | { ok: false; error: string };

export declare function mergePrices(
  prev: PriceFile & { notes?: string },
  results: Record<string, FetchResult | undefined>,
  today: string,
): { file: PriceFile; refreshed: number; notes: string[]; flags: string[] };

export declare function prBody(
  summary: { notes: string[]; flags: string[] },
  today: string,
): string;

export type { PriceEntry };
