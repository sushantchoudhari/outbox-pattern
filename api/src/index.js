'use strict';

const express = require('express');
const applicationsRouter = require('./routes/applications');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/applications', applicationsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[api] Server listening on port ${PORT}`);
});
