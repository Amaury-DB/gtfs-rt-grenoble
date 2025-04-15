const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

const api = axios.create({
  baseURL: config.API_BASE_URL,
  timeout: config.REQUEST_TIMEOUT
});

async function getAllStops() {
  try {
    const response = await api.get('/points/json', {
      params: {
        types: 'stops',
        includeHiddenAgencies: true
      }
    });

    // Filter stops for SEM agency only
    const stops = response.data.features
      .filter(feature => feature.properties.gtfsId.startsWith(config.AGENCY_FILTER + ':'))
      .map(feature => feature.properties.gtfsId);
    
    logger.info(`Found ${stops.length} SEM stops`);
    return stops;
  } catch (error) {
    logger.error('Failed to fetch stops', { error: error.message });
    throw error;
  }
}

async function getStopTimes(stopId) {
  try {
    const response = await api.get(`/routers/default/index/stops/${stopId}/stoptimes`, {
      params: {
        showCancelledTrips: true
      }
    });
    return response.data;
  } catch (error) {
    logger.error('Failed to fetch stop times', { stopId, error: error.message });
    return null;
  }
}

module.exports = {
  getAllStops,
  getStopTimes
};