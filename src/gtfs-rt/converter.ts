import axios from 'axios';
import { StopTime, TripUpdate, ApiResponse, ApiTime } from './types';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

export class GtfsRtConverter {
  private readonly API_BASE_URL = 'https://data.mobilites-m.fr/api';
  private readonly axiosInstance;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: this.API_BASE_URL,
      headers: {
        'origin': 'Mobilidia - Contact via contact@mobilidia.fr'
      }
    });
  }

  async fetchStopTimes(stopId: string): Promise<StopTime> {
    try {
      const response = await this.axiosInstance.get(
        `/routers/default/index/stops/${stopId}/stoptimes`
      );

      const data = response.data;
      return this.convertApiResponseToStopTime(stopId, data);
    } catch (error) {
      console.error(`Error fetching stop times for ${stopId}:`, error);
      throw error;
    }
  }

  private convertApiResponseToStopTime(stopId: string, apiResponse: ApiResponse[]): StopTime {
    if (!apiResponse || !Array.isArray(apiResponse)) {
      console.warn(`Invalid API response for stop ${stopId}`);
      return { pattern: [], times: [] };
    }
    
    const pattern = apiResponse[0]?.pattern;
    if (!pattern) {
      console.warn(`No pattern found for stop ${stopId}`);
      return { pattern: [], times: [] };
    }
    
    const times = apiResponse.flatMap(update => 
      update.times.map((time: ApiTime) => ({
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
      if (!stopId.match(/^SEM:[0-9]+$/)) {
        console.warn(`Warning: Invalid stop ID format ${stopId}`);
        return false;
      }

      await this.axiosInstance.get(`/routers/default/index/stops/${stopId}/stoptimes`);
      return true;
    } catch (error) {
      console.warn(`Warning: Invalid stop ID ${stopId}`);
      return false;
    }
  }

  private getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  private createJsonFeedMessage(tripUpdates: TripUpdate[]): any {
    const timestamp = this.getCurrentTimestamp();
    
    return {
      header: {
        gtfsRealtimeVersion: '2.0',
        incrementality: 0,
        timestamp
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
              time: stu.departure.time
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
    
    const validationResults = await Promise.all(
      stopIds.map(id => this.validateStopId(id))
    );
    const validStopIds = stopIds.filter((_, index) => validationResults[index]);

    if (validStopIds.length === 0) {
      console.warn(`No valid stops found in batch. Received ${stopIds.length} stops, all were invalid.`);
      return [];
    }

    const stopTimes = await Promise.all(
      validStopIds.map(stopId => this.fetchStopTimes(stopId))
    );

    const tripUpdates = stopTimes
      .flatMap(stopTime => this.convertToTripUpdate(stopTime))
      .filter(update => update.delay !== 0);

    if (tripUpdates.length === 0) {
      console.warn('No trip updates with delays found');
    }

    return tripUpdates;
  }

  async generateFeed(stopIds: string[]): Promise<Uint8Array> {
    const tripUpdates = await this.generateTripUpdates(stopIds);
    return this.createFeedMessage(tripUpdates);
  }

  private convertToTripUpdate(stopTime: StopTime): TripUpdate[] {
    if (stopTime.pattern.length === 0) {
      return [];
    }

    return stopTime.times.map(time => ({
      tripId: time.tripId,
      routeId: stopTime.pattern[0]?.id.split(':')[1] || '',
      delay: time.departureDelay,
      timestamp: this.getCurrentTimestamp(),
      stopTimeUpdates: [{
        stopId: time.stopId,
        departure: {
          delay: time.departureDelay,
          time: time.realtimeDeparture
        }
      }]
    }));
  }
}