'use strict';

/**
 * logger.js — Structured JSON Logger
 * ────────────────────────────────────
 * Responsibility: write structured JSON log entries to stdout/stderr.
 *
 * JSON lines are directly queryable in CloudWatch Logs Insights:
 *   fields @timestamp, level, message, applicationId
 *   | filter level = "error"
 *   | sort @timestamp desc
 */

/**
 * Writes a structured JSON log line.
 *
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 * @param {object} [fields] - Additional key/value pairs merged into the entry.
 */
function log(level, message, fields = {}) {
  const entry = JSON.stringify({
    level,
    message,
    ...fields,
    ts: new Date().toISOString(),
  });

  if (level === 'error') {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

module.exports = { log };
