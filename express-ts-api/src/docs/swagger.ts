/**
 * docs/swagger.ts — OpenAPI / Swagger UI Setup
 * ──────────────────────────────────────────────
 * Mounts Swagger UI at /api/docs (non-production environments only).
 * The spec models every endpoint, request schema, and response shape.
 *
 * ACCESS:
 *   http://localhost:3000/api/docs  (development + preprod)
 *
 * EXTENDING THE SPEC:
 *   Add a new `paths` entry for each new route in the same style as below.
 *   Keep `components.schemas` in sync with your Zod schemas.
 */

import swaggerUi from 'swagger-ui-express';
import { Application } from 'express';

const spec = {
  openapi: '3.0.0',
  info: {
    title:       'Express TypeScript API',
    version:     '1.0.0',
    description: 'Production-ready Express.js + TypeScript REST API starter',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Development' },
    { url: 'https://preprod.example.com', description: 'Pre-production' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      SafeUser: {
        type: 'object',
        properties: {
          id:        { type: 'string', format: 'uuid' },
          name:      { type: 'string' },
          email:     { type: 'string', format: 'email' },
          role:      { type: 'string', enum: ['user', 'admin'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          user:  { $ref: '#/components/schemas/SafeUser' },
          token: { type: 'string', description: 'JWT Bearer token' },
        },
      },
      ValidationError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error:   { type: 'string', example: 'Validation failed' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field:   { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        summary: 'Health check',
        tags: ['System'],
        responses: {
          '200': { description: 'Server is healthy' },
        },
      },
    },
    '/api/v1/auth/register': {
      post: {
        summary:  'Register a new account',
        tags:     ['Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name:     { type: 'string', minLength: 2 },
                  email:    { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Account created', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          '409': { description: 'Email already registered' },
          '422': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } } },
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        summary: 'Log in',
        tags:    ['Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email:    { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Login successful', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/api/v1/auth/me': {
      get: {
        summary:  'Get current user profile',
        tags:     ['Auth'],
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Profile returned' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/api/v1/users': {
      get: {
        summary:  'List all users',
        tags:     ['Users'],
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Array of users' }, '401': { description: 'Not authenticated' } },
      },
      post: {
        summary: 'Create a user',
        tags:    ['Users'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name:     { type: 'string' },
                  email:    { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  role:     { type: 'string', enum: ['user', 'admin'] },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'User created' }, '409': { description: 'Email taken' }, '422': { description: 'Validation error' } },
      },
    },
    '/api/v1/users/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        summary:  'Get user by ID',
        tags:     ['Users'],
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'User found' }, '404': { description: 'Not found' } },
      },
      patch: {
        summary:  'Update user',
        tags:     ['Users'],
        security: [{ BearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name:     { type: 'string' },
                  email:    { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'User updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        summary:  'Delete user (admin only)',
        tags:     ['Users'],
        security: [{ BearerAuth: [] }],
        responses: { '204': { description: 'Deleted' }, '403': { description: 'Forbidden' }, '404': { description: 'Not found' } },
      },
    },
  },
};

export function setupSwagger(app: Application): void {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, {
    customSiteTitle: 'Express TS API Docs',
  }));
}
