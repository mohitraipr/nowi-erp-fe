import { apiClient } from './apiClient';
import type { Vendor } from './types';

export async function listVendors(): Promise<Vendor[]> {
  const res = await apiClient.get<Vendor[] | { data: Vendor[] }>('/api/vendors');
  // Tolerate both list-shape and { data: [] } envelope.
  return Array.isArray(res.data) ? res.data : res.data.data;
}

/** Quick-add from a picker — the server mints the code from the name. */
export async function createVendor(name: string): Promise<Vendor> {
  const res = await apiClient.post<Vendor>('/api/vendors', { name });
  return res.data;
}
