/**
 * modules/user/user.schema.ts — Zod Validation Schemas
 * ───────────────────────────────────────────────────────
 * Declares the valid shape of every user-related HTTP request.
 * Schemas are used by the validate() middleware — not the service.
 *
 * SWITCHING TO A DATABASE:
 *   These schemas remain unchanged regardless of the storage backend.
 *   They validate the HTTP contract, not the database schema.
 */

import { z } from 'zod';

/** Rules for POST /users — all fields are required. */
export const createUserSchema = z.object({
  name:     z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email:    z.string().email('Must be a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role:     z.enum(['user', 'admin']).optional(),
});

/** Rules for PATCH /users/:id — all fields optional, at least one required. */
export const updateUserSchema = z
  .object({
    name:     z.string().trim().min(2).max(100).optional(),
    email:    z.string().email('Must be a valid email address').optional(),
    password: z.string().min(8).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

/** Rules for routes that only accept a UUID path parameter. */
export const idParamSchema = z.object({
  id: z.string().uuid('ID must be a valid UUID'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
