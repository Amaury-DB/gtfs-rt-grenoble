import * as fs from 'fs';
import * as path from 'path';

export class BatchProcessor {
  private stops: string[] = [];
  private currentBatchIndex = 0;
  private readonly batchSize = 5;
  private readonly delayBetweenBatches = 5000; // 5 seconds

  constructor() {
    this.loadStops();
  }

  private loadStops(): void {
    try {
      const stopsPath = path.join(__dirname, 'data/stops.json');
      const stopsData = JSON.parse(fs.readFileSync(stopsPath, 'utf-8'));
      
      // Log the structure of the first feature to understand the format
      if (stopsData.features && stopsData.features.length > 0) {
        console.log('First stop structure:', JSON.stringify(stopsData.features[0], null, 2));
      }
      
      // Extract stop IDs from the features array
      this.stops = stopsData.features
        .map((feature: any) => feature.properties?.gtfsId || null)
        .filter((code: string | null): code is string => 
          code !== null && 
          typeof code === 'string' &&
          code.startsWith('SEM:')
        );

      console.log(`Loaded ${this.stops.length} stops from stops.json. First 5 stops:`, this.stops.slice(0, 5));
      
      if (this.stops.length === 0) {
        console.error('No valid SEM gtfsIds found in stops.json');
      }
    } catch (error) {
      console.error('Error loading stops:', error);
      this.stops = [];
    }
  }

  public getNextBatch(): string[] {
    const batch = this.stops.slice(
      this.currentBatchIndex,
      this.currentBatchIndex + this.batchSize
    );
    
    this.currentBatchIndex += this.batchSize;
    if (this.currentBatchIndex >= this.stops.length) {
      this.currentBatchIndex = 0;
    }
    
    return batch;
  }

  public getBatchDelay(): number {
    return this.delayBetweenBatches;
  }

  public getTotalStops(): number {
    return this.stops.length;
  }
}