module.exports = {
  API_BASE_URL: 'https://data.mobilites-m.fr/api',
  BATCH_SIZE: 10, // Number of stops to process in parallel
  BATCH_DELAY: 1000, // Delay between batches in milliseconds
  UPDATE_INTERVAL: '*/5 * * * *', // Run every 5 minutes
  GTFS_RT_PATH: './gtfs-rt/trip_updates.pb',
  AGENCY_FILTER: 'SEM', // Filter for SEM agency only
  REQUEST_TIMEOUT: 10000, // API request timeout in milliseconds
};