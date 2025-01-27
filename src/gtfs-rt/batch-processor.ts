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
        .filter((code: string | null): code is string => {
          if (!code || typeof code !== 'string') return false;
          // Only accept IDs that start with SEM:
          return code.toLowerCase().startsWith('sem:');
        }
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

    console.log(`Starting validation of ${this.stops.length} stops...`);
    const batchSize = 100; // Increased batch size for faster validation
    
    let validCount = 0;
    let invalidCount = 0;
    let errorDetails: { [key: string]: string } = {};

    for (let i = 0; i < this.stops.length; i += batchSize) {
      const batch = this.stops.slice(i, i + batchSize);
      const startTime = Date.now();
      
      // Validate stops in parallel with a concurrency limit
      const results = await Promise.all(
        batch.map(async stopId => {
          try {
            const isValid = await this.converter.validateStopId(stopId);
            return { stopId, isValid, error: null };
          } catch (error) {
            return { stopId, isValid: false, error };
          }
        })
      );

      // Process results
      for (const result of results) {
        if (result.isValid) {
          this.validStops.add(result.stopId);
          validCount++;
        } else {
          invalidCount++;
          errorDetails[result.stopId] = result.error ?
            (result.error instanceof Error ? result.error.message : 'Unknown error') :
            'Failed validation check';
        }
      }
      
      const currentBatch = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(this.stops.length/batchSize);
      const timeElapsed = Date.now() - startTime;
      const progress = ((i + batch.length) / this.stops.length * 100).toFixed(1);
      console.log(
        `Batch ${currentBatch}/${totalBatches} complete (${progress}%). ` +
        `Valid: ${validCount}, Invalid: ${invalidCount}. ` +
        `Time: ${(timeElapsed/1000).toFixed(1)}s`
      );
    }
    
    // Log final validation results
    console.log('\nValidation Summary:');
    console.log(`✓ Valid stops: ${validCount}`);
    console.log(`✗ Invalid stops: ${invalidCount}`);
    
    if (invalidCount > 0) {
      console.log('\nInvalid Stops Details:');
      Object.entries(errorDetails).forEach(([stopId, reason]) => {
        console.log(`- ${stopId}: ${reason}`);
      });
    }
    
    if (validCount === 0) {
      throw new Error('No valid stops found after validation');
    }
  }

  public isReady(): boolean {
    return this.isInitialized && this.validStops.size > 0;
  }
}