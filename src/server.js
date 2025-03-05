const express = require('express');
const fs = require('fs').promises;
const config = require('./config');
const logger = require('./logger');

const app = express();
const port = process.env.PORT || 3000;

app.get('/feed', async (req, res) => {
  try {
    const feed = await fs.readFile(config.GTFS_RT_PATH);
    res.set('Content-Type', 'application/x-protobuf');
    res.send(feed);
    logger.info('GTFS-RT feed served successfully');
  } catch (error) {
    logger.error('Failed to serve GTFS-RT feed', { error: error.message });
    res.status(500).json({ error: 'Failed to retrieve feed' });
  }
});

app.listen(port, () => {
  logger.info(`GTFS-RT feed server listening at http://localhost:${port}/feed`);
});