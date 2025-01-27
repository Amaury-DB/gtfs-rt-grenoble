import express from 'express';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { GtfsRtConverter } from './gtfs-rt/converter';
import { BatchProcessor } from './gtfs-rt/batch-processor';

interface TripDescriptor {
  tripId: string;
  routeId: string;
  scheduleRelationship: number;
}

interface StopTimeUpdate {
  stopId: string;
  departure: {
    delay: number;
    time: number;
  };
  scheduleRelationship: number;
}

interface TripUpdate {
  trip: TripDescriptor;
  stopTimeUpdate: StopTimeUpdate[];
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

// Store accumulated feed data
let accumulatedFeed: Feed = {
  header: {
    gtfsRealtimeVersion: '2.0',
    incrementality: 0,
    timestamp: Math.floor(Date.now() / 1000) // UTC POSIX time
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
    accumulatedFeed.header.timestamp = Math.floor(Date.now() / 1000); // UTC POSIX time
    
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
  // Initialize the batch processor first
  try {
    await batchProcessor.initialize();
    serverReady = true;
    console.log('Server is ready to serve GTFS-RT data');
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
  res.json({ 
    status: serverReady ? 'ready' : 'initializing',
    totalStops: batchProcessor.getTotalStops(),
    lastUpdate: accumulatedFeed.entity.length > 0 ? new Date().toISOString() : null
  });
});

// GTFS-RT feed endpoint
app.get('/gtfs-rt/trip-updates', async (req, res) => {
  try {
    if (!serverReady) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Server is still initializing. Please check /gtfs-rt/health for status.'
      });
    }
    
    // Check format parameter
    const format = req.query.format?.toString().toLowerCase();
    
    if (format === 'json') {
      res.json(accumulatedFeed);
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
                tripId: entity.tripUpdate.trip.tripId.replace(/^sem:/i, '').replace(/^sem:/i, ''),
                routeId: entity.tripUpdate.trip.routeId,
                scheduleRelationship: 0
              },
              stopTimeUpdate: entity.tripUpdate.stopTimeUpdate.map(update => ({
                stopId: update.stopId.replace(/^sem:/i, '').replace(/^sem:/i, ''),
                departure: {
                  delay: Math.floor(update.departure.delay),
                  time: Math.floor(update.departure.time) // Ensure integer UTC POSIX time
                },
                scheduleRelationship: 0
              }))
            }
          }))
      }).finish();
      res.set('Content-Type', 'application/x-protobuf');
      res.send(Buffer.from(protobufFeed));
    }
  } catch (error) {
    console.error('Error generating GTFS-RT feed:', error);
    res.status(500).json({ 
      error: 'Error generating feed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

const PORT = process.env.PORT || 80;

app.listen(PORT, () => {
  // Start the batch processing after server is running
  startBatchProcessing().catch(error => {
    console.error('Error in batch processing loop:', error);
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