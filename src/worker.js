const schedule = require('node-schedule');
const pLimit = require('p-limit');
const gtfsRealtime = require('gtfs-realtime-bindings');
const { getAllStops, getStopTimes } = require('./api');
const { convertToGtfsRt, saveGtfsRtFeed } = require('./gtfs');
const config = require('./config');
const logger = require('./logger');
require('./server');

let processedStops = 0;
let totalStops = 0;
let currentFeed = null;

function initializeFeed() {
  return gtfsRealtime.transit_realtime.FeedMessage.create({
    header: {
      gtfsRealtimeVersion: "2.0",
      incrementality: 0, // FULL_DATASET
      timestamp: Math.floor(Date.now() / 1000),
    },
    entity: [],
  });
}

function updateProgress(processed) {
  if (totalStops === null || totalStops === 0) return;
  processedStops = Math.min(processed, totalStops);
  const percentage = Math.round((processedStops / totalStops) * 100);
  logger.info(`Processing stops: ${percentage}% complete (${processedStops}/${totalStops})`);
}

async function processBatch(stops) {
  const limit = pLimit(config.BATCH_SIZE);
  const stopTimesPromises = stops.map(stopId => 
    limit(async () => {
      const result = await getStopTimes(stopId);
      updateProgress(processedStops + 1);
      return result;
    })
  );

  const results = await Promise.all(stopTimesPromises);
  const validResults = results.filter(result => result !== null);
  
  // Convert batch results to GTFS-RT and append to current feed
  if (validResults.length > 0) {
    const batchFeed = convertToGtfsRt(validResults);
    currentFeed.entity.push(...batchFeed.entity);
    
    // Save current state of the feed
    try {
      await saveGtfsRtFeed(currentFeed);
    } catch (error) {
      logger.error('Failed to save intermediate GTFS-RT feed', { error: error.message });
    }
  }
  
  return validResults;
}

async function processAllStops() {
  try {
    logger.info('Starting stop processing');
    currentFeed = initializeFeed();
    
    logger.info('Fetching stops list...');
    const allStops = await getAllStops();
    
    if (!Array.isArray(allStops) || allStops.length === 0) {
      logger.info('No stops found to process');
      return;
    }

    processedStops = 0;
    totalStops = allStops.length;
    logger.info(`Found ${totalStops} stops to process`);

    // Process stops in batches
    const batchSize = config.BATCH_SIZE;
    const batches = [];
    
    for (let i = 0; i < allStops.length; i += batchSize) {
      const batch = allStops.slice(i, i + batchSize);
      batches.push(batch);
    }

    logger.info('Starting to process stops in batches...');

    for (const batch of batches) {
      await processBatch(batch);
      
      // Add delay between batches
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, config.BATCH_DELAY));
      }
    }

    logger.info('Successfully updated GTFS-RT feed');
    totalStops = null; // Reset for next run
    currentFeed = null;
  } catch (error) {
    logger.error('Failed to process stops', { error: error.message });
    totalStops = null; // Reset on error
    currentFeed = null;
  }
}

// Schedule periodic execution
schedule.scheduleJob(config.UPDATE_INTERVAL, processAllStops);

// Initial execution
processAllStops();
logger.info('Worker initialized - waiting for first data fetch...');

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal, shutting down gracefully');
  schedule.gracefulShutdown()
    .then(() => process.exit(0));
});