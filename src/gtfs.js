const fs = require('fs').promises;
const path = require('path');
const gtfsRealtime = require('gtfs-realtime-bindings');
const config = require('./config');
const logger = require('./logger');

function convertToGtfsRt(stopTimesData) {
  const feed = {
    header: {
      gtfsRealtimeVersion: "2.0",
      incrementality: 0, // FULL_DATASET
      timestamp: Math.floor(Date.now() / 1000),
    },
    entity: [],
  };

  for (const stopTime of stopTimesData) {
    if (!stopTime.pattern || !stopTime.times) continue;

    const tripUpdate = {
      trip: {
        tripId: stopTime.pattern.id
      }
    };

    tripUpdate.stopTimeUpdate = stopTime.times.map(time => {
      return {
        stopId: time.stopId,
        arrival: {
          time: time.serviceDay + time.realtimeArrival,
          delay: time.arrivalDelay
        },
        departure: {
          time: time.serviceDay + time.realtimeDeparture,
          delay: time.departureDelay
        },
        scheduleRelationship: time.realtime ? 0 : 3 // 0 = SCHEDULED, 3 = CANCELED
      };
    });
    
    const entity = {
      id: `${stopTime.pattern.id}_${Date.now()}`,
      tripUpdate: tripUpdate,
    };

    feed.entity.push(entity);
  }

  return gtfsRealtime.transit_realtime.FeedMessage.create(feed);
}

async function saveGtfsRtFeed(feed) {
  try {
    const buffer = gtfsRealtime.transit_realtime.FeedMessage.encode(feed).finish();
    const dir = path.dirname(config.GTFS_RT_PATH);
    
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(config.GTFS_RT_PATH, buffer);
    
    logger.info('GTFS-RT feed saved successfully');
  } catch (error) {
    logger.error('Failed to save GTFS-RT feed', { error: error.message });
    throw error;
  }
}

module.exports = {
  convertToGtfsRt,
  saveGtfsRtFeed
};