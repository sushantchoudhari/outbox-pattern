/**
 * modules/auth/auth.schema.ts — Auth Request Validation Schemas
 * ───────────────────────────────────────────────────────────────
 */

import { z } from 'zod';

export const registerSchema = z.object({
  name:     z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email:    z.string().email('Must be a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const loginSchema = z.object({
  email:    z.string().email('Must be a valid email address'),
  // Don't validate min-length on login — just check it's non-empty.
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput    = z.infer<typeof loginSchema>;
