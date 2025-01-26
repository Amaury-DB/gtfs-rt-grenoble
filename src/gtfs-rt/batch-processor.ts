import * as fs from 'fs';
import * as path from 'path';
import { GtfsRtConverter } from './converter';

export class BatchProcessor {
  private stops: string[] = [];
  private currentBatchIndex = 0;
  private readonly batchSize = 10; // Reduced batch size for better distribution
  private readonly cycleTime = 300000; // 5 minutes in milliseconds
  private isInitialized = false;
  private validStops: Set<string> = new Set();

  constructor(private converter: GtfsRtConverter) {}

  public async initialize(): Promise<void> {
    console.log('Initializing BatchProcessor...');
    await this.loadAndValidateStops();
    this.isInitialized = true;
    console.log(`Initialization complete. ${this.validStops.size} valid stops ready for processing.`);
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
    const totalBatches = Math.ceil(this.stops.length / this.batchSize);
    // Ensure minimum delay between batches (at least 1 second)
    const calculatedDelay = Math.floor(this.cycleTime / totalBatches);
    return Math.max(calculatedDelay, 1000);
  }

  public getTotalStops(): number {
    return this.stops.length;
  }

  private async loadAndValidateStops(): Promise<void> {
    this.loadStops();
    
    if (this.stops.length === 0) {
      throw new Error('No stops loaded from stops.json');
    }

    console.log(`Validating ${this.stops.length} stops...`);
    const batchSize = 50; // Validate stops in larger batches for speed
    
    for (let i = 0; i < this.stops.length; i += batchSize) {
      const batch = this.stops.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (stopId) => {
          const isValid = await this.converter.validateStopId(stopId);
          if (isValid) {
            this.validStops.add(stopId);
          }
          return isValid;
        })
      );
      console.log(`Validated batch ${i/batchSize + 1}/${Math.ceil(this.stops.length/batchSize)}: ${results.filter((r: boolean) => r).length} valid stops`);
    }
  }

  public isReady(): boolean {
    return this.isInitialized && this.validStops.size > 0;
  }
}