import type { ResearchProviderRequest } from "./model.mjs";

export type ResearchCacheEntry<T> = {
  key: string;
  topicKey: string;
  providerId: string;
  request: ResearchProviderRequest;
  value: T;
  createdAt: string;
  expiresAt: string;
};

export type ResearchCacheTimeOptions = {
  now?: string | number | Date;
};

export interface ResearchCache<T> {
  get(
    request: ResearchProviderRequest,
    providerId: string,
    options?: ResearchCacheTimeOptions
  ): ResearchCacheEntry<T> | null;
  findReusable(
    request: ResearchProviderRequest,
    providerId: string,
    options?: ResearchCacheTimeOptions
  ): ResearchCacheEntry<T> | null;
  set(
    request: ResearchProviderRequest,
    providerId: string,
    value: T,
    options?: ResearchCacheTimeOptions & { ttlMs?: number }
  ): ResearchCacheEntry<T>;
}

export function buildResearchCacheKey(
  request: ResearchProviderRequest,
  providerId: string
): string;
export function buildResearchTopicCacheKey(
  request: ResearchProviderRequest,
  providerId: string
): string;
export function getResearchCacheTtlMs(
  request: ResearchProviderRequest
): number;

export class InMemoryResearchCache<T = unknown>
  implements ResearchCache<T>
{
  get(
    request: ResearchProviderRequest,
    providerId: string,
    options?: ResearchCacheTimeOptions
  ): ResearchCacheEntry<T> | null;
  findReusable(
    request: ResearchProviderRequest,
    providerId: string,
    options?: ResearchCacheTimeOptions
  ): ResearchCacheEntry<T> | null;
  set(
    request: ResearchProviderRequest,
    providerId: string,
    value: T,
    options?: ResearchCacheTimeOptions & { ttlMs?: number }
  ): ResearchCacheEntry<T>;
  clear(): void;
}

