'use strict';

/**
 * utils/response.js — HTTP Response Helpers
 * ───────────────────────────────────────────
 * Every route returns a response through one of these helpers so the
 * response envelope is always consistent:
 *
 *   Success:  { success: true,  data: <payload> }
 *   Error:    { success: false, error: <message>, details?: <array> }
 *
 * Consistent shape makes front-end clients and API consumers simpler —
 * they always check `response.success` first.
 */

/**
 * 200 OK (or custom status) with a data payload.
 */
const ok = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({ success: true, data });
};

/**
 * 201 Created with the newly created resource.
 */
const created = (res, data) => ok(res, data, 201);

/**
 * 204 No Content — for DELETE responses where there is nothing to return.
 */
const noContent = (res) => res.status(204).send();

module.exports = { ok, created, noContent };
