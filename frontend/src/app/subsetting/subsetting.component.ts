import { Component, OnInit } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { Router } from '@angular/router';
import { SourcesService, SourceElement } from '../sources.service';

@Component({
  selector: 'app-subsetting',
  templateUrl: './subsetting.component.html',
  styleUrls: ['./subsetting.component.css']
})
export class SubsettingComponent implements OnInit {
  displayedColumns: string[] = ['select', 'abbreviation', 'expandedForm', 'languageAbbreviation', 'active'];
  dataSource = new MatTableDataSource<SourceElement>();
  selectedSourceAbbreviations: string[] = [];
  showInactiveSources = false;
  showTranslations = false;
  progressMessages: string[] = [];
  folderName = '';
  downloadUrl = '';
  progress: { totalLines?: number, filteredLines?: number } = {};
  currentStep: string = 'MRCONSO';
  expectedMRCONSOLines: number = 0;
  allSources: SourceElement[] = [];

  constructor(private sourcesService: SourcesService, private router: Router) { }

  ngOnInit(): void {
    this.sourcesService.activeSources$.subscribe(
      (sources: SourceElement[]) => {
        this.allSources = sources;
        this.showInactiveSources = false;
        this.showTranslations = false;
        this.applyFilters(); // filter and pre-select
      },
      (error: any) => {
        console.error('Error loading sources:', error);
      }
    );
  }



  applyFilters(): void {
    const filtered = this.allSources.filter(source =>
      source.active && source.languageAbbreviation === 'ENG'
    );

    this.dataSource.data = [...filtered]; // clone triggers Angular CD

    this.selectedSourceAbbreviations = filtered.map(source => source.abbreviation);
  }


  trackByAbbreviation(index: number, item: SourceElement): string {
    return item.abbreviation;
  }


  toggleInactiveSources(): void {
    this.showInactiveSources = !this.showInactiveSources;
    this.applyDynamicFilters();
  }

  toggleTranslations(): void {
    this.showTranslations = !this.showTranslations;
    this.applyDynamicFilters();
  }

  applyDynamicFilters(): void {
    const filtered = this.allSources.filter(source => {
      const matchesActive = this.showInactiveSources || source.active;
      const matchesTranslation = this.showTranslations || source.languageAbbreviation === 'ENG';
      return matchesActive && matchesTranslation;
    });

    this.dataSource.data = [...filtered];

    // Don't touch selectedSourceAbbreviations here — preserve user's manual selections
  }


  clearSelections(): void {
    this.selectedSourceAbbreviations = [];
  }

  isSelected(source: SourceElement): boolean {
    return this.selectedSourceAbbreviations.includes(source.abbreviation);
  }

  toggleSourceSelection(source: SourceElement): void {
    const index = this.selectedSourceAbbreviations.indexOf(source.abbreviation);
    if (index >= 0) {
      this.selectedSourceAbbreviations.splice(index, 1);
    } else {
      this.selectedSourceAbbreviations.push(source.abbreviation);
    }
  }

  startSubsetting(): void {
    const selectedAbbrevs = this.selectedSourceAbbreviations.join(',');
    const url = `/api/subsetMetathesaurusProgress?selectedSourceAbbreviations=${selectedAbbrevs}`;

    this.progressMessages = [];
    this.folderName = '';
    this.downloadUrl = '';

    const eventSource = new EventSource(url);
    eventSource.onmessage = (event) => {
      this.progressMessages.push(`MRCONSO: ${event.data}`);

      try {
        const data = JSON.parse(event.data);
        if (data.totalLines !== undefined && data.filteredLines !== undefined) {
          this.progress = data;
          console.log('Progress update:', this.progress);
        }
      } catch (e) {
        console.error('Error parsing SSE data:', e);
      }
    };

    eventSource.addEventListener('complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      this.progressMessages.push('MRCONSO subsetting complete.');
      this.folderName = data.folder;
      this.downloadUrl = `/api/downloadZip?folder=${this.folderName}`;
      eventSource.close();
    });

    eventSource.onerror = (error) => {
      console.error('Error with MRCONSO subsetting:', error);
      eventSource.close();
    };
  }

  downloadZip(): void {
    if (this.downloadUrl) {
      window.location.href = this.downloadUrl;
    } else {
      console.error('Download URL not available yet.');
    }
  }

  subsetMetathesaurus(): void {
    const queryParams = { selectedSourceAbbreviations: this.selectedSourceAbbreviations.join(',') };
    this.router.navigate(['/subset-progress'], { queryParams });
  }

  getMRCONSOProgressPercentage(): number {
    if (this.currentStep === 'MRCONSO' && this.expectedMRCONSOLines > 0 && this.progress.totalLines !== undefined) {
      const percentage = (this.progress.totalLines / this.expectedMRCONSOLines) * 100;
      return Math.min(percentage, 100);
    }
    return 0;
  }
}
