import { z } from 'zod';

export const uploadDatasetSchema = z.object({
  name: z.string().trim().min(1).max(255),
  filename: z.string().trim().min(1).max(255),
  // base64-encoded file content (CSV or .xlsx), max ~8MB decoded
  contentBase64: z.string().min(8),
});

export const listDatasetsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const listReportsQuerySchema = z.object({
  datasetId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
