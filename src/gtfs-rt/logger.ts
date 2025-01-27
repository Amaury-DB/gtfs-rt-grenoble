import * as fs from 'fs';
import * as path from 'path';

export class RequestLogger {
  private logFile: string;
  private readonly maxLogSize = 10 * 1024 * 1024; // 10MB
  private readonly backupCount = 5;

  constructor() {
    const logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logFile = path.join(logDir, 'requests.log');
  }

  private rotateLogIfNeeded(): void {
    try {
      if (!fs.existsSync(this.logFile)) {
        return;
      }

      const stats = fs.statSync(this.logFile);
      if (stats.size >= this.maxLogSize) {
        // Rotate existing backup files
        for (let i = this.backupCount - 1; i > 0; i--) {
          const oldFile = `${this.logFile}.${i}`;
          const newFile = `${this.logFile}.${i + 1}`;
          if (fs.existsSync(oldFile)) {
            fs.renameSync(oldFile, newFile);
          }
        }
        // Move current log to .1
        fs.renameSync(this.logFile, `${this.logFile}.1`);
      }
    } catch (error) {
      console.error('Error rotating log file:', error);
    }
  }

  public log(message: string): void {
    try {
      this.rotateLogIfNeeded();
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}\n`;
      fs.appendFileSync(this.logFile, logEntry);
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }

  public logRequest(method: string, url: string, status: number, duration: number): void {
    const message = `${method} ${url} - Status: ${status} - Duration: ${duration}ms`;
    this.log(message);
  }

  public logError(error: Error, context?: string): void {
    const message = `ERROR${context ? ` [${context}]` : ''}: ${error.message}\n${error.stack}`;
    this.log(message);
  }

  public getLogContent(lines: number = 100): string[] {
    try {
      if (!fs.existsSync(this.logFile)) {
        return [];
      }
      const content = fs.readFileSync(this.logFile, 'utf-8');
      return content.split('\n').filter(Boolean).slice(-lines);
    } catch (error) {
      console.error('Error reading log file:', error);
      return [];
    }
  }
}