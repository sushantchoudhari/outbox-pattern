'use strict';

/**
 * utils/logger.js — Structured Logger
 * ─────────────────────────────────────
 * Emits JSON log lines so every log entry is machine-parseable.
 * In production, tools like CloudWatch Logs Insights, Datadog, or ELK
 * can query fields like { level: "error" } directly.
 *
 * For a full-featured logger in production, replace this with Winston
 * or Pino — both emit JSON and support log levels, transports, and
 * log rotation out of the box.
 */

const config = require('../config');

const logger = {
  /**
   * Logs an informational message.
   * @param {string} message
   * @param {object} [fields] - Extra key-value pairs to include in the log line.
   */
  info(message, fields = {}) {
    // Suppress info logs during tests to keep test output clean.
    if (config.server.env === 'test') return;
    console.log(JSON.stringify({ level: 'info', message, ...fields, ts: new Date().toISOString() }));
  },

  /**
   * Logs a warning.
   */
  warn(message, fields = {}) {
    console.warn(JSON.stringify({ level: 'warn', message, ...fields, ts: new Date().toISOString() }));
  },

  /**
   * Logs an error.
   */
  error(message, fields = {}) {
    console.error(JSON.stringify({ level: 'error', message, ...fields, ts: new Date().toISOString() }));
  },
};

module.exports = logger;
