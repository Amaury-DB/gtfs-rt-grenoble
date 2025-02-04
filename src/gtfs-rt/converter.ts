import axios from 'axios';
import { StopTime, TripUpdate, ApiResponse, ApiTime } from './types';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { CacheManager } from './cache-manager';

export class GtfsRtConverter {
  private readonly API_BASE_URL = 'https://data.mobilites-m.fr/api';
  private readonly axiosInstance;
  private cacheManager: CacheManager;
  private rateLimiter: {
    lastRequest: number;
    minDelay: number;
  };

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: this.API_BASE_URL,
      headers: {
        'origin': 'Mobilidia - Contact via contact@mobilidia.fr'
      }
    });
    this.rateLimiter = {
      lastRequest: 0,
      minDelay: 1000 // Minimum 1 second between requests
    };
    this.cacheManager = new CacheManager();
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async makeRateLimitedRequest<T>(
    url: string,
    retries = 3,
    backoffMs = 2000
  ): Promise<T> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.rateLimiter.lastRequest;
    
    if (timeSinceLastRequest < this.rateLimiter.minDelay) {
      await this.delay(this.rateLimiter.minDelay - timeSinceLastRequest);
    }
    
    try {
      this.rateLimiter.lastRequest = Date.now();
      const response = await this.axiosInstance.get<T>(url);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        if (retries > 0) {
          console.log(`Rate limited, retrying in ${backoffMs}ms... (${retries} retries left)`);
          await this.delay(backoffMs);
          return this.makeRateLimitedRequest(url, retries - 1, backoffMs * 2);
        }
      }
      throw error;
    }
  }

  async fetchStopTimes(stopId: string): Promise<StopTime> {
    try {
      // Check cache first
      const cachedData = this.cacheManager.getStopData(stopId);
      if (cachedData) {
        return cachedData;
      }

      const data = await this.makeRateLimitedRequest<ApiResponse[]>(`/routers/default/index/stops/${stopId}/stoptimes`);

      const convertedData = this.convertApiResponseToStopTime(stopId, data);
      
      // Update cache with new data
      this.cacheManager.updateStopData(stopId, convertedData);
      
      return convertedData;
    } catch (error) {
      console.error(`Error fetching stop times for ${stopId}:`, error);
      throw error;
    }
  }

  private convertApiResponseToStopTime(stopId: string, apiResponse: ApiResponse[]): StopTime {
    if (!stopId.toLowerCase().startsWith('sem:') || !apiResponse || !Array.isArray(apiResponse)) {
      console.warn(`Invalid API response for stop ${stopId}`);
      return { pattern: [], times: [] };
    }
    
    const pattern = apiResponse[0]?.pattern;
    if (!pattern) {
      console.warn(`No pattern found for stop ${stopId}`);
      return { pattern: [], times: [] };
    }
    
    const times = apiResponse.flatMap(update => 
      update.times
      .filter(time => time.tripId.toLowerCase().startsWith('sem:'))
      .map((time: ApiTime) => ({
        stopId: time.stopId,
        stopName: time.stopName,
        scheduledArrival: time.scheduledArrival,
        scheduledDeparture: time.scheduledDeparture,
        realtimeArrival: time.realtimeArrival,
        realtimeDeparture: time.realtimeDeparture,
        arrivalDelay: time.arrivalDelay,
        departureDelay: time.departureDelay,
        timepoint: time.timepoint,
        realtime: time.realtime,
        realtimeState: time.realtimeState,
        serviceDay: time.serviceDay,
        tripId: time.tripId,
        pickupType: time.pickupType
      }))
    );

    const result = {
      pattern: pattern ? [{
        id: pattern.id,
        desc: pattern.desc,
        dir: pattern.dir,
        shortDesc: pattern.shortDesc,
        lastStop: pattern.lastStop,
        lastStopName: pattern.lastStopName
      }] : [],
      times
    };

    return result;
  }

  async validateStopId(stopId: string): Promise<boolean> {
    try {
      // Normalize stop ID format
      const normalizedStopId = stopId.toUpperCase();
      
      // Validate ID format
      if (!stopId.toLowerCase().startsWith('sem:')) {
        console.warn(`Stop ID ${stopId} does not start with SEM: prefix`);
        return false;
      }

      // Make the request with normalized ID
      const data = await this.makeRateLimitedRequest<ApiResponse[]>(`/routers/default/index/stops/${normalizedStopId}/stoptimes`);
      
      // Check if the response contains valid data
      if (!data || !Array.isArray(data) || data.length === 0) {
        console.warn(`Stop ID ${stopId} returned empty or invalid data`);
        return false;
      }
      
      // Check if the stop has valid pattern and times
      if (!data[0]?.pattern || !data[0]?.times || data[0].times.length === 0) {
        console.warn(`Stop ID ${stopId} has no pattern data`);
        return false;
      }
      
      // Verify pattern has required fields
      const pattern = data[0].pattern;
      if (!pattern.id || !pattern.desc || pattern.dir === undefined) {
        console.warn(`Stop ID ${stopId} has incomplete pattern data`);
        return false;
      }
      
      return true;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.warn(`Stop ID ${stopId} validation failed: ${error.response?.status === 404 ? 'Stop not found' : error.message}`);
      } else {
        console.warn(`Stop ID ${stopId} validation failed with unexpected error`);
      }
      return false;
    }
  }

  private getCurrentTimestamp(): number {
    return Math.floor(new Date().getTime() / 1000); // Ensure UTC POSIX time in seconds
  }

  private createJsonFeedMessage(tripUpdates: TripUpdate[]): any {
    const timestamp = this.getCurrentTimestamp();
    const currentTime = Math.floor(Date.now() / 1000); // UTC POSIX time in seconds
    
    return {
      header: {
        gtfsRealtimeVersion: '2.0',
        incrementality: 0,
        timestamp: currentTime
      },
      entity: tripUpdates.map((update, index) => ({
        id: index.toString(),
        tripUpdate: {
          trip: {
            tripId: update.tripId,
            routeId: update.routeId,
            scheduleRelationship: 0
          },
          stopTimeUpdate: update.stopTimeUpdates.map(stu => ({
            stopId: stu.stopId,
            departure: {
              delay: stu.departure.delay,
              time: Math.floor(stu.departure.time) // Ensure integer UTC POSIX time in seconds
            },
            scheduleRelationship: 0
          }))
        }
      }))
    };
  }

  private createFeedMessage(tripUpdates: TripUpdate[]): Uint8Array {
    const feed = this.createJsonFeedMessage(tripUpdates);
    return GtfsRealtimeBindings.transit_realtime.FeedMessage.encode(feed).finish();
  }

  async generateJsonFeed(stopIds: string[]): Promise<any> {
    const tripUpdates = await this.generateTripUpdates(stopIds);
    return this.createJsonFeedMessage(tripUpdates);
  }

  private async generateTripUpdates(stopIds: string[]): Promise<TripUpdate[]> {
    console.log(`Generating feed for ${stopIds.length} stops: ${stopIds.slice(0, 5).join(', ')}${stopIds.length > 5 ? '...' : ''}`);
    
    // Clean up expired cache entries
    this.cacheManager.clearExpiredData();
    
    // Log cache stats
    const stats = this.cacheManager.getStats();
    console.log(`Cache stats - Total cached: ${stats.totalCached}, Average age: ${Math.round(stats.averageAge/1000)}s`);
    
    const validationResults = await Promise.all(
      stopIds.map(id => this.validateStopId(id))
    );
    const validStopIds = stopIds.filter((_, index) => validationResults[index]);
    console.log(`Valid stops: ${validStopIds.length}/${stopIds.length}`);

    if (validStopIds.length === 0) {
      console.warn(`No valid stops found in batch. Received ${stopIds.length} stops, all were invalid.`);
      return [];
    }

    const stopTimes = await Promise.all(
      validStopIds.map(stopId => this.fetchStopTimes(stopId))
    );
    console.log(`Fetched stop times for ${stopTimes.length} stops`);

    const tripUpdates = stopTimes
      .flatMap(stopTime => this.convertToTripUpdate(stopTime))
      .filter(update => {
        const hasDelay = update.delay !== 0;
        if (!hasDelay) {
          console.log(`Skipping update for trip ${update.tripId} - no delay`);
        }
        return hasDelay;
      });

    if (tripUpdates.length === 0) {
      console.warn('No trip updates with delays found. Check if:');
      console.warn('1. Stops are valid and accessible');
      console.warn('2. There are any active trips');
      console.warn('3. Any trips have delays');
    }

    return tripUpdates;
  }

  async generateFeed(stopIds: string[]): Promise<Uint8Array> {
    const tripUpdates = await this.generateTripUpdates(stopIds);
    return this.createFeedMessage(tripUpdates);
  }

  private convertToTripUpdate(stopTime: StopTime): TripUpdate[] {
    if (stopTime.pattern.length === 0) {
      console.log('No pattern found in stopTime');
      return [];
    }

    const ensureValidTimes = (time: {
      realtimeArrival: number;
      realtimeDeparture: number;
      arrivalDelay: number;
      departureDelay: number;
      scheduledArrival: number;
      scheduledDeparture: number;
      serviceDay: number;
    }) => {
      // Convert to POSIX timestamps (seconds since epoch)
      const scheduledDepartureTime = time.serviceDay + Math.max(time.scheduledDeparture, time.scheduledArrival);
      const realtimeDepartureTime = time.serviceDay + Math.max(time.realtimeDeparture, time.realtimeArrival);

      // Calculate delay in milliseconds (always positive)
      const delayInSeconds = Math.abs(realtimeDepartureTime - scheduledDepartureTime);
      const delayInMilliseconds = delayInSeconds * 1000;

      return {
        delay: delayInMilliseconds,
        time: Math.floor(realtimeDepartureTime) // POSIX time in seconds
      }
    };

    const formatRouteId = (patternId: string): string => {
      // Remove SEM: prefix (case insensitive)
      const cleanId = patternId.replace(/^sem:/i, '');
      
      // Extract the route identifier (can be number, letter, or combination)
      const match = cleanId.match(/^(?:sem:)?([a-z0-9]+)(?::\d+)*$/i);
      if (match?.[1]) {
        // Keep alphanumeric characters, preserve case for letters
        return match[1].replace(/-/g, '');
      }
      // Fallback: keep alphanumeric characters
      return cleanId.replace(/-/g, '').replace(/[^a-z0-9]/gi, '') || '0';
    };

    const updates = stopTime.times
      .map(time => {
        if (!time.tripId.toLowerCase().startsWith('sem:')) {
          return null;
        }

        const validTimes = ensureValidTimes(time);
        // Only include updates with actual delays
        if (validTimes.delay < 1000) { // Less than 1 second delay
          return null;
        }

        return {
          tripId: time.tripId,
          routeId: formatRouteId(stopTime.pattern[0]?.id || ''),
          delay: validTimes.delay,
          timestamp: this.getCurrentTimestamp(),
          stopTimeUpdates: [{
            stopId: time.stopId,
            departure: validTimes
          }]
        };
      })
      .filter((update): update is NonNullable<typeof update> => update !== null);

    if (updates.length === 0) {
      console.log('No times found for pattern:', stopTime.pattern[0]?.id);
    }

    return updates;
  }
}