import express from 'express';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { GtfsRtConverter } from './gtfs-rt/converter';
import { BatchProcessor } from './gtfs-rt/batch-processor';
import { RequestLogger } from './gtfs-rt/logger';

interface TripDescriptor {
  tripId: string;
  routeId: string;
  scheduleRelationship: number;
}

interface StopTimeUpdate {
  stopId: string;
  stop_id?: string;
  departure: {
    delay: number;
    time: number;
  };
  scheduleRelationship: number;
}

interface TripUpdate {
  trip: TripDescriptor;
  stop_time_update?: StopTimeUpdate[];
  stopTimeUpdate?: StopTimeUpdate[];
}

interface FeedEntity {
  id: string;
  tripUpdate: TripUpdate;
}

interface Feed {
  header: {
    gtfsRealtimeVersion: string;
    incrementality: number;
    timestamp: number;
  };
  entity: FeedEntity[];
}

const app = express();
const converter = new GtfsRtConverter();
const batchProcessor = new BatchProcessor(converter);
const logger = new RequestLogger();

// Store accumulated feed data
let accumulatedFeed: Feed = {
  header: {
    gtfsRealtimeVersion: '2.0',
    incrementality: 0,
    timestamp: Math.floor(new Date().getTime() / 1000) // UTC POSIX time in seconds
  },
  entity: []
};
let serverReady = false;

// Function to process a batch of stops
async function processBatch(stopIds: string[]): Promise<void> {
  try {
    if (stopIds.length === 0) {
      console.warn('Empty batch received, skipping processing');
      return;
    }

    // Get new feed data for this batch
    const newJsonFeed = await converter.generateJsonFeed(stopIds);

    // Update timestamp
    accumulatedFeed.header.timestamp = Math.floor(new Date().getTime() / 1000); // UTC POSIX time in seconds

    // Remove old entries for stops in this batch
    const batchStopIds = new Set(stopIds);
    accumulatedFeed.entity = accumulatedFeed.entity.filter(entity => {
      const stopId = entity.tripUpdate?.stopTimeUpdate?.[0]?.stopId;
      return stopId && !batchStopIds.has(stopId);
    });

    // Add new entries from this batch
    if (newJsonFeed.entity && newJsonFeed.entity.length > 0) {
      accumulatedFeed.entity = [...accumulatedFeed.entity, ...newJsonFeed.entity];
      console.log(`Added ${newJsonFeed.entity.length} updates from current batch. Total updates: ${accumulatedFeed.entity.length}`);
    } else {
      console.log('No new updates in current batch');
    };
  } catch (error) {
    console.error('Error processing batch:', error);
  }
}

// Start the batch processing loop
async function startBatchProcessing() {
  console.log('Initializing GTFS-RT server...');
  const startTime = Date.now();

  // Initialize the batch processor first
  try {
    await batchProcessor.initialize();
    serverReady = true;
    const initTime = (Date.now() - startTime) / 1000;
    console.log(`Server ready in ${initTime.toFixed(1)}s. Processing ${batchProcessor.getTotalStops()} stops.`);
  } catch (error) {
    console.error('Failed to initialize batch processor:', error);
    process.exit(1);
  }

  while (true) {
    const batch = batchProcessor.getNextBatch();
    const batchDelay = batchProcessor.getBatchDelay();

    console.log(`Processing batch of ${batch.length} stops, next batch in ${batchDelay}ms`);
    await processBatch(batch);

    // Wait before processing the next batch
    await new Promise(resolve => setTimeout(resolve, batchDelay));

    // If we've processed all stops, start a new cycle
    if (batch.length === 0) {
      console.log('Completed full cycle, starting new cycle');
    }
  }
}

// Configure CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Health check endpoint
app.get('/gtfs-rt/health', (req, res) => {
  const startTime = Date.now();
  res.json({
    status: serverReady ? 'ready' : 'initializing',
    totalStops: batchProcessor.getTotalStops(),
    lastUpdate: accumulatedFeed.entity.length > 0 ? new Date().toISOString() : null
  });
  logger.logRequest('GET', '/gtfs-rt/health', 200, Date.now() - startTime);
});

