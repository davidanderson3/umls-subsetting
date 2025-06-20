import { Component, OnInit, OnDestroy, NgZone, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-subset-progress',
  templateUrl: './subset-progress.component.html',
  styleUrls: ['./subset-progress.component.css']
})
export class SubsetProgressComponent implements OnInit, OnDestroy {
  progress: { [key: string]: number } = {};
  folderName: string = '';
  downloadUrl: string = '';
  status: string = 'Processing...';
  eventSource: EventSource | null = null;
  selectedSourceAbbreviations: string[] = [];
  activeSteps: Set<string> = new Set();
  pendingComputePreferencesLines: number[] = [];
  mrconsoLineCount: number = 0;
  stepStartTimes: { [key: string]: number } = {};
  stepDurations: { [key: string]: number } = {};
  completedSubsetSources: string[] = [];
  subsetStartTime: number = 0;
  subsetElapsedTimeMs: number = 0;

  steps: string[] = [
    'MRSAB',
    'MRRANK',
    'MRDEF',
    'MRREL',
    'MRSAT',
    'MRCONSO',
    'Compute Preferences',
    'Compressing'
  ];

  expectedLines: { [key: string]: number } = {};

  private quickSteps = new Set(['MRREL', 'MRSAT', 'MRDEF', 'MRSAB', 'MRRANK']);

  constructor(
    private route: ActivatedRoute,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.route.queryParams.subscribe(async params => {
      const abbrevs = params['selectedSourceAbbreviations'];
      if (abbrevs) {
        this.selectedSourceAbbreviations = abbrevs.split(',');
      }
      await this.loadExpectedLines();
      this.startProgress();
    });
  }

  async loadExpectedLines(): Promise<void> {
    try {
      const res = await fetch('http://localhost:3001/api/rowCounts');
      if (!res.ok) throw new Error('Failed to load row counts');
      const data = await res.json();
      this.expectedLines = data;
    } catch (err) {
      this.expectedLines = {}; // Do not set fallback values
    }
  }

  startProgress(): void {
    this.subsetStartTime = Date.now(); // ⏱ Start total timer

    const queryParam = this.selectedSourceAbbreviations.join(',');
    const url = `http://localhost:3001/api/subsetMetathesaurusProgress?selectedSourceAbbreviations=${encodeURIComponent(queryParam)}`;

    this.eventSource = new EventSource(url);

    this.eventSource.addEventListener('progress', (event: MessageEvent) => {
      console.log('📥 progress event:', event.data);
      this.ngZone.run(() => {
        try {
          const data = JSON.parse(event.data);
          this.updateProgress(
            data.step,
            data.processedFiles,
            data.totalFiles,
            data.completed || false,
            data.totalLines
          );

          if (data.step) {
            if (!this.stepStartTimes[data.step]) {
              this.stepStartTimes[data.step] = Date.now();
            }

            if (data.completed === true) {
              const durationMs = Date.now() - this.stepStartTimes[data.step];
              this.stepDurations[data.step] = durationMs;
              this.activeSteps.delete(data.step);
              this.status = Array.from(this.activeSteps).join(', ') || 'Finalizing...';
              console.log(`✅ Step ${data.step} completed in ${durationMs}ms`);
            }
          }
        } catch (e) {
          console.error('Error parsing progress event:', e);
        }
      });
    });

    this.eventSource.addEventListener('step', (event: MessageEvent) => {
      this.ngZone.run(() => {
        try {
          const data = JSON.parse(event.data);
          const step = data.step;
          this.activeSteps.add(step);
          this.stepStartTimes[step] = Date.now();
          this.status = Array.from(this.activeSteps).join(', ');
        } catch (e) {
          console.error('Error parsing step event data:', e);
        }
      });
    });

    this.eventSource.addEventListener('complete', (event: MessageEvent) => {
      this.ngZone.run(() => {
        const data = JSON.parse(event.data);
        console.log('✅ Subsetting complete:', data);
        this.status = '✅ Subsetting complete';
        this.folderName = data.folder;
        this.downloadUrl = `http://localhost:3001/${data.folder}/${data.folder}.tar.gz`;
        this.completedSubsetSources = [...this.selectedSourceAbbreviations];

        this.subsetElapsedTimeMs = Date.now() - this.subsetStartTime;

        console.log('🔎 UI should now display these sources:', this.completedSubsetSources);
        console.log(`🕒 Total time: ${this.getTotalElapsedTime()}`);

        this.eventSource?.close();
      });
    });

    this.eventSource.onerror = (error) => {
      this.ngZone.run(() => {
        console.error('❌ EventSource error:', error);
        this.status = '❌ Error during subsetting';
        this.eventSource?.close();
      });
    };
  }

  updateProgress(
    step: string,
    processedFiles?: number,
    totalFiles?: number,
    completed: boolean = false,
    totalLines?: number
  ): void {
    if (!step) return;

    if (step === 'MRCONSO' && totalLines !== undefined) {
      this.mrconsoLineCount = totalLines;
      console.log(`[updateProgress] captured MRCONSO line count: ${totalLines}`);
      this.pendingComputePreferencesLines.forEach(queuedLines => {
        const percent = Math.min((queuedLines / this.mrconsoLineCount) * 100, 100);
        this.progress['Compute Preferences'] = Math.round(percent);
      });
      this.pendingComputePreferencesLines = [];
      return;
    }

    if (step === 'Compute Preferences' && totalLines !== undefined) {
      if (this.mrconsoLineCount > 0) {
        const percent = Math.min((totalLines / this.mrconsoLineCount) * 100, 100);
        this.progress[step] = Math.round(percent);
      } else {
        this.pendingComputePreferencesLines.push(totalLines);
      }
      return;
    }

    if (step === 'Compressing' && processedFiles !== undefined && totalFiles !== undefined) {
      const percent = Math.min((processedFiles / totalFiles) * 100, 100);
      this.progress[step] = Math.round(percent);
    }

    if (processedFiles !== undefined && totalFiles !== undefined) {
      const percent = Math.min((processedFiles / totalFiles) * 100, 100);
      this.progress[step] = Math.round(percent);
    }

    if (completed) {
      this.progress[step] = 100;
    }

    console.log(`[updateProgress] step=${step} processed=${processedFiles} total=${totalFiles} lines=${totalLines}`);
    console.log(`[updateProgress] mrconsoLineCount=${this.mrconsoLineCount}`);
    console.log(`[updateProgress] progress[${step}] = ${this.progress[step]}`);
  }

  getStepProgress(step: string): number {
    return Math.min(Math.round(this.progress[step] || 0), 100);
  }

  getStepDuration(step: string): string {
    const ms = this.stepDurations[step];
    if (!ms) return '';
    const seconds = (ms / 1000).toFixed(2);
    return `(${seconds}s)`;
  }

  getTotalElapsedTime(): string {
    if (!this.subsetElapsedTimeMs) return '';
    const seconds = (this.subsetElapsedTimeMs / 1000).toFixed(2);
    return `${seconds}s`;
  }

  ngOnDestroy(): void {
    this.eventSource?.close();
  }
}
