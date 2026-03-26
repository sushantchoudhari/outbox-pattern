'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'appdb',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 10,
  idleTimeoutMillis:      30_000,
  connectionTimeoutMillis: 3_000,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

module.exports = pool;
