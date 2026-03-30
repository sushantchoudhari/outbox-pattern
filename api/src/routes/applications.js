'use strict';

/**
 * routes/applications.js — Application Route Definitions
 * ────────────────────────────────────────────────────────
 * Wires HTTP methods + paths to controller handlers.
 * No business logic; no SQL; no response formatting.
 */

const { Router } = require('express');
const { create, getById } = require('../modules/applications/applications.controller');

const router = Router();

router.post('/',    create);
router.get('/:id',  getById);

module.exports = router;

