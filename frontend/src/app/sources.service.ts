import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { map } from 'rxjs/operators';

export interface SourceElement {
  abbreviation: string;
  expandedForm: string;
  active: boolean;
  languageAbbreviation?: string; // Optional language abbreviation
}

@Injectable({
  providedIn: 'root'
})
export class SourcesService {

  private apiUrl = 'https://uts-ws.nlm.nih.gov/rest/metadata/current/sources';
  private saveUrl = 'http://localhost:3001/api/saveSources';
  private loadUrl = 'http://localhost:3001/api/getActiveSources';
  // New subset endpoint URL for the UMLS Metathesaurus subset
  private subsetUrl = 'http://localhost:3001/api/subsetMetathesaurus';

  private activeSources = new BehaviorSubject<SourceElement[]>([]);
  activeSources$ = this.activeSources.asObservable();

  constructor(private http: HttpClient) { }

  // Method to fetch sources from the API
  getSources(): Observable<SourceElement[]> {
    return this.http.get<any>(this.apiUrl).pipe(
      map(data => {
        // Map sources without filtering by language
        const sources: SourceElement[] = data.result.map((source: any) => ({
          abbreviation: source.abbreviation,
          expandedForm: source.expandedForm,
          active: false,
          languageAbbreviation: source.language?.abbreviation // Get the language abbreviation if available
        }));

        // Load saved active states from the backend
        this.loadActiveStates().subscribe(savedActiveStates => {
          sources.forEach((source: SourceElement) => {
            const savedSource = savedActiveStates.find(s => s.abbreviation === source.abbreviation);
            if (savedSource) {
              source.active = savedSource.active; // Update active status from saved states
            }
          });

          // Sort the sources by abbreviation
          sources.sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));

          // Update BehaviorSubject with the sorted sources
          this.activeSources.next(sources);
        });

        return sources;
      })
    );
  }

  // Toggle active status and save
  toggleActive(source: SourceElement): void {
    source.active = !source.active;
    this.updateActiveSources(this.activeSources.getValue());
  }

  // Update the active sources and save
  updateActiveSources(sources: SourceElement[]): void {
    this.activeSources.next(sources);
    this.saveSources(sources).subscribe();
  }

  // Save sources to the backend
  saveSources(sources: SourceElement[]): Observable<any> {
    return this.http.post(this.saveUrl, sources);
  }

  // Load active states from the backend
  private loadActiveStates(): Observable<SourceElement[]> {
    return this.http.get<SourceElement[]>(this.loadUrl).pipe(
      map((data: SourceElement[]) => data.map(source => ({
        abbreviation: source.abbreviation,
        expandedForm: source.expandedForm,
        active: source.active
      })))
    );
  }

  // New method: Subset the UMLS Metathesaurus based on selected source abbreviations.
  subsetMetathesaurus(selectedSourceAbbreviations: string[]): Observable<SourceElement[]> {
    return this.http.post<SourceElement[]>(this.subsetUrl, { selectedSourceAbbreviations });
  }
}
