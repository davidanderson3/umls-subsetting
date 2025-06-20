import { Component, OnInit } from '@angular/core';
import { SourcesService, SourceElement } from '../sources.service';
import { MatTableDataSource } from '@angular/material/table';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.css']
})
export class AdminComponent implements OnInit {
  displayedColumns: string[] = ['abbreviation', 'expandedForm', 'active'];
  dataSource = new MatTableDataSource<SourceElement>();

  constructor(private sourcesService: SourcesService) {}

  ngOnInit(): void {
    // Subscribe to activeSources$ to get updates whenever the sources change
    this.sourcesService.activeSources$.subscribe(
      sources => {
        this.dataSource.data = sources;
      },
      (error: any) => {
        console.error('Error loading sources:', error);
      }
    );
  }

  toggleActive(element: SourceElement): void {
    // Use the toggleActive method from the service
    this.sourcesService.toggleActive(element);
  }
}
