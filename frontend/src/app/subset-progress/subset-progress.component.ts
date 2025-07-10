import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-subset-progress',
  templateUrl: './subset-progress.component.html',
  styleUrls: ['./subset-progress.component.css']
})
export class SubsetProgressComponent implements OnInit, OnDestroy {
  progress: { [key: string]: number } = {};
  folderName = '';
  downloadUrl = '';
  status = 'Processing...';
  eventSource: EventSource | null = null;
  selectedSourceAbbreviations: string[] = [];
  activeSteps = new Set<string>();
  pendingComputePreferencesLines: number[] = [];
  mrconsoLineCount = 0;
  stepStartTimes: { [key: string]: number } = {};
  stepDurations: { [key: string]: number } = {};
  completedSubsetSources: string[] = [];
  subsetStartTime = 0;
  subsetElapsedTimeMs = 0;

  steps = [
    'MRSAB',
    'MRRANK',
    'MRDEF',
    'MRREL',
    'MRSAT',
    'MRCONSO',
    'MRDOC',
    'Compute Preferences',
    'Compressing'
  ];

  private quickSteps = new Set(['MRREL', 'MRSAT', 'MRDEF', 'MRSAB', 'MRRANK', 'MRDOC']);

  constructor(
    private route: ActivatedRoute,
    private ngZone: NgZone
  ) { }

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const abbrevs = params['selectedSourceAbbreviations'];
      if (abbrevs) this.selectedSourceAbbreviations = abbrevs.split(',');
      this.startProgress();
    });
  }

  startProgress(): void {
    this.subsetStartTime = Date.now();
    const queryParam = this.selectedSourceAbbreviations.join(',');
    const url = `http://localhost:3001/api/subsetMetathesaurusProgress?selectedSourceAbbreviations=${encodeURIComponent(queryParam)}`;

    this.eventSource = new EventSource(url);

    this.eventSource.addEventListener('progress', (event: MessageEvent) => {
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

          if (data.step && data.completed === true) {
            const durationMs = Date.now() - (this.stepStartTimes[data.step] || 0);
            this.stepDurations[data.step] = durationMs;
            this.activeSteps.delete(data.step);
            this.status = Array.from(this.activeSteps).join(', ') || 'Finalizing...';
          }
        } catch (e) {
          console.error('Error parsing progress event:', e);
        }
      });
    });

    this.eventSource.addEventListener('step', (event: MessageEvent) => {
      this.ngZone.run(() => {
        try {
          const step = JSON.parse(event.data).step;
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
        this.status = '✅ Subsetting complete';
        this.folderName = data.folder;
        this.downloadUrl = `http://localhost:3001/${data.folder}/${data.folder}.tar.gz`;
        this.completedSubsetSources = [...this.selectedSourceAbbreviations];
        this.subsetElapsedTimeMs = Date.now() - this.subsetStartTime;
        this.eventSource?.close();
      });
    });

    this.eventSource.onerror = (error) => {
      this.ngZone.run(() => {
        console.error('EventSource error:', error);
        this.status = '❌ Error during subsetting';
        this.eventSource?.close();
      });
    };
  }

  updateProgress(
    step: string,
    processedFiles?: number,
    totalFiles?: number,
    completed = false,
    totalLines?: number
  ): void {
    if (!step) return;

    if (step === 'MRCONSO' && totalLines != null) {
      this.mrconsoLineCount = totalLines;
      this.pendingComputePreferencesLines.forEach(lines => {
        this.progress['Compute Preferences'] =
          Math.round(Math.min((lines / this.mrconsoLineCount) * 100, 100));
      });
      this.pendingComputePreferencesLines = [];
      return;
    }

    if (step === 'Compute Preferences' && totalLines != null) {
      if (this.mrconsoLineCount > 0) {
        this.progress[step] = Math.round(
          Math.min((totalLines / this.mrconsoLineCount) * 100, 100)
        );
      } else {
        this.pendingComputePreferencesLines.push(totalLines);
      }
      return;
    }

    if (processedFiles != null && totalFiles != null) {
      this.progress[step] = Math.round(
        Math.min((processedFiles / totalFiles) * 100, 100)
      );
    }

    if (completed) {
      this.progress[step] = 100;
    }
  }

  getStepProgress(step: string): number {
    return Math.min(Math.round(this.progress[step] || 0), 100);
  }

  getStepDuration(step: string): string {
    const ms = this.stepDurations[step];
    if (!ms) return '';
    return `(${(ms / 1000).toFixed(2)}s)`;
  }

  getTotalElapsedTime(): string {
    if (!this.subsetElapsedTimeMs) return '';
    return `${(this.subsetElapsedTimeMs / 1000).toFixed(2)}s`;
  }

  ngOnDestroy(): void {
    this.eventSource?.close();
  }
}