// GTFS-RT feed endpoint
app.get('/gtfs-rt/trip-updates', async (req, res) => {
  const startTime = Date.now();
  try {
    if (!serverReady) {
      logger.logRequest('GET', '/gtfs-rt/trip-updates', 503, Date.now() - startTime);
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Server is still initializing. Please check /gtfs-rt/health for status.'
      });
    }

    // Check format parameter
    const format = req.query.format?.toString().toLowerCase();

    // Get current time for filtering
    const currentTime = Math.floor(Date.now() / 1000);

    if (format === 'json') {
      // Create OTP-compatible JSON structure
      const otpFeed = {
        header: accumulatedFeed.header,
        entity: accumulatedFeed.entity
            .filter(entity => {
              const tripId = entity.tripUpdate?.trip?.tripId;
              if (!tripId?.toLowerCase().startsWith('sem:')) return false;

              // Get departure time from first stop update
              const departureTime = entity.tripUpdate?.stopTimeUpdate?.[0]?.departure.time || 0;
              return departureTime > currentTime;
            })
            .map(entity => ({
              id: entity.id,
              trip_update: {
                trip: {
                  trip_id: entity.tripUpdate.trip.tripId.replace(/^sem:/i, ''),
                  route_id: entity.tripUpdate.trip.routeId.replace(/^sem:/i, '')
                },
                stop_time_updates: entity.tripUpdate.stopTimeUpdate
                    ?.sort((a, b) => a.departure.time - b.departure.time)
                    .map(update => ({
                      stop_id: update.stopId.replace(/^sem:/i, '').replace(/-/g, ''),
                      departure_time: Math.floor(update.departure.time),
                      delay: Math.floor(update.departure.delay / 1000) // Convert ms to seconds
                    }))
              }
            }))
      };
      res.json(otpFeed);
    } else {
      const protobufFeed = GtfsRealtimeBindings.transit_realtime.FeedMessage.encode({
        header: accumulatedFeed.header,
        entity: accumulatedFeed.entity
            .filter(entity => {
              const tripId = entity.tripUpdate?.trip?.tripId;
              return tripId && tripId.toLowerCase().startsWith('sem:');
            })
            .map(entity => ({
              id: entity.id,
              tripUpdate: {
                trip: {
                  tripId: entity.tripUpdate.trip.tripId,
                  routeId: entity.tripUpdate.trip.routeId,
                  scheduleRelationship: 0
                },
                stopTimeUpdate: entity.tripUpdate.stopTimeUpdate?.filter(update =>
                    update.departure.time > currentTime
                )?.sort((a, b) =>
                    a.departure.time - b.departure.time
                ) || []
              }
            }))
      }).finish();
      res.set('Content-Type', 'application/x-protobuf');
      res.send(Buffer.from(protobufFeed));
    }
    logger.logRequest('GET', '/gtfs-rt/trip-updates', 200, Date.now() - startTime);
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), 'GTFS-RT feed generation');
    logger.logRequest('GET', '/gtfs-rt/trip-updates', 500, Date.now() - startTime);
    res.status(500).json({
      error: 'Error generating feed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

const PORT = process.env.PORT || 80;

app.listen(PORT, () => {
  // Start the batch processing after server is running
  startBatchProcessing().catch((error: unknown) => {
    logger.logError(error instanceof Error ? error : new Error(String(error)), 'Batch processing');
  });

  console.log(`
🚀 GTFS-RT Server running on port ${PORT}

Available endpoints:
  - GET /gtfs-rt/health        - Health check
  - GET /gtfs-rt/trip-updates  - GTFS-RT feed
    Query params:
      format: Response format - 'json' or 'protobuf' (default: protobuf)
      Example: /gtfs-rt/trip-updates?format=json

Processing ${batchProcessor.getTotalStops()} stops in batches of 5 with 5-second delays
  `);
});