import { StopTime, TripUpdate } from './types';

interface CachedStopData {
  lastUpdated: number;
  data: StopTime;
}

export class CacheManager {
  private stopCache: Map<string, CachedStopData> = new Map();
  private readonly cacheLifetime = 30000; // 30 seconds cache lifetime

  private getPosixTime(): number {
    return Math.floor(Date.now() / 1000); // UTC POSIX time
  }

  public getStopData(stopId: string): StopTime | null {
    const cached = this.stopCache.get(stopId);
    if (!cached) return null;
    
    const now = this.getPosixTime();
    if (now - cached.lastUpdated > this.cacheLifetime) {
      this.stopCache.delete(stopId);
      return null;
    }
    
    return cached.data;
  }

  public updateStopData(stopId: string, data: StopTime): void {
    // Only update if data has changed
    const existing = this.stopCache.get(stopId);
    if (existing && this.isDataEqual(existing.data, data)) {
      return;
    }

    this.stopCache.set(stopId, {
      lastUpdated: this.getPosixTime(),
      data
    });
  }

  public clearExpiredData(): void {
    const now = this.getPosixTime();
    for (const [stopId, cached] of this.stopCache.entries()) {
      if (now - cached.lastUpdated > this.cacheLifetime) {
        this.stopCache.delete(stopId);
      }
    }
  }

  private isDataEqual(a: StopTime, b: StopTime): boolean {
    // Compare patterns
    if (a.pattern.length !== b.pattern.length) return false;
    
    // Compare times
    if (a.times.length !== b.times.length) return false;
    
    // Compare each time entry's key fields
    return a.times.every((timeA, index) => {
      const timeB = b.times[index];
      return timeA.tripId === timeB.tripId &&
             timeA.realtimeDeparture === timeB.realtimeDeparture &&
             timeA.departureDelay === timeB.departureDelay;
    });
  }

  public getCachedStops(): string[] {
    return Array.from(this.stopCache.keys());
  }

  public getStats(): {
    totalCached: number;
    averageAge: number;
  } {
    const now = this.getPosixTime();
    const ages = Array.from(this.stopCache.values())
      .map(cache => now - cache.lastUpdated);
    
    return {
      totalCached: this.stopCache.size,
      averageAge: ages.length ? 
        ages.reduce((sum, age) => sum + age, 0) / ages.length : 
        0
    };
  }
}