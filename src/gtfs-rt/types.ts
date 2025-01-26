export interface ApiPattern {
  id: string;
  desc: string;
  dir: number;
  shortDesc: string;
  lastStop: string;
  lastStopName: string;
}

export interface ApiTime {
  stopId: string;
  stopName: string;
  scheduledArrival: number;
  scheduledDeparture: number;
  realtimeArrival: number;
  realtimeDeparture: number;
  arrivalDelay: number;
  departureDelay: number;
  timepoint: boolean;
  realtime: boolean;
  realtimeState: string;
  serviceDay: number;
  tripId: string;
  pickupType: string;
}

export interface ApiResponse {
  pattern: ApiPattern;
  times: ApiTime[];
}

export interface StopTime {
  pattern: Array<{
    id: string;
    desc: string;
    dir: number;
    shortDesc: string;
    lastStop: string;
    lastStopName: string;
  }>;
  times: {
    stopId: string;
    stopName: string;
    scheduledArrival: number;
    scheduledDeparture: number;
    realtimeArrival: number;
    realtimeDeparture: number;
    arrivalDelay: number;
    departureDelay: number;
    timepoint: boolean;
    realtime: boolean;
    realtimeState: string;
    serviceDay: number;
    tripId: string;
    pickupType: string;
  }[];
}

export interface TripUpdate {
  tripId: string;
  routeId: string;
  delay: number;
  timestamp: number;
  stopTimeUpdates: {
    stopId: string;
    departure: {
      delay: number;
      time: number;
    };
  }[];
}