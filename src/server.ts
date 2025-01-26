import express from 'express';
import { GtfsRtConverter } from './gtfs-rt/converter';
import { BatchProcessor } from './gtfs-rt/batch-processor';

const app = express();
const converter = new GtfsRtConverter();
const batchProcessor = new BatchProcessor();

// Store the latest feed data
let latestFeed: { protobuf: Buffer; json: any } | null = null;

// Function to process a batch of stops
async function processBatch(stopIds: string[]): Promise<void> {
  try {
    if (stopIds.length === 0) {
      console.warn('Empty batch received, skipping processing');
      return;
    }

    const protobufFeed = await converter.generateFeed(stopIds);
    const jsonFeed = await converter.generateJsonFeed(stopIds);
    
    // Only update the latest feed if we got valid data
    if (protobufFeed.length === 0) {
      console.warn('No valid data in feed, skipping update');
      return;
    }

    latestFeed = {
      protobuf: Buffer.from(protobufFeed),
      json: jsonFeed
    };
  } catch (error) {
    console.error('Error processing batch:', error);
  }
}

// Start the batch processing loop
async function startBatchProcessing() {
  while (true) {
    const batch = batchProcessor.getNextBatch();
    await processBatch(batch);
    
    // Wait before processing the next batch
    await new Promise(resolve => setTimeout(resolve, batchProcessor.getBatchDelay()));
    
    // If we've processed all stops, wait before starting the next cycle
    if (batch.length === 0 || batch.length < 5) {
      console.log('Completed full cycle, waiting 1 minute before next update');
      await new Promise(resolve => setTimeout(resolve, 60000 - batchProcessor.getBatchDelay()));
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
  res.json({ status: 'ok' });
});

// GTFS-RT feed endpoint
app.get('/gtfs-rt/trip-updates', async (req, res) => {
  try {
    if (!latestFeed) {
      return res.status(503).json({
        error: 'Service unavailable',
        message: 'Feed data is not yet available'
      });
    }

    // Check format parameter
    const format = req.query.format?.toString().toLowerCase();

    if (format === 'json') {
      res.json(latestFeed.json);
    } else {
      res.set('Content-Type', 'application/x-protobuf');
      res.send(latestFeed.protobuf);
    }
  } catch (error) {
    console.error('Error generating GTFS-RT feed:', error);
    res.status(500).json({ 
      error: 'Error generating feed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

const PORT = process.env.PORT || 3000;

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